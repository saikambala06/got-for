/**
 * AI-powered job posting extractor using Google Gemini (see
 * utils/geminiClient.js). Given a job title, company, and raw scraped page
 * text, returns clean, structured skills / qualifications / key-highlights —
 * the same fields the browser extension's side panel renders.
 *
 * Falls back to a local, regex/taxonomy-based extraction (skillsLexicon.js)
 * whenever no AI provider is configured or the call fails/returns something
 * malformed, so the panel is never left empty. Never throws.
 */
const { callAI, extractJSON } = require('./geminiClient');
const { extractSkillsFromText } = require('./skillsLexicon');

const SYSTEM_PROMPT = `You are a precision job-posting data extraction engine. Your ONLY job is to read raw, messy text scraped from a job listing web page and output a single valid JSON object — nothing else. No markdown fences, no commentary, no explanation before or after. Just raw JSON.

The scraped text may contain unrelated page clutter (navigation links, "Apply now" buttons, related-job carousels, footer text, cookie banners). Ignore all of that and focus only on the actual job posting content.

=== OUTPUT SCHEMA ===
{
  "skills": string[],            // Specific hard/technical skills, tools, languages, frameworks, platforms, or named certifications this job explicitly requires or mentions. Use the exact conventional name (e.g. "Machine learning", "AWS", "Power BI", "SQL"). Do NOT include vague filler like "communication skills", "team player", "fast-paced environment", or the job title itself. 6-15 items, most important first. Never invent skills not implied by the text.
  "qualifications": string[],    // Short, verbatim-or-near-verbatim bullet points describing required/preferred qualifications, education, years of experience, or must-have background (e.g. "5+ years of professional experience", "Bachelor's degree in Computer Science or related field"). 3-8 items. Do not include responsibilities/duties here, only qualifications/requirements.
  "highlights": string[],        // Notable candidate-relevant facts about the job/company: visa sponsorship, benefits (medical/dental/vision/401k), remote/hybrid status, equity, bonus, relocation, security clearance, unlimited PTO. Only include ones with clear textual evidence. 0-6 items, using short labels like "H1B Sponsor Likely", "Medical coverage", "Remote friendly".
  "employmentType": string,      // "Full-time", "Part-time", "Contract", "Internship", "Temporary", or "" if unclear.
  "experienceLevel": string,     // e.g. "Entry Level", "Mid Level", "Senior Level", or "" if unclear.
  "salaryMin": number,           // Lower bound of stated salary range as a plain number (e.g. 73000), or 0 if not stated.
  "salaryMax": number,           // Upper bound of stated salary range as a plain number, or 0 if not stated.
  "salaryPeriod": string         // "year" or "hour", or "" if not stated.
}

=== RULES ===
1. Output ONLY the JSON object. First character must be "{", last must be "}".
2. Every field MUST appear, even if empty ("" or [] or 0).
3. Never fabricate a skill, qualification, or highlight that isn't clearly supported by the text.
4. Keep each qualifications/highlights string under 120 characters.
5. Deduplicate — never repeat the same skill/qualification/highlight twice.`;

function clampArray(arr, max, maxLen = 140) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const s = String(raw || '').trim().slice(0, maxLen);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function clampNumber(n) {
  const num = Number(n);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}

// ── Local (no-AI) fallback ───────────────────────────────────────────────

const HIGHLIGHT_RULES = [
  { label: 'H1B Sponsor Likely', test: /\bh-?1b\b.{0,40}\b(sponsor|sponsorship)\b|\bsponsor(ship)?\b.{0,40}\bh-?1b\b|visa sponsorship available/i },
  { label: 'Medical coverage', test: /\bmedical\b(?:\s+(?:insurance|coverage|benefits))?/i },
  { label: 'Dental', test: /\bdental\b/i },
  { label: 'Vision', test: /\bvision\b/i },
  { label: '401(k)', test: /\b401\s?\(?k\)?\b/i },
  { label: 'Remote friendly', test: /\bremote[- ]friendly\b|\bwork from home\b|\bfully remote\b/i },
  { label: 'Hybrid', test: /\bhybrid\b/i },
  { label: 'Equity / stock options', test: /\bequity\b|\bstock options\b|\bRSU\b/i },
  { label: 'Unlimited PTO', test: /\bunlimited\s+(pto|vacation)\b/i },
  { label: 'Relocation assistance', test: /\brelocation\s+(assistance|package|support)\b/i },
  { label: 'Security clearance required', test: /\bsecurity clearance\b/i },
  { label: 'Bonus eligible', test: /\bannual bonus\b|\bbonus eligible\b|\bperformance bonus\b/i }
];

function detectHighlights(text) {
  return HIGHLIGHT_RULES.filter((h) => h.test.test(text)).map((h) => h.label);
}

