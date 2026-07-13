/**
 * Rule-based resume parser.
 * Used when GEMINI_API_KEY is absent or the AI call fails.
 * Handles most common resume layouts including ATS-formatted, modern, and dense formats.
 */
const { cleanSkill } = require('./skillUtils');

// ─── Section header patterns ──────────────────────────────────────────────────

const SECTION_HEADERS = {
  summary:        /^(summary|professional\s+summary|objective|career\s+objective|profile|about\s+me|professional\s+profile|executive\s+summary)$/i,
  experience:     /^(experience|work\s+experience|employment\s+history|professional\s+experience|relevant\s+experience|career\s+history|work\s+history)$/i,
  education:      /^(education|academic\s+(background|history)|educational\s+(background|qualifications))$/i,
  skills:         /^(skills|technical\s+skills|core\s+competencies|key\s+skills|skill\s+set|technologies|tools?\s+&\s+technologies?)$/i,
  projects:       /^(projects?|personal\s+projects?|key\s+projects?|notable\s+projects?)$/i,
  certifications: /^(certifications?|certificates?|certification?|licenses?\s*(&\s*certifications?)?)$/i,
  achievements:   /^(achievements?|awards?|honors?|honours?|accomplishments?)$/i,
  languages:      /^(languages?)$/i,
  publications:   /^(publications?)$/i,
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTH_PAT = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_RE = new RegExp(
  `(${MONTH_PAT}\\.?\\s*\\d{4}|\\d{1,2}/\\d{4}|\\d{4})\\s*[-–—~to]+\\s*(Present|Current|Now|${MONTH_PAT}\\.?\\s*\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`,
  'i'
);

function extractDateRange(text) {
  const m = text.match(DATE_RE);
  if (!m) return { startDate: '', endDate: '', matchText: '' };
  return { startDate: m[1].trim(), endDate: m[2].trim(), matchText: m[0] };
}

// ─── Bullet detection ─────────────────────────────────────────────────────────

// Common resume action verbs that start bullet points
const ACTION_VERBS = /^(Achieved|Administered|Analyzed|Architected|Automated|Built|Championed|Collaborated|Conducted|Configured|Created|Defined|Delivered|Deployed|Designed|Developed|Drove|Enhanced|Established|Executed|Facilitated|Implemented|Improved|Increased|Integrated|Launched|Led|Maintained|Managed|Mentored|Migrated|Monitored|Negotiated|Optimized|Orchestrated|Participated|Performed|Planned|Reduced|Responsible|Revamped|Reviewed|Shipped|Spearheaded|Standardized|Streamlined|Supported|Troubleshot|Worked|Wrote)\b/i;

function isBulletLine(line) {
  if (!line) return false;
  const t = line.trim();
  // Explicit bullet marker
  if (/^[-•*▪▸\u2022\u25AA\u25CF\u2713\u2714\u25BA\u27A2\u27B3]/.test(t)) return true;
  // Numbered bullet: "1." or "1)"
  if (/^\d+[.)]\s/.test(t)) return true;
  // Starts with an action verb
  if (ACTION_VERBS.test(t)) return true;
  return false;
}

// ─── Block splitter ───────────────────────────────────────────────────────────

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

// ─── List splitter ────────────────────────────────────────────────────────────

function splitList(lines) {
  return lines
    .filter(Boolean)
    .join('\n')
    .split(/\n|•|\u2022|;|\|/)
    .flatMap(s => s.split(/,(?!\s*\d)/).map(t => t.trim()))  // split on commas unless followed by digit
    .map(s => s.replace(/^[-*]\s*/, '').trim())
    .filter(s => s && s.length > 0 && s.length < 80);
}

// ─── Name extraction ──────────────────────────────────────────────────────────

function extractName(nonEmpty) {
  // The name is usually the very first line: short, no @ or digits, not a section header
  for (const line of nonEmpty.slice(0, 6)) {
    const t = line.trim();
    if (
      t.length >= 2 &&
      t.length < 60 &&
      !/@/.test(t) &&
      !/https?:\/\//i.test(t) &&
      !/\d{3,}/.test(t) &&       // no long digit runs (phone numbers)
      !/[|•·]/.test(t) &&        // not a pipe-separated contact line
      !/^\s*(summary|experience|education|skills|projects|certifications?)\s*$/i.test(t)
    ) {
      // Looks like a name — typically 2-4 words, each capitalised
      const words = t.split(/\s+/);
      if (words.length >= 2 && words.length <= 5 && words.every(w => /^[A-Z]/.test(w))) {
        return t;
      }
      // Or ALL CAPS name
      if (t === t.toUpperCase() && words.length >= 2) return t;
      // Fallback: first short non-contact line
      if (words.length >= 2) return t;
    }
  }
  return '';
}

// ─── Location extraction ──────────────────────────────────────────────────────

const LOCATION_RE = /\b([A-Za-z][A-Za-z.\s]{1,25},\s*(?:[A-Z]{2}|[A-Za-z]{3,20}))\b/;

