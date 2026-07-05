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
- email: Find any text matching word@domain.tld. Copy verbatim.
- phone: Any phone number. Include country code if shown (+1, +91, etc.).
- location: City, State/Country. Look near the name/contact section. If just a city, use that.
- linkedin: Any URL or path containing "linkedin.com". Preserve the full URL.
- portfolio: Any GitHub URL (github.com/...), personal website, or other portfolio link that is NOT LinkedIn.

WORK EXPERIENCE — Most critical section. Each job must be a separate object:
- role: The EXACT job title / position held (e.g. "Senior Software Engineer", "Azure DevOps Engineer"). This is WHAT the person did, NOT where. Never put company names here.
- company: The EXACT employer / company name (e.g. "Microsoft", "BCBS", "CVS Health"). This is WHERE they worked. Never put job titles here.
- location: ONLY City and State/Country (e.g. "Redmond, WA", "Remote"). Never put the job title or company name in this field.
- startDate: Exact start date as written (e.g. "Jan 2020", "2/2018", "March 2021"). Never infer.
- endDate: Exact end date as written, OR "Present" if the person currently works there.
- current: Set to true ONLY when "Present", "Current", "Now", or "Ongoing" is the end date.
- description: Extract EVERY bullet point, dash, or numbered item listed under this job.
  Put EACH bullet on its own line separated by \\n.
  Include the full text of each bullet — do NOT truncate, summarize, or omit any.
  Preserve quantitative metrics exactly: "40%", "$2M", "10k users", etc.
  If bullets span multiple lines visually, merge them into one logical bullet.
FIELD ASSIGNMENT — never mix these:
  role = job title only | company = employer name only | location = city/state only

EDUCATION:
- Extract institution name, degree type, field of study, location, start year, end year exactly.
- field: The major/subject (e.g. "Computer Science", "Business Administration").

SKILLS:
- Extract EVERY skill mentioned ANYWHERE in the resume as individual array items.
- Split comma-separated lists into separate items.
- Include: languages, frameworks, tools, platforms, methodologies, certifications, soft skills.

