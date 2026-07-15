/**
 * Shared xAI (Grok) chat client. Used by aiResumeParser.js and
 * aiJobExtractor.js so every AI-powered feature (resume parsing, tailoring,
 * cover letters, job extraction) goes through the same request/retry logic
 * and key pool.
 *
 * Configure one or more keys via XAI_API_KEY / XAI_API_KEYS / XAI_API_KEY_1..N
 * (see xaiKeyPool.js). If no key is configured, or every configured key's
 * call fails, this throws — callers are expected to catch that and degrade
 * to their own local, non-AI fallback rather than surface a raw error to
 * the user.
 */

const { getKeyPool } = require('./xaiKeyPool');

const XAI_MODEL = process.env.XAI_MODEL || 'grok-3';
const XAI_FALLBACK_MODEL = process.env.XAI_FALLBACK_MODEL || 'grok-3-mini';

const JSON_FENCE_RE = /^```(?:json)?\s*/i;
const JSON_FENCE_END_RE = /\s*```\s*$/i;

function stripFences(text) {
  return text.replace(JSON_FENCE_RE, '').replace(JSON_FENCE_END_RE, '').trim();
}

function parseRetryAfterSeconds(response, bodyText) {
  const header = response.headers.get?.('retry-after');
  if (header && !Number.isNaN(Number(header))) return Number(header);
  const match = bodyText && bodyText.match(/"retry(?:_|-)?after"\s*:\s*"?(\d+)/i);
  return match ? Number(match[1]) : null;
}

// ─── xAI (Grok) ──────────────────────────────────────────────────────────

/**
 * Tries every configured xAI key (round-robin, skipping ones on cooldown)
 * until one succeeds. A 429 (rate limited) or 403 (key disabled/blocked)
 * rotates immediately to the next key with no delay to the user. A
 * transient 5xx gets one same-key retry with backoff before moving on.
 */
async function callGrok(messages, maxTokens, { jsonMode = false } = {}) {
  const pool = getKeyPool();
  if (!pool.hasKeys()) throw new Error('XAI_API_KEY not configured');

  const buildBody = (model) => ({
    model,
    max_tokens: maxTokens,
    temperature: 0,
    messages,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
  });

  const doRequest = (apiKey, model) =>
    fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildBody(model))
    });

  const order = pool.availableOrder().length ? pool.availableOrder() : pool.allBySoonestAvailable();
  let lastError = null;

  for (const apiKey of order) {
    let response;
    try {
      response = await doRequest(apiKey, XAI_MODEL);
    } catch (networkErr) {
      lastError = networkErr;
      continue; // network hiccup on this key — try the next one
    }

    // grok-3 unavailable on this account/region — retry once on the cheaper mini model.
    if (!response.ok && (response.status === 400 || response.status === 404)) {
      response = await doRequest(apiKey, XAI_FALLBACK_MODEL);
    }

    if (!response.ok && response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      response = await doRequest(apiKey, XAI_MODEL);
    }

    if (response.status === 429 || response.status === 403) {
      const bodyText = await response.text().catch(() => '');
      const retryAfter = parseRetryAfterSeconds(response, bodyText);
      pool.markExhausted(apiKey, retryAfter);
      lastError = new Error(`xAI API ${response.status} on key ${pool.label(apiKey)}: ${bodyText.slice(0, 200)}`);
      continue; // rotate to the next key in the pool
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // Not a rate-limit issue (bad request, bad model, etc.) — retrying
      // with a different key won't help, so fail fast with the real reason.
      throw new Error(`xAI API ${response.status}: ${body.slice(0, 300)}`);
    }

    pool.markWorking(apiKey);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    if (!text) {
      throw new Error('Grok returned an empty response');
    }

    return stripFences(text);
  }

  throw lastError || new Error('All configured xAI API keys are currently unavailable');
}

// ─── Provider-agnostic entry point ───────────────────────────────────────
// Kept as callAI (rather than renaming every call site) so aiJobExtractor.js
// and other callers don't need to change — Grok is now the only provider.
async function callAI(messages, maxTokens = 8000, opts = {}) {
  return callGrok(messages, maxTokens, opts);
}

function extractJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in AI response');
  }
  return JSON.parse(text.slice(start, end + 1));
}

module.exports = { callAI, callGrok, extractJSON };
