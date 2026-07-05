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

// Splits a section's lines into entries using blank lines as boundaries
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

function looksLikeCompanyLocationLine(line) {
  if (!line) return false;
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 90) return false;
  if (/^[•\u2022\-*▪]/.test(trimmed)) return false;
  if (extractDateRange(trimmed).matchText) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 8) return false;
  return true;
}

const LOCATION_RE = /\b([A-Za-z][A-Za-z.\s]{1,30},\s*(?:[A-Z]{2}|[A-Za-z]{3,20}))\b/;

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
      name = line;
      break;
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

  Object.keys(sections).forEach((k) => {
    while (sections[k].length && sections[k][0] === '') sections[k].shift();
    while (sections[k].length && sections[k][sections[k].length - 1] === '') sections[k].pop();
  });

  const skills = sections.skills ? splitList(sections.skills).slice(0, 40) : [];
  const languages = sections.languages ? splitList(sections.languages).slice(0, 20) : [];
  const achievements = sections.achievements ? sections.achievements.filter(Boolean).slice(0, 20) : [];

  const experience = (sections.experience ? splitBlocks(sections.experience) : []).slice(0, 10).map((block) => {
    let dateLineIdx = block.findIndex((l) => extractDateRange(l).matchText);
    const headerLines = dateLineIdx === -1 ? [block[0] || ''] : block.slice(0, dateLineIdx + 1);
    let bulletLines = dateLineIdx === -1 ? block.slice(1) : block.slice(dateLineIdx + 1);

    const headerJoined = headerLines.join(' - ');
    const dateInfo = extractDateRange(headerJoined);
    const headerNoDate = (dateInfo.matchText ? headerJoined.replace(dateInfo.matchText, '').trim() : headerJoined).replace(/[\s,–—-]+$/, '');

    let parts = headerNoDate.split(/ at | @ |,| - |—/i).map((s) => s.trim()).filter(Boolean);

    // Recover company/location line that may have been pushed into bullets
    if (parts.length < 2 && bulletLines.length && looksLikeCompanyLocationLine(bulletLines[0])) {
      const extra = bulletLines[0].split(/,| - |—/i).map((s) => s.trim()).filter(Boolean);
      parts = parts.concat(extra);
      bulletLines = bulletLines.slice(1);
    }

    // Improved robust assignment for tricky resume formats (fixes roles 2,4,5,6 etc.)
    let role = parts[0] || headerLines[0] || '';
    let company = parts[1] || '';
    let loc = parts.slice(2).join(', ');

    // Additional fixes for common mis-mappings
    if ((!company || company.length < 3) && parts.length > 1) {
      company = parts[1];
    }
    if (parts.length > 2) {
      const potentialLoc = parts[parts.length - 1];
      if (LOCATION_RE.test(potentialLoc) || potentialLoc.includes(',')) {
        loc = potentialLoc;
        company = parts.slice(1, -1).join(', ') || company;
      }
    }

    const description = bulletLines.filter(Boolean).join('\n').trim();

    return {
      role,
      company,
      location: loc,
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

    const dateInfo = extractDateRange(block.join(' '));
    let location = '';
    if (block[restStart]) {
      const lineDate = extractDateRange(block[restStart]);
      const locText = lineDate.matchText 
        ? block[restStart].replace(lineDate.matchText, '').trim().replace(/[,.\s-]+$/, '') 
        : block[restStart];
      if (locText) location = locText;
      restStart += 1;
    }
    const rest = block.slice(restStart).join(' ').trim();

    let field = '';
    const inMatch = degreeLine.match(/^(.*?)\s+in\s+(.+)$/i);
    if (inMatch) field = inMatch[2].trim();

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
    name: line, 
    issuer: '', 
    date: (extractDateRange(line).endDate || extractDateRange(line).startDate || '')
  }));

  const publications = (sections.publications || []).filter(Boolean).slice(0, 10).map((line) => ({
    title: line, 
    link: (line.match(/https?:\/\/[^\s,;)]+/) || [''])[0], 
    date: ''
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
