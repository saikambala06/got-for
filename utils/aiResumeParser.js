/**
 * AI-powered resume parser using Groq.
 * Uses Groq as the only AI provider. Local regex parsing is retained only as a deterministic text-to-field recovery path.
 */
const { parseResumeText } = require('./resumeParser');
const { cleanSkill } = require('./skillUtils');
const { jsonrepair } = require('jsonrepair');

// ─── Shared Groq caller ──────────────────────────────────────────────────────
//
// NOTE ON MODEL NAME: 'openai/gpt-oss-120b' is Groq's flagship general-purpose
// model (their own recommended replacement for the now-deprecated
// llama-3.3-70b-versatile). The model can still be overridden via GROQ_MODEL
// without a code change. On a 400/404 (model unavailable on this account, or
// renamed/retired) we fall back once to 'openai/gpt-oss-20b', the smaller
// sibling model, which is nearly always enabled.
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const GROQ_FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-120b';
const GROQ_TAILOR_MAX_COMPLETION = Number(process.env.GROQ_TAILOR_MAX_COMPLETION || 2400);
const GROQ_PARSE_MAX_COMPLETION = Number(process.env.GROQ_PARSE_MAX_COMPLETION || 2200);
const GROQ_SAFE_INPUT_CHARS = Number(process.env.GROQ_SAFE_INPUT_CHARS || 18000);

const { getKeyPool } = require('./groqKeyPool');

function parseRetryAfterSeconds(response) {
  const header = response.headers.get?.('retry-after');
  return header && !Number.isNaN(Number(header)) ? Number(header) : null;
}

