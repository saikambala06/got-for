// SKVK Assistant — background service worker
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

  async 'jobs:trackView'({ title, company, jobUrl }) {
    const body = await apiFetch('/api/jobs/track-view', {
      method: 'POST',
      body: JSON.stringify({ title, company, jobUrl })
    });
    return body.view;
  },

  async 'job:analyze'({ jobTitle, company, jobDescription, rawText }) {
    const body = await apiFetch('/api/jobs/analyze', {
      method: 'POST',
      body: JSON.stringify({ jobTitle, company, jobDescription, rawText })
    });
    return body.analysis;
  },

  async 'tabs:openDashboard'() {
    const { apiBase } = await getConfig();
    await chrome.tabs.create({ url: apiBase });
    return { ok: true };
  },

  async 'tabs:openTailor'({ resumeId, jobTitle, company, jobDescription }) {
    const { apiBase } = await getConfig();
    const params = new URLSearchParams({
      resumeId: resumeId || '',
      jobTitle: jobTitle || '',
      company: company || '',
      jobDescription: jobDescription || ''
    });
    await chrome.tabs.create({ url: `${apiBase}/tailor.html?${params.toString()}` });
    return { ok: true };
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

// SKVK Assistant only ever runs on the single tab the user actively clicked
// the toolbar icon on — there is no content script running in the background
// on any other tab, and no page is read or has data loaded until this fires.
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
  } catch (_) { /* already injected on this tab */ }
  chrome.tabs.sendMessage(tab.id, { type: 'panel:toggle' }).catch(() => {});
});
