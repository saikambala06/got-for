/**
 * Gemini-only AI chat client. Used by aiJobExtractor.js so job-posting
 * extraction goes through the same call/retry logic as the rest of the app.
 *
 * Requires GEMINI_API_KEY. If it isn't set, or the call fails, this throws —
 * callers are expected to catch that and degrade to their own local,
 * non-AI fallback rather than surface a raw error to the user.
 */

const JSON_FENCE_RE = /^```(?:json)?\s*/i;
const JSON_FENCE_END_RE = /\s*```\s*$/i;

function stripFences(text) {
  return text.replace(JSON_FENCE_RE, '').replace(JSON_FENCE_END_RE, '').trim();
}

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

  // gemini-3.5-flash is the current GA Flash model (near-Pro accuracy at
  // Flash speed); gemini-3.1-flash-lite is a faster/cheaper GA fallback if
  // the primary model isn't enabled on a given account/region.
  let response = await request('gemini-3.5-flash');

  if (!response.ok && (response.status === 400 || response.status === 404)) {
    response = await request('gemini-3.1-flash-lite');
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

/**
 * Calls Gemini and returns the response text. Throws if GEMINI_API_KEY
 * isn't configured, or the call fails.
 */
async function callAI(messages, maxTokens = 8000) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('No AI provider configured (set GEMINI_API_KEY)');
  }

  try {
    return await callGemini(messages, maxTokens);
  } catch (err) {
    console.error('[geminiClient] Gemini call failed:', err.message);
    throw new Error(`Gemini call failed: ${err.message}`);
  }
}

function extractJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in AI response');
  }
  return JSON.parse(text.slice(start, end + 1));
}

module.exports = { callAI, extractJSON };
