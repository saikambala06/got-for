// Resume parser — AI-powered primary path (Anthropic API), regex fallback.
//
// Primary:  parseResumeWithAI(text)  — calls Claude, returns structured JSON
//           that exactly matches the Resume mongoose model.
// Fallback: parseResumeText(text)    — original rule-based parser, used when
//           ANTHROPIC_API_KEY is not set or the API call fails.

// ─── AI parser ───────────────────────────────────────────────────────────────

const AI_SYSTEM = `You are a precise resume data extractor. You receive raw resume text and return ONLY a single valid JSON object — no markdown fences, no preamble, no commentary.`;

const AI_PROMPT = `Parse the resume text below and return a JSON object with EXACTLY this structure (all fields required, use "" or [] for missing data):

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
      "description": "First bullet point\\nSecond bullet point\\nThird bullet point"
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
  "projects": [
    { "name": "", "link": "", "description": "" }
  ],
  "certifications": [
    { "name": "", "issuer": "", "date": "" }
  ],
  "achievements": [],
  "languages": [],
  "publications": [
    { "title": "", "link": "", "date": "" }
  ]
}

CRITICAL RULES:
1. experience[].description  → each bullet point / achievement / responsibility on its OWN line, joined with literal \\n. Do NOT add any bullet symbols (•, -, *) at the start of lines. Copy the bullet text verbatim.
2. education[].description   → any additional notes, honours, or activities as plain text.
3. startDate / endDate       → human-readable, e.g. "Jan 2022", "2020", "Present".
4. current                   → true only when the role/study is ongoing.
5. linkedin                  → full URL if present, else "".
6. portfolio                 → any non-LinkedIn URL found in contact details, else "".
7. skills                    → flat array of individual skill strings.
8. achievements / languages  → flat arrays of strings.
9. Sections absent from the resume → empty array [] or empty string "".
10. Return ONLY the JSON object. Nothing before or after it.

RESUME TEXT:
`;

