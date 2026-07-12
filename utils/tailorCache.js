const crypto = require('crypto');

// Short-lived in-memory cache so re-requesting the same resume+job+level
// (e.g. switching back to a tailoring level already generated in this
// session) returns instantly instead of round-tripping the AI again.
// Not persisted — fine for a single server process; on serverless/multi
// instance deployments this just degrades to "no cache", never wrong data.
const TTL_MS = 30 * 60 * 1000; // 30 minutes
const store = new Map();

function keyFor(resumeId, level, jobTitle, jobDescription, emphasizeSkills) {
  const h = crypto.createHash('sha1')
    .update(String(jobTitle || ''))
    .update('\u0001')
    .update(String(jobDescription || ''))
    .update('\u0001')
    .update((emphasizeSkills || []).slice().sort().join(','))
    .digest('hex');
  return `${resumeId}:${level}:${h}`;
}

function get(resumeId, level, jobTitle, jobDescription, emphasizeSkills) {
  const key = keyFor(resumeId, level, jobTitle, jobDescription, emphasizeSkills);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.t > TTL_MS) { store.delete(key); return null; }
  return entry.v;
}

function set(resumeId, level, jobTitle, jobDescription, emphasizeSkills, value) {
  const key = keyFor(resumeId, level, jobTitle, jobDescription, emphasizeSkills);
  store.set(key, { v: value, t: Date.now() });
  // Opportunistic cleanup so the map doesn't grow unbounded over a long-lived process.
  if (store.size > 500) {
    const now = Date.now();
    for (const [k, e] of store) if (now - e.t > TTL_MS) store.delete(k);
  }
}

module.exports = { get, set };
