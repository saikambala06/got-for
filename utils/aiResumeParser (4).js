'use strict';
const { parseResumeText } = require('./resumeParser');

// ─── xAI caller with JSON mode enforced ──────────────────────────────────────
async function callGrok(messages, maxTokens = 6000) {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error('XAI_API_KEY not set');

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'grok-3-mini',
      max_tokens: maxTokens,
      temperature: 0,
      response_format: { type: 'json_object' }, // forces pure JSON — no markdown, no preamble
      messages,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`xAI ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '{}';
}

// ─── Prompt ───────────────────────────────────────────────────────────────────
const SYSTEM = `You extract resume data and return it as JSON.

Return this exact JSON structure (no extra keys, no markdown):
{
  "personal": {
    "name": "candidate full name",
    "email": "email@example.com",
    "phone": "+1 234 567 8900",
    "location": "City, State",
    "linkedin": "linkedin.com/in/username",
    "portfolio": ""
  },
  "summary": "professional summary text",
  "experience": [
    {
      "role": "Job Title",
      "company": "Company Name",
      "location": "City, State",
      "startDate": "Mon YYYY",
      "endDate": "Mon YYYY or Present",
      "current": false,
      "description": "bullet 1\\nbullet 2\\nbullet 3"
    }
  ],
  "education": [
    {
      "school": "University Name",
      "degree": "Degree Type",
      "field": "Field of Study",
      "location": "",
      "startDate": "",
      "endDate": "YYYY",
      "current": false,
      "description": ""
    }
  ],
  "skills": ["Skill 1", "Skill 2"],
  "projects": [{ "name": "", "link": "", "description": "" }],
  "certifications": [{ "name": "", "issuer": "", "date": "" }],
  "achievements": [],
  "languages": [],
  "publications": []
}

RULES — follow exactly:
1. personal.name  = candidate's own full name (first line of resume)
2. personal.location = candidate's home city/state from contact section
3. experience[].role = job title ONLY — never a company name
4. experience[].company = employer name ONLY — never a job title  
5. experience[].location = city/state of THAT job — never a bullet point fragment
6. experience[].description = join every bullet point with \\n — include ALL bullets, do not truncate
7. experience[].current = true only when endDate is "Present"
8. skills = individual skill strings ONLY — no category headers like "Cloud Platforms" or "DevOps Tools"
9. skills = strip any leading colon, bullet, or dash from each skill name
10. If a field has no data use "" for strings, [] for arrays, false for booleans
11. Do NOT invent data — only extract what is in the resume text`;

// ─── Sanitise output ──────────────────────────────────────────────────────────
function sanitize(p) {
  const s = (...v) => { for (const x of v) { if (typeof x === 'string' && x.trim()) return x.trim(); if (typeof x === 'number') return String(x); } return ''; };
  const b = (...v) => v.some(x => x === true || x === 'true' || x === 'yes');
  const a = v => Array.isArray(v) ? v : [];

  // Normalise description array-or-string
  const desc = x => {
    const raw = x?.description ?? x?.responsibilities ?? x?.bullets ?? x?.duties ?? '';
    if (Array.isArray(raw)) return raw.filter(Boolean).map(String).join('\n');
    return typeof raw === 'string' ? raw.trim() : '';
  };

  // Clean a single skill — strip colon/bullet prefixes and skip category headers
  const CATEGORY = /^(cloud platforms?|devops tools?|infrastructure as code|containers?|orchestration|ci\/?cd|scripting|automation|monitoring|logging|security|devsecops?|programming|frameworks?|databases?|tools?|soft skills?|technical skills?|core competencies|key skills?|certifications?)$/i;
  const cleanSkill = raw => {
    if (!raw) return '';
    let sk = String(raw).trim().replace(/^[\s:•\-–▪◦○→✓]+/, '').replace(/:+$/, '').trim();
    if (!sk || sk.length > 60 || CATEGORY.test(sk)) return '';
    return sk;
  };

  const personal = p?.personal ?? p?.contact ?? p ?? {};
  const expSrc = a(p?.experience ?? p?.workExperience ?? p?.work_experience ?? p?.jobs ?? p?.employment ?? []);
  const eduSrc = a(p?.education ?? p?.educationHistory ?? p?.academics ?? []);
  const skillSrc = p?.skills ?? p?.technicalSkills ?? p?.technical_skills ?? [];
  const certSrc = a(p?.certifications ?? p?.certificates ?? p?.credentials ?? []);
  const projSrc = a(p?.projects ?? p?.sideProjects ?? []);

  // Skill normalisation: handle string, array-of-strings, or array-of-{category,items} objects
  let skills = [];
  if (typeof skillSrc === 'string') {
    skills = skillSrc.split(/[,;\n|•]/).map(cleanSkill).filter(Boolean);
  } else {
    skills = a(skillSrc).flatMap(sk => {
      if (typeof sk === 'string') return sk.split(/[,;|•]/).map(cleanSkill).filter(Boolean);
      if (sk && typeof sk === 'object') {
        // { category: "...", items: [...] }  or  { category, skills: [...] }
        const items = a(sk.items ?? sk.skills ?? sk.list ?? []);
        if (items.length) return items.flatMap(i => typeof i === 'string' ? i.split(/[,;]/).map(cleanSkill).filter(Boolean) : [cleanSkill(s(i?.name, i?.skill))].filter(Boolean));
        return [cleanSkill(s(sk.name, sk.skill, sk.value))].filter(Boolean);
      }
      return [];
    });
  }

  // Experience: resolve aliases + sanity-swap role↔company if obviously swapped
  const COMPANY_RE = /\b(Inc\.?|LLC|LLP|Corp\.?|Ltd\.?|Limited|Group|Holdings|Solutions|Services|Technologies|Systems|Consulting|Associates|Partners|Hospital|Bank|University|College|School|Institute|Health|Insurance|Financial|Capital|Digital|Global|International)\b/i;
  const TITLE_RE   = /\b(Engineer|Developer|Manager|Director|Analyst|Designer|Consultant|Architect|Lead|Senior|Junior|Head|Officer|Specialist|Coordinator|Executive|President|VP|Administrator|Intern|Principal|Scientist|Technician|Programmer|Supervisor|Representative|Recruiter|Strategist|Researcher|Advisor)\b/i;

  const experience = expSrc.map(x => {
    const endRaw = s(x?.endDate, x?.end_date, x?.end, x?.to, x?.endYear);
    const isCurrent = b(x?.current, x?.isCurrent, x?.present) || /\b(present|current|now)\b/i.test(endRaw);

    let role    = s(x?.role, x?.title, x?.jobTitle, x?.job_title, x?.position, x?.designation, x?.jobRole);
    let company = s(x?.company, x?.employer, x?.organization, x?.organisation, x?.companyName, x?.firm, x?.employerName);
    let location = s(x?.location, x?.jobLocation, x?.city, x?.place, x?.workCity);
    const startDate = s(x?.startDate, x?.start_date, x?.start, x?.from, x?.startYear);

    // Swap if AI clearly mixed them up
    if (role && company) {
      if (COMPANY_RE.test(role) && !TITLE_RE.test(role) && TITLE_RE.test(company) && !COMPANY_RE.test(company)) {
        [role, company] = [company, role];
      }
    }
    // If location got a bullet fragment (ends with period and >30 chars, likely not a city)
    if (location && (location.length > 40 || /\.\s*$/.test(location)) && !/(,\s*[A-Z]{2}|remote)/i.test(location)) {
      location = '';
    }

    return {
      role, company, location, startDate,
      endDate: isCurrent ? 'Present' : endRaw,
      current: isCurrent,
      description: desc(x),
    };
  });

  return {
    personal: {
      name:      s(personal?.name, personal?.fullName, p?.name),
      email:     s(personal?.email, personal?.emailAddress, p?.email),
      phone:     s(personal?.phone, personal?.phoneNumber, personal?.mobile, p?.phone),
      location:  s(personal?.location, personal?.address, personal?.city, p?.location),
      linkedin:  s(personal?.linkedin, personal?.linkedIn, personal?.linkedinUrl, p?.linkedin),
      portfolio: s(personal?.portfolio, personal?.website, personal?.github, p?.portfolio),
    },
    summary: s(p?.summary, p?.objective, p?.profile, p?.professionalSummary),
    experience,
    education: eduSrc.map(x => ({
      school:    s(x?.school, x?.institution, x?.university, x?.college, x?.name),
      degree:    s(x?.degree, x?.qualification, x?.credential, x?.diploma),
      field:     s(x?.field, x?.major, x?.fieldOfStudy, x?.subject, x?.specialization),
      location:  s(x?.location, x?.city, x?.campus),
      startDate: s(x?.startDate, x?.start_date, x?.start, x?.startYear),
      endDate:   s(x?.endDate, x?.end_date, x?.graduationYear, x?.endYear),
      current:   b(x?.current, x?.isCurrent, x?.enrolled),
      description: s(x?.description, x?.notes, x?.gpa),
    })),
    skills,
    certifications: certSrc.map(x => ({
      name:   s(x?.name, x?.title, x?.certification),
      issuer: s(x?.issuer, x?.issuedBy, x?.organization, x?.provider, x?.by),
      date:   s(x?.date, x?.year, x?.issued),
    })),
    projects: projSrc.map(x => ({
      name:        s(x?.name, x?.title, x?.projectName),
      link:        s(x?.link, x?.url, x?.github, x?.website),
      description: s(x?.description, x?.summary, x?.details),
    })),
    achievements: a(p?.achievements ?? p?.awards ?? p?.honors).map(x => typeof x === 'string' ? x.trim() : s(x?.title, x?.name)).filter(Boolean),
    languages:    a(p?.languages).map(x => typeof x === 'string' ? x.trim() : (() => { const n = s(x?.language, x?.name); const l = s(x?.level, x?.proficiency); return l ? `${n} (${l})` : n; })()).filter(Boolean),
    publications: a(p?.publications ?? p?.papers).map(x => ({ title: s(x?.title, x?.name), link: s(x?.link, x?.url), date: s(x?.date, x?.year) })),
  };
}

// ─── Main: parse resume text with AI ─────────────────────────────────────────
async function parseResumeWithAI(rawText) {
  if (!process.env.XAI_API_KEY) {
    console.warn('[parser] No XAI_API_KEY — using regex fallback');
    return parseResumeText(rawText);
  }

  // Limit text to 18k chars (enough for a 3-page resume)
  const text = rawText.slice(0, 18000);

  try {
    const jsonStr = await callGrok([
      { role: 'system', content: SYSTEM },
      { role: 'user',   content: `Extract all data from this resume:\n\n${text}` },
    ], 6000);

    const parsed = JSON.parse(jsonStr);
    const result = sanitize(parsed);

    // Safety: if AI returned 0 experience entries, use regex as backup
    if (result.experience.length === 0 && /experience|employment/i.test(rawText)) {
      const fallback = parseResumeText(rawText);
      if (fallback.experience?.length) result.experience = fallback.experience;
    }

    return result;
  } catch (err) {
    console.error('[parser] AI failed, falling back to regex:', err.message);
    return parseResumeText(rawText);
  }
}

// ─── Tailor ───────────────────────────────────────────────────────────────────
async function tailorResumeWithAI(resume, jobTitle, jobDescription) {
  if (!process.env.XAI_API_KEY) throw new Error('XAI_API_KEY not configured');

  const snap = JSON.stringify({
    summary: resume.summary,
    skills:  resume.skills,
    experience: resume.experience.map((e, i) => ({ index: i, role: e.role, company: e.company, description: e.description })),
  }, null, 2);

  const TAILOR_SYS = `You are a resume writer. Tailor the resume to match the job description.
Return only this JSON:
{
  "summary": "new tailored summary",
  "skills": ["skill1","skill2"],
  "experience": [{"index": 0, "description": "rewritten bullets\\nseparated by newline"}],
  "suggestions": "brief explanation"
}
Rules: never invent facts, only rewrite what exists, use job keywords authentically.`;

  const jsonStr = await callGrok([
    { role: 'system', content: TAILOR_SYS },
    { role: 'user',   content: `Job: ${jobTitle}\n\nDescription:\n${jobDescription.slice(0, 3000)}\n\nResume:\n${snap}` },
  ], 3000);

  return JSON.parse(jsonStr);
}

module.exports = { parseResumeWithAI, tailorResumeWithAI };
