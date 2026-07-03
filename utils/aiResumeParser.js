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
      model: 'grok-3-mini',
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

const PARSE_SYSTEM_PROMPT = `You are a precise resume parser. Extract every piece of structured information from the resume text below and return ONLY a valid JSON object. No markdown, no explanation, no code fences — raw JSON only.

Schema:
{
  "personal": {
    "name": "Full name",
    "email": "email address",
    "phone": "phone number",
    "location": "City, State or Country",
    "linkedin": "full LinkedIn URL or empty string",
    "portfolio": "portfolio or website URL or empty string"
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

Rules:
- Preserve dates exactly as written in the resume
- Set current: true only when the job/education says "Present" or "Current"
- Put each work-experience bullet on its own line (\\n-separated) inside "description"
- Extract ALL skills as individual strings
- Use "" for missing text fields, [] for missing list fields`;

function sanitizeParsed(p) {
  const s = (v) => (typeof v === 'string' ? v : '');
  const b = (v) => Boolean(v);
  const a = (v) => (Array.isArray(v) ? v : []);
  return {
    personal: {
      name: s(p?.personal?.name),
      email: s(p?.personal?.email),
      phone: s(p?.personal?.phone),
      location: s(p?.personal?.location),
      linkedin: s(p?.personal?.linkedin),
      portfolio: s(p?.personal?.portfolio)
    },
    summary: s(p?.summary),
    experience: a(p?.experience).map((x) => ({
      role: s(x?.role),
      company: s(x?.company),
      location: s(x?.location),
      startDate: s(x?.startDate),
      endDate: s(x?.endDate),
      current: b(x?.current),
      description: s(x?.description)
    })),
    education: a(p?.education).map((x) => ({
      school: s(x?.school),
      degree: s(x?.degree),
      field: s(x?.field),
      location: s(x?.location),
      startDate: s(x?.startDate),
      endDate: s(x?.endDate),
      current: b(x?.current),
      description: s(x?.description)
    })),
    skills: a(p?.skills).map(String).filter(Boolean),
    projects: a(p?.projects).map((x) => ({
      name: s(x?.name),
      link: s(x?.link),
      description: s(x?.description)
    })),
    certifications: a(p?.certifications).map((x) => ({
      name: s(x?.name),
      issuer: s(x?.issuer),
      date: s(x?.date)
    })),
    achievements: a(p?.achievements).map(String).filter(Boolean),
    languages: a(p?.languages).map(String).filter(Boolean),
    publications: a(p?.publications).map((x) => ({
      title: s(x?.title),
      link: s(x?.link),
      date: s(x?.date)
    }))
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
    const trimmed = rawText.slice(0, 8000); // keep well within Grok's context
    const json = await callXAI(
      [
        { role: 'system', content: PARSE_SYSTEM_PROMPT },
        { role: 'user', content: `Parse this resume:\n\n${trimmed}` }
      ],
      3000
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
