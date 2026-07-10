// JobTrail Assistant — background service worker
// Owns the session (JWT + API base URL) and proxies every backend call so
// content scripts never need CORS access of their own.

const DEFAULT_API_BASE = 'https://got-for.vercel.app';

async function getConfig() {
  const { token, user } = await chrome.storage.local.get(['token', 'user']);
  return { apiBase: DEFAULT_API_BASE, token: token || null, user: user || null };
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

  async 'auth:login'({ email, password }) {
    const base = DEFAULT_API_BASE;
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Login failed');
    await chrome.storage.local.set({ token: body.token, user: body.user });
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

  async 'resumes:tailor'({ resumeId, jobTitle, jobDescription, emphasizeSkills, tailoringLevel }) {
    const body = await apiFetch(`/api/resumes/${resumeId}/tailor`, {
      method: 'POST',
      body: JSON.stringify({ jobTitle, jobDescription, emphasizeSkills, tailoringLevel })
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
  },

  // ─── Full-page tailor flow (tailor.html / quick-download.html) ─────────
  async 'tailor:openPicker'({ sessionId }, sender) {
    const key = `jt_session_${sessionId}`;
    const store = await chrome.storage.local.get(key);
    const session = store[key] || {};
    session.originTabId = sender?.tab?.id || null;
    await chrome.storage.local.set({ [key]: session });
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`tailor.html?sid=${sessionId}`) });
    return { tabId: tab.id };
  },

  async 'tailor:openQuickDownload'({ sessionId }) {
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`quick-download.html?sid=${sessionId}`) });
    return { tabId: tab.id };
  },

  async 'tailor:startReview'({ sessionId, resumeId }) {
    const key = `jt_session_${sessionId}`;
    const store = await chrome.storage.local.get(key);
    const session = store[key];
    if (!session || !session.originTabId) throw new Error('The original job tab is no longer available.');
    await chrome.tabs.update(session.originTabId, { active: true });
    await chrome.tabs.sendMessage(session.originTabId, { type: 'tailor:runReview', payload: { resumeId } });
    return { ok: true };
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;

  handler(message.payload || {}, sender)
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
        'content/tailor-studio.js',
        'content/content.js'
      ]
    });
  } catch (_) { /* already injected */ }
  chrome.tabs.sendMessage(tab.id, { type: 'panel:toggle' }).catch(() => {});
});
