/**
 * Shared multi-provider AI chat client. Used by aiResumeParser.js and
 * aiJobExtractor.js so every AI-powered feature (resume parsing, tailoring,
 * cover letters, job extraction) goes through the same provider selection
 * and retry logic.
 *
 * Provider priority (first configured key wins, per call):
 *   1. XAI_API_KEY    — xAI / Grok (paid, usage-based)
 *   2. GEMINI_API_KEY — Google Gemini (has a genuinely free tier — see
 *                        https://ai.google.dev/pricing — good default if you
 *                        don't want to pay for API access)
 *
 * If neither key is set, or every configured provider's call fails, this
 * throws — callers are expected to catch that and degrade to their own
 * local, non-AI fallback rather than surface a raw error to the user.
 */

const JSON_FENCE_RE = /^```(?:json)?\s*/i;
const JSON_FENCE_END_RE = /\s*```\s*$/i;

function stripFences(text) {
  return text.replace(JSON_FENCE_RE, '').replace(JSON_FENCE_END_RE, '').trim();
}

// ─── xAI (Grok) ──────────────────────────────────────────────────────────

async function callGrok(messages, maxTokens) {
  const apiKey = process.env.XAI_API_KEY;

  const request = (model) =>
    fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, messages })
    });

  let response = await request('grok-3');

  if (!response.ok && (response.status === 400 || response.status === 404)) {
    // grok-3 unavailable on this account/region — retry on the cheaper mini model.
    response = await request('grok-3-mini');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`xAI API ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  return stripFences(text);
}

// ─── Google Gemini (free tier) ───────────────────────────────────────────
//
// This used to be its own, weaker implementation: a single hardcoded key
// (no pool), no retry on 429/403/5xx, no request timeout, and an older
// model name than the rest of the app used. That's why job-page reading
// could hang/be slow (a stuck request had nothing to time it out) and why
// it looked "inaccurate" (any failure — including a transient overload —
// fell straight back to the crude local regex extractor). It now shares
// the exact same key-pooled, retrying, timed-out client as resume
// tailoring/parsing — see ./geminiClient.js.
const { callGemini: callSharedGemini } = require('./geminiClient');
const { getKeyPool } = require('./geminiKeyPool');

async function callGemini(messages, maxTokens) {
  return callSharedGemini(messages, maxTokens);
}

// ─── Provider-agnostic entry point ───────────────────────────────────────

/**
 * Tries every configured provider in priority order (xAI, then Gemini) and
 * returns the first successful response. Throws only if no provider is
 * configured, or every configured provider's call failed.
 */
async function callAI(messages, maxTokens = 8000) {
  const attempts = [];

  if (process.env.XAI_API_KEY) {
    try {
      return await callGrok(messages, maxTokens);
    } catch (err) {
      console.error('[aiClient] xAI call failed, trying next provider:', err.message);
      attempts.push(`xAI: ${err.message}`);
    }
  }

  if (getKeyPool().hasKeys()) {
    try {
      return await callGemini(messages, maxTokens);
    } catch (err) {
      console.error('[aiClient] Gemini call failed:', err.message);
      attempts.push(`Gemini: ${err.message}`);
    }
  }

  if (!attempts.length) {
    throw new Error('No AI provider configured (set XAI_API_KEY or GEMINI_API_KEY)');
  }
  throw new Error(`All configured AI providers failed — ${attempts.join(' | ')}`);
}

function extractJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in AI response');
  }
  return JSON.parse(text.slice(start, end + 1));
}

module.exports = { callAI, callXAI: callAI, extractJSON };
