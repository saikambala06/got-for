/**
 * Shared xAI (Grok) chat-completion client. Used by aiResumeParser.js and
 * aiJobExtractor.js so both features hit the same retry/fallback logic.
 * Throws on any failure — callers are expected to catch and degrade to a
 * local, non-AI fallback rather than surface a raw error to the user.
 */

async function callXAI(messages, maxTokens = 8000) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not configured');

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'grok-3',        // grok-3 for highest accuracy; falls back to grok-3-mini if unavailable
      max_tokens: maxTokens,
      temperature: 0,         // deterministic extraction
      messages
    })
  });

  if (!response.ok) {
    // Try grok-3-mini if grok-3 fails
    if (response.status === 400 || response.status === 404) {
      const retry = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'grok-3-mini', max_tokens: maxTokens, temperature: 0, messages })
      });
      if (!retry.ok) {
        const body = await retry.text().catch(() => '');
        throw new Error(`xAI API ${retry.status}: ${body.slice(0, 200)}`);
      }
      const data = await retry.json();
      const text = data.choices?.[0]?.message?.content || '';
      return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    }
    const body = await response.text().catch(() => '');
    throw new Error(`xAI API ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

function extractJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in AI response');
  }
  return JSON.parse(text.slice(start, end + 1));
}

module.exports = { callXAI, extractJSON };
