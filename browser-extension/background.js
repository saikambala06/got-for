// JobTrail Assistant — background service worker
// Owns the session (JWT + API base URL) and proxies every backend call so
// content scripts never need CORS access of their own.

const DEFAULT_API_BASE = 'http://localhost:4000';

async function getConfig() {
  const { apiBase, token, user } = await chrome.storage.local.get(['apiBase', 'token', 'user']);
  return { apiBase: apiBase || DEFAULT_API_BASE, token: token || null, user: user || null };
}

async function apiFetch(path, options = {}) {
  const { apiBase, token } = await getConfig();
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  let body = null;
  try { body = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    const message = (body && body.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

const handlers = {
  async 'auth:getState'() {
    const { apiBase, token, user } = await getConfig();
    return { loggedIn: !!token, apiBase, user };
  },

  async 'auth:login'({ email, password, apiBase }) {
    if (apiBase) await chrome.storage.local.set({ apiBase });
    const base = apiBase || (await getConfig()).apiBase;
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Login failed');
    await chrome.storage.local.set({ token: body.token, user: body.user, apiBase: base });
    return { user: body.user };
  },

  async 'auth:logout'() {
    await chrome.storage.local.remove(['token', 'user']);
    return { ok: true };
  },

  async 'resumes:list'() {
    const body = await apiFetch('/api/resumes');
    return body.resumes || [];
  },

  async 'resumes:tailor'({ resumeId, jobTitle, jobDescription, emphasizeSkills }) {
    const body = await apiFetch(`/api/resumes/${resumeId}/tailor`, {
      method: 'POST',
      body: JSON.stringify({ jobTitle, jobDescription, emphasizeSkills })
    });
    return body.tailored;
  },

  async 'resumes:coverLetter'({ resumeId, jobTitle, company, jobDescription }) {
    const body = await apiFetch(`/api/resumes/${resumeId}/cover-letter`, {
      method: 'POST',
      body: JSON.stringify({ jobTitle, company, jobDescription })
    });
    return body.coverLetter;
  },

  async 'resumes:save'({ resumeId, patch }) {
    const body = await apiFetch(`/api/resumes/${resumeId}`, {
      method: 'PUT',
      body: JSON.stringify(patch)
    });
    return body.resume;
  },

  async 'jobs:create'(job) {
    const body = await apiFetch('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(job)
    });
    return body.job;
  },

  async 'job:analyze'({ jobTitle, company, jobDescription }) {
    const body = await apiFetch('/api/jobs/analyze', {
      method: 'POST',
      body: JSON.stringify({ jobTitle, company, jobDescription })
    });
    return body.analysis;
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;

  handler(message.payload || {})
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

  return true; // keep the message channel open for the async response
});

// Clicking the toolbar icon on a page where the content script hasn't run
// yet (e.g. it was open before install/reload) — inject it now.
chrome.action.onClicked?.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        'content/skills-data.js',
        'content/job-parser.js',
        'content/panel-ui.js',
        'content/content.js'
      ]
    });
  } catch (_) { /* already injected */ }
  chrome.tabs.sendMessage(tab.id, { type: 'panel:toggle' }).catch(() => {});
});
