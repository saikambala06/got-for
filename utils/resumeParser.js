// Free, rule-based resume parser - improved for your Azure DevOps resume format

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
    .map(s => s.trim())
    .filter(s => s && s.length < 80);
}

function splitBlocks(lines) {
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (line === '') {
      if (current.length) blocks.push(current);
      current = [];
    } else current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

const MONTHS = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

function extractDateRange(text) {
  const re = new RegExp(`((?:${MONTHS}\\.?\\s)?\\d{1,2}[\/.]?\\d{4}|(?:${MONTHS}\\.?\\s)?\\d{4})\\s*[-–—]+\\s*(Present|Current|(?:${MONTHS}\\.?\\s)?\\d{4})`, 'i');
  const m = text.match(re);
  if (!m) return { startDate: '', endDate: '', matchText: '' };
  return { startDate: m[1].trim(), endDate: m[2].trim(), matchText: m[0] };
}

const LOCATION_RE = /\b[A-Za-z][A-Za-z.\s]{1,35},\s*(?:[A-Z]{2}|[A-Za-z]{3,20})\b/;

function parseResumeText(rawText) {
  const text = (rawText || '').replace(/\r/g, '');
  const lines = text.split('\n').map(l => l.trim());
  const nonEmpty = lines.filter(Boolean);

  // Personal info
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const phoneMatch = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  const linkedinMatch = text.match(/(https?:\/\/)?(www\.)?linkedin\.com\/[^\s,;)]+/i);
  const urlMatches = text.match(/https?:\/\/[^\s,;)]+/g) || [];
  const portfolio = urlMatches.find(u => !/linkedin\.com/i.test(u)) || '';

  let name = nonEmpty[0] || '';
  let location = '';
  for (const line of nonEmpty.slice(0, 10)) {
    const m = line.match(LOCATION_RE);
    if (m) { location = m[0]; break; }
  }

  // Section detection
  let currentSection = null;
  const sections = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentSection) sections[currentSection].push('');
      continue;
    }
    let matched = null;
    for (const [key, re] of Object.entries(SECTION_HEADERS)) {
      if (re.test(trimmed)) { matched = key; break; }
    }
    if (matched) {
      currentSection = matched;
      sections[matched] = sections[matched] || [];
    } else if (currentSection) {
      sections[currentSection].push(trimmed);
    }
  }

  // Clean sections
  Object.keys(sections).forEach(k => {
    while (sections[k][0] === '') sections[k].shift();
    while (sections[k][sections[k].length-1] === '') sections[k].pop();
  });

  const skills = sections.skills ? splitList(sections.skills) : [];

  // === EXPERIENCE - Improved parsing ===
  const experience = (sections.experience ? splitBlocks(sections.experience) : []).map(block => {
    const dateLineIdx = block.findIndex(l => extractDateRange(l).matchText);
    const headerLines = dateLineIdx === -1 ? [block[0] || ''] : block.slice(0, dateLineIdx + 1);
    let bullets = dateLineIdx === -1 ? block.slice(1) : block.slice(dateLineIdx + 1);

    const headerText = headerLines.join(' | ');
    const dateInfo = extractDateRange(headerText);

    // Extract role, company, location from header
    let headerClean = headerText.replace(dateInfo.matchText, '').trim();
    let parts = headerClean.split(/ at | @ |,| - |—/).map(p => p.trim()).filter(Boolean);

    let role = parts[0] || '';
    let company = parts[1] || '';
    let loc = parts.slice(2).join(', ') || '';

    // Fallback for common patterns
    if (!company && parts.length > 1) company = parts[1];
    if (LOCATION_RE.test(parts[parts.length-1])) {
      loc = parts.pop();
      company = parts[1] || company;
    }

    return {
      role,
      company,
      location: loc,
      startDate: dateInfo.startDate,
      endDate: dateInfo.endDate || 'Present',
      current: /present|current/i.test(dateInfo.endDate),
      description: bullets.filter(Boolean).join('\n').trim()
    };
  });

  // Education
  const education = (sections.education ? splitBlocks(sections.education) : []).map(block => {
    const dateInfo = extractDateRange(block.join(' '));
    return {
      school: block[0] || '',
      degree: block[1] || '',
      field: block.find(l => /information technology|computer|engineering/i.test(l)) || '',
      location: '',
      startDate: '',
      endDate: '',
      current: false,
      description: ''
    };
  });

  const summary = sections.summary ? sections.summary.join(' ').trim() : '';

  return {
    personal: { name, email: emailMatch?.[0] || '', phone: phoneMatch?.[0] || '', location, linkedin: linkedinMatch?.[0] || '', portfolio },
    summary,
    experience,
    education,
    skills,
    projects: [],
    certifications: [],
    achievements: [],
    languages: [],
    publications: []
  };
}

function normalizeDocxText(text) {
  return text.replace(/\n{3,}/g, '\n\n').replace(/\n{2}/g, '\n\n');
}

module.exports = { parseResumeText, normalizeDocxText };
