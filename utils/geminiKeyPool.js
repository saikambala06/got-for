/**
 * Gemini API key pool.
 *
 * Lets an operator configure more than one Gemini API key so that when one
 * key's free-tier quota is exhausted (HTTP 429), requests transparently move
 * on to the next working key instead of failing in front of the user.
 *
 * Configuration (any/all of these can be used together — the pool merges
 * and de-dupes them):
 *   GEMINI_API_KEY        single key (existing behaviour, still works)
 *   GEMINI_API_KEYS       comma or newline separated list of keys
 *   GEMINI_API_KEY_1..N   numbered individual keys
 *
 * Exhausted keys are put on a cooldown timer (from the API's Retry-After
 * header when present, otherwise a default) rather than being removed
 * outright — quota windows reset, so a key that's out today is often fine
 * again in a minute/hour.
 */

function loadKeysFromEnv() {
  const keys = [];

  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);

  if (process.env.GEMINI_API_KEYS) {
    process.env.GEMINI_API_KEYS
      .split(/[,\n]/)
      .map((k) => k.trim())
      .filter(Boolean)
      .forEach((k) => keys.push(k));
  }

  Object.keys(process.env)
    .filter((k) => /^GEMINI_API_KEY_\d+$/.test(k))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .forEach((k) => { if (process.env[k]) keys.push(process.env[k]); });

  return [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
}

const DEFAULT_COOLDOWN_MS = 60 * 1000; // fallback when the API gives no Retry-After
const MAX_COOLDOWN_MS = 60 * 60 * 1000; // never wait more than an hour before retrying a key

class GeminiKeyPool {
  constructor() {
    this.keys = loadKeysFromEnv();
    // key -> epoch ms until which the key should be skipped
    this.cooldownUntil = new Map();
    this.cursor = 0;
  }

  hasKeys() {
    return this.keys.length > 0;
  }

  count() {
    return this.keys.length;
  }

  label(key) {
    return key ? `…${key.slice(-4)}` : 'none';
  }

  /** Keys not currently cooling down, in round-robin order starting from the cursor. */
  availableOrder() {
    const now = Date.now();
    const ordered = [];
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.cursor + i) % this.keys.length;
      const key = this.keys[idx];
      const until = this.cooldownUntil.get(key) || 0;
      if (until <= now) ordered.push(key);
    }
    return ordered;
  }

  /** All keys, even cooling-down ones, ordered by soonest-available — used only if every key is exhausted. */
  allBySoonestAvailable() {
    return [...this.keys].sort((a, b) => (this.cooldownUntil.get(a) || 0) - (this.cooldownUntil.get(b) || 0));
  }

  markExhausted(key, retryAfterSeconds) {
    const waitMs = Math.min(
      MAX_COOLDOWN_MS,
      retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : DEFAULT_COOLDOWN_MS
    );
    this.cooldownUntil.set(key, Date.now() + waitMs);
  }

  markWorking(key) {
    this.cooldownUntil.delete(key);
    // Advance the round-robin cursor so the *next* call starts from a
    // different key too, spreading load evenly across the whole pool
    // instead of hammering key #1 until it also runs out.
    const idx = this.keys.indexOf(key);
    if (idx !== -1) this.cursor = (idx + 1) % this.keys.length;
  }

  status() {
    const now = Date.now();
    return this.keys.map((k) => ({
      key: this.label(k),
      status: (this.cooldownUntil.get(k) || 0) > now ? 'cooling_down' : 'available',
      availableAt: this.cooldownUntil.get(k) ? new Date(this.cooldownUntil.get(k)).toISOString() : null
    }));
  }
}

// Singleton — shared across every request in this process, so cooldown
// state (and the round-robin cursor) persists between calls.
let instance = null;
function getKeyPool() {
  if (!instance) {
    instance = new GeminiKeyPool();
    // Log once, at first use, so a naming mistake (e.g. only 1 of 3 keys
    // detected) is visible immediately in server/Vercel function logs
    // instead of being discovered only after a 429 reaches the user.
    if (instance.hasKeys()) {
      console.log(
        `[geminiKeyPool] loaded ${instance.count()} key(s): ${instance.keys.map((k) => instance.label(k)).join(', ')}`
      );
    } else {
      console.warn('[geminiKeyPool] no GEMINI_API_KEY / GEMINI_API_KEYS / GEMINI_API_KEY_N found — AI features disabled');
    }
  }
  return instance;
}

module.exports = { getKeyPool, GeminiKeyPool };
