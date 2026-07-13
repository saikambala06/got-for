/**
 * Shared Gemini caller — the single place every AI feature (resume parsing,
 * tailoring, cover letters, job-posting analysis/extraction) goes through.
 *
 * This used to be duplicated: aiResumeParser.js had one implementation with
 * a key pool but weak 5xx handling, and xaiClient.js had a second, weaker
 * implementation with no key pool, no retry, and no timeout at all. That
 * split caused two separate bugs:
 *   1. A transient Gemini 503 ("high demand") crashed tailoring outright,
 *      because 5xx errors got exactly one same-key retry and then failed
 *      fast instead of rotating through the rest of the key pool.
 *   2. Job-page reading/analysis (which went through the weaker client) had
 *      no timeout at all, so a slow/overloaded Gemini response could hang
 *      the request for a long time, and any failure there fell straight
 *      back to the crude regex extractor — which is what produced
 *      inaccurate skills/qualifications.
 *
 * Fix: one client, used everywhere, that (a) rotates across the whole key
 * pool on 429/403/5xx, (b) does a short bounded retry with backoff for 5xx
 * before rotating, (c) makes a second full pass across the pool after a
 * short delay if every key hit a transient 5xx (Gemini overload is usually
 * seconds, not minutes), and (d) times out each individual request so a
 * hung call can't stall the whole feature.
 */

const { getKeyPool } = require('./geminiKeyPool');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const REQUEST_TIMEOUT_MS = 25000; // don't let one call hang the request indefinitely
const MAX_SAME_KEY_RETRIES = 2; // for transient 5xx on a single key, before rotating
const SAME_KEY_RETRY_BASE_MS = 700;
const OVERLOAD_COOLDOWN_MS = 8000; // short — a 503 is usually transient, not a real quota exhaustion
const EXTRA_POOL_PASSES = 1; // additional full sweeps of the pool if every key was overloaded
const POOL_PASS_DELAY_MS = 2500;

function parseRetryAfterSeconds(response, bodyText) {
  const header = response.headers.get?.('retry-after');
  if (header && !Number.isNaN(Number(header))) return Number(header);
  const match = bodyText && bodyText.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  return match ? Number(match[1]) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Gemini request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function isRetryable5xx(status) {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * @param {Array<{role: string, content: string}>} messages
 * @param {number} maxTokens
 * @param {{ jsonMode?: boolean }} opts
 * @returns {Promise<string>} raw text response (fences stripped)
 */
async function callGemini(messages, maxTokens = 8000, { jsonMode = false } = {}) {
  const pool = getKeyPool();
  if (!pool.hasKeys()) throw new Error('GEMINI_API_KEY not configured');

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
      temperature: 0,
      maxOutputTokens: maxTokens,
      thinkingConfig: { thinkingBudget: 0 },
      ...(jsonMode ? { responseMimeType: 'application/json' } : {})
    }
  };
  if (systemText) {
    requestBody.systemInstruction = { parts: [{ text: systemText }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const doRequest = (apiKey) =>
    fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(requestBody)
      },
      REQUEST_TIMEOUT_MS
    );

  let lastError = null;
  let sawOverload = false;

  const totalPasses = 1 + EXTRA_POOL_PASSES;
  for (let pass = 0; pass < totalPasses; pass++) {
    if (pass > 0) {
      // Only worth another full sweep if the *previous* pass failed purely
      // due to overload (5xx) — a hard failure (bad request/blocked/etc.)
      // won't be fixed by waiting and retrying the same thing again.
      if (!sawOverload) break;
      sawOverload = false;
      await sleep(POOL_PASS_DELAY_MS);
    }

    const order = pool.availableOrder().length ? pool.availableOrder() : pool.allBySoonestAvailable();

    for (const apiKey of order) {
      let response;
      try {
        response = await doRequest(apiKey);
      } catch (networkErr) {
        lastError = networkErr;
        continue; // network hiccup / timeout on this key — try the next one
      }

      // Transient overload: bounded same-key retries with backoff before
      // giving up on this key and rotating to the next one.
      if (!response.ok && isRetryable5xx(response.status)) {
        let attempt = 0;
        while (!response.ok && isRetryable5xx(response.status) && attempt < MAX_SAME_KEY_RETRIES) {
          attempt++;
          await sleep(SAME_KEY_RETRY_BASE_MS * attempt);
          try {
            response = await doRequest(apiKey);
          } catch (networkErr) {
            lastError = networkErr;
            response = null;
            break;
          }
        }
        if (!response || (!response.ok && isRetryable5xx(response.status))) {
          const bodyText = response ? await response.text().catch(() => '') : '';
          sawOverload = true;
          pool.markExhausted(apiKey, OVERLOAD_COOLDOWN_MS / 1000);
          lastError = new Error(
            `Gemini API ${response ? response.status : 'network'} on key ${pool.label(apiKey)} (overloaded): ${bodyText.slice(0, 200)}`
          );
          continue; // rotate to the next key immediately
        }
      }

      if (response.status === 429 || response.status === 403) {
        const bodyText = await response.text().catch(() => '');
        const retryAfter = parseRetryAfterSeconds(response, bodyText);
        pool.markExhausted(apiKey, retryAfter);
        lastError = new Error(`Gemini API ${response.status} on key ${pool.label(apiKey)}: ${bodyText.slice(0, 200)}`);
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // Not a quota/overload issue (bad request, bad model, blocked, etc.)
        // — retrying won't help, so fail fast with the real reason.
        throw new Error(`Gemini API ${response.status}: ${body.slice(0, 300)}`);
      }

      pool.markWorking(apiKey);
      const data = await response.json();

      if (!data.candidates?.length) {
        const blockReason = data.promptFeedback?.blockReason;
        throw new Error(
          blockReason
            ? `Gemini blocked the request (${blockReason}) — try rephrasing the job description or resume.`
            : 'Gemini returned no candidates'
        );
      }

      const candidate = data.candidates[0];
      const text = (candidate.content?.parts || []).map((p) => p.text || '').join('').trim();

      if (!text) {
        throw new Error(
          candidate.finishReason === 'MAX_TOKENS'
            ? 'Gemini response was cut off before it produced any output — try a shorter job description or resume.'
            : `Gemini returned an empty response${candidate.finishReason ? ` (${candidate.finishReason})` : ''}`
        );
      }

      return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    }
  }

  if (sawOverload) {
    throw new Error(
      `Gemini is currently experiencing high demand and did not recover after retrying across ${pool.count()} key(s). Please try again in a moment.`
    );
  }
  throw lastError || new Error('All configured Gemini API keys are currently unavailable');
}

module.exports = { callGemini, GEMINI_MODEL };
