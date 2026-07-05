/**
 * AI-powered resume parser and tailor using xAI (Grok) API.
 * Falls back to the rule-based regex parser if XAI_API_KEY is missing or the call fails.
 */
const { parseResumeText } = require('./resumeParser');

// ─── Shared xAI caller ───────────────────────────────────────────────────────

async function callXAI(messages, maxTokens = 3000) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not configured');

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'grok-3-mini',   // upgrade to grok-3 if available on your plan for higher accuracy
      max_tokens: maxTokens,
      messages
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`xAI API ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  // Strip any accidental markdown fences the model might add
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// ─── Resume parsing ───────────────────────────────────────────────────────────

const PARSE_SYSTEM_PROMPT = `You are an expert resume data extractor. Your task is to parse the provided resume text with MAXIMUM ACCURACY and return ONLY a valid JSON object — no markdown fences, no explanation, no commentary, no trailing text.

CRITICAL RULES:
1. Extract EVERY piece of information, even if partially mentioned
2. For "personal.name": look for the person's full name at the top of the resume — it's usually the largest/first text
3. For "personal.email": find any email address (look for @ symbol)
4. For "personal.phone": extract any phone number including country codes
5. For "personal.location": city, state, country — look near name/contact info
6. For "personal.linkedin": look for linkedin.com URLs or "LinkedIn:" labels — include full URL
7. For "personal.portfolio": look for github.com, personal websites, "Portfolio:", "Website:" labels
8. For "experience.description": extract ALL bullet points/achievements, each on its own line separated by \n — do NOT truncate
9. For "skills": extract EVERY skill mentioned anywhere in the resume as individual array items
10. For dates: preserve exactly as written (e.g., "Jan 2022", "2020–2023", "Present")
11. If a field is not found, use "" for strings and [] for arrays — NEVER omit a field

Schema:
{
  "personal": {
    "name": "Full name — usually the very first line of the resume",
    "email": "email address",
    "phone": "phone number with country code if present",
    "location": "City, State/Province, Country",
    "linkedin": "full LinkedIn URL or empty string",
    "portfolio": "portfolio, GitHub, or website URL or empty string"
  },
  "summary": "Professional summary paragraph, or empty string",
  "experience": [
    {
      "role": "Job title",
      "company": "Company name",
      "location": "City, State",
      "startDate": "Month Year (e.g. Jan 2022)",
      "endDate": "Month Year or Present",
      "current": true or false,
      "description": "Bullet-point achievements, one per line separated by \\n"
    }
  ],
  "education": [
    {
      "school": "University or school name",
      "degree": "Degree title (e.g. Bachelor of Science)",
      "field": "Field of study (e.g. Computer Science)",
      "location": "City, State",
      "startDate": "Year or Month Year",
      "endDate": "Year or Month Year or Present",
      "current": true or false,
      "description": ""
    }
  ],
  "skills": ["skill1", "skill2", ...],
  "projects": [{ "name": "Project name", "link": "URL or empty", "description": "What it does" }],
  "certifications": [{ "name": "Cert name", "issuer": "Issuing body", "date": "Date or empty" }],
  "achievements": ["achievement1", ...],
  "languages": ["English (native)", "Spanish (fluent)", ...],
  "publications": [{ "title": "Paper title", "link": "URL or empty", "date": "Year or empty" }]
}

STRICT EXTRACTION RULES — READ EVERY RULE CAREFULLY:

PERSONAL INFO:
- name: The person's FULL NAME at the very top — usually the first non-blank line. Extract exactly, including middle names.
  * Must be a real human name (First Last, or First Middle Last).
  * NEVER a 1-3 character abbreviation, initials, "Resume", "CV", or a job title.
  * If the top of the resume shows initials/nickname followed by the full name on the next line, use the FULL NAME.
  * If no clean full name is found, return "" — do NOT guess.
- email: Find any text matching word@domain.tld. Copy verbatim.
- phone: Any phone number. Include country code if shown (+1, +91, etc.).
- location: City, State/Country. Must be a real geographic place (e.g. "Redmond, WA", "Mumbai, India").
  * NEVER put a job description sentence, skill, or bullet text into location.
  * If unsure, return "".