async function callGroq(messages, maxTokens = 8000, { jsonMode = false } = {}) {
  const pool = getKeyPool();
  if (!pool.hasKeys()) throw new Error('GROQ_API_KEY not configured');

  // Groq's chat completions endpoint is OpenAI-compatible, so our internal
  // {role, content} message shape (role: 'system' | 'user' | 'assistant')
  // maps straight across — no reshaping needed.
  function buildRequestBody(model) {
    return {
      model,
      messages,
      temperature: 0,        // deterministic extraction
      max_completion_tokens: maxTokens,
      // This is extraction/rewriting, not open-ended reasoning, so keep the
      // reasoning effort (and the hidden "thinking" tokens it would otherwise
      // spend) to a minimum — the token budget goes to visible output instead.
      reasoning_effort: 'low',
      include_reasoning: false,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    };
  }

  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const doRequest = (apiKey, body) => fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  // Try every key in the pool (round-robin, skipping ones on cooldown) until
  // one succeeds. A 429 (quota exhausted) or 401/403 (key invalid/disabled)
  // rotates immediately to the next key with no delay to the user — that's
  // the whole point of having a pool. A transient 5xx gets one same-key
  // retry with backoff before moving on.
  const order = pool.availableOrder().length ? pool.availableOrder() : pool.allBySoonestAvailable();
  let lastError = null;
  let droppedToFallbackModel = false; // only fall back to the smaller model once, total, across the whole call

  for (const apiKey of order) {
    let model = GROQ_MODEL;
    let response;
    try {
      response = await doRequest(apiKey, buildRequestBody(model));
    } catch (networkErr) {
      lastError = networkErr;
      continue; // network hiccup on this key — try the next one
    }

    if (!response.ok && response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      response = await doRequest(apiKey, buildRequestBody(model));
    }

    // A 400/404 here usually means the configured model isn't enabled for
    // this account, or has been renamed/retired. Retrying once against the
    // smaller fallback model (on the same key) self-heals that whole class
    // of error instead of hard failing every request until redeployed.
    if ((response.status === 400 || response.status === 404) && !droppedToFallbackModel && model !== GROQ_FALLBACK_MODEL) {
      droppedToFallbackModel = true;
      model = GROQ_FALLBACK_MODEL;
      response = await doRequest(apiKey, buildRequestBody(model));
    }

    if (response.status === 429 || response.status === 401 || response.status === 403) {
      const retryAfter = parseRetryAfterSeconds(response);
      const bodyText = await response.text().catch(() => '');
      pool.markExhausted(apiKey, retryAfter);
      lastError = new Error(`Groq API ${response.status} on key ${pool.label(apiKey)}: ${bodyText.slice(0, 200)}`);
      continue; // rotate to the next key in the pool
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // Not a quota/auth issue (bad request, bad model, etc.) — retrying
      // with a different key won't help, so fail fast with the real reason.
      throw new Error(`Groq API ${response.status}: ${body.slice(0, 300)}`);
    }

    pool.markWorking(apiKey);
    const data = await response.json();

    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('Groq returned no choices');
    }

    const text = (choice.message?.content || '').trim();

    if (!text) {
      throw new Error(
        choice.finish_reason === 'length'
          ? 'Groq response was cut off before it produced any output — try a shorter job description or resume.'
          : `Groq returned an empty response${choice.finish_reason ? ` (${choice.finish_reason})` : ''}`
      );
    }

    return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }

  // Every key in the pool is either exhausted or errored.
  throw lastError || new Error('All configured Groq API keys are currently unavailable');
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
      let list;
      if (typeof raw === 'string') {
        list = raw.split(/[,;|]/).map(cleanSkill).filter(Boolean);
      } else {
        list = arr(raw).flatMap(s => {
          if (typeof s === 'string') return s.split(/[,;|]/).map(cleanSkill).filter(Boolean);
          if (typeof s === 'object' && s !== null) return [cleanSkill(str(s?.name, s?.skill, s?.value))].filter(Boolean);
          return [];
        });
      }
      // Dedupe case-insensitively while preserving first-seen casing/order
      const seen = new Set();
      return list.filter((s) => {
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
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

  const start = s.indexOf('{');
  if (start === -1) {
    throw new Error('No JSON object found in model response');
  }

  // Walk forward from the first '{' and find the point where it (and every
  // container opened after it) closes. Using this — rather than the naive
  // `lastIndexOf('}')` — matters because models sometimes append trailing
  // prose/notes after the JSON object, which can itself contain braces
  // (e.g. a stray "{something}" in a comment). lastIndexOf would then grab
  // that later brace as the "end", leaving unrelated trailing text inside
  // the slice and causing "Unexpected non-whitespace character after JSON".
  // Walking forward and stopping the instant the first object balances out
  // avoids that failure mode entirely, and still supports truncated
  // responses (the walk just never finds a balanced point, so `end`
  // stays -1 and we fall through to repairTruncatedJSON on the full tail).
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  if (end !== -1) {
    const candidate = s.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (e) {
      try {
        return repairTruncatedJSON(candidate, extractErrorPosition(e));
      } catch {
        try {
          return JSON.parse(jsonrepair(candidate));
        } catch {
          // Fall through and try the wider/truncation-repair path below.
        }
      }
    }
  }

  // Either the first object never balanced (truncated response) or the
  // balanced slice itself didn't parse cleanly — fall back to the old
  // "everything from the first '{' to the last '}' in the text" slice and
  // attempt truncation repair on that.
  const lastBrace = s.lastIndexOf('}');
  if (lastBrace === -1 || lastBrace < start) {
    throw new Error('No JSON object found in model response');
  }
  s = s.slice(start, lastBrace + 1);

  try {
    return JSON.parse(s);
  } catch (e) {
    try {
      return repairTruncatedJSON(s, extractErrorPosition(e));
    } catch {
      // Last resort: jsonrepair handles cases our own repair logic doesn't —
      // unescaped quotes inside string values, raw control characters,
      // trailing commas, single-quoted strings, etc. This is what actually
      // recovers responses that fail with errors like "Expected ',' or ']'
      // after array element", which usually means a stray unescaped quote
      // mid-string threw off parsing well before the true end of the
      // response (not a truncation issue at all, so our bracket-counting
      // repair can't fix it).
      try {
        return JSON.parse(jsonrepair(s));
      } catch {
        throw new Error(`JSON parse failed: ${e.message}`);
      }
    }
  }
}

// JSON.parse's error message includes the character offset where parsing
// broke, e.g. "Unexpected token x in JSON at position 123" or "Expected ','
// or ']' after array element in JSON at position 123". Pull that number out
// so repairTruncatedJSON can bound its scan to it.
function extractErrorPosition(err) {
  const m = /position (\d+)/.exec(err?.message || '');
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Recover a usable object from JSON that got cut off mid-response (hit the
 * token budget) or otherwise has trailing garbage after some valid prefix.
 *
 * Naively counting '{'/'[' vs '}'/']' and appending the difference (the old
 * approach) breaks whenever `lastIndexOf('}')` above happened to land on a
 * brace that *isn't* the true end of the document — e.g. the closing brace
 * of some nested object in the middle of an array — because everything
 * between that point and the real cutoff is left in place and is not valid
 * JSON on its own. That produces exactly the "Expected ',' or ']' after
 * array element" error this function exists to prevent.
 *
 * Instead, walk the string tracking bracket depth and string state, and
 * remember every point where a container (object/array) fully closes. On
 * failure we cut back to the *last* such safe point — guaranteed to be a
 * complete, valid value — then close whatever containers are still open at
 * that point. This reliably recovers all-but-the-last (incomplete) element
 * of a truncated array, which is exactly what happens when maxOutputTokens
 * is hit mid-way through a long bullet list.
 */
function repairTruncatedJSON(s, errorPosition) {
  // Bound the scan to where JSON.parse actually broke (if we know it). This
  // matters for more than just true end-of-response truncation: if the
  // model emitted a subtly malformed value mid-document (e.g. a stray
  // unescaped character inside a string), the *rest* of the string can
  // still contain well-formed-looking brackets that make it past a naive
  // full-string scan as a "safe" cut point — even though it sits after the
  // actual corruption. That produces a "repaired" string which still
  // contains the bad content and fails to parse again. Stopping the walk at
  // errorPosition guarantees the repaired result never includes anything
  // past the point parsing is known to have gone wrong.
  const limit = Number.isFinite(errorPosition) ? Math.min(errorPosition, s.length) : s.length;

  const stack = [];
  let inString = false;
  let escape = false;
  let lastSafeCut = null;

  for (let i = 0; i < limit; i++) {
    const c = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') { stack.push(c); continue; }
    if (c === '}' || c === ']') {
      stack.pop();
      lastSafeCut = { index: i + 1, stack: stack.slice() };
    }
  }

  if (!lastSafeCut || lastSafeCut.index >= s.length) {
    // Nothing usable, or the string already parses cleanly up to its end
    // (shouldn't reach here since JSON.parse already failed) — nothing to repair.
    throw new Error('no safe truncation point found');
  }

  let fixed = s.slice(0, lastSafeCut.index);
  const closers = lastSafeCut.stack.slice().reverse().map((ch) => (ch === '{' ? '}' : ']'));
  fixed += closers.join('');

  return JSON.parse(fixed);
}

// ─── Main parse function ──────────────────────────────────────────────────────

/**
 * Parse a raw resume text into structured fields using Groq.
 * Falls back to the regex parser if the API key is absent or the call fails.
 */
async function parseResumeWithAI(rawText) {
  if (!getKeyPool().hasKeys()) {
    throw new Error('GROQ_API_KEY not configured');
  }
  if (!rawText || !String(rawText).trim()) {
    throw new Error('Resume text is empty');
  }

  const cleaned = preprocessResumeText(String(rawText));
  // Use enough of the document to preserve multi-page work history while
  // staying comfortably inside Groq's current context limits.
  // Keep the prompt+completion comfortably below the common 8k TPM bucket.
  // A 60k-character resume plus a 12k completion request could itself trigger
  // Groq HTTP 413 before the model ever sees the document.
  const trimmed = cleaned.length <= GROQ_SAFE_INPUT_CHARS
    ? cleaned
    : cleaned.slice(0, GROQ_SAFE_INPUT_CHARS);

  const rawJson = await callGroq(
    [
      { role: 'system', content: PARSE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          'Parse the following resume. Extract every factual field available in the supplied text and preserve experience bullets exactly as supplied.',
          'Never invent, infer, or summarize a missing fact. Return only the requested JSON object.',
          '',
          '=== RESUME TEXT START ===',
          trimmed,
          '=== RESUME TEXT END ==='
        ].join('\n')
      }
    ],
    GROQ_PARSE_MAX_COMPLETION,
    { jsonMode: true }
  );

  const result = sanitizeParsed(extractJSON(rawJson));
  const hasData = Boolean(
    result.personal.name ||
    result.personal.email ||
    result.experience.length ||
    result.education.length ||
    result.skills.length ||
    result.summary
  );

  if (!hasData) throw new Error('Groq returned an empty resume structure');
  return result;
}

// ─── Parse pasted (not uploaded) resume text ──────────────────────────────────
// Same underlying parseResumeWithAI pipeline — pulled out under its own name
// so callers (the web portal's "paste text" flow) read clearly.
async function parseRawResumeTextWithAI(rawText) {
  return parseResumeWithAI(rawText);
}

// ─── Tailor an arbitrary pasted resume against a pasted job description ──────
// Unlike tailorResumeWithAI (which tailors an existing saved Resume document
// and returns a resume-shaped patch), this is for the web portal's "Tailor"
// tab where the person just pastes free text on both sides — no saved
// resume required. Returns a match-score/keyword-gap shaped result instead.

const TAILOR_TEXT_SYSTEM_PROMPT = `You are a resume tailoring assistant. Compare the RESUME to the JOB DESCRIPTION and respond with JSON only, no preamble, no markdown fences, using exactly this schema:
{
  "match_score": number (0-100),
  "matched_keywords": [string],
  "missing_keywords": [string],
  "tailored_summary": string (2-3 sentences, based only on real experience already in the resume),
  "tailored_bullets": [string] (3-5 rewritten bullets reframing real existing experience using language from the job description),
  "advice": string (2-3 sentences of concrete, honest advice)
}
Do not fabricate skills or experience the candidate doesn't have.`;

function sanitizeTailorTextResult(r) {
  const arr = (v, max) => (Array.isArray(v) ? v : [])
    .map((s) => (typeof s === 'string' ? s.trim() : String(s || '').trim()))
    .filter(Boolean)
    .slice(0, max);
  const score = Number(r?.match_score);
  return {
    match_score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    matched_keywords: arr(r?.matched_keywords, 30),
    missing_keywords: arr(r?.missing_keywords, 30),
    tailored_summary: typeof r?.tailored_summary === 'string' ? r.tailored_summary.trim() : '',
    tailored_bullets: arr(r?.tailored_bullets, 6),
    advice: typeof r?.advice === 'string' ? r.advice.trim() : ''
  };
}

async function tailorRawTextWithAI(resumeText, jobDescription) {
  if (!getKeyPool().hasKeys()) {
    throw new Error('GROQ_API_KEY not configured');
  }
  if (!resumeText?.trim() || !jobDescription?.trim()) {
    throw new Error('Both resume text and job description are required');
  }

  const json = await callGroq(
    [
      { role: 'system', content: TAILOR_TEXT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `RESUME:\n"""\n${resumeText.slice(0, 20000)}\n"""\n\nJOB DESCRIPTION:\n"""\n${jobDescription.slice(0, 6000)}\n"""`
      }
    ],
    3000,
    { jsonMode: true }
  );

  return sanitizeTailorTextResult(extractJSON(json));
}



const JOB_ANALYSIS_SYSTEM_PROMPT = `You are a precision job-posting analysis engine. Read the job posting text and output a single valid JSON object — nothing else. No markdown fences, no commentary.

Your job is to extract, in the candidate's own resume-matching vocabulary:

1. "skills": EVERY concrete hard skill, tool, language, framework, platform, or technology explicitly required or preferred in the posting. Use short canonical names matching how they'd appear on a resume (e.g. "React", "AWS", "Python", "SQL", "Kubernetes", "Figma"). Do not include soft skills (e.g. "communication", "teamwork") in this list. Do not invent skills that aren't mentioned or clearly implied by the posting's requirements. Aim to be thorough — junior postings may have 3-5, senior/technical postings often have 15-25.

2. "qualifications": ONLY the 3-4 MOST IMPORTANT, MUST-HAVE requirements a candidate needs — the ones that would actually decide whether to apply (e.g. required years of experience, a required degree, the single most critical required skill/certification, a hard eligibility requirement like work authorization). Rank every candidate requirement by how central it is to being qualified, then return ONLY the top 3-4. Drop nice-to-haves, generic filler ("strong communication skills"), and anything redundant with a higher-ranked item. Each bullet: short, standalone, max ~90 characters. Never fabricate a requirement that isn't supported by the text. If the posting truly only supports 1-2 real requirements, return just those — do not pad with weak filler to reach 3.

3. "highlights": ONLY the 3-4 MOST NOTABLE, CONCRETE benefits/perks/hiring-context callouts explicitly mentioned — the ones a candidate would actually care about (e.g. "Visa sponsorship available", "Fully remote", "Equity/stock options", "Unlimited PTO"). Rank by how compelling/distinctive they are and return ONLY the top 3-4; skip generic or minor ones (e.g. don't list "health insurance" if there are more distinctive callouts like sponsorship or a 4-day week). Only include ones actually supported by the text. Return [] if none are mentioned — do not invent generic ones.

4. "experience": { "years": string like "5+ years" or "" if not stated, "seniority": one of "Entry-level"/"Junior"/"Mid-level"/"Senior"/"Lead"/"Principal"/"Staff"/"" if not stated }

=== JSON SCHEMA ===
{
  "skills": [],
  "qualifications": [],
  "highlights": [],
  "experience": { "years": "", "seniority": "" }
}`;

function sanitizeJobAnalysis(a) {
  const arrStr = (v, max) => {
    const list = Array.isArray(v) ? v : [];
    return list
      .map((s) => (typeof s === 'string' ? s.trim() : String(s?.name || s?.value || s || '').trim()))
      .filter(Boolean)
      .slice(0, max);
  };
  return {
    skills: arrStr(a?.skills, 30),
    qualifications: arrStr(a?.qualifications, 4),
    highlights: arrStr(a?.highlights, 4),
    experience: {
      years: typeof a?.experience?.years === 'string' ? a.experience.years.trim() : '',
      seniority: typeof a?.experience?.seniority === 'string' ? a.experience.seniority.trim() : ''
    }
  };
}

/**
 * Analyze a job posting with Groq to extract skills, qualifications,
 * highlights, and experience level. Throws if GROQ_API_KEY isn't
 * configured or the call fails — callers should fall back to the
 * regex-based extraction already computed client-side.
 */
async function analyzeJobWithAI(jobTitle, company, description) {
  if (!getKeyPool().hasKeys()) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const trimmed = (description || '').slice(0, 12000);
  if (!trimmed.trim()) {
    throw new Error('No job description text to analyze');
  }

  const json = await callGroq(
    [
      { role: 'system', content: JOB_ANALYSIS_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `Job Title: ${jobTitle || 'Not specified'}`,
          `Company: ${company || 'Not specified'}`,
          '',
          '=== JOB POSTING TEXT START ===',
          trimmed,
          '=== JOB POSTING TEXT END ==='
        ].join('\n')
      }
    ],
    3000,
    { jsonMode: true }
  );

  return sanitizeJobAnalysis(extractJSON(json));
}



