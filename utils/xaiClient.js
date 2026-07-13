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

function toGeminiPayload(messages, maxTokens) {
  const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

  return {
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    contents,
    generationConfig: { temperature: 0, maxOutputTokens: maxTokens }
  };
}

async function callGemini(messages, maxTokens) {
  const apiKey = process.env.GEMINI_API_KEY;
  const payload = toGeminiPayload(messages, maxTokens);

  const request = (model) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

  // gemini-2.0-flash has the most generous free-tier quota; fall back to
  // gemini-1.5-flash for accounts where 2.0 isn't yet enabled.
  let response = await request('gemini-2.0-flash');

  if (!response.ok && (response.status === 400 || response.status === 404)) {
    response = await request('gemini-1.5-flash');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini API ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) {
    const blockReason = data.promptFeedback?.blockReason;
    throw new Error(blockReason ? `Gemini blocked the request: ${blockReason}` : 'Empty response from Gemini');
  }
  return stripFences(text);
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

  if (process.env.GEMINI_API_KEY) {
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
