/**
 * AI-powered resume parser using xAI (Grok).
 * Falls back to the rule-based regex parser if XAI_API_KEY is missing or the call fails.
 */
const { parseResumeText } = require('./resumeParser');

// ─── Shared xAI caller ───────────────────────────────────────────────────────

async function callXAIOnce(apiKey, model, messages, maxTokens) {
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,         // deterministic extraction
      messages
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const err = new Error(`xAI API ${response.status}: ${body.slice(0, 200)}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

async function callXAI(messages, maxTokens = 8000) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not configured');

  // grok-3-mini is the model this app is provisioned/documented for. Try it first.
  // If it's ever unavailable for the configured key, fall back to grok-3 rather
  // than hard-failing every AI feature (parsing, tailoring, cover letters).
  try {
    return await callXAIOnce(apiKey, 'grok-3-mini', messages, maxTokens);
  } catch (err) {
    const retryableStatus = [400, 401, 403, 404, 422].includes(err.status);
    if (!retryableStatus) throw err;
    try {
      return await callXAIOnce(apiKey, 'grok-3', messages, maxTokens);
    } catch (err2) {
      throw err; // surface the original error — it's for the model we actually expect to work
    }
  }
}

// ─── Resume text pre-processing ───────────────────────────────────────────────

/**
 * Clean up raw PDF/DOCX extracted text before sending to the AI.
 * Removes page headers/footers, collapses excessive whitespace, normalises bullets.
 */
function preprocessResumeText(raw) {
  return raw
    // Remove page-number artifacts like "-- 1 of 3 --" or "Page 1"
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '\n')
    .replace(/\bPage\s+\d+\s*(of\s+\d+)?\b/gi, '')
    // Normalise various bullet characters to a simple dash
    .replace(/^[\u2022\u25AA\u25CF\u2713\u2714\u25BA\u27A2\u27B3*▪▸]\s*/gm, '- ')
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, '\n\n')
    // Remove trailing spaces on each line
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// ─── System prompt ────────────────────────────────────────────────────────────

const PARSE_SYSTEM_PROMPT = `You are a precision resume data extraction engine. Your ONLY job is to read the resume text and output a single valid JSON object — nothing else. No markdown fences, no commentary, no explanation before or after. Just raw JSON.

=== CRITICAL OUTPUT RULES ===
1. Output ONLY the JSON object. First character must be "{", last must be "}".
2. Every field in the schema MUST appear, even if empty ("" or []).
3. NEVER truncate, summarise, or omit any bullet point from work experience.
4. NEVER invent or infer any data not explicitly in the resume text.

=== FIELD EXTRACTION RULES ===

PERSONAL INFO (look in the first 10 lines of the resume):
- name: The person's FULL name — the very first prominent text, usually all-caps or largest font. Extract exactly.
- email: Any address matching pattern user@domain.tld
- phone: Full phone number including country code (+1, +91, etc.) if shown
- location: City, State/Country. Look near the name/contact section.
- linkedin: Full LinkedIn URL or path (linkedin.com/in/...). Include https:// if present.
- portfolio: Any GitHub, personal website, or portfolio URL that is NOT LinkedIn.

SUMMARY:
- The professional summary / objective / profile paragraph, as one continuous string.

WORK EXPERIENCE — Highest priority. Each job = one object in the array:
- role: EXACT job title as written (e.g. "Senior Azure DevOps Engineer"). Do not rephrase.
- company: EXACT employer name as written (e.g. "Microsoft"). Do not abbreviate.
- location: City, State where the job was located. "Remote" if remote.
- startDate: Exact start date as written (e.g. "Dec 2019", "Feb 2018"). Never infer.
- endDate: Exact end date as written, OR "Present" if person currently works there.
- current: true if endDate is "Present" / "Current" / "Now" / "Ongoing", else false.
- description: ALL bullet points for this job, each on its own line, joined by \\n.
  RULES FOR BULLETS:
  • Every line starting with "-", "•", a number, or a past-tense action verb is a bullet.
  • Preserve the COMPLETE text of every bullet — do NOT cut it short.
  • Preserve all numbers, percentages, dollar amounts exactly (e.g. "40%", "$2M", "15+").
  • Each logical bullet must be on its own line (\\n separated).
  • If a bullet wraps visually, merge continuation lines into the same bullet.
  • Include EVERY bullet — even the last few that might appear near the end of the text.

EDUCATION — Each institution = one object:
- school: Institution name exactly as written.
- degree: Degree type exactly (e.g. "Bachelor of Science", "Master of Science").
- field: Field of study / major (e.g. "Information Technology", "Computer Science").
- location: City, State if shown.
- startDate: Start year or "Month Year" as written.
- endDate: End/graduation year or "Month Year" as written.
- current: true only if still enrolled.
- description: Any GPA, honours, or additional notes (usually "").

SKILLS:
- Extract EVERY skill mentioned anywhere in the resume as individual strings.
- Split comma/semicolon/pipe separated lists into individual items.
- Include: languages, frameworks, tools, platforms, methodologies, cloud services, databases.
- Do NOT include full sentences — only the skill name/acronym.

PROJECTS, CERTIFICATIONS, ACHIEVEMENTS, LANGUAGES, PUBLICATIONS:
- Extract exactly as shown. Use [] if none exist.

=== JSON SCHEMA ===
{
  "personal": {
    "name": "",
    "email": "",
    "phone": "",
    "location": "",
    "linkedin": "",
    "portfolio": ""
  },
  "summary": "",
  "experience": [
    {
      "role": "",
      "company": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "current": false,
      "description": "bullet1\\nbullet2\\nbullet3"
    }
  ],
  "education": [
    {
      "school": "",
      "degree": "",
      "field": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "current": false,
      "description": ""
    }
  ],
  "skills": [],
  "projects": [],
  "certifications": [{ "name": "", "issuer": "", "date": "" }],
  "achievements": [],
  "languages": [],
  "publications": []
}`;

// ─── Sanitisation ─────────────────────────────────────────────────────────────

function sanitizeParsed(p) {
  const str = (...vals) => {
    for (const v of vals) {
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return '';
  };
  const bool = (...vals) => vals.some(v => v === true || v === 'true' || v === 'yes');
  const arr = (v) => (Array.isArray(v) ? v : []);

  // Normalise bullet descriptions — handle arrays or strings
  const normDesc = (x) => {
    const raw =
      x?.description ?? x?.responsibilities ?? x?.achievements ??
      x?.duties ?? x?.bullets ?? x?.highlights ?? x?.summary ?? '';
    if (Array.isArray(raw)) {
      // Each element is one bullet
      return raw.map(s => String(s).trim()).filter(Boolean).join('\n');
    }
    if (typeof raw === 'string') {
      // Sometimes the model puts " | " or "; " between bullets instead of \n
      // Normalise those too
      return raw
        .split(/\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .join('\n');
    }
    return '';
  };

  const personal = p?.personal ?? p?.contact ?? p ?? {};

  return {
    personal: {
      name:      str(personal?.name, personal?.fullName, personal?.full_name, p?.name),
      email:     str(personal?.email, personal?.emailAddress, p?.email),
      phone:     str(personal?.phone, personal?.phoneNumber, personal?.mobile, p?.phone),
      location:  str(personal?.location, personal?.address, personal?.city, p?.location),
      linkedin:  str(personal?.linkedin, personal?.linkedIn, personal?.linkedinUrl, p?.linkedin),
      portfolio: str(personal?.portfolio, personal?.website, personal?.github, p?.portfolio),
    },
    summary: str(p?.summary, p?.objective, p?.profile, p?.professionalSummary),
    experience: arr(p?.experience ?? p?.workExperience ?? p?.work_experience ?? p?.jobs).map((x) => {
      const endRaw = str(x?.endDate, x?.end_date, x?.end, x?.to);
      const isCurrent =
        bool(x?.current, x?.isCurrent, x?.is_current) ||
        /\b(present|current|now|ongoing)\b/i.test(endRaw);
      return {
        role:      str(x?.role, x?.title, x?.jobTitle, x?.position, x?.designation),
        company:   str(x?.company, x?.employer, x?.organization, x?.companyName, x?.firm),
        location:  str(x?.location, x?.city, x?.place, x?.jobLocation),
        startDate: str(x?.startDate, x?.start_date, x?.start, x?.from),
        endDate:   isCurrent ? 'Present' : endRaw,
        current:   isCurrent,
        description: normDesc(x),
      };
    }),
    education: arr(p?.education ?? p?.educationHistory).map((x) => ({
      school:    str(x?.school, x?.institution, x?.university, x?.college, x?.name),
      degree:    str(x?.degree, x?.qualification, x?.credential, x?.award),
      field:     str(x?.field, x?.major, x?.fieldOfStudy, x?.field_of_study, x?.subject),
      location:  str(x?.location, x?.city, x?.place),
      startDate: str(x?.startDate, x?.start_date, x?.start, x?.from),
      endDate:   str(x?.endDate, x?.end_date, x?.end, x?.to, x?.graduationYear),
      current:   bool(x?.current, x?.isCurrent, x?.enrolled),
      description: str(x?.description, x?.notes, x?.activities),
    })),
    skills: (() => {
      const raw = p?.skills ?? p?.technicalSkills ?? p?.technical_skills ?? [];
      if (typeof raw === 'string') return raw.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
      return arr(raw).flatMap(s => {
        if (typeof s === 'string') return s.split(/[,;|]/).map(t => t.trim()).filter(Boolean);
        if (typeof s === 'object' && s !== null) return [str(s?.name, s?.skill, s?.value)].filter(Boolean);
        return [];
      });
    })(),
    projects: arr(p?.projects ?? p?.sideProjects).map((x) => ({
      name:        str(x?.name, x?.title, x?.projectName),
      link:        str(x?.link, x?.url, x?.github, x?.website),
      description: str(x?.description, x?.summary, x?.details),
    })),
    certifications: arr(p?.certifications ?? p?.certificates ?? p?.credentials).map((x) => ({
      name:   str(x?.name, x?.title, x?.certification),
      issuer: str(x?.issuer, x?.issuedBy, x?.organization, x?.provider),
      date:   str(x?.date, x?.year, x?.issued),
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

// ─── JSON extraction helper ───────────────────────────────────────────────────

/**
 * Try very hard to extract a valid JSON object from the model's raw output.
 * Handles: leading/trailing text, markdown fences, partial responses.
 */
function extractJSON(raw) {
  // Strip markdown fences
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // Find the first '{' and last '}'
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in model response');
  }
  s = s.slice(start, end + 1);

  try {
    return JSON.parse(s);
  } catch (e) {
    // Attempt to auto-close truncated JSON (happens when max_tokens is hit)
    // Count open braces/brackets and close them
    let fixed = s;
    let openBraces   = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
    let openBrackets = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
    // Remove trailing incomplete token (e.g. partial string)
    fixed = fixed.replace(/,\s*$/, '');
    while (openBrackets-- > 0) fixed += ']';
    while (openBraces--   > 0) fixed += '}';
    try {
      return JSON.parse(fixed);
    } catch {
      throw new Error(`JSON parse failed: ${e.message}`);
    }
  }
}

// ─── Main parse function ──────────────────────────────────────────────────────

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
    const cleaned = preprocessResumeText(rawText);
    // Use up to 24000 chars — enough for a 3-page resume with all bullets
    const trimmed = cleaned.slice(0, 24000);

    const rawJson = await callXAI(
      [
        { role: 'system', content: PARSE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            'Parse the following resume. Extract EVERY bullet point — do not skip any.',
            'Return ONLY raw JSON. Start your response with "{" immediately.',
            '',
            '=== RESUME TEXT START ===',
            trimmed,
            '=== RESUME TEXT END ==='
          ].join('\n')
        }
      ],
      8000   // generous — handles resumes with 30+ bullets per job
    );

    const parsed = extractJSON(rawJson);
    const result = sanitizeParsed(parsed);

    // Sanity-check: if the AI somehow extracted nothing useful, fall back
    const hasData =
      result.personal.name ||
      result.experience.length > 0 ||
      result.summary;

    if (!hasData) {
      console.warn('[aiResumeParser] AI returned empty result — falling back to regex');
      return parseResumeText(rawText);
    }

    return result;
  } catch (err) {
    console.error('[aiResumeParser] AI parse failed, falling back to regex:', err.message);
    return parseResumeText(rawText);
  }
}

// ─── Resume tailoring ─────────────────────────────────────────────────────────

const TAILOR_SYSTEM_PROMPT = `You are an expert resume writer and career coach. Tailor the provided resume content to better match the job description by:
- Rewriting the professional summary to reflect the target role
- Reordering and refining the skills list to prioritise the most relevant ones first
- Folding in any items listed under "Candidate-confirmed additional skills" — the candidate has explicitly confirmed they have these, so include them in the skills list (do not treat them as unverified)
- Sharpening experience bullet points to highlight achievements that align with the job requirements, using keywords from the job posting where authentic
- Never inventing facts, employers, dates, or achievements — only rephrase, reorder, and incorporate what already exists or what the candidate has explicitly confirmed

Return ONLY valid JSON, no markdown, no explanation:
{
  "summary": "New 2–3 sentence tailored professional summary",
  "skills": ["skill1", "skill2", ...reordered/refined list, including confirmed additions],
  "experience": [
    {
      "index": 0,
      "description": "Rewritten bullet points (\\n-separated)"
    }
  ],
  "suggestions": "1–2 sentence explanation of the key changes made"
}`;

async function tailorResumeWithAI(resume, jobTitle, jobDescription, emphasizeSkills = []) {
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

  const confirmedExtras = Array.isArray(emphasizeSkills)
    ? emphasizeSkills.filter(Boolean).map(String).slice(0, 30)
    : [];
  const extrasBlock = confirmedExtras.length
    ? `\n\nCandidate-confirmed additional skills (from the job posting's requirements, which the candidate has checked off as skills they genuinely have):\n${confirmedExtras.join(', ')}`
    : '';

  const json = await callXAI(
    [
      { role: 'system', content: TAILOR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Job Title: ${jobTitle || 'Not specified'}\n\nJob Description:\n${jobDescription.slice(0, 4000)}\n\nCurrent Resume:\n${snapshot}${extrasBlock}`
      }
    ],
    3000
  );

  return extractJSON(json);
}

// ─── Cover letter generation ────────────────────────────────────────────────

const COVER_LETTER_SYSTEM_PROMPT = `You are an expert career coach writing a concise, authentic cover letter.
Rules:
- 3–4 short paragraphs, no more than 280 words total
- Use only facts present in the resume snapshot provided — never invent employers, titles, dates, or achievements
- Open by naming the role and company and a genuine hook tied to the candidate's background
- Middle paragraph(s): connect 2–3 concrete resume achievements/skills to the job's stated requirements
- Close with a confident, brief call to action
- Plain text only — no markdown, no placeholders like "[Your Name]" (use the candidate's real name/details from the resume snapshot; omit a line if the info truly isn't available)
- Do not fabricate a signature block address; a simple sign-off with the candidate's name is enough`;

async function generateCoverLetterWithAI(resume, jobTitle, company, jobDescription) {
  if (!process.env.XAI_API_KEY) {
    throw new Error('AI cover letter generation requires XAI_API_KEY to be configured');
  }

  const snapshot = JSON.stringify(
    {
      name: resume.personal?.name,
      email: resume.personal?.email,
      phone: resume.personal?.phone,
      summary: resume.summary,
      skills: resume.skills,
      experience: resume.experience.map((e) => ({
        role: e.role,
        company: e.company,
        description: e.description
      })),
      education: resume.education.map((ed) => ({ school: ed.school, degree: ed.degree, field: ed.field }))
    },
    null,
    2
  );

  const text = await callXAI(
    [
      { role: 'system', content: COVER_LETTER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Job Title: ${jobTitle || 'Not specified'}\nCompany: ${company || 'Not specified'}\n\nJob Description:\n${(jobDescription || '').slice(0, 3000)}\n\nCandidate Resume Snapshot:\n${snapshot}`
      }
    ],
    1200
  );

  return text.trim();
}

module.exports = { parseResumeWithAI, tailorResumeWithAI, generateCoverLetterWithAI };