- linkedin: Any URL or path containing "linkedin.com". Preserve the full URL.
- portfolio: Any GitHub URL (github.com/...), personal website, or other portfolio link that is NOT LinkedIn.

WORK EXPERIENCE — Most critical section. Each job must be a separate object:
- role: The EXACT job title as written (e.g. "Senior Software Engineer", "Product Manager II"). Do NOT paraphrase.
- company: The EXACT company/employer name as written. Do NOT abbreviate.
- location: City, State where the job was located (if shown). May be "Remote".
  * Only include if the resume explicitly shows a city/state next to that job.
  * NEVER copy a bullet point or description sentence into location.
  * Must be short (< 40 chars), typically "City, ST" or "Remote".
  * If unsure, return "".
- startDate: Exact start date as written (e.g. "Jan 2020", "2/2018", "March 2021"). Never infer.
- endDate: Exact end date as written, OR "Present" if the person currently works there.
- current: Set to true ONLY when "Present", "Current", "Now", or "Ongoing" is the end date.
- description: Extract EVERY bullet point, dash, or numbered item listed under this job.
  * Put EACH bullet on its own line separated by \\n.
  * Include the full text of each bullet — do NOT truncate, summarize, or omit any.
  * Preserve quantitative metrics exactly: "40%", "$2M", "10k users", etc.
  * If bullets span multiple lines visually (soft-wrapped), merge them into ONE logical bullet.
  * If a line starts with a lowercase word or continues a sentence from the previous line, it belongs to the previous bullet — do NOT create a new one.

EDUCATION:
- Extract institution name, degree type, field of study, location, start year, end year exactly.
- field: The major/subject (e.g. "Computer Science", "Business Administration").

SKILLS — VERY IMPORTANT:
- Skills lists are often written as "Category: item1, item2, item3" (e.g. "Cloud Platforms: Azure, AWS, GCP").
- Extract ONLY the actual items (item1, item2, item3) — NEVER include the category label ("Cloud Platforms", "DevOps Tools", "Databases", "Infrastructure as Code", "Containers & Orchestration", etc.) as a skill.
- NEVER include a colon character in any skill name.
- NEVER prefix a skill with a colon (e.g. ":Docker" is WRONG — use "Docker").
- Each skill should be a clean, standalone technology/tool/competency name.
- Split comma-separated lists into separate items.
- Include: languages, frameworks, tools, platforms, methodologies, soft skills.
- Do NOT include duplicates.

CERTIFICATIONS:
- "name" is the certification title only.
- "issuer" is the organization (Microsoft, AWS, Google, Databricks, etc.) — extract separately when identifiable.