const TAILOR_LEVEL_INSTRUCTIONS = {
  low: 'Tailoring level: LOW. Make light, conservative edits — fix weak verbs and align a few keywords, but change as little of the original wording as possible. Touch only the bullets/summary that clearly need it. Do not suggest removing any bullets.',
  medium: 'Tailoring level: MEDIUM. Rewrite the summary and rephrase most bullets to foreground relevant keywords and quantify impact where the original already implies a number. Keep every bullet (rewrite, do not remove) unless it is truly off-topic for this job.',
  high: 'Tailoring level: HIGH. Aggressively rewrite the summary and every bullet to maximize keyword alignment with the job description, tighten language, and add stronger action verbs and metrics phrasing consistent with what is already in the resume. You may mark bullets that are irrelevant to this job as "remove" and may add up to 2 new bullets per role synthesized from the candidate confirmed skills/summary (never inventing employers, dates, or unverified facts).'
};

const TAILOR_SYSTEM_PROMPT = `You are an expert resume writer and career coach. Tailor the provided resume content to better match the job description. This is a bullet-level, reviewable tailoring pass: the candidate will see every change as an old to new diff and accept or reject each one individually, so preserve a clear one-to-one mapping between original and rewritten content.

Rules:
- Rewrite the professional summary to reflect the target role
- Reorder and refine the skills list to prioritise the most relevant ones first
- Fold in any items listed under "Candidate-confirmed additional skills" into the skills list (the candidate has explicitly confirmed they have these)
- For EVERY bullet in EVERY role, decide one of: "modify" (rewrite it), "keep" (return it unchanged, old equals new), or "remove" (suggest removal — only at HIGH tailoring level and only for bullets truly irrelevant to this job)
- You may also "add" a small number of brand new bullets per role (only at MEDIUM/HIGH level, and only synthesized from facts already present elsewhere in the resume — never invented)
- Never invent facts, employers, dates, or achievements — only rephrase, reorder, and incorporate what already exists or what the candidate has explicitly confirmed
- Follow the requested tailoring level intensity exactly as instructed
- Score the ATS/recruiter match twice — see ATS SCORING RUBRIC below — once for the resume exactly as it stands today ("before"), and once assuming every change you just proposed above is fully accepted ("after")
- Output must be a single valid JSON object: escape any double-quote characters or line breaks that occur inside a string value (e.g. write \" and \n), never leave a raw " or newline inside a string, and never add trailing commas

ATS SCORING RUBRIC (apply this the same way every time, for both "before" and "after"):
- Hard skills / tools / technologies overlap with the job description — 40% of the score
- Job title & seniority alignment (does the candidate's level/title match what's asked?) — 20%
- Relevant responsibilities/domain experience overlap — 25%
- Keyword/terminology alignment (the exact language the job description uses) — 15%
- Score 0–100 and calibrate realistically: a strong, well-aligned candidate typically lands 75–92; a partial/adjacent fit 45–70; a weak fit below 40. Do not default to a narrow band — genuinely differentiate based on the actual overlap.
- "before" reflects ONLY the resume content exactly as given (ignore your own suggestions). "after" reflects the resume if literally every "modify"/"add"/"remove" decision above were applied — it must genuinely track how much those specific changes move the needle (a "low" tailoring pass with light edits should produce a smaller before→after lift than a "high" pass that rewrites aggressively; never report "after" lower than "before" unless the original resume is already a stronger match than any honest rewrite could achieve).

Return ONLY valid JSON, no markdown, no explanation:
{
  "summary": { "old": "original summary text", "new": "new 2 to 3 sentence tailored professional summary" },
  "skills": ["skill1", "skill2", "...full reordered/refined list, including confirmed additions"],
  "experience": [
    {
      "index": 0,
      "bullets": [
        { "old": "original bullet text", "new": "rewritten bullet text", "action": "modify" },
        { "old": "original bullet text", "new": "original bullet text", "action": "keep" },
        { "old": "original bullet text", "new": "", "action": "remove" },
        { "old": "", "new": "a brand new bullet", "action": "add" }
      ]
    }
  ],
  "atsScore": { "before": 62, "after": 87 },
  "suggestions": "1–2 sentence explanation of the key changes made"
}`;

