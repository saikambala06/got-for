// Free, rule-based resume parser. Extracts contact details and best-effort
// section content (experience, education, skills, etc.) from raw resume
// text using regexes and section-header detection — no paid AI/LLM calls.

const SECTION_HEADERS = {
  summary: /^(summary|professional summary|objective|profile|about me)$/i,
  experience: /^(experience|work experience|employment history|professional experience|relevant experience)$/i,
  education: /^(education|academic background|academic history)$/i,
  skills: /^(skills|technical skills|core competencies|key skills)$/i,
  projects: /^(projects|personal projects|key projects)$/i,
  certifications: /^(certifications?|licenses?( ?& ?certifications)?)$/i,
  achievements: /^(achievements|awards|honors|honours)$/i,
  languages: /^(languages)$/i,
  publications: /^(publications)$/i
};

function splitList(lines) {
  return lines
    .filter(Boolean)
    .join('\n')
    .split(/\n|,|•|\u2022|;|\|/)
    .map((s) => s.trim())
    .filter((s) => s && s.length < 80);
}

// Splits a section's lines into entries using blank lines (real paragraph
// breaks, preserved by the caller) as the boundary between e.g. one job
// and the next.
function splitBlocks(lines) {
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (line === '') {
      if (current.length) { blocks.push(current); current = []; }
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

const MONTHS = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

function extractDateRange(text) {
  const re = new RegExp(`((?:${MONTHS}\\.?\\s)?\\d{4})\\s*[-–—]+\\s*(Present|Current|(?:${MONTHS}\\.?\\s)?\\d{4})`, 'i');
  const m = text.match(re);
  if (!m) return { startDate: '', endDate: '', matchText: '' };
  return { startDate: m[1].trim(), endDate: m[2].trim(), matchText: m[0] };
}

// A line that looks like "Company, City, ST" or "Company — City, ST" rather
// than a bullet point of accomplishment text — used to recover a
// company/location line that got separated from the role/date header by a
// line break (e.g. Role / Dates / Company, Location / bullets ordering).
function looksLikeCompanyLocationLine(line) {
  if (!line) return false;
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 90) return false;
  if (/^[•\u2022\-*▪]/.test(trimmed)) return false; // bullet marker
  if (extractDateRange(trimmed).matchText) return false; // has its own dates
  // Accomplishment bullets are usually full sentences ending in a period,
  // or start with a past-tense verb. Company/location lines are short
  // noun phrases, often containing a comma.
  if (/[.!?]$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 8) return false;
  return true;
}

// Common state/country location patterns, e.g. "Redmond, WA" or "Mumbai, India".
const LOCATION_RE = /\b([A-Za-z][A-Za-z.\s]{1,30},\s*(?:[A-Z]{2}|[A-Za-z]{3,20}))\b/;

// Degree titles, used to split a single line like "Master of Science in
// Information Technology from Wilmington University" into separate
// degree / school fields instead of dumping the whole line into "school".
const DEGREE_PREFIX_RE = /^(Bachelor|Master|Associate|Doctor(?:ate)?|Ph\.?D\.?|MBA|EMBA|B\.?S\.?(?:c)?\.?|M\.?S\.?(?:c)?\.?|B\.?A\.?|M\.?A\.?|B\.?Eng\.?|M\.?Eng\.?|B\.?Tech\.?|M\.?Tech\.?)\b/i;

function parseResumeText(rawText) {
  const text = (rawText || '').replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);

  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const phoneMatch = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  const linkedinMatch = text.match(/(https?:\/\/)?(www\.)?linkedin\.com\/[^\s,;)]+/i);
  const urlMatches = text.match(/https?:\/\/[^\s,;)]+/g) || [];
  const portfolio = urlMatches.find((u) => !/linkedin\.com/i.test(u)) || '';

  // Location usually sits in the contact line near the top, alongside the
  // email/phone — e.g. "Jane Doe | Redmond, WA | jane@x.com | (555)...".
  // Split on common separators and pick the segment that looks like a
  // "City, ST/Country" pair and isn't the phone/email/link.
  let location = '';
  for (const line of nonEmpty.slice(0, 8)) {
    const segments = line.split(/[|•·]/).map((s) => s.trim()).filter(Boolean);
    for (const seg of segments) {
      if (/@/.test(seg) || /https?:\/\//i.test(seg) || /linkedin/i.test(seg)) continue;
      if (phoneMatch && seg.includes(phoneMatch[0])) continue;
      const m = seg.match(LOCATION_RE);
      if (m && m[0].length === seg.length) { location = m[0]; break; }
    }
    if (location) break;
  }

  // Heuristic: the resume's name is usually the first short, non-empty line
  // that isn't an email/phone/url and isn't a section header itself.
  let name = '';
  for (const line of nonEmpty.slice(0, 5)) {
    if (line.length > 1 && line.length < 60 && !/@/.test(line) && !/https?:\/\//.test(line) && !/\d{3,}/.test(line)) {
      name = line;
      break;
    }
  }

  // Walk lines, bucket content under the most recent recognized section
  // header. Blank lines are kept (as '') so splitBlocks() can later use
  // them as the boundary between one entry (job, degree, etc.) and the next.
  let current = null;
  const sections = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current) sections[current].push('');
      continue;
    }
    let matchedKey = null;
    for (const [key, re] of Object.entries(SECTION_HEADERS)) {
      if (re.test(line)) { matchedKey = key; break; }
    }
    if (matchedKey) {
      current = matchedKey;
      sections[current] = sections[current] || [];
      continue;
    }
    if (current) {
      sections[current] = sections[current] || [];
      sections[current].push(line);
    }
  }
  // Trim leading/trailing blank-line markers per section
  Object.keys(sections).forEach((k) => {
    while (sections[k].length && sections[k][0] === '') sections[k].shift();
    while (sections[k].length && sections[k][sections[k].length - 1] === '') sections[k].pop();
  });

  const skills = sections.skills ? splitList(sections.skills).slice(0, 40) : [];
  const languages = sections.languages ? splitList(sections.languages).slice(0, 20) : [];
  const achievements = sections.achievements ? sections.achievements.filter(Boolean).slice(0, 20) : [];

  const experience = (sections.experience ? splitBlocks(sections.experience) : []).slice(0, 10).map((block) => {
    // Header info (role / company / location / dates) can be crammed onto
    // one line, or spread across the first 2-3 lines of the block (e.g.
    // "Role" then "Company, Location   Jan 2022 - Present" then bullets).
    // Find the first line that actually contains a date range and treat
    // everything up to and including it as the header; everything after
    // is the bullet/description content. This stops company/location text
    // that lives on its own line from leaking into the description.
    let dateLineIdx = block.findIndex((l) => extractDateRange(l).matchText);
    const headerLines = dateLineIdx === -1 ? [block[0] || ''] : block.slice(0, dateLineIdx + 1);
    let bulletLines = dateLineIdx === -1 ? block.slice(1) : block.slice(dateLineIdx + 1);
    const headerJoined = headerLines.join(' - ');
    const dateInfo = extractDateRange(headerJoined);
    const headerNoDate = (dateInfo.matchText ? headerJoined.replace(dateInfo.matchText, '').trim() : headerJoined).replace(/[\s,–—-]+$/, '');
    let parts = headerNoDate.split(/ at | @ |,| - |—/i).map((s) => s.trim()).filter(Boolean);
    // If the header only yielded a role (no company), the resume likely had
    // the layout Role / Dates / Company, Location / bullets — i.e. the
    // company+location line ended up at the front of bulletLines instead of
    // in the header. Pull it back in if it looks the part.
    if (parts.length < 2 && bulletLines.length && looksLikeCompanyLocationLine(bulletLines[0])) {
      const extra = bulletLines[0].split(/,| - |—/i).map((s) => s.trim()).filter(Boolean);
      parts = parts.concat(extra);
      bulletLines = bulletLines.slice(1);
    }
    const description = bulletLines.filter(Boolean).join('\n').trim();
    return {
      role: parts[0] || headerLines[0] || '',
      company: parts[1] || '',
      location: parts.slice(2).join(', '),
      startDate: dateInfo.startDate,
      endDate: dateInfo.endDate,
      current: /present|current/i.test(dateInfo.endDate),
      description
    };
  });

  const education = (sections.education ? splitBlocks(sections.education) : []).slice(0, 6).map((block) => {
    let header = block[0] || '';
    let degreeLine = block[1] || '';
    let restStart = 2;
    // Handle "Master of Science in Information Technology from Wilmington
    // University" all on one line — split into degree (incl. field) + school
    // instead of leaving it all in "school" with an empty degree.
    if (DEGREE_PREFIX_RE.test(header) && !extractDateRange(header).matchText) {
      const fromMatch = header.match(/^(.*?)\s+from\s+(.+)$/i);
      if (fromMatch) {
        degreeLine = fromMatch[1].trim();
        header = fromMatch[2].trim();
        restStart = 1;
      } else {
        const atMatch = header.match(/^(.*?)\s*[-—,]\s*(.+)$/);
        if (atMatch && DEGREE_PREFIX_RE.test(atMatch[1])) {
          degreeLine = atMatch[1].trim();
          header = atMatch[2].trim();
          restStart = 1;
        }
      }
    }
    // A third header line (before the free-text description starts) is
    // usually the location, e.g. "Wilmington University" / "M.S. in CS" /
    // "New Castle, DE". Only treat it as location if it doesn't itself
    // contain the date range (in which case there is no separate location).
    const dateInfo = extractDateRange(block.join(' '));
    let location = '';
    if (block[restStart]) {
      const lineDate = extractDateRange(block[restStart]);
      const locText = lineDate.matchText ? block[restStart].replace(lineDate.matchText, '').trim().replace(/[,.\s-]+$/, '') : block[restStart];
      if (locText) location = locText;
      restStart += 1;
    }
    const rest = block.slice(restStart).join(' ').trim();
    // Pull a field of study out of the degree line when phrased "X in Y"
    // (e.g. "Master of Science in Information Technology").
    let field = '';
    const inMatch = degreeLine.match(/^(.*?)\s+in\s+(.+)$/i);
    if (inMatch) { field = inMatch[2].trim(); }
    return {
      school: header,
      degree: degreeLine,
      field,
      location,
      startDate: dateInfo.startDate,
      endDate: dateInfo.endDate,
      current: /present|current/i.test(dateInfo.endDate),
      description: dateInfo.matchText ? rest.replace(dateInfo.matchText, '').trim() : rest
    };
  });

  const projects = (sections.projects ? splitBlocks(sections.projects) : []).slice(0, 8).map((block) => ({
    name: block[0] || '',
    link: (block.join(' ').match(/https?:\/\/[^\s,;)]+/) || [''])[0],
    description: block.slice(1).join(' ').trim()
  }));

  const certifications = (sections.certifications || []).filter(Boolean).slice(0, 10).map((line) => ({
    name: line, issuer: '', date: (extractDateRange(line).endDate || extractDateRange(line).startDate || '')
  }));

  const publications = (sections.publications || []).filter(Boolean).slice(0, 10).map((line) => ({
    title: line, link: (line.match(/https?:\/\/[^\s,;)]+/) || [''])[0], date: ''
  }));

  const summary = sections.summary ? sections.summary.filter(Boolean).join(' ').trim() : '';

  return {
    personal: {
      name,
      email: emailMatch ? emailMatch[0] : '',
      phone: phoneMatch ? phoneMatch[0].trim() : '',
      location,
      linkedin: linkedinMatch ? linkedinMatch[0] : '',
      portfolio
    },
    summary,
    experience,
    education,
    skills,
    projects,
    certifications,
    achievements,
    languages,
    publications
  };
}