GENERAL:
- Preserve all dates exactly as written.
- Use "" for any missing text field. Use [] for any missing array field.
- NEVER skip a field from the schema.
- Do NOT merge different jobs into one object.
- Do NOT invent or infer information not present in the resume text.`;

// ─── Helpers used by sanitizeParsed ──────────────────────────────────────────

const SKILL_CATEGORY_LABELS = new Set([
  'cloud platforms', 'devops tools', 'infrastructure as code',
  'containers & orchestration', 'ci/cd & release management',
  'scripting & automation', 'monitoring & logging',
  'security & devsecops', 'databases', 'operating systems',
  'programming languages', 'frameworks', 'tools', 'technologies',
  'languages', 'methodologies', 'soft skills', 'other',
  'version control', 'collaboration', 'cloud', 'devops'
]);

function cleanSkill(s) {
  if (!s) return '';
  let t = String(s).trim();
  // Strip leading/trailing colons, dashes, bullets, whitespace
  t = t.replace(/^[:\-•\u2022\s]+/, '').replace(/[:\-\s]+$/, '').trim();
  if (!t) return '';
  if (SKILL_CATEGORY_LABELS.has(t.toLowerCase())) return '';
  if (t.length > 60) return '';
  // Reject anything containing a colon in the middle (likely a mis-split
  // "Category: item" leftover)
  if (t.includes(':')) return '';
  return t;
}

function flattenSkills(val) {
  if (val == null) return [];
  if (typeof val === 'string') {
    // Handle "Category: item1, item2, item3" — drop the category prefix
    const colonIdx = val.indexOf(':');
    let listPart = val;
    if (colonIdx > 0 && colonIdx < 40) {
      const label = val.slice(0, colonIdx).trim().toLowerCase();
      if (SKILL_CATEGORY_LABELS.has(label) || /^[A-Z][A-Za-z &/]{2,30}$/.test(val.slice(0, colonIdx).trim())) {
        listPart = val.slice(colonIdx + 1);
      }
    }
    return listPart.split(/[,;|\n]/).map(cleanSkill).filter(Boolean);
  }
  if (Array.isArray(val)) return val.flatMap(flattenSkills);
  if (typeof val === 'object') {
    // Common shapes: { category, items }, { name: "..." }, { skill: "..." }
    if (Array.isArray(val.items)) return flattenSkills(val.items);
    if (Array.isArray(val.skills)) return flattenSkills(val.skills);
    if (Array.isArray(val.values)) return flattenSkills(val.values);
    const single = cleanSkill(val.name || val.skill || val.value || val.label || '');
    return single ? [single] : [];
  }
  return [];
}

function isPlausibleName(n) {
  if (!n) return false;
  const t = String(n).trim();
  if (t.length < 4 || t.length > 60) return false;
  if (/[@\d]/.test(t)) return false;
  if (/https?:\/\//i.test(t)) return false;
  if (/^(resume|cv|curriculum vitae)$/i.test(t)) return false;
  if (!/^[A-Za-z][A-Za-z .'\-]+$/.test(t)) return false;
  return t.split(/\s+/).length >= 2;
}

function cleanName(n) {
  if (!n) return '';
  const t = String(n).trim();
  return isPlausibleName(t) ? t : '';
}

function isPlausibleLocation(l) {
  if (!l) return false;
  const t = String(l).trim();
  if (t.length < 2 || t.length > 60) return false;
  if (/[.!?]$/.test(t)) return false;
  if (/^[a-z]/.test(t)) return false;
  if (/^(and|or|with|for|to|by|in|on|of|the)\b/i.test(t)) return false;
  return true;
}

// Merge soft-wrapped bullet continuations produced by mammoth's line
// splitting on long paragraphs.
function mergeWrappedBullets(text) {
  if (!text) return '';
  const lines = String(text).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.length > 0);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const prev = out[out.length - 1];
    const isBulletStart = /^[•\u2022\-*▪○●]/.test(trimmed);
    const startsLower = /^[a-z]/.test(trimmed);
    const startsWithConj = /^(and|or|with|for|to|by|in|on|of|the|a|an|but|which|that|while)\b/i.test(trimmed);
    const prevIncomplete = prev && /[a-z,]$/.test(prev.trim());

    if (prev && !isBulletStart && (startsLower || startsWithConj || prevIncomplete)) {
      out[out.length - 1] = prev.replace(/\s+$/, '') + ' ' + trimmed;
    } else {
      out.push(line);
    }
  }
  // Strip leading bullet glyphs for consistency
  return out.map((l) => l.replace(/^[•\u2022\-*▪○●]\s*/, '')).join('\n');
}

function sanitizeParsed(p) {
  const str = (...vals) => {
    for (const v of vals) {
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return '';
  };
  const bool = (...vals) => vals.some((v) => v === true || v === 'true' || v === 'yes');
  const arr  = (v) => (Array.isArray(v) ? v : []);

  const normDesc = (x) => {
    const raw = x?.description ?? x?.responsibilities ?? x?.achievements ??
                x?.duties ?? x?.bullets ?? x?.highlights ?? x?.summary ?? '';
    let text = '';
    if (Array.isArray(raw)) text = raw.map(String).join('\n');
    else if (typeof raw === 'string') text = raw;
    return mergeWrappedBullets(text);
  };

  const personal = p?.personal ?? p?.contact ?? p ?? {};

  return {
    personal: {
      name:      cleanName(str(personal?.name, personal?.fullName, personal?.full_name, p?.name)),
      email:     str(personal?.email, personal?.emailAddress, personal?.email_address, p?.email),
      phone:     str(personal?.phone, personal?.phoneNumber, personal?.mobile, personal?.telephone, p?.phone),
      location:  (() => {
        const l = str(personal?.location, personal?.address, personal?.city, personal?.cityState, p?.location);
        return isPlausibleLocation(l) ? l : '';
      })(),
      linkedin:  str(personal?.linkedin, personal?.linkedIn, personal?.linkedinUrl, personal?.linkedin_url, p?.linkedin),
      portfolio: str(personal?.portfolio, personal?.website, personal?.github, personal?.portfolioUrl, personal?.url, p?.portfolio),
    },
    summary: str(p?.summary, p?.objective, p?.profile, p?.professionalSummary, p?.professional_summary),
    experience: arr(p?.experience ?? p?.workExperience ?? p?.work_experience ?? p?.jobs).map((x) => {
      const endRaw = str(x?.endDate, x?.end_date, x?.end, x?.to, x?.endYear);
      const isCurrent = bool(x?.current, x?.isCurrent, x?.is_current) ||
                        /\b(present|current|now|ongoing)\b/i.test(endRaw);
      let loc = str(x?.location, x?.city, x?.place, x?.jobLocation);
      // Guard: reject bullet-fragment leakage into location field
      if (loc && !isPlausibleLocation(loc)) loc = '';
      return {
        role:      str(x?.role, x?.title, x?.jobTitle, x?.job_title, x?.position, x?.designation),
        company:   str(x?.company, x?.employer, x?.organization, x?.companyName, x?.company_name, x?.firm),
        location:  loc,
        startDate: str(x?.startDate, x?.start_date, x?.start, x?.from, x?.startYear),
        endDate:   isCurrent ? 'Present' : endRaw,
        current:   isCurrent,
        description: normDesc(x),
      };
    }),
    education: arr(p?.education ?? p?.educationHistory ?? p?.education_history).map((x) => ({
      school:    str(x?.school, x?.institution, x?.university, x?.college, x?.name),
      degree:    str(x?.degree, x?.qualification, x?.credential, x?.award),
      field:     str(x?.field, x?.major, x?.fieldOfStudy, x?.field_of_study, x?.subject, x?.specialization),
      location:  (() => {
        const l = str(x?.location, x?.city, x?.place);
        return isPlausibleLocation(l) ? l : '';
      })(),
      startDate: str(x?.startDate, x?.start_date, x?.start, x?.from, x?.startYear),
      endDate:   str(x?.endDate, x?.end_date, x?.end, x?.to, x?.endYear, x?.graduationYear),
      current:   bool(x?.current, x?.isCurrent, x?.enrolled),
      description: str(x?.description, x?.notes, x?.activities),
    })),
    skills: (() => {
      const raw = p?.skills ?? p?.technicalSkills ?? p?.technical_skills ?? [];
      const list = flattenSkills(raw);
      // Dedupe (case-insensitive), preserve first-seen order
      const seen = new Set();
      const deduped = [];
      for (const s of list) {
        const k = s.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        deduped.push(s);
      }
      return deduped.slice(0, 80);
    })(),
    projects: arr(p?.projects ?? p?.sideProjects ?? p?.side_projects).map((x) => ({
      name:        str(x?.name, x?.title, x?.projectName),
      link:        str(x?.link, x?.url, x?.github, x?.website),
      description: str(x?.description, x?.summary, x?.details),
    })),
    certifications: arr(p?.certifications ?? p?.certificates ?? p?.credentials).map((x) => {
      let name   = str(x?.name, x?.title, x?.certification);
      let issuer = str(x?.issuer, x?.issuedBy, x?.organization, x?.provider, x?.authority);
      // If issuer missing but name mentions a known issuer, extract it
      if (!issuer && name) {
        const m = name.match(/\b(Microsoft|AWS|Amazon|Google|Cisco|Oracle|IBM|Coursera|Udemy|PMI|CompTIA|Databricks|Snowflake|HashiCorp|Red Hat|Kubernetes|Linux Foundation|Salesforce|Adobe)\b/i);
        if (m) issuer = m[1];
      }
      return {
        name,
        issuer,
        date: str(x?.date, x?.year, x?.issued, x?.issuedDate),
      };
    }),
    achievements: arr(p?.achievements ?? p?.honors ?? p?.awards).map((a) => {
      if (typeof a === 'string') return a.trim();
      if (typeof a === 'object' && a !== null) return str(a?.title, a?.name, a?.description);
      return '';
    }).filter(Boolean),
    languages: arr(p?.languages).map((l) => {
      if (typeof l === 'string') return l.trim();
      if (typeof l === 'object' && l !== null) {
        const name  = str(l?.language, l?.name);
        const level = str(l?.level, l?.proficiency, l?.fluency);
        return level ? `${name} (${level})` : name;
      }
      return '';
    }).filter(Boolean),
    publications: arr(p?.publications).map((x) => ({
      title: str(x?.title, x?.name),
      link:  str(x?.link, x?.url),
      date:  str(x?.date, x?.year),
    })),
  };
}

/**
 * Parse a raw resume text into structured fields using xAI Grok.
 * Falls back to the regex parser if the API key is absent or the call fails.
 * If the AI result has obviously missing critical fields (e.g. name), we
 * try to backfill from the regex parser rather than shipping empty data.
 */
async function parseResumeWithAI(rawText) {
  const regexResult = parseResumeText(rawText);

  if (!process.env.XAI_API_KEY) {
    console.warn('[aiResumeParser] XAI_API_KEY not set — using regex fallback');
    return regexResult;
  }

  try {
    const trimmed = rawText.slice(0, 12000);
    const json = await callXAI(
      [
        { role: 'system', content: PARSE_SYSTEM_PROMPT },
        { role: 'user', content: `Parse this resume completely and accurately. Return ONLY raw JSON, no markdown:\n\n${trimmed}` }
      ],
      4000
    );
    const aiResult = sanitizeParsed(JSON.parse(json));

    // Backfill from regex parser when AI leaves critical fields blank
    if (!aiResult.personal.name && regexResult.personal.name) {
      aiResult.personal.name = regexResult.personal.name;
    }
    if (!aiResult.personal.email && regexResult.personal.email) {
      aiResult.personal.email = regexResult.personal.email;
    }
    if (!aiResult.personal.phone && regexResult.personal.phone) {
      aiResult.personal.phone = regexResult.personal.phone;
    }
    if (!aiResult.personal.location && regexResult.personal.location) {
      aiResult.personal.location = regexResult.personal.location;
    }
    if (!aiResult.personal.linkedin && regexResult.personal.linkedin) {
      aiResult.personal.linkedin = regexResult.personal.linkedin;
    }
    if ((!aiResult.skills || aiResult.skills.length === 0) && regexResult.skills.length) {
      aiResult.skills = regexResult.skills;
    }
    return aiResult;
  } catch (err) {
    console.error('[aiResumeParser] AI parse failed, falling back to regex:', err.message);
    return regexResult;
  }
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

/**
 * Tailor an existing resume to a specific job description using xAI Grok.
 * Throws if XAI_API_KEY is not configured or the API call fails.
 */
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
        description: e.description
      }))
    },
    null,
    2
  );

  const json = await callXAI(
    [
      { role: 'system', content: TAILOR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Job Title: ${jobTitle || 'Not specified'}\n\nJob Description:\n${jobDescription.slice(0, 4000)}\n\nCurrent Resume:\n${snapshot}`
      }
    ],
    2500
  );

  return JSON.parse(json);
}

module.exports = { parseResumeWithAI, tailorResumeWithAI };