function detectQualifications(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const headingIdx = lines.findIndex((l) =>
    /^(requirements?|qualifications?|what you.?ll need|who you are|skills( required)?|must have|preferred qualifications|minimum qualifications)\b[:\-]?$/i.test(l)
  );
  if (headingIdx === -1) {
    // No explicit heading — pull sentences that look like requirement bullets anywhere.
    return lines
      .filter((l) => /^[-•*]\s*/.test(l) || /^\d+\+?\s*years?/i.test(l))
      .map((l) => l.replace(/^[-•*]\s*/, ''))
      .slice(0, 8);
  }
  const bullets = [];
  for (let i = headingIdx + 1; i < lines.length && bullets.length < 8; i++) {
    const l = lines[i];
    if (/^(responsibilities|about (us|the company|the role)|benefits|perks|compensation|equal opportunity)\b/i.test(l)) break;
    if (/^[-•*]\s*/.test(l) || (l.length > 15 && l.length < 200)) {
      bullets.push(l.replace(/^[-•*]\s*/, ''));
    }
  }
  return bullets;
}

function detectEmploymentType(text) {
  const m = text.match(/\b(Full-time|Part-time|Contract|Internship|Temporary|Freelance)\b/i);
  return m ? m[1] : '';
}

function detectExperienceLevel(text) {
  if (/\b(senior|sr\.?|lead|principal|staff)\b/i.test(text)) return 'Senior Level';
  if (/\b(entry[- ]level|junior|jr\.?|new grad|graduate)\b/i.test(text)) return 'Entry Level';
  if (/\bmid[- ]level\b/i.test(text)) return 'Mid Level';
  return '';
}

function detectSalary(text) {
  const m = text.match(/\$\s?(\d{1,3}(?:,\d{3})*|\d+)(K|k)?\s?-\s?\$\s?(\d{1,3}(?:,\d{3})*|\d+)(K|k)?\s?(?:\/\s?(yr|hr|year|hour))?/);
  if (!m) return { salaryMin: 0, salaryMax: 0, salaryPeriod: '' };
  const toNum = (numStr, kFlag) => {
    let n = Number(String(numStr).replace(/,/g, ''));
    if (kFlag) n *= 1000;
    return n;
  };
  const min = toNum(m[1], m[2]);
  const max = toNum(m[3], m[4]);
  const periodRaw = (m[5] || '').toLowerCase();
  const salaryPeriod = periodRaw === 'hr' || periodRaw === 'hour' ? 'hour' : (min || max ? 'year' : '');
  return { salaryMin: min, salaryMax: max, salaryPeriod };
}

function localExtractJobDetails(title, company, description) {
  const text = description || '';
  return {
    skills: clampArray(extractSkillsFromText(text), 15),
    qualifications: clampArray(detectQualifications(text), 8),
    highlights: clampArray(detectHighlights(text), 6),
    employmentType: detectEmploymentType(text),
    experienceLevel: detectExperienceLevel(text),
    ...detectSalary(text),
    usedAI: false
  };
}

// ── AI-powered extraction with local fallback ────────────────────────────

async function extractJobDetails(title, company, description) {
  const text = (description || '').trim();
  if (!text) {
    return { skills: [], qualifications: [], highlights: [], employmentType: '', experienceLevel: '', salaryMin: 0, salaryMax: 0, salaryPeriod: '', usedAI: false };
  }

  if (!process.env.GEMINI_API_KEY) {
    console.warn('[aiJobExtractor] No AI provider configured (GEMINI_API_KEY) — using local extraction engine');
    return localExtractJobDetails(title, company, text);
  }

  try {
    const json = await callAI(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Job Title: ${title || 'Not specified'}\nCompany: ${company || 'Not specified'}\n\nRaw scraped page text:\n${text.slice(0, 6000)}`
        }
      ],
      2000
    );

    const result = extractJSON(json);

    const local = localExtractJobDetails(title, company, text);

    // AI is the primary source, but we still union in anything our local
    // taxonomy caught that the model may have missed — never lets a real,
    // literal skill mention (e.g. "AWS", "Python") silently disappear.
    const skillsAI = clampArray(result.skills, 15);
    const skillsLocalOnly = local.skills.filter(
      (s) => !skillsAI.some((a) => a.toLowerCase() === s.toLowerCase())
    );
    const skills = clampArray([...skillsAI, ...skillsLocalOnly], 15);

    return {
      skills,
      qualifications: clampArray(result.qualifications, 8) .length ? clampArray(result.qualifications, 8) : local.qualifications,
      highlights: clampArray(result.highlights, 6).length ? clampArray(result.highlights, 6) : local.highlights,
      employmentType: result.employmentType || local.employmentType || '',
      experienceLevel: result.experienceLevel || local.experienceLevel || '',
      salaryMin: clampNumber(result.salaryMin) || local.salaryMin,
      salaryMax: clampNumber(result.salaryMax) || local.salaryMax,
      salaryPeriod: result.salaryPeriod || local.salaryPeriod || '',
      usedAI: true
    };
  } catch (err) {
    console.error('[aiJobExtractor] AI extraction failed, using local engine:', err.message);
    return localExtractJobDetails(title, company, text);
  }
}

module.exports = { extractJobDetails };
