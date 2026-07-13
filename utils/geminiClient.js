/**
 * Shared Google Gemini chat client. Used by aiResumeParser.js and
 * aiJobExtractor.js so every AI-powered feature (resume parsing, tailoring,
 * cover letters, job field extraction) goes through the same provider,
 * model, and key-rotation logic — no more mixed xAI/Gemini paths.
 *
 * Uses the shared multi-key pool (utils/geminiKeyPool.js) so that when one
 * GEMINI_API_KEY hits its free-tier quota (HTTP 429) or gets disabled
 * (403), the call transparently rotates to the next configured key instead
 * of failing in front of the user — this is what keeps job-field extraction
 * accurate and available even under quota pressure.
 *
 * Configure one or more keys via GEMINI_API_KEY, GEMINI_API_KEYS
 * (comma/newline separated), or GEMINI_API_KEY_1..N — see geminiKeyPool.js.
 *
 * If no key is configured, or every configured key's call fails, this
 * throws — callers are expected to catch that and degrade to their own
 * local, non-AI fallback rather than surface a raw error to the user.
 */

const { getKeyPool } = require('./geminiKeyPool');

// 'gemini-2.5-flash' is no longer available to new API keys/projects
// (Google returns a 404 "no longer available to new users"). We default to
// 'gemini-flash-latest', Google's auto-updated alias that always points at
// their current-generation Flash model, so accuracy doesn't regress as
// Google rotates model versions. Override via GEMINI_MODEL if needed.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

function parseRetryAfterSeconds(response, bodyText) {
  const header = response.headers.get?.('retry-after');
  if (header && !Number.isNaN(Number(header))) return Number(header);
  // Gemini also sometimes embeds a RetryInfo with a "retryDelay": "37s" in the JSON error body.
  const match = bodyText && bodyText.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  return match ? Number(match[1]) : null;
}

/**
 * Calls Gemini with the given chat-style messages, rotating across every
 * configured API key on quota/auth errors until one succeeds.
 */
async function callGemini(messages, maxTokens = 8000, { jsonMode = false } = {}) {
  const pool = getKeyPool();
  if (!pool.hasKeys()) throw new Error('No Gemini API key configured (set GEMINI_API_KEY)');

  const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

  const requestBody = {
    contents,
    generationConfig: {
      temperature: 0, // deterministic extraction — accuracy over creativity
      maxOutputTokens: maxTokens,
      // Flash models reason ("think") by default. A budget of 0 turns that
      // off entirely — this is extraction/rewriting, not reasoning — so the
      // whole token budget goes to visible output instead of being silently
      // spent on hidden "thinking" tokens.
      thinkingConfig: { thinkingBudget: 0 },
      ...(jsonMode ? { responseMimeType: 'application/json' } : {})
    }
  };
  if (systemText) {
    requestBody.systemInstruction = { parts: [{ text: systemText }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const doRequest = (apiKey) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(requestBody)
    });

  // Try every key in the pool (round-robin, skipping ones on cooldown) until
  // one succeeds. A 429 (quota exhausted) or 403 (key disabled/blocked)
  // rotates immediately to the next key with no delay to the user. A
  // transient 5xx gets one same-key retry with backoff before moving on.
  const order = pool.availableOrder().length ? pool.availableOrder() : pool.allBySoonestAvailable();
  let lastError = null;

  for (const apiKey of order) {
    let response;
    try {
      response = await doRequest(apiKey);
    } catch (networkErr) {
      lastError = networkErr;
      continue; // network hiccup on this key — try the next one
    }

    if (!response.ok && response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      response = await doRequest(apiKey);
    }

    if (response.status === 429 || response.status === 403) {
      const bodyText = await response.text().catch(() => '');
      const retryAfter = parseRetryAfterSeconds(response, bodyText);
      pool.markExhausted(apiKey, retryAfter);
      lastError = new Error(`Gemini API ${response.status} on key ${pool.label(apiKey)}: ${bodyText.slice(0, 200)}`);
      continue; // rotate to the next key in the pool
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // Not a quota issue (bad request, bad model, etc.) — retrying with a
      // different key won't help, so fail fast with the real reason.
      throw new Error(`Gemini API ${response.status}: ${body.slice(0, 300)}`);
    }

    pool.markWorking(apiKey);
    const data = await response.json();

    if (!data.candidates?.length) {
      const blockReason = data.promptFeedback?.blockReason;
      throw new Error(
        blockReason
          ? `Gemini blocked the request (${blockReason}) — try rephrasing the job description.`
          : 'Gemini returned no candidates'
      );
    }

    const candidate = data.candidates[0];
    const text = (candidate.content?.parts || []).map((p) => p.text || '').join('').trim();

    if (!text) {
      throw new Error(
        candidate.finishReason === 'MAX_TOKENS'
          ? 'Gemini response was cut off before it produced any output — try shorter input.'
          : `Gemini returned an empty response${candidate.finishReason ? ` (${candidate.finishReason})` : ''}`
      );
    }

    return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }

  // Every key in the pool is either exhausted or errored.
  throw lastError || new Error('All configured Gemini API keys are currently unavailable');
}

/**
 * Provider-agnostic entry point kept for callers that don't need jsonMode.
 * Gemini is now the sole provider — this simply calls it and surfaces the
 * real error (no more silent provider chain) if it fails.
 */
async function callAI(messages, maxTokens = 8000) {
  return callGemini(messages, maxTokens);
}

function extractJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in AI response');
  }
  return JSON.parse(text.slice(start, end + 1));
}

module.exports = { callAI, callGemini, extractJSON };