// Mammoth's DOCX text extraction puts a blank line after EVERY paragraph
// (so "Role" / "Dates" / "Description" each end up with blank lines between
// them too, not just between job entries). This collapses normal
// paragraph-to-paragraph gaps back into plain line breaks, while still
// treating a genuinely empty paragraph in the original document (which
// mammoth renders as a longer run of newlines) as a real section break.
function normalizeDocxText(text) {
  const tokens = text.split(/(\n+)/);
  let out = '';
  for (const tok of tokens) {
    if (/^\n+$/.test(tok)) {
      out += tok.length >= 3 ? '\n\n' : '\n';
    } else {
      out += tok;
    }
  }
  return out;
}

module.exports = { parseResumeText, normalizeDocxText };

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
- role: The EXACT job title as written (e.g. "Senior Software Engineer", "Product Manager II"). Do NOT paraphrase.
- company: The EXACT company/employer name as written. Do NOT abbreviate.
- location: City, State where the job was located (if shown). May be "Remote".
- startDate: Exact start date as written (e.g. "Jan 2020", "2/2018", "March 2021"). Never infer.
- endDate: Exact end date as written, OR "Present" if the person currently works there.
- current: Set to true ONLY when "Present", "Current", "Now", or "Ongoing" is the end date.
- description: Extract EVERY bullet point, dash, or numbered item listed under this job. 
  Put EACH bullet on its own line separated by \\n.
  Include the full text of each bullet — do NOT truncate, summarize, or omit any.
  Preserve quantitative metrics exactly: "40%", "$2M", "10k users", etc.
  If bullets span multiple lines visually, merge them into one logical bullet.

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
    experience: arr(p?.experience ?? p?.workExperience ?? p?.work_experience ?? p?.jobs).map((x) => {
      const endRaw = str(x?.endDate, x?.end_date, x?.end, x?.to, x?.endYear);
      const isCurrent = bool(x?.current, x?.isCurrent, x?.is_current) ||
                        /\b(present|current|now|ongoing)\b/i.test(endRaw);
      return {
        role:      str(x?.role, x?.title, x?.jobTitle, x?.job_title, x?.position, x?.designation),
        company:   str(x?.company, x?.employer, x?.organization, x?.companyName, x?.company_name, x?.firm),
        location:  str(x?.location, x?.city, x?.place, x?.jobLocation),
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

module.exports = { parseResumeWithAI, tailorResumeWithAI };  When we upload resume all fields are wrong but i have edited and created exact resume data as accurate if we upload resume it contain this data for sure in my web portal , if we upload other pdf or docx resume it should accurately like this example file or should occupy fields and  please fix my resumes tab to add accurate data when any pdf or docx resume is uploaded
