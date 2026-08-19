/**
 * Extension bootstrap for the resume parser page.
 *
 * The parser UI itself is the exact same file the dashboard serves
 * (parser-ui.js). This module only does the two things that differ inside an
 * extension: render the app shell, and hand the UI a transport that attaches
 * the stored bearer token to an absolute API base.
 *
 * The upload is a multipart POST made directly from this page rather than
 * proxied through the service worker — a File cannot be structured-cloned
 * through chrome.runtime.sendMessage, and the page already holds the host
 * permissions it needs.
 */

(function () {
  'use strict';

  const DEFAULT_API_BASE = 'https://got-for.vercel.app';

  const NAV = [
    { key: 'dashboard', label: 'Dashboard', path: '/dashboard.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>' },
    { key: 'tracker', label: 'Job Tracker', path: '/tracker.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h3l2-2h4l2 2h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M9 13l2 2 4-4"/></svg>' },
    { key: 'resumes', label: 'Resumes', path: '/resumes.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>' },
    { key: 'parse', label: 'Parse resume', path: null,
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 5 17 10"/><line x1="12" y1="5" x2="12" y2="16"/></svg>' },
    { key: 'account', label: 'Account', path: '/account.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>' }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length ? parts.slice(0, 2).map((w) => w[0].toUpperCase()).join('') : '?';
  }

  async function getSession() {
    const sync = await chrome.storage.sync.get(['apiBase']);
    const local = await chrome.storage.local.get(['token', 'user']);
    return {
      apiBase: String(sync.apiBase || DEFAULT_API_BASE).replace(/\/$/, ''),
      token: local.token || null,
      user: local.user || null
    };
  }

  function renderSidebar(session) {
    const root = document.getElementById('sidebarRoot');
    if (!root) return;

    const nav = NAV.map((item) => {
      const active = item.key === 'parse';
      const href = item.path ? `${session.apiBase}${item.path}` : '#';
      const target = item.path ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a class="nav-item${active ? ' active' : ''}" href="${esc(href)}"${target}>${item.icon}<span>${esc(item.label)}</span></a>`;
    }).join('');

    root.innerHTML = `
      <a class="brand" href="${esc(session.apiBase)}" target="_blank" rel="noopener noreferrer">
        <div class="mark">SK</div>
        <div class="name">SK<span> VK</span></div>
      </a>
      <nav class="nav">${nav}</nav>
      <div class="sidebar-footer">
        <div class="plan-card">
          <div class="plan-title">Extension</div>
          <div class="plan-name">⚡ Connected</div>
          <div class="plan-row"><span>Parser</span><span>PDF · DOCX</span></div>
          <div class="plan-row"><span>Account</span><span>Synced</span></div>
        </div>
        <div class="user-chip">
          <div class="avatar" style="background:${esc(session.user?.avatarColor || '#6557f5')}">${esc(initials(session.user?.name))}</div>
          <div style="min-width:0">
            <div class="uname">${esc(session.user?.name || 'Signed in')}</div>
            <div class="uemail">${esc(session.user?.email || '')}</div>
          </div>
        </div>
      </div>`;
  }

  async function boot() {
    const bootState = document.getElementById('bootState');
    const signinState = document.getElementById('signinState');
    const parserRoot = document.getElementById('parserRoot');

    let session;
    try {
      session = await getSession();
    } catch {
      session = { apiBase: DEFAULT_API_BASE, token: null, user: null };
    }

    renderSidebar(session);

    if (!session.token) {
      bootState.hidden = true;
      signinState.hidden = false;
      const reload = document.getElementById('reloadBtn');
      if (reload) reload.addEventListener('click', () => location.reload());
      if (window.motion) window.motion.init(document);
      return;
    }

    // Hand the shared UI everything it needs to talk to the API.
    window.PARSER_TRANSPORT = {
      base: session.apiBase,
      request(url, options = {}) {
        const headers = { ...(options.headers || {}), Authorization: `Bearer ${session.token}` };
        return fetch(url, { ...options, headers });
      }
    };

    bootState.hidden = true;
    parserRoot.hidden = false;

    // parser-ui.js is loaded only now, so it boots with the transport in place.
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'parser-ui.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load the parser UI.'));
      document.body.appendChild(script);
    }).catch((err) => {
      if (window.motion) window.motion.toast(err.message, 'error');
    });

    if (window.motion) window.motion.init(document);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
