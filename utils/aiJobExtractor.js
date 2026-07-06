'use strict';

// ── xAI caller (shared pattern from aiResumeParser) ──────────────────────────
async function callGrok(messages, maxTokens = 2000) {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error('XAI_API_KEY not set');

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'grok-3-mini',
      max_tokens: maxTokens,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`xAI ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '{}';
}

// ── Regex-based fallback extraction ──────────────────────────────────────────
function regexExtract(description) {
  const text = description || '';

  // Salary
  const salaryRe = /\$\s*([\d,]+)\s*[Kk]?\s*(?:\/\s*(?:yr|year|mo|month|hr|hour)|per\s+(?:year|month|hour|annum))?\s*(?:[-–to]+\s*\$\s*([\d,]+)\s*[Kk]?)?/g;
  let salary = '';
  const sm = text.match(/\$([\d,]+)[Kk]?\s*[-–]\s*\$([\d,]+)[Kk]?/);
  if (sm) {
    const a = parseFloat(sm[1].replace(',', '')) * (sm[1].match(/[Kk]/) || sm[0].match(/[Kk]/i) ? 1000 : 1);
    const b = parseFloat(sm[2].replace(',', '')) * (sm[2].match(/[Kk]/) || sm[0].match(/[Kk]/i) ? 1000 : 1);
    salary = `$${Math.round(a/1000)}K – $${Math.round(b/1000)}K/yr`;
  } else {
    const sm2 = text.match(/\$([\d,]+)[Kk]?(?:\s*\/\s*(?:yr|year|annum))?/);
    if (sm2) salary = sm2[0];
  }

  // Experience level
  let experienceLevel = '';
  if (/senior|sr\.?\s+/i.test(text)) experienceLevel = 'Senior';
  else if (/mid[\s-]?level|intermediate/i.test(text)) experienceLevel = 'Mid Level';
  else if (/junior|jr\.?\s+|entry[\s-]?level|new grad/i.test(text)) experienceLevel = 'Entry Level';
  else if (/lead|principal|staff\s+/i.test(text)) experienceLevel = 'Lead';
  else if (/director|head of|vp of|vice president/i.test(text)) experienceLevel = 'Director';
  else if (/manager/i.test(text)) experienceLevel = 'Manager';

  // Experience years
  let experienceYears = '';
  const yrMatch = text.match(/(\d+)\+?\s*(?:to\s*\d+)?\s*years?\s+(?:of\s+)?(?:experience|exp)/i);
  if (yrMatch) experienceYears = `${yrMatch[1]}+ yrs`;

  // Benefits / highlights
  const highlights = [];
  if (/h[\s-]?1b|visa\s+sponsor/i.test(text)) highlights.push('H1B Sponsor Likely');
  if (/medical|health\s+insurance|health\s+coverage/i.test(text)) highlights.push('Medical Coverage');
  if (/dental/i.test(text)) highlights.push('Dental');
  if (/vision/i.test(text)) highlights.push('Vision');
  if (/401\s*[kK]|retirement|pension/i.test(text)) highlights.push('401(k)');
  if (/remote|work\s+from\s+home|wfh/i.test(text)) highlights.push('Remote Friendly');
  if (/hybrid/i.test(text)) highlights.push('Hybrid');
  if (/pto|paid\s+time\s+off|unlimited\s+pto|vacation/i.test(text)) highlights.push('PTO');
  if (/equity|stock|rsu|options/i.test(text)) highlights.push('Equity');
  if (/bonus/i.test(text)) highlights.push('Bonus');
  if (/parental|maternity|paternity/i.test(text)) highlights.push('Parental Leave');
  if (/relocation/i.test(text)) highlights.push('Relocation Assistance');

  return { salary, experienceLevel, experienceYears, highlights };
}

// ── Prompt ────────────────────────────────────────────────────────────────────
const EXTRACT_SYS = `You extract structured job posting data and return it as JSON only.

Return this exact JSON structure (no extra keys, no markdown, no explanation):
{
  "salary": "e.g. $73K – $113K/yr or empty string",
  "salaryMin": 73000,
  "salaryMax": 113000,
  "salaryPeriod": "annual | monthly | hourly | empty",
  "experienceLevel": "Entry Level | Mid Level | Senior | Lead | Manager | Director | empty",
  "experienceYears": "e.g. 3+ yrs or empty string",
  "highlights": ["H1B Sponsor Likely", "Medical Coverage", "Dental", "Vision", "401(k)", "Remote Friendly", "Hybrid", "PTO", "Equity", "Bonus", "Parental Leave"],
  "skills": ["skill1", "skill2"],
  "keywords": ["keyword1", "keyword2"]
}

RULES:
1. salary: extract the exact salary/pay range as a human-readable string. Use K for thousands, include /yr /mo /hr suffix.
2. salaryMin/salaryMax: numeric values in full (e.g. 73000 not 73). Use 0 if not found.
3. highlights: only include what is explicitly mentioned. Common items: H1B Sponsor Likely, Medical Coverage, Dental, Vision, 401(k), Remote Friendly, Hybrid, PTO/Unlimited PTO, Equity/RSU/Stock Options, Performance Bonus, Parental Leave, Relocation Assistance.
4. skills: extract all technical and soft skills mentioned as requirements or preferred qualifications.
5. keywords: 8-15 most important job requirement keywords for resume matching.
6. If field has no data: use "" for strings, 0 for numbers, [] for arrays.`;

// ── Main export ───────────────────────────────────────────────────────────────
async function extractJobDetails(description, title = '') {
  const text = (description || '').slice(0, 6000);
  const regex = regexExtract(text);

  if (!process.env.XAI_API_KEY) {
    // Fallback: return regex extraction + basic skills
    return { ...regex, skills: [], keywords: [], salaryMin: 0, salaryMax: 0, salaryPeriod: '' };
  }

  try {
    const jsonStr = await callGrok([
      { role: 'system', content: EXTRACT_SYS },
      { role: 'user', content: `Job Title: ${title}\n\nJob Description:\n${text}` },
    ], 1500);

    const parsed = JSON.parse(jsonStr);

    // Merge: prefer AI results but fall back to regex if AI returned empty
    return {
      salary:          parsed.salary          || regex.salary          || '',
      salaryMin:       parsed.salaryMin        || 0,
      salaryMax:       parsed.salaryMax        || 0,
      salaryPeriod:    parsed.salaryPeriod     || '',
      experienceLevel: parsed.experienceLevel  || regex.experienceLevel || '',
      experienceYears: parsed.experienceYears  || regex.experienceYears || '',
      highlights:      Array.isArray(parsed.highlights) && parsed.highlights.length
                         ? parsed.highlights
                         : regex.highlights,
      skills:          Array.isArray(parsed.skills)    ? parsed.skills   : [],
      keywords:        Array.isArray(parsed.keywords)  ? parsed.keywords : [],
    };
  } catch (err) {
    console.error('[jobExtractor] AI failed, using regex fallback:', err.message);
    return { ...regex, skills: [], keywords: [], salaryMin: 0, salaryMax: 0, salaryPeriod: '' };
  }
}

module.exports = { extractJobDetails };