// Clamp/validate the AI's before/after ATS scores. Returns null for a side
// that the model omitted or returned as non-numeric, rather than silently
// coercing to 0 — 0 is a real (if harsh) score and callers need to be able
// to tell "AI scored this 0" apart from "AI didn't return a score at all"
// so they can fall back to a client-side estimate only in the latter case.
function sanitizeAtsScore(v) {
  const clampScore = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null);
  const before = clampScore(Number(v?.before));
  let after = clampScore(Number(v?.after));
  // Tailoring is meant to help, not hurt — if both scores came back, never
  // let "after" render lower than "before" (rare model noise, not a real
  // regression worth surfacing as "your tailored resume scores worse").
  if (before !== null && after !== null && after < before) after = before;
  return { before, after };
}

function splitBullets(description) {
  return String(description || '')
    .split('\n')
    .map((l) => l.replace(/^[\s]*[-•*]\s*/, '').trim())
    .filter(Boolean);
}

function sanitizeTailorResult(result, resume) {
  const out = { ...result };

  // Summary: accept either the new {old,new} shape or a legacy plain string.
  const originalSummary = resume.summary || '';
  if (out.summary && typeof out.summary === 'object') {
    out.summary = {
      old: typeof out.summary.old === 'string' ? out.summary.old : originalSummary,
      new: typeof out.summary.new === 'string' ? out.summary.new : originalSummary
    };
  } else {
    out.summary = { old: originalSummary, new: typeof out.summary === 'string' ? out.summary : originalSummary };
  }

  if (Array.isArray(out.skills)) {
    const seen = new Set();
    out.skills = out.skills
      .map(cleanSkill)
      .filter((s) => {
        if (!s) return false;
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  } else {
    out.skills = resume.skills || [];
  }

  const experienceByIndex = new Map((out.experience || []).map((e) => [e.index, e]));
  out.experience = (resume.experience || []).map((role, i) => {
    const aiEntry = experienceByIndex.get(i);
    const originalBullets = splitBullets(role.description);

    let bullets;
    if (aiEntry && Array.isArray(aiEntry.bullets) && aiEntry.bullets.length) {
      bullets = aiEntry.bullets.map((b) => ({
        old: typeof b.old === 'string' ? b.old : '',
        new: typeof b.new === 'string' ? b.new : (b.old || ''),
        action: ['modify', 'keep', 'remove', 'add'].includes(b.action) ? b.action : 'modify'
      }));
    } else if (aiEntry && typeof aiEntry.description === 'string') {
      // Legacy shape fallback: a single rewritten block with no per-bullet alignment.
      const newBullets = splitBullets(aiEntry.description);
      const len = Math.max(originalBullets.length, newBullets.length);
      bullets = Array.from({ length: len }, (_, j) => ({
        old: originalBullets[j] || '',
        new: newBullets[j] || originalBullets[j] || '',
        action: newBullets[j] ? (originalBullets[j] ? 'modify' : 'add') : 'remove'
      }));
    } else {
      bullets = originalBullets.map((b) => ({ old: b, new: b, action: 'keep' }));
    }

    return { index: i, role: role.role, company: role.company, bullets };
  });

  out.suggestions = typeof out.suggestions === 'string' ? out.suggestions : '';
  out.atsScore = sanitizeAtsScore(result.atsScore);
  return out;
}

function compactTailorResume(resume) {
  const source = resume?.toObject ? resume.toObject() : resume || {};
  return {
    summary: String(source.summary || '').slice(0, 1100),
    skills: Array.isArray(source.skills) ? source.skills.slice(0, 45).map(String) : [],
    experience: Array.isArray(source.experience) ? source.experience.slice(0, 6).map((e, i) => ({
      index: i,
      role: String(e?.role || '').slice(0, 140),
      company: String(e?.company || '').slice(0, 140),
      startDate: String(e?.startDate || '').slice(0, 40),
      endDate: String(e?.endDate || '').slice(0, 40),
      bullets: (Array.isArray(e?.bullets) ? e.bullets : String(e?.description || '').split(/\n|•|\u2022/))
        .map(b => typeof b === 'string' ? b : (b?.new || b?.old || b?.suggested || b?.original || ''))
        .map(b => String(b).replace(/\s+/g, ' ').trim().slice(0, 280))
        .filter(Boolean)
        .slice(0, 8)
    })): []
  };
}

async function tailorResumeWithAI(resume, jobTitle, jobDescription, emphasizeSkills = [], tailoringLevel = 'high') {
  if (!getKeyPool().hasKeys()) {
    throw new Error('AI tailoring requires GROQ_API_KEY to be configured');
  }

  const level = TAILOR_LEVEL_INSTRUCTIONS[tailoringLevel] ? tailoringLevel : 'high';
  const snapshot = JSON.stringify(compactTailorResume(resume));
  const confirmedExtras = Array.isArray(emphasizeSkills)
    ? emphasizeSkills.filter(Boolean).map(String).slice(0, 15)
    : [];
  const extrasBlock = confirmedExtras.length
    ? `\nCandidate-confirmed skills: ${confirmedExtras.join(', ')}`
    : '';
  const jobText = String(jobDescription || '').replace(/\s+/g, ' ').slice(0, 5000);

  let messages = [
    { role: 'system', content: TAILOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${TAILOR_LEVEL_INSTRUCTIONS[level]}\nJob Title: ${jobTitle || 'Not specified'}\nJob Description:\n${jobText}\nCurrent Resume JSON:\n${snapshot}${extrasBlock}`
    }
  ];

  try {
    const json = await callGroq(messages, GROQ_TAILOR_MAX_COMPLETION, { jsonMode: true });
    return sanitizeTailorResult(extractJSON(json), resume);
  } catch (err) {
    // Groq can reject a request before generation when input + requested
    // completion exceeds the organization's TPM window. Retry once with a
    // deliberately smaller prompt/budget instead of exposing a 413 to users.
    if (/Groq API 413/i.test(String(err.message || ''))) {
      const smallerSnapshot = JSON.stringify(compactTailorResume({
        ...((resume?.toObject ? resume.toObject() : resume) || {}),
        experience: (resume?.experience || []).slice(0, 4).map(e => ({
          ...e,
          bullets: (Array.isArray(e.bullets) ? e.bullets : []).slice(0, 5).map(b => String(b?.new || b?.old || b || '').slice(0, 180))
        }))
      }));
      messages = [
        { role: 'system', content: TAILOR_SYSTEM_PROMPT },
        { role: 'user', content: `${TAILOR_LEVEL_INSTRUCTIONS[level]}\nJob: ${String(jobTitle || '').slice(0, 120)}\nDescription: ${jobText.slice(0, 2800)}\nResume: ${smallerSnapshot}` }
      ];
      const retryJson = await callGroq(messages, 2600, { jsonMode: true });
      return sanitizeTailorResult(extractJSON(retryJson), resume);
    }
    throw err;
  }
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
  if (!getKeyPool().hasKeys()) {
    throw new Error('AI cover letter generation requires GROQ_API_KEY to be configured');
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

  const text = await callGroq(
    [
      { role: 'system', content: COVER_LETTER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Job Title: ${jobTitle || 'Not specified'}\nCompany: ${company || 'Not specified'}\n\nJob Description:\n${(jobDescription || '').slice(0, 3000)}\n\nCandidate Resume Snapshot:\n${snapshot}`
      }
    ],
    2000
  );

  return text.trim();
}

module.exports = { parseResumeWithAI, parseRawResumeTextWithAI, tailorResumeWithAI, tailorRawTextWithAI, generateCoverLetterWithAI, analyzeJobWithAI };