function extractLocation(nonEmpty) {
  for (const line of nonEmpty.slice(0, 10)) {
    // NOTE: comma is deliberately NOT a split delimiter here — LOCATION_RE
    // matches a "City, ST" pattern that needs its own internal comma intact.
    // Splitting on comma first (as this used to) breaks "San Francisco, CA"
    // into "San Francisco" and "CA" before the regex ever sees it, so a
    // location that's only separated from the rest of the line by pipes or
    // bullets (not further comma-split) would never match.
    const segments = line.split(/[|•·]/).map(s => s.trim()).filter(Boolean);
    for (const seg of segments) {
      if (/@/.test(seg) || /https?:\/\//i.test(seg) || /linkedin/i.test(seg)) continue;
      const m = seg.match(LOCATION_RE);
      if (m) return m[0];
    }
  }
  return '';
}

// ─── Experience parser ────────────────────────────────────────────────────────

/**
 * Parse a single experience block (list of text lines for one job) into
 * { role, company, location, startDate, endDate, current, description }.
 */
function parseExpBlock(block) {
  // Find which line has the date range — everything before it is the header
  let dateLineIdx = block.findIndex(l => extractDateRange(l).matchText);
  const headerLines = dateLineIdx === -1 ? [block[0] || ''] : block.slice(0, dateLineIdx + 1);
  let bulletLines   = dateLineIdx === -1 ? block.slice(1) : block.slice(dateLineIdx + 1);

  const headerJoined = headerLines.join(' | ');
  const dateInfo = extractDateRange(headerJoined);
  const headerNoDate = dateInfo.matchText
    ? headerJoined.replace(dateInfo.matchText, '').trim().replace(/[\s|,–—-]+$/, '')
    : headerJoined;

  // Split header into role / company / location
  // Common separators: " at ", " @ ", " – ", " | ", ","
  let parts = headerNoDate
    .split(/\s+at\s+|\s+@\s+|\s*[|–—]\s*|,/)
    .map(s => s.trim())
    .filter(Boolean);

  // If only one part, the company line may be the first bullet line
  if (parts.length < 2 && bulletLines.length) {
    const possibleCompany = bulletLines[0];
    if (
      possibleCompany &&
      !isBulletLine(possibleCompany) &&
      !extractDateRange(possibleCompany).matchText &&
      possibleCompany.length < 80
    ) {
      const extra = possibleCompany.split(/,\s*|\s*[|–—]\s*/).map(s => s.trim()).filter(Boolean);
      parts = [...parts, ...extra];
      bulletLines = bulletLines.slice(1);
    }
  }

  // Build description: every bullet line, cleaned of bullet markers
  const descLines = bulletLines
    .filter(Boolean)
    .map(l => l.replace(/^[-•*▪▸\u2022\u25AA\u25CF]\s*/, '').trim())
    .filter(Boolean);

  return {
    role:      parts[0] || headerLines[0] || '',
    company:   parts[1] || '',
    location:  parts.slice(2).join(', '),
    startDate: dateInfo.startDate,
    endDate:   dateInfo.endDate,
    current:   /present|current|now/i.test(dateInfo.endDate),
    description: descLines.join('\n')
  };
}

// ─── Education parser ─────────────────────────────────────────────────────────

const DEGREE_RE = /^(Bachelor|Master|Associate|Doctor(?:ate)?|Ph\.?D\.?|MBA|EMBA|B\.?S\.?(?:c)?\.?|M\.?S\.?(?:c)?\.?|B\.?A\.?|M\.?A\.?|B\.?Eng\.?|M\.?Eng\.?|B\.?Tech\.?|M\.?Tech\.?)\b/i;

function parseEduBlock(block) {
  let school = '', degree = '', field = '';
  let restStart = 0;

  const firstLine = block[0] || '';
  const secondLine = block[1] || '';

  // Handle "Master of Science in X from University" all on one line
  if (DEGREE_RE.test(firstLine) && !extractDateRange(firstLine).matchText) {
    const fromM = firstLine.match(/^(.*?)\s+from\s+(.+)$/i);
    if (fromM) {
      degree = fromM[1].trim();
      school = fromM[2].trim();
      restStart = 1;
    } else {
      degree = firstLine;
      school = secondLine;
      restStart = 2;
    }
  } else if (DEGREE_RE.test(secondLine)) {
    school = firstLine;
    degree = secondLine;
    restStart = 2;
  } else {
    school = firstLine;
    degree = secondLine;
    restStart = 2;
  }

  // Extract "in X" from degree line
  const inM = degree.match(/^(.*?)\s+in\s+(.+)$/i);
  if (inM) {
    field = inM[2].trim();
    degree = inM[1].trim();
  }

  const dateInfo = extractDateRange(block.join(' '));
  const description = block.slice(restStart).filter(Boolean).join(' ')
    .replace(dateInfo.matchText || '', '').trim();

  return {
    school,
    degree,
    field,
    location: '',
    startDate: dateInfo.startDate,
    endDate:   dateInfo.endDate,
    current:   /present|current/i.test(dateInfo.endDate),
    description: description.replace(DATE_RE, '').trim()
  };
}

// ─── Main parse function ──────────────────────────────────────────────────────

function parseResumeText(rawText) {
  const text    = (rawText || '').replace(/\r/g, '');
  const lines   = text.split('\n').map(l => l.trim());
  const nonEmpty = lines.filter(Boolean);

  // ── Contact info ──
  const emailMatch   = text.match(/[\w.+'-]+@[\w-]+\.[\w.-]+/);
  const phoneMatch   = text.match(/(\+?[\d][\d\s().-]{7,}\d)/);
  const linkedinMatch = text.match(/(https?:\/\/)?(www\.)?linkedin\.com\/[^\s,;)<]+/i);
  const urlMatches   = text.match(/https?:\/\/[^\s,;)<]+/g) || [];
  const portfolio    = urlMatches.find(u => !/linkedin\.com/i.test(u)) || '';

  const name     = extractName(nonEmpty);
  const location = extractLocation(nonEmpty);

  // ── Section bucketing ──
  let current = null;
  const sections = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current) sections[current].push('');
      continue;
    }
    let matched = null;
    for (const [key, re] of Object.entries(SECTION_HEADERS)) {
      if (re.test(line)) { matched = key; break; }
    }
    if (matched) {
      current = matched;
      sections[current] = sections[current] || [];
      continue;
    }
    if (current) {
      sections[current] = sections[current] || [];
      sections[current].push(line);
    }
  }

  // Trim leading/trailing blank-line markers
  for (const k of Object.keys(sections)) {
    while (sections[k].length && sections[k][0] === '') sections[k].shift();
    while (sections[k].length && sections[k][sections[k].length - 1] === '') sections[k].pop();
  }

  // ── Skills ──
  const skills = sections.skills
    ? (() => {
        // A resume Skills section is often written one category per line, e.g.
        //   Languages: Python, JavaScript, Java
        //   Frameworks: React, Node.js
        // splitList() only splits on commas/bullets/newlines, so the category
        // label stays glued to the first item after it ("Languages: Python").
        // cleanSkill() strips that label back off; the dedupe below then
        // collapses anything that becomes a duplicate once cleaned.
        const seen = new Set();
        return splitList(sections.skills)
          .map(cleanSkill)
          .filter((s) => {
            if (!s) return false;
            const key = s.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 60);
      })()
    : [];

  // ── Experience ──
  const experience = (sections.experience ? splitBlocks(sections.experience) : [])
    .slice(0, 10)
    .map(parseExpBlock);

  // ── Education ──
  const education = (sections.education ? splitBlocks(sections.education) : [])
    .slice(0, 6)
    .map(parseEduBlock);

  // ── Projects ──
  const projects = (sections.projects ? splitBlocks(sections.projects) : []).slice(0, 8).map(block => ({
    name: block[0] || '',
    link: (block.join(' ').match(/https?:\/\/[^\s,;)<]+/) || [''])[0],
    description: block.slice(1).join(' ').trim()
  }));

  // ── Certifications ──
  const certifications = (sections.certifications || []).filter(Boolean).slice(0, 10).map(line => ({
    name:   line.replace(DATE_RE, '').trim(),
    issuer: '',
    date:   (() => { const d = extractDateRange(line); return d.endDate || d.startDate || ''; })()
  }));

   // ── Certification ──
  const certification = (sections.certification || []).filter(Boolean).slice(0, 10).map(line => ({
    name:   line.replace(DATE_RE, '').trim(),
    issuer: '',
    date:   (() => { const d = extractDateRange(line); return d.endDate || d.startDate || ''; })()
  }));

  // ── Other ──
  const publications = (sections.publications || []).filter(Boolean).slice(0, 10).map(line => ({
    title: line,
    link:  (line.match(/https?:\/\/[^\s,;)<]+/) || [''])[0],
    date:  ''
  }));

  const summary = sections.summary
    ? sections.summary.filter(Boolean).join(' ').trim()
    : '';

  const achievements = (sections.achievements || []).filter(Boolean).slice(0, 20);
  const languages    = sections.languages ? splitList(sections.languages).slice(0, 20) : [];

  return {
    personal: {
      name,
      email:     emailMatch   ? emailMatch[0]   : '',
      phone:     phoneMatch   ? phoneMatch[0].trim() : '',
      location,
      linkedin:  linkedinMatch ? linkedinMatch[0] : '',
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

// ─── DOCX text normaliser ─────────────────────────────────────────────────────
// Mammoth puts a blank line after EVERY paragraph; collapse single blank lines
// to single newlines so section detection works correctly.
function normalizeDocxText(text) {
  const tokens = text.split(/(\n+)/);
  let out = '';
  for (const tok of tokens) {
    if (/^\n+$/.test(tok)) {
      // 3+ newlines = real paragraph break; 1-2 = paragraph end, treat as single \n
      out += tok.length >= 3 ? '\n\n' : '\n';
    } else {
      out += tok;
    }
  }
  return out;
}

module.exports = { parseResumeText, normalizeDocxText };
