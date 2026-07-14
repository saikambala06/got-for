// Shared helpers for the full-page extension views (tailor.html, quick-download.html)

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function send(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res) return reject(new Error('No response from extension background'));
      if (!res.ok) return reject(new Error(res.error || 'Request failed'));
      resolve(res.data);
    });
  });
}

function sessionId() {
  return new URLSearchParams(location.search).get('sid');
}

async function loadSession() {
  const sid = sessionId();
  if (!sid) throw new Error('Missing session — open this from the JobTrail panel.');
  const key = `jt_session_${sid}`;
  const store = await chrome.storage.local.get(key);
  const session = store[key];
  if (!session) throw new Error('This tailoring session has expired. Go back and try again.');
  return { sid, key, session };
}

async function saveSession(key, session) {
  await chrome.storage.local.set({ [key]: session });
}

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboards', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>' },
  { key: 'resumes', label: 'Resumes', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>' },
  { key: 'tracker', label: 'Job Tracker', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h3l2-2h4l2 2h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M9 13l2 2 4-4"/></svg>' },
  { key: 'account', label: 'Account', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>' }
];

function renderShell({ active, title, bodyHtml }) {
  const logoUrl = chrome.runtime.getURL('icons/icon128.png');
  const navHtml = NAV_ITEMS.map((it) => `
    <span class="nav-item ${it.key === active ? 'active' : ''}">${it.icon}<span>${esc(it.label)}</span></span>`).join('');

  document.body.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><img src="${logoUrl}" alt="" /><div class="name">Job<span>Trail</span></div></div>
        <nav class="sidebar-nav">${navHtml}</nav>
        <div class="sidebar-spacer"></div>
        <div class="sidebar-plan">
          <div class="plan-label">Current plan</div>
          <div class="plan-name">Pro Plan</div>
          <div class="plan-row"><span>Job extractions</span><span>392/800</span></div>
          <div class="plan-bar"><div style="width:49%"></div></div>
          <div class="plan-row"><span>Tailored resumes</span><span>283/500</span></div>
          <div class="plan-bar"><div style="width:57%"></div></div>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <span class="title">${esc(title)}</span>
          <button class="need-help" type="button">💬 Need Help?</button>
        </div>
        <div class="main-body" id="main-body">${bodyHtml}</div>
      </div>
    </div>`;
}

function renderLoadingInto(elId, message) {
  const el = document.getElementById(elId);
  const logoUrl = chrome.runtime.getURL('icons/icon128.png');
  el.innerHTML = `
    <div class="page-loading">
      <div>
        <img class="page-loading-logo" src="${logoUrl}" alt="Loading" />
        <div class="page-loading-text">${esc(message || 'Working…')}</div>
      </div>
    </div>`;
}
