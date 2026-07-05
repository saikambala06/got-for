/**
 * AI-powered resume parser and tailor using xAI (Grok) API.
 * Falls back to the rule-based regex parser if XAI_API_KEY is missing or the call fails.
 */
'use strict';

const { parseResumeText } = require('./resumeParser');

// ─── Shared xAI caller ───────────────────────────────────────────────────────

async function callXAI(messages, maxTokens = 8000) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not configured');

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-3',          // Full grok-3 for maximum accuracy on field extraction
      max_tokens: maxTokens,
      temperature: 0,            // Zero temperature — deterministic, no hallucinations
      messages,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // If grok-3 is unavailable on this plan, fall back to grok-3-mini
    if (response.status === 404 || response.status === 403) {
      return callXAI_mini(messages, maxTokens);
    }
    throw new Error(`xAI API ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  return cleanJSON(data.choices?.[0]?.message?.content || '');
}

async function callXAI_mini(messages, maxTokens = 8000) {
  const apiKey = process.env.XAI_API_KEY;
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-3-mini',
      max_tokens: maxTokens,
      temperature: 0,
      messages,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`xAI API (mini) ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  return cleanJSON(data.choices?.[0]?.message?.content || '');
}

/** Strip markdown fences and find the outermost JSON object */
function cleanJSON(raw) {
  // Remove ```json ... ``` or ``` ... ```
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  // Find the first { and last } to isolate the JSON object
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  return s;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const PARSE_SYSTEM_PROMPT = `You are a precise resume data extraction engine. Extract structured data from the resume text provided by the user.

OUTPUT FORMAT: Return ONLY a single valid JSON object. No markdown, no explanation, no comments. The JSON must be parseable by JSON.parse().

REQUIRED JSON SCHEMA (all fields mandatory — use "" for missing strings, [] for missing arrays):
{
  "personal": {
    "name":      "Full name of the candidate (first line of resume, usually largest text)",
    "email":     "Email address (look for @ symbol)",
    "phone":     "Phone number including country code if present",
    "location":  "City, State or Country of the candidate (from contact section, NOT job locations)",
    "linkedin":  "LinkedIn URL (full URL containing linkedin.com)",
    "portfolio": "GitHub, personal website, or portfolio URL (NOT LinkedIn)"
  },
  "summary": "Professional summary or objective paragraph. Empty string if not present.",
  "experience": [
    {
      "role":        "Job title — WHAT the person did (e.g. 'Software Engineer', 'Product Manager'). NEVER put a company name here.",
      "company":     "Company or employer name — WHERE they worked (e.g. 'Google', 'Microsoft'). NEVER put a job title here.",
      "location":    "City and State/Country of the job location only (e.g. 'Austin, TX', 'Remote'). NEVER put role or company here.",
      "startDate":   "Start date exactly as written (e.g. 'Jan 2020', '03/2019', '2018')",
      "endDate":     "End date exactly as written, or 'Present' if currently employed there",
      "current":     true or false,
      "description": "ALL bullet points under this job, each on its own line, joined with \\n. Never truncate."
    }
  ],
  "education": [
    {
      "school":      "Institution name",
      "degree":      "Degree type (e.g. 'Bachelor of Science', 'Master of Arts')",
      "field":       "Field/major (e.g. 'Computer Science', 'Business Administration')",
      "location":    "City, State of the institution",
      "startDate":   "Start year or date",
      "endDate":     "End year or date or 'Present'",
      "current":     true or false,
      "description": ""
    }
  ],
  "skills":         ["Individual skill strings — split any comma-separated lists"],
  "projects":       [{ "name": "", "link": "", "description": "" }],
  "certifications": [{ "name": "", "issuer": "", "date": "" }],
  "achievements":   ["achievement string"],
  "languages":      ["Language (Proficiency level)"],
  "publications":   [{ "title": "", "link": "", "date": "" }]
}

EXTRACTION RULES — follow these exactly:

PERSONAL SECTION:
• name — The candidate's full name. It is almost always the very first non-blank line of the resume.
• email — Copy verbatim including domain.
• phone — Copy verbatim including any country code.
• location — The candidate's home/contact location from the header. This is NOT the same as job locations.
• linkedin — Only if a linkedin.com URL or path is present.
• portfolio — Only non-LinkedIn websites (GitHub, personal sites).

EXPERIENCE SECTION — CRITICAL — READ CAREFULLY:
• Each distinct job is a SEPARATE object in the array.
• role = job title ONLY. Examples: "Senior DevOps Engineer", "Software Developer", "Data Analyst".
  ✗ WRONG: role = "Microsoft" (that is a company name)
  ✓ CORRECT: role = "Azure DevOps Engineer"
• company = employer name ONLY. Examples: "Microsoft", "Amazon", "JPMorgan Chase", "Blue Cross Blue Shield".
  ✗ WRONG: company = "Azure DevOps Engineer" (that is a job title)
  ✓ CORRECT: company = "Microsoft"
• location = job city/state ONLY. Examples: "Redmond, WA", "New York, NY", "Remote".
  ✗ WRONG: location = "Azure DevOps Engineer at Microsoft" (do not mix fields)
  ✓ CORRECT: location = "Redmond, WA"
• description — Join ALL bullet points for this job with \\n. Include every single bullet. Never summarize or cut short.
• current = true ONLY when end date is "Present", "Current", "Now", or "Ongoing".

DATE RULES:
• Copy start and end dates exactly as they appear in the resume.
• If only a year range appears (e.g. "2018–2021"), use startDate="2018" endDate="2021".
• If the end date says "Present" / "Current" / "Now", set endDate="Present" and current=true.

DO NOT:
• Invent or infer any information not present in the resume text.
• Merge multiple jobs into one object.
• Skip any job, education, skill, or certification.
• Truncate bullet points.
• Put company names in role or job titles in company.`;

// ─── Sanitise / normalise the parsed output ───────────────────────────────────

/**
 * Clean a single skill string — strip colon/bullet artifacts and skip category headers.
 * Fixes: ":Microsoft Azure" → "Microsoft Azure", "Cloud Platforms:" → skipped
 */
const SKILL_CATEGORY_RE = /^(cloud platforms?|devops tools?|infrastructure as code|containers?( [&and]+ orchestration)?|ci\/cd( [&and]+ release management)?|scripting( [&and]+ automation)?|monitoring( [&and]+ logging)?|security( [&and]+ devsecops?)?|programming languages?|frameworks?|databases?|operating systems?|tools?|soft skills?|technical skills?|core competencies|key skills?|professional skills?|certifications?|web technologies|methodologies)$/i;

function cleanSkill(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  // Strip leading colon/bullet artifacts e.g. ":Microsoft Azure" or "• Docker"
  s = s.replace(/^[\s:•\-\u2013\u25aa\u25e6\u2023\u25b6\u2192\u2713]+/, '').trim();
  // Strip trailing colon (category label)
  s = s.replace(/:+$/, '').trim();
  // Skip empty, category-header, or suspiciously long strings (bullet text bleed-through)
  if (!s || SKILL_CATEGORY_RE.test(s) || s.length > 60) return '';
  return s;
}

function sanitizeParsed(p) {
  const str = (...vals) => {
    for (const v of vals) {
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return '';
  };
  const bool = (...vals) => vals.some(v => v === true || v === 'true' || v === 'yes' || v === 1);
  const arr  = (v) => (Array.isArray(v) ? v : []);

  // Normalise description: handle arrays or strings
  const normDesc = (x) => {
    const raw =
      x?.description ?? x?.responsibilities ?? x?.achievements ??
      x?.duties ?? x?.bullets ?? x?.highlights ?? '';
    if (Array.isArray(raw)) return raw.filter(Boolean).map(String).join('\n');
    if (typeof raw === 'string') return raw.trim();
    return '';
  };

  // personal section — support both nested { personal: {...} } and flat shapes
  const personal = p?.personal ?? p?.contact ?? p ?? {};

  // ── Experience entries ─────────────────────────────────────────────────────
  const expSrc =
    p?.experience ??
    p?.workExperience ?? p?.work_experience ??
    p?.employment ?? p?.employmentHistory ?? p?.jobs ?? [];

  const experience = arr(expSrc).map((x) => {
    const endRaw = str(
      x?.endDate, x?.end_date, x?.enddate,
      x?.end, x?.to, x?.endYear, x?.end_year
    );
    const isCurrent =
      bool(x?.current, x?.isCurrent, x?.is_current, x?.present, x?.ongoing) ||
      /\b(present|current|now|ongoing)\b/i.test(endRaw);

    // Wide alias lists so the model's output key variations are all caught
    const role = str(
      x?.role, x?.title, x?.jobTitle, x?.job_title,
      x?.position, x?.designation, x?.jobRole, x?.job_role,
      x?.roleTitle, x?.occupationTitle, x?.occupation, x?.positionTitle
    );
    const company = str(
      x?.company, x?.employer, x?.organization, x?.organisation,
      x?.companyName, x?.company_name, x?.firm, x?.employerName,
      x?.employer_name, x?.corp, x?.workplace, x?.client
    );
    const location = str(
      x?.location, x?.jobLocation, x?.job_location,
      x?.workLocation, x?.work_location, x?.city, x?.place,
      x?.address, x?.region, x?.workCity
    );
    const startDate = str(
      x?.startDate, x?.start_date, x?.startdate,
      x?.start, x?.from, x?.startYear, x?.start_year, x?.fromDate
    );

    // ── Sanity swap: detect and fix obvious role ↔ company swaps ─────────────
    // Company-name indicators: legal suffixes, known corporate words
    const COMPANY_RE = /\b(Inc\.?|LLC|LLP|Corp\.?|Ltd\.?|Limited|Group|Holdings|Solutions|Services|Technologies|Systems|Consulting|Associates|Partners|Hospital|Bank|University|College|School|Institute|Foundation|Agency|Bureau|Department|Ministry|Authority|Council)\b/i;
    // Job-title indicators: seniority levels and role keywords
    const TITLE_RE   = /\b(Engineer|Developer|Manager|Director|Analyst|Designer|Consultant|Architect|Lead|Senior|Junior|Head|Officer|Specialist|Coordinator|Executive|President|VP|Vice President|Administrator|Intern|Associate|Principal|Staff|Scientist|Researcher|Strategist|Advisor|Technician|Programmer|Operator|Supervisor|Controller|Accountant|Recruiter|Writer|Editor|Trainer|Representative)\b/i;

    let finalRole    = role;
    let finalCompany = company;

    if (role && company) {
      const roleIsCompany = COMPANY_RE.test(role)  && !TITLE_RE.test(role);
      const companyIsRole = TITLE_RE.test(company) && !COMPANY_RE.test(company);
      if (roleIsCompany && companyIsRole) {
        finalRole    = company;
        finalCompany = role;
      }
    }

    // If role is still empty but we have a title-like value hiding in location, pull it out
    if (!finalRole && location && TITLE_RE.test(location) && !COMPANY_RE.test(location)) {
      finalRole = location;
    }

    return {
      role:        finalRole,
      company:     finalCompany,
      location:    finalRole === location ? '' : location, // don't duplicate if we moved it
      startDate,
      endDate:     isCurrent ? 'Present' : endRaw,
      current:     isCurrent,
      description: normDesc(x),
    };
  });

  // ── Education ──────────────────────────────────────────────────────────────
  const eduSrc =
    p?.education ?? p?.educationHistory ?? p?.education_history ??
    p?.educations ?? p?.academics ?? [];

  const education = arr(eduSrc).map((x) => ({
    school:      str(x?.school, x?.institution, x?.university, x?.college, x?.institute, x?.name),
    degree:      str(x?.degree, x?.qualification, x?.credential, x?.award, x?.diploma),
    field:       str(x?.field, x?.major, x?.fieldOfStudy, x?.field_of_study, x?.subject, x?.specialization, x?.concentration),
    location:    str(x?.location, x?.city, x?.place, x?.campus),
    startDate:   str(x?.startDate, x?.start_date, x?.start, x?.from, x?.startYear),
    endDate:     str(x?.endDate, x?.end_date, x?.end, x?.to, x?.endYear, x?.graduationYear, x?.graduation_year),
    current:     bool(x?.current, x?.isCurrent, x?.enrolled),
    description: str(x?.description, x?.notes, x?.activities, x?.gpa),
  }));

  // ── Skills ─────────────────────────────────────────────────────────────────
  const skillsRaw =
    p?.skills ?? p?.technicalSkills ?? p?.technical_skills ??
    p?.coreSkills ?? p?.core_skills ?? p?.competencies ?? [];

  const skills = (() => {
    if (typeof skillsRaw === 'string') {
      return skillsRaw.split(/[,;|•\n]/).map(s => cleanSkill(s)).filter(Boolean);
    }
    return arr(skillsRaw).flatMap(s => {
      if (typeof s === 'string') return s.split(/[,;|•]/).map(t => cleanSkill(t)).filter(Boolean);
      if (s && typeof s === 'object') {
        // Handle { category: "...", items: [...] } shape
        if (Array.isArray(s?.items)) return s.items.flatMap(i => typeof i === 'string' ? i.split(/[,;]/).map(t => cleanSkill(t)).filter(Boolean) : [str(i?.name, i?.skill)].filter(Boolean));
        if (Array.isArray(s?.skills)) return s.skills.map(i => cleanSkill(str(i?.name ?? i)));
        // Handle { category: "Cloud Platforms", skills: ["Azure", "AWS"] } shape
        if (s?.category && Array.isArray(s?.list)) return s.list.map(i => cleanSkill(str(i)));
        return [cleanSkill(str(s?.name, s?.skill, s?.value, s?.label))].filter(Boolean);
      }
      return [];
    });
  })();

  // ── Certifications ─────────────────────────────────────────────────────────
  const certSrc = p?.certifications ?? p?.certificates ?? p?.credentials ?? p?.certs ?? [];
  const certifications = arr(certSrc).map((x) => ({
    name:   str(x?.name, x?.title, x?.certification, x?.certificate),
    issuer: str(x?.issuer, x?.issuedBy, x?.organization, x?.organisation, x?.provider, x?.authority, x?.by),
    date:   str(x?.date, x?.year, x?.issued, x?.issuedDate, x?.issued_date, x?.dateObtained),
  }));

  // ── Projects ───────────────────────────────────────────────────────────────
  const projSrc = p?.projects ?? p?.sideProjects ?? p?.side_projects ?? p?.personalProjects ?? [];
  const projects = arr(projSrc).map((x) => ({
    name:        str(x?.name, x?.title, x?.projectName, x?.project),
    link:        str(x?.link, x?.url, x?.github, x?.website, x?.repo),
    description: str(x?.description, x?.summary, x?.details, x?.about),
  }));

  // ── Achievements ───────────────────────────────────────────────────────────
  const achSrc = p?.achievements ?? p?.honors ?? p?.awards ?? p?.accomplishments ?? [];
  const achievements = arr(achSrc).map(a => {
    if (typeof a === 'string') return a.trim();
    if (a && typeof a === 'object') return str(a?.title, a?.name, a?.description, a?.award);
    return '';
  }).filter(Boolean);

  // ── Languages ──────────────────────────────────────────────────────────────
  const languages = arr(p?.languages).map(l => {
    if (typeof l === 'string') return l.trim();
    if (l && typeof l === 'object') {
      const name  = str(l?.language, l?.name, l?.lang);
      const level = str(l?.level, l?.proficiency, l?.fluency);
      return level ? `${name} (${level})` : name;
    }
    return '';
  }).filter(Boolean);

  // ── Publications ───────────────────────────────────────────────────────────
  const publications = arr(p?.publications ?? p?.papers ?? p?.research).map((x) => ({
    title: str(x?.title, x?.name, x?.paper),
    link:  str(x?.link, x?.url, x?.doi),
    date:  str(x?.date, x?.year, x?.published),
  }));

  return {
    personal: {
      name:      str(personal?.name, personal?.fullName, personal?.full_name, p?.name),
      email:     str(personal?.email, personal?.emailAddress, personal?.email_address, p?.email),
      phone:     str(personal?.phone, personal?.phoneNumber, personal?.phone_number, personal?.mobile, personal?.telephone, personal?.cell, p?.phone),
      location:  str(personal?.location, personal?.address, personal?.city, personal?.cityState, personal?.city_state, p?.location),
      linkedin:  str(personal?.linkedin, personal?.linkedIn, personal?.linkedinUrl, personal?.linkedin_url, personal?.linkedInUrl, p?.linkedin),
      portfolio: str(personal?.portfolio, personal?.website, personal?.github, personal?.portfolioUrl, personal?.url, personal?.web, p?.portfolio),
    },
    summary:        str(p?.summary, p?.objective, p?.profile, p?.professionalSummary, p?.professional_summary, p?.about, p?.overview),
    experience,
    education,
    skills,
    projects,
    certifications,
    achievements,
    languages,
    publications,
  };
}

// ─── Main parse function ──────────────────────────────────────────────────────

/**
 * Parse raw resume text into structured fields using xAI Grok.
 * Falls back to the regex parser only if the API key is absent.
 */
async function parseResumeWithAI(rawText) {
  if (!process.env.XAI_API_KEY) {
    console.warn('[aiResumeParser] XAI_API_KEY not set — using regex fallback');
    return parseResumeText(rawText);
  }

  // Send up to 20,000 chars — enough for the densest multi-page resume
  const trimmed = rawText.slice(0, 20000);

  let jsonStr;
  try {
    jsonStr = await callXAI([
      { role: 'system', content: PARSE_SYSTEM_PROMPT },
      { role: 'user',   content: `Extract all resume data from the text below. Return ONLY the JSON object, nothing else.\n\n---\n${trimmed}\n---` },
    ], 8000);
  } catch (err) {
    console.error('[aiResumeParser] AI call failed, falling back to regex:', err.message);
    return parseResumeText(rawText);
  }

  // Try to parse the JSON; if it fails, attempt a repair pass
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (parseErr) {
    console.warn('[aiResumeParser] JSON parse failed, attempting repair pass…');
    try {
      // Ask the model to fix its own malformed JSON output
      const repaired = await callXAI([
        { role: 'system',    content: 'You are a JSON repair engine. Fix any syntax errors in the JSON provided by the user. Return ONLY the corrected JSON, nothing else.' },
        { role: 'user',      content: `Fix the JSON syntax errors in this output and return only valid JSON:\n\n${jsonStr.slice(0, 8000)}` },
      ], 8000);
      parsed = JSON.parse(repaired);
    } catch (repairErr) {
      console.error('[aiResumeParser] Repair pass also failed, falling back to regex:', repairErr.message);
      return parseResumeText(rawText);
    }
  }

  const result = sanitizeParsed(parsed);

  // Quality check: if AI returned zero experience entries but the raw text has
  // experience keywords, run the regex parser and merge missing experience
  if (result.experience.length === 0 && /experience|employment|work history/i.test(rawText)) {
    console.warn('[aiResumeParser] AI returned 0 experience entries — merging regex fallback');
    const regexResult = parseResumeText(rawText);
    if (regexResult.experience && regexResult.experience.length > 0) {
      result.experience = regexResult.experience;
    }
  }

  return result;
}

// ─── Resume tailoring ─────────────────────────────────────────────────────────

const TAILOR_SYSTEM_PROMPT = `You are an expert resume writer and career coach. Tailor the provided resume content to better match the job description by:
- Rewriting the professional summary to reflect the target role
- Reordering and refining the skills list to prioritise the most relevant ones first
- Sharpening experience bullet points to highlight achievements that align with the job requirements, using keywords from the job posting where authentic
- Never inventing facts — only rephrase and reorder what already exists

Return ONLY valid JSON, no markdown, no explanation:
{
  "summary": "New 2–3 sentence tailored professional summary",
  "skills": ["skill1", "skill2", ...reordered/refined list],
  "experience": [
    {
      "index": 0,
      "description": "Rewritten bullet points (\\n-separated)"
    }
  ],
  "suggestions": "1–2 sentence explanation of the key changes made"
}`;

async function tailorResumeWithAI(resume, jobTitle, jobDescription) {
  if (!process.env.XAI_API_KEY) {
    throw new Error('AI tailoring requires XAI_API_KEY to be configured');
  }

  const snapshot = JSON.stringify(
    {
      summary: resume.summary,
      skills: resume.skills,
      experience: resume.experience.map((e, i) => ({
        index: i,
        role: e.role,
        company: e.company,
        description: e.description,
      })),
    },
    null,
    2
  );

  const json = await callXAI(
    [
      { role: 'system', content: TAILOR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Job Title: ${jobTitle || 'Not specified'}\n\nJob Description:\n${jobDescription.slice(0, 4000)}\n\nCurrent Resume:\n${snapshot}`,
      },
    ],
    3000
  );

  return JSON.parse(json);
}

module.exports = { parseResumeWithAI, tailorResumeWithAI };