async function parseResumeWithAI(text) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: AI_SYSTEM,
      messages: [{ role: 'user', content: AI_PROMPT + text }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Anthropic API error ${res.status}: ${err.error?.message || 'unknown'}`);
  }

  const data = await res.json();
  const raw = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Strip accidental markdown fences Claude might still emit
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const parsed = JSON.parse(clean);

  // Guarantee every array field exists so the rest of the app never crashes
  const lists = ['experience', 'education', 'skills', 'projects', 'certifications', 'achievements', 'languages', 'publications'];
  lists.forEach((k) => { if (!Array.isArray(parsed[k])) parsed[k] = []; });
  if (!parsed.personal || typeof parsed.personal !== 'object') parsed.personal = {};

  return parsed;
}

// ─── Rule-based fallback ──────────────────────────────────────────────────────

const SECTION_HEADERS = {
  summary:        /^(summary|professional summary|objective|profile|about me)$/i,
  experience:     /^(experience|work experience|employment history|professional experience|relevant experience)$/i,
  education:      /^(education|academic background|academic history)$/i,
  skills:         /^(skills|technical skills|core competencies|key skills)$/i,
  projects:       /^(projects|personal projects|key projects)$/i,
  certifications: /^(certifications?|licenses?( ?& ?certifications)?)$/i,
  achievements:   /^(achievements|awards|honors|honours)$/i,
  languages:      /^(languages)$/i,
  publications:   /^(publications)$/i
};

function splitList(lines) {
  return lines
    .filter(Boolean)
    .join('\n')
    .split(/\n|,|•|\u2022|;|\|/)
    .map((s) => s.trim())
    .filter((s) => s && s.length < 80);
}

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
  const re = new RegExp(`((?:${MONTHS}\\.?\\s)?\\d{4})\\s*[-\u2013\u2014]+\\s*(Present|Current|(?:${MONTHS}\\.?\\s)?\\d{4})`, 'i');
  const m = text.match(re);
  if (!m) return { startDate: '', endDate: '', matchText: '' };
  return { startDate: m[1].trim(), endDate: m[2].trim(), matchText: m[0] };
}

function looksLikeCompanyLocationLine(line) {
  if (!line) return false;
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return false;
  if (/^[•\u2022\-*\u25aa]/.test(trimmed)) return false;
  if (extractDateRange(trimmed).matchText) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  if (trimmed.split(/\s+/).length > 8) return false;
  return true;
}

const LOCATION_RE = /\b([A-Za-z][A-Za-z.\s]{1,30},\s*(?:[A-Z]{2}|[A-Za-z]{3,20}))\b/;
const DEGREE_PREFIX_RE = /^(Bachelor|Master|Associate|Doctor(?:ate)?|Ph\.?D\.?|MBA|EMBA|B\.?S\.?(?:c)?\.?|M\.?S\.?(?:c)?\.?|B\.?A\.?|M\.?A\.?|B\.?Eng\.?|M\.?Eng\.?|B\.?Tech\.?|M\.?Tech\.?)\b/i;

function parseResumeText(rawText) {
  const text = (rawText || '').replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);

  const emailMatch    = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const phoneMatch    = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  const linkedinMatch = text.match(/(https?:\/\/)?(www\.)?linkedin\.com\/[^\s,;)]+/i);
  const urlMatches    = text.match(/https?:\/\/[^\s,;)]+/g) || [];
  const portfolio     = urlMatches.find((u) => !/linkedin\.com/i.test(u)) || '';

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

  let name = '';
  for (const line of nonEmpty.slice(0, 5)) {
    if (line.length > 1 && line.length < 60 && !/@/.test(line) && !/https?:\/\//.test(line) && !/\d{3,}/.test(line)) {
      name = line; break;
    }
  }

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
    if (matchedKey) { current = matchedKey; sections[current] = sections[current] || []; continue; }
    if (current) { sections[current] = sections[current] || []; sections[current].push(line); }
  }
  Object.keys(sections).forEach((k) => {
    while (sections[k].length && sections[k][0] === '') sections[k].shift();
    while (sections[k].length && sections[k][sections[k].length - 1] === '') sections[k].pop();
  });

  const skills       = sections.skills       ? splitList(sections.skills).slice(0, 40) : [];
  const languages    = sections.languages    ? splitList(sections.languages).slice(0, 20) : [];
  const achievements = sections.achievements ? sections.achievements.filter(Boolean).slice(0, 20) : [];

  const experience = (sections.experience ? splitBlocks(sections.experience) : []).slice(0, 10).map((block) => {
    let dateLineIdx  = block.findIndex((l) => extractDateRange(l).matchText);
    const headerLines = dateLineIdx === -1 ? [block[0] || ''] : block.slice(0, dateLineIdx + 1);
    let bulletLines   = dateLineIdx === -1 ? block.slice(1) : block.slice(dateLineIdx + 1);
    const headerJoined = headerLines.join(' - ');
    const dateInfo    = extractDateRange(headerJoined);
    const headerNoDate = (dateInfo.matchText ? headerJoined.replace(dateInfo.matchText, '').trim() : headerJoined).replace(/[\s,\u2013\u2014-]+$/, '');
    let parts = headerNoDate.split(/ at | @ |,| - |\u2014/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2 && bulletLines.length && looksLikeCompanyLocationLine(bulletLines[0])) {
      const extra = bulletLines[0].split(/,| - |\u2014/i).map((s) => s.trim()).filter(Boolean);
      parts = parts.concat(extra);
      bulletLines = bulletLines.slice(1);
    }
    return {
      role:      parts[0] || headerLines[0] || '',
      company:   parts[1] || '',
      location:  parts.slice(2).join(', '),
      startDate: dateInfo.startDate,
      endDate:   dateInfo.endDate,
      current:   /present|current/i.test(dateInfo.endDate),
      description: bulletLines.filter(Boolean).join('\n').trim()
    };
  });

  const education = (sections.education ? splitBlocks(sections.education) : []).slice(0, 6).map((block) => {
    let header = block[0] || '', degreeLine = block[1] || '', restStart = 2;
    if (DEGREE_PREFIX_RE.test(header) && !extractDateRange(header).matchText) {
      const fromMatch = header.match(/^(.*?)\s+from\s+(.+)$/i);
      if (fromMatch) { degreeLine = fromMatch[1].trim(); header = fromMatch[2].trim(); restStart = 1; }
      else {
        const atMatch = header.match(/^(.*?)\s*[-\u2014,]\s*(.+)$/);
        if (atMatch && DEGREE_PREFIX_RE.test(atMatch[1])) { degreeLine = atMatch[1].trim(); header = atMatch[2].trim(); restStart = 1; }
      }
    }
    const dateInfo = extractDateRange(block.join(' '));
    let loc = '';
    if (block[restStart]) {
      const lineDate = extractDateRange(block[restStart]);
      const locText  = lineDate.matchText ? block[restStart].replace(lineDate.matchText, '').trim().replace(/[,.\s-]+$/, '') : block[restStart];
      if (locText) loc = locText;
      restStart += 1;
    }
    const rest = block.slice(restStart).join(' ').trim();
    let field = '';
    const inMatch = degreeLine.match(/^(.*?)\s+in\s+(.+)$/i);
    if (inMatch) { field = inMatch[2].trim(); }
    return {
      school: header, degree: degreeLine, field, location: loc,
      startDate: dateInfo.startDate, endDate: dateInfo.endDate,
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

  return {
    personal: {
      name,
      email:    emailMatch    ? emailMatch[0]    : '',
      phone:    phoneMatch    ? phoneMatch[0].trim() : '',
      location,
      linkedin: linkedinMatch ? linkedinMatch[0] : '',
      portfolio
    },
    summary: sections.summary ? sections.summary.filter(Boolean).join(' ').trim() : '',
    experience, education, skills, projects, certifications, achievements, languages, publications
  };
}

// Mammoth collapses DOCX paragraph breaks into extra newlines — normalise.
function normalizeDocxText(text) {
  const tokens = text.split(/(\n+)/);
  let out = '';
  for (const tok of tokens) {
    out += /^\n+$/.test(tok) ? (tok.length >= 3 ? '\n\n' : '\n') : tok;
  }
  return out;
}

module.exports = { parseResumeText, normalizeDocxText, parseResumeWithAI };