GENERAL:
- Preserve all dates exactly as written.
- Use "" for any missing text field. Use [] for any missing array field.
- NEVER skip a field from the schema.
- Do NOT merge different jobs into one object.
- Do NOT invent or infer information not present in the resume text.`;

function sanitizeParsed(p) {
  // str: coerce any value to string, try multiple key aliases
  const str = (...vals) => {
    for (const v of vals) {
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return '';
  };
  const bool = (...vals) => vals.some(v => v === true || v === 'true' || v === 'yes');
  const arr  = (v) => (Array.isArray(v) ? v : []);

  // Normalise bullet descriptions: handle arrays, objects, or strings
  const normDesc = (x) => {
    const raw = x?.description ?? x?.responsibilities ?? x?.achievements ??
                x?.duties ?? x?.bullets ?? x?.highlights ?? x?.summary ?? '';
    if (Array.isArray(raw)) return raw.map(String).join('\n');
    if (typeof raw === 'string') return raw;
    return '';
  };

  // personal: try both flat and nested shapes the model might return
  const personal = p?.personal ?? p?.contact ?? p ?? {};
  return {
    personal: {
      name:      str(personal?.name, personal?.fullName, personal?.full_name, p?.name),
      email:     str(personal?.email, personal?.emailAddress, personal?.email_address, p?.email),
      phone:     str(personal?.phone, personal?.phoneNumber, personal?.mobile, personal?.telephone, p?.phone),
      location:  str(personal?.location, personal?.address, personal?.city, personal?.cityState, p?.location),
      linkedin:  str(personal?.linkedin, personal?.linkedIn, personal?.linkedinUrl, personal?.linkedin_url, p?.linkedin),
      portfolio: str(personal?.portfolio, personal?.website, personal?.github, personal?.portfolioUrl, personal?.url, p?.portfolio),
    },
    summary: str(p?.summary, p?.objective, p?.profile, p?.professionalSummary, p?.professional_summary),
    experience: arr(p?.experience ?? p?.workExperience ?? p?.work_experience ?? p?.jobs ?? p?.employment ?? p?.employmentHistory).map((x) => {
      const endRaw = str(x?.endDate, x?.end_date, x?.end, x?.to, x?.endYear, x?.end_year);
      const isCurrent = bool(x?.current, x?.isCurrent, x?.is_current, x?.present) ||
                        /\b(present|current|now|ongoing)\b/i.test(endRaw);

      // Resolve role — job title field, with wide alias coverage
      const role = str(
        x?.role, x?.title, x?.jobTitle, x?.job_title, x?.position, x?.designation,
        x?.jobRole, x?.job_role, x?.roleTitle, x?.occupationTitle, x?.occupation
      );
      // Resolve company — employer name field
      const company = str(
        x?.company, x?.employer, x?.organization, x?.companyName, x?.company_name,
        x?.firm, x?.employerName, x?.employer_name, x?.corp, x?.workplace
      );
      // Resolve location — where the job was located
      const location = str(
        x?.location, x?.city, x?.place, x?.jobLocation, x?.job_location,
        x?.workCity, x?.work_location, x?.address, x?.region
      );
      const startDate = str(x?.startDate, x?.start_date, x?.start, x?.from, x?.startYear, x?.start_year);

      // Sanity guard: if role looks like a company name and company looks like a job title,
      // the AI has likely swapped them — detect by checking for obvious company suffixes
      // (Inc, LLC, Corp, Ltd, etc.) and common title keywords (Engineer, Manager, etc.)
      const COMPANY_SUFFIX_RE = /\b(Inc\.?|LLC|Corp\.?|Ltd\.?|Limited|Group|Holdings|Solutions|Services|Technologies|Systems|Consulting|Associates|Partners|Hospital|Bank|University|College|School)\b/i;
      const JOB_TITLE_RE = /\b(Engineer|Developer|Manager|Director|Analyst|Designer|Consultant|Architect|Lead|Senior|Junior|Head|Officer|Specialist|Coordinator|Executive|President|VP|Administrator|Intern|Associate|Principal|Staff|Scientist)\b/i;

      let finalRole = role;
      let finalCompany = company;
      if (
        role && company &&
        COMPANY_SUFFIX_RE.test(role) && !COMPANY_SUFFIX_RE.test(company) &&
        JOB_TITLE_RE.test(company) && !JOB_TITLE_RE.test(role)
      ) {
        // Clearly swapped — correct it
        finalRole = company;
        finalCompany = role;
      }

      return {
        role:      finalRole,
        company:   finalCompany,
        location,
        startDate,
        endDate:   isCurrent ? 'Present' : endRaw,
        current:   isCurrent,
        description: normDesc(x),
      };
    }),
    education: arr(p?.education ?? p?.educationHistory ?? p?.education_history).map((x) => ({
      school:    str(x?.school, x?.institution, x?.university, x?.college, x?.name),
      degree:    str(x?.degree, x?.qualification, x?.credential, x?.award),
      field:     str(x?.field, x?.major, x?.fieldOfStudy, x?.field_of_study, x?.subject, x?.specialization),
      location:  str(x?.location, x?.city, x?.place),
      startDate: str(x?.startDate, x?.start_date, x?.start, x?.from, x?.startYear),
      endDate:   str(x?.endDate, x?.end_date, x?.end, x?.to, x?.endYear, x?.graduationYear),
      current:   bool(x?.current, x?.isCurrent, x?.enrolled),
      description: str(x?.description, x?.notes, x?.activities),
    })),
    skills: (() => {
      // skills might be array of strings, array of objects, or a single comma-separated string
      const raw = p?.skills ?? p?.technicalSkills ?? p?.technical_skills ?? [];
      if (typeof raw === 'string') return raw.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
      return arr(raw).flatMap(s => {
        if (typeof s === 'string') return s.split(/[,;|]/).map(t => t.trim()).filter(Boolean);
        if (typeof s === 'object' && s !== null) {
          return [str(s?.name, s?.skill, s?.value)].filter(Boolean);
        }
        return [];
      });
    })(),
    projects: arr(p?.projects ?? p?.sideProjects ?? p?.side_projects).map((x) => ({
      name:        str(x?.name, x?.title, x?.projectName),
      link:        str(x?.link, x?.url, x?.github, x?.website),
      description: str(x?.description, x?.summary, x?.details),
    })),
    certifications: arr(p?.certifications ?? p?.certificates ?? p?.credentials).map((x) => ({
      name:   str(x?.name, x?.title, x?.certification),
      issuer: str(x?.issuer, x?.issuedBy, x?.organization, x?.provider, x?.authority),
      date:   str(x?.date, x?.year, x?.issued, x?.issuedDate),
    })),
    achievements: arr(p?.achievements ?? p?.honors ?? p?.awards).map(a => {
      if (typeof a === 'string') return a.trim();
      if (typeof a === 'object' && a !== null) return str(a?.title, a?.name, a?.description);
      return '';
    }).filter(Boolean),
    languages: arr(p?.languages).map(l => {
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
 */
async function parseResumeWithAI(rawText) {
  if (!process.env.XAI_API_KEY) {
    console.warn('[aiResumeParser] XAI_API_KEY not set — using regex fallback');
    return parseResumeText(rawText);
  }

  try {
    const trimmed = rawText.slice(0, 12000); // generous limit — resumes can be long
    const json = await callXAI(
      [
        { role: 'system', content: PARSE_SYSTEM_PROMPT },
        { role: 'user', content: `Parse this resume completely and accurately. Return ONLY raw JSON, no markdown:\n\n${trimmed}` }
      ],
      4000 // enough for dense resumes with many bullet points
    );
    return sanitizeParsed(JSON.parse(json));
  } catch (err) {
    console.error('[aiResumeParser] AI parse failed, falling back to regex:', err.message);
    return parseResumeText(rawText);
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
