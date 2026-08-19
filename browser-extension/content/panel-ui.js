// SKVK Assistant — side panel UI
// Renders inside a Shadow DOM so host-page CSS can never bleed in or out.

(function (global) {
  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'Inter', -apple-system, 'Segoe UI', system-ui, sans-serif; }
    .jt-launcher {
      position: fixed; top: 50%; right: 0; transform: translateY(-50%);
      z-index: 2147483000; background: linear-gradient(135deg, #8c7dff, #6557f5);
      color: #ffffff; border: none; border-radius: 10px 0 0 10px;
      padding: 14px 8px; font-weight: 700; font-size: 12px; letter-spacing: 0.06em;
      writing-mode: vertical-rl; text-orientation: mixed; cursor: pointer;
      box-shadow: -4px 0 18px rgba(0,0,0,0.35);
    }
    .jt-launcher:hover { filter: brightness(1.08); transform: translateY(-50%) translateX(-2px); }
    .jt-launcher:active { transform: translateY(-50%) scale(.98); }
    .jt-panel {
      position: fixed; top: 16px; right: 16px; bottom: 16px; width: 360px;
      z-index: 2147483000; background: #111827; color: #eef0fb;
      border: 1px solid #2b3350; border-radius: 18px;
      box-shadow: 0 24px 56px -14px rgba(0,0,0,0.62);
      display: flex; flex-direction: column; overflow: hidden;
      animation: jt-panel-in .34s cubic-bezier(.16,1,.3,1) both;
    }
    .jt-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px; border-bottom: 1px solid #2b3350; background: #151c2e;
      flex-shrink: 0;
    }
    .jt-brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
    .jt-brand .dot { width: 20px; height: 20px; border-radius: 6px; background: linear-gradient(135deg, #8c7dff, #6557f5); flex-shrink:0; }
    .jt-header button.jt-close { background: none; border: none; color: #9aa1c3; font-size: 16px; cursor: pointer; padding: 4px; line-height: 1; }
    .jt-header button.jt-close:hover { color: #eef0fb; }
    .jt-header-right { display: flex; align-items: center; gap: 10px; }
    .jt-profile { position: relative; }
    .jt-avatar { width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(135deg, #8c7dff, #6557f5); color: #ffffff; font-weight: 700; font-size: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; }
    .jt-profile-menu { position: absolute; top: 32px; right: 0; background: #1e263c; border: 1px solid #2b3350; border-radius: 10px; padding: 8px; min-width: 160px; box-shadow: 0 10px 24px -8px rgba(0,0,0,0.6); z-index: 5; display: none; }
    .jt-profile-menu.open { display: block; }
    .jt-profile-name { font-size: 12.5px; font-weight: 700; color: #eef0fb; padding: 4px 6px; }
    .jt-profile-email { font-size: 11px; color: #6a7196; padding: 0 6px 6px; border-bottom: 1px solid #2b3350; margin-bottom: 6px; }
    .jt-dashboard-btn { width: 100%; text-align: left; background: none; border: none; color: #d7dae8; font-size: 12.5px; padding: 6px; border-radius: 6px; cursor: pointer; }
    .jt-dashboard-btn:hover { background: #2b3350; }
    .jt-logout-btn { width: 100%; text-align: left; background: none; border: none; color: #ff8fa3; font-size: 12.5px; padding: 6px; border-radius: 6px; cursor: pointer; }
    .jt-logout-btn:hover { background: #2b3350; }
    .jt-notice-toast { position: fixed; top: 20px; right: 20px; z-index: 2147483001; background: #1e263c; color: #eef0fb; border: 1px solid #2b3350; border-radius: 10px; padding: 10px 14px; font-size: 12.5px; max-width: 280px; box-shadow: 0 10px 24px -8px rgba(0,0,0,0.6); }
    .jt-body { flex: 1; overflow-y: auto; padding: 16px; }
    .jt-body::-webkit-scrollbar { width: 6px; }
    .jt-body::-webkit-scrollbar-thumb { background: #1e263c; border-radius: 6px; }

    .jt-jobtitle { font-size: 16px; font-weight: 700; margin: 0 0 4px; line-height: 1.3; }
    .jt-meta-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .jt-pill { font-size: 11.5px; padding: 3px 9px; border-radius: 999px; background: #1e263c; color: #9aa1c3; border: 1px solid #2b3350; }
    .jt-pill.salary { color: #36d399; border-color: rgba(54,211,153,0.35); background: rgba(54,211,153,0.08); }

    .jt-section { margin-top: 16px; padding-top: 14px; border-top: 1px solid #2b3350; }
    .jt-section-title { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #6a7196; font-weight: 700; margin: 0 0 10px; }

    .jt-match-row { display: flex; align-items: center; gap: 14px; }
    .jt-match-copy { flex: 1; font-size: 12.5px; color: #9aa1c3; line-height: 1.5; }
    .jt-match-copy b { color: #eef0fb; }
    .jt-gauge { flex-shrink: 0; }

    .jt-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .jt-chip { font-size: 12px; padding: 5px 10px; border-radius: 8px; background: #1e263c; border: 1px solid #2b3350; color: #9aa1c3; display:flex; align-items:center; gap:5px; cursor: default; }
    .jt-chip.matched { color: #36d399; border-color: rgba(54,211,153,0.35); background: rgba(54,211,153,0.08); }
    .jt-chip.selectable { cursor: pointer; }
    .jt-chip.selectable.checked { color: #b0a5ff; border-color: rgba(140,125,255,0.45); background: rgba(140,125,255,0.14); }
    .jt-chip .check { font-weight: 700; }

    .jt-highlights { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
    .jt-highlights li { font-size: 12.5px; color: #d7dae8; display: flex; gap: 8px; align-items: baseline; }
    .jt-highlights li::before { content: '•'; color: #8c7dff; font-weight: 700; }

    .jt-qual-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .jt-qual-list li { font-size: 12.5px; color: #9aa1c3; line-height: 1.4; padding-left: 14px; position: relative; }
    .jt-qual-list li::before { content: '—'; position: absolute; left: 0; color: #6a7196; }

    .jt-field { margin-bottom: 8px; }
    .jt-field label { font-size: 11px; color: #6a7196; display:block; margin-bottom: 3px; }
    .jt-field input, .jt-field select { width: 100%; background: #0d1322; border: 1px solid #2b3350; border-radius: 8px; padding: 7px 9px; color: #eef0fb; font-size: 12.5px; }

    .jt-footer { padding: 12px 16px; border-top: 1px solid #2b3350; background: #151c2e; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
    .jt-btn-row { display: flex; gap: 8px; }
    .jt-btn { flex: 1; border: 1px solid #2b3350; background: #1e263c; color: #d7dae8; border-radius: 9px; padding: 8px 10px; font-size: 12.5px; font-weight: 600; cursor: pointer; text-align: center; }
    .jt-btn:hover { background: #2b3350; }
    .jt-btn:disabled { opacity: 0.5; cursor: default; }
    .jt-btn.primary { background: linear-gradient(135deg, #8c7dff, #6557f5); color: #ffffff; border: none; }
    .jt-btn.primary:hover { filter: brightness(1.06); }
    .jt-btn.ghost { background: transparent; }
    .jt-btn.small { flex: none; padding: 6px 10px; font-size: 11.5px; }

    .jt-empty, .jt-loading, .jt-error { font-size: 13px; color: #9aa1c3; text-align: center; padding: 30px 10px; }
    .jt-error { color: #ff8fa3; }

    .jt-empty-state {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; height: 100%; min-height: 320px; padding: 24px 12px; gap: 16px;
    }
    .jt-empty-state .jt-empty-icon { font-size: 30px; opacity: 0.7; }
    .jt-empty-state .jt-empty-msg { font-size: 13.5px; color: #d7dae8; line-height: 1.5; max-width: 260px; }
    .jt-empty-state .jt-empty-sub { font-size: 11.5px; color: #6a7196; max-width: 260px; line-height: 1.4; }

    .jt-modal-overlay {
      position: fixed; z-index: 2147483002; background: rgba(17,24,39,0.56); backdrop-filter: blur(6px);
      display: flex; align-items: center; justify-content: center; padding: 18px;
      border-radius: 16px; overflow: hidden; animation: jt-fade .18s ease both;
    }
    .jt-modal-card {
      background: #ffffff; color: #172033; border: 1px solid #e5e9f0; border-radius: 18px; padding: 22px;
      width: 100%; max-width: 318px; box-shadow: 0 22px 52px rgba(28,40,63,0.18);
      position: relative; animation: jt-modal-in .22s ease both;
    }
    .jt-modal-card::before { content: ''; display: block; width: 42px; height: 4px; border-radius: 999px; background: linear-gradient(135deg,#6557f5,#8c7dff); margin-bottom: 14px; }
    .jt-modal-card .jt-modal-close {
      position: absolute; top: 13px; right: 13px; width: 30px; height: 30px; border-radius: 9px;
      background: #f8fafc; border: 1px solid #e5e9f0; font-size: 15px; color: #697386; cursor: pointer; line-height: 1;
      transition: transform .18s ease, background .18s ease, color .18s ease;
    }
    .jt-modal-card .jt-modal-close:hover { transform: translateY(-1px); background: #f1f3f8; color: #172033; }
    .jt-modal-title { font-size: 16px; font-weight: 800; letter-spacing: -.02em; margin: 0 30px 7px 0; }
    .jt-modal-body { font-size: 12.5px; color: #697386; line-height: 1.55; margin-bottom: 17px; }
    .jt-modal-btn-row { display: flex; gap: 9px; }
    .jt-modal-btn {
      flex: 1; border-radius: 12px; padding: 10px 11px; font-size: 12.5px; font-weight: 750;
      cursor: pointer; border: 1px solid #e5e9f0; background: #f8fafc; color: #4e5768;
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease;
    }
    .jt-modal-btn.primary { background: linear-gradient(135deg,#6557f5,#8c7dff); border-color: transparent; color: #ffffff; box-shadow: 0 9px 18px rgba(101,87,245,.22); }
    .jt-modal-btn:hover { transform: translateY(-2px); border-color: #cbd3df; box-shadow: 0 8px 16px rgba(28,40,63,.08); }
    .jt-modal-btn:active { transform: translateY(0) scale(.98); }
    .jt-modal-btn.primary:hover { box-shadow: 0 12px 22px rgba(101,87,245,.28); }
    .jt-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.25); border-top-color: #ffffff; border-radius: 50%; display: inline-block; animation: jt-spin 0.7s linear infinite; margin-right: 6px; vertical-align: -2px; }
    @keyframes jt-spin { to { transform: rotate(360deg); } }
    @keyframes jt-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes jt-modal-in { 0% { opacity: 0; transform: translateY(14px) scale(.96); } 60% { opacity: 1; transform: translateY(0) scale(1.01); } 100% { opacity: 1; transform: none; } }
    @keyframes jt-panel-in { from { opacity: 0; transform: translateX(26px); } to { opacity: 1; transform: none; } }
    @keyframes jt-row-in { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }
    @keyframes jt-sheen { 0% { transform: translateX(-130%) skewX(-18deg); } 100% { transform: translateX(230%) skewX(-18deg); } }

    /* Staggered entrance for list content inside the panel body. */
    .jt-chips .jt-chip,
    .jt-highlights li,
    .jt-qual-list li { animation: jt-row-in .34s cubic-bezier(.16,1,.3,1) both; }
    .jt-chips .jt-chip:nth-child(n+2)  { animation-delay: .03s; }
    .jt-chips .jt-chip:nth-child(n+5)  { animation-delay: .07s; }
    .jt-chips .jt-chip:nth-child(n+9)  { animation-delay: .11s; }
    .jt-highlights li:nth-child(n+2)   { animation-delay: .05s; }
    .jt-highlights li:nth-child(n+3)   { animation-delay: .1s; }
    .jt-highlights li:nth-child(n+4)   { animation-delay: .15s; }

    .jt-chip { transition: transform .16s cubic-bezier(.22,.61,.36,1), background .18s ease, border-color .18s ease, color .18s ease; }
    .jt-chip.selectable:hover { transform: translateY(-2px); }

    .jt-btn { position: relative; overflow: hidden; transition: transform .16s cubic-bezier(.22,.61,.36,1), background .18s ease, box-shadow .2s ease, filter .18s ease; }
    .jt-btn:hover:not(:disabled) { transform: translateY(-2px); }
    .jt-btn:active:not(:disabled) { transform: translateY(0) scale(.98); }
    .jt-btn.primary { box-shadow: 0 10px 22px rgba(101,87,245,.32); }
    .jt-btn.primary::after {
      content: ''; position: absolute; top: 0; bottom: 0; width: 45%;
      background: linear-gradient(100deg, transparent, rgba(255,255,255,.3), transparent);
      transform: translateX(-130%) skewX(-18deg); pointer-events: none;
    }
    .jt-btn.primary:hover:not(:disabled)::after { animation: jt-sheen .65s cubic-bezier(.16,1,.3,1); }

    @media (prefers-reduced-motion: reduce) {
      .jt-panel, .jt-chip, .jt-highlights li, .jt-qual-list li, .jt-modal-card { animation: none !important; }
    }

    .jt-tailor-summary { font-size: 12.5px; line-height: 1.5; color: #d7dae8; background: #0d1322; border: 1px solid #2b3350; border-radius: 10px; padding: 10px; margin-bottom: 10px; white-space: pre-wrap; }
    .jt-tag-new { font-size: 9.5px; background: #8c7dff; color: #ffffff; border-radius: 5px; padding: 1px 4px; margin-left: 4px; font-weight: 700; }
    .jt-suggestions { font-size: 11.5px; color: #6a7196; margin-top: 8px; font-style: italic; }
    textarea.jt-cover { width: 100%; min-height: 220px; background: #0d1322; border: 1px solid #2b3350; border-radius: 8px; color: #eef0fb; padding: 10px; font-size: 12px; line-height: 1.5; resize: vertical; }
  `;

  function gaugeSvg(percent) {
    const r = 26, c = 2 * Math.PI * r;
    const offset = c - (Math.max(0, Math.min(100, percent)) / 100) * c;
    const color = percent >= 70 ? '#36d399' : percent >= 40 ? '#b0a5ff' : '#ff8fa3';
    return `
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="${r}" stroke="#1e263c" stroke-width="6" fill="none"/>
        <circle cx="32" cy="32" r="${r}" stroke="${color}" stroke-width="6" fill="none"
          stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
          transform="rotate(-90 32 32)"/>
        <text x="32" y="37" text-anchor="middle" font-size="15" font-weight="700" fill="#eef0fb">${Math.round(percent)}%</text>
      </svg>`;
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  class SKVKPanel {
    constructor() {
      this.host = document.createElement('div');
      this.host.id = 'skvk-assistant-host';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLES;
      this.shadow.appendChild(style);
      (document.documentElement || document.body).appendChild(this.host);

      this.launcher = document.createElement('button');
      this.launcher.className = 'jt-launcher';
      this.launcher.textContent = 'SKVK';
      this.launcher.addEventListener('click', () => this.open());
      this.shadow.appendChild(this.launcher);

      this.panel = document.createElement('div');
      this.panel.className = 'jt-panel';
      this.panel.style.display = 'none';
      this.panel.innerHTML = `
        <div class="jt-header">
          <div class="jt-brand"><span class="dot"></span> SKVK Assistant</div>
          <div class="jt-header-right">
            <div class="jt-profile" style="display:none;">
              <button class="jt-avatar" title="Account"></button>
              <div class="jt-profile-menu">
                <div class="jt-profile-name"></div>
                <div class="jt-profile-email"></div>
                <button class="jt-dashboard-btn">Open SKVK dashboard</button>
                <button class="jt-logout-btn">Log out</button>
              </div>
            </div>
            <button class="jt-close" title="Close">✕</button>
          </div>
        </div>
        <div class="jt-body"></div>
      `;
      this.shadow.appendChild(this.panel);
      this.bodyEl = this.panel.querySelector('.jt-body');
      this.profileEl = this.panel.querySelector('.jt-profile');
      this.panel.querySelector('.jt-close').addEventListener('click', () => this.close());
      this.panel.querySelector('.jt-avatar').addEventListener('click', () => {
        this.panel.querySelector('.jt-profile-menu').classList.toggle('open');
      });

      this.isOpen = false;
      this.destroyed = false;
    }

    open() { this.isOpen = true; this.panel.style.display = 'flex'; this.launcher.style.display = 'none'; }
    // Just hides the panel/launcher — it does NOT remove the host or reset
    // window.__skvkAssistantLoaded. Removing + resetting used to force the
    // background script to re-inject content.js on the next toolbar click,
    // but re-injecting content.js while the page's `window` (and its
    // existing chrome.runtime.onMessage listener from the first injection)
    // is still alive registers a SECOND listener rather than replacing the
    // first — every close/reopen cycle piled on another one. With enough
    // duplicate listeners, a single toolbar click could fire multiple
    // stale handlers at once, each spinning up its own SKVKPanel host, so
    // the page ended up with several overlapping/duplicate panels and the
    // toggle could appear to "not open" or show stale data. Hiding instead
    // of destroying means re-clicking the icon only ever talks to the one
    // listener that's actually been there since the page loaded.
    close() {
      this.isOpen = false;
      // Remove this host AND any stale copies left by an earlier extension
      // build. This is deliberately permanent for the current page until the
      // browser-toolbar icon is clicked again.
      document.querySelectorAll('#skvk-assistant-host').forEach((node) => node.remove());
      this.destroyed = true;
      window.__skvkAssistantPanelDestroyed = true;
    }
    toggle() {
      if (this.destroyed || !this.host.isConnected) return false;
      this.isOpen ? this.close() : this.open();
      return true;
    }

    // Renders the signed-in user's initial as an avatar with a logout menu.
    // Passing null hides it (logged out / login screen).
    setProfile(user, onLogout, onDashboard) {
      if (!user) { this.profileEl.style.display = 'none'; return; }
      this.profileEl.style.display = 'block';
      this.panel.querySelector('.jt-avatar').textContent = (user.name || user.email || '?')[0].toUpperCase();
      this.panel.querySelector('.jt-profile-name').textContent = user.name || 'Signed in';
      this.panel.querySelector('.jt-profile-email').textContent = user.email || '';
      const logoutBtn = this.panel.querySelector('.jt-logout-btn');
      const freshLogoutBtn = logoutBtn.cloneNode(true);
      logoutBtn.replaceWith(freshLogoutBtn);
      freshLogoutBtn.addEventListener('click', () => {
        this.panel.querySelector('.jt-profile-menu').classList.remove('open');
        onLogout();
      });
      const dashboardBtn = this.panel.querySelector('.jt-dashboard-btn');
      const freshDashboardBtn = dashboardBtn.cloneNode(true);
      dashboardBtn.replaceWith(freshDashboardBtn);
      freshDashboardBtn.addEventListener('click', () => {
        this.panel.querySelector('.jt-profile-menu').classList.remove('open');
        if (onDashboard) onDashboard();
      });
    }

    renderLoginForm(onLogin) {
      this.clearFooter();
      this.setBody(`
        <div style="padding-top:8px;">
          <div class="jt-section-title" style="margin-top:0;">Log in to SKVK</div>
          <div class="jt-field"><label>Email</label><input id="jt-login-email" type="email"/></div>
          <div class="jt-field"><label>Password</label><input id="jt-login-password" type="password"/></div>
          <div class="jt-error" id="jt-login-error" style="display:none; padding:6px 0; text-align:left;"></div>
          <button class="jt-btn primary" id="jt-login-submit" style="width:100%; margin-top:6px;">Log in</button>
        </div>
      `);
      const errorEl = this.panel.querySelector('#jt-login-error');
      const submit = () => {
        const email = this.panel.querySelector('#jt-login-email').value.trim();
        const password = this.panel.querySelector('#jt-login-password').value;
        errorEl.style.display = 'none';
        if (!email || !password) {
          errorEl.textContent = 'Enter your email and password.';
          errorEl.style.display = 'block';
          return;
        }
        const btn = this.panel.querySelector('#jt-login-submit');
        btn.disabled = true; btn.textContent = 'Logging in…';
        onLogin(email, password, (message) => {
          btn.disabled = false; btn.textContent = 'Log in';
          errorEl.textContent = message;
          errorEl.style.display = 'block';
        });
      };
      this.panel.querySelector('#jt-login-submit').addEventListener('click', submit);
      this.panel.querySelector('#jt-login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }

    // Brief, non-blocking toast shown outside the panel (e.g. when the icon
    // is clicked on a page that isn't a job posting). Auto-dismisses itself.
    flashNotice(message) {
      const toast = document.createElement('div');
      toast.className = 'jt-notice-toast';
      toast.textContent = message;
      this.shadow.appendChild(toast);
      setTimeout(() => toast.remove(), 3200);
    }

    setBody(html) {
      this.bodyEl.innerHTML = html;
    }

    clearFooter() {
      this.shadow.querySelector('.jt-footer')?.remove();
    }

    renderLoading(message) {
      this.clearFooter();
      this.setBody(`<div class="jt-loading"><span class="jt-spinner" style="border-top-color:#8c7dff"></span>${esc(message || 'Loading…')}</div>`);
    }

    // Centered "not a job page" state: shown *inside* the open panel (the
    // panel stays open as a docked sidebar until the user explicitly hits
    // the ✕) rather than a self-dismissing toast. A Reload button sits
    // below the message so the user can re-check the page after navigating
    // without having to close/reopen the panel.
    renderEmptyState(message, subMessage, onReload) {
      this.clearFooter();
      this.setBody(`
        <div class="jt-empty-state">
          <div class="jt-empty-icon">🔍</div>
          <div class="jt-empty-msg">${esc(message)}</div>
          ${subMessage ? `<div class="jt-empty-sub">${esc(subMessage)}</div>` : ''}
          <button class="jt-btn ghost small" id="jt-empty-reload">Reload job details</button>
        </div>
      `);
      this.panel.querySelector('#jt-empty-reload').addEventListener('click', onReload);
    }

    // "Did you apply for this job?" confirmation modal, shown before a
    // reload actually re-parses the page. Mirrors the reference design:
    // white card, centered, ✕ to dismiss, and two explicit choices.
    showReloadConfirm({ onYes, onNo, onDismiss } = {}) {
      const rect = this.panel.getBoundingClientRect();
      const overlay = document.createElement('div');
      overlay.className = 'jt-modal-overlay';
      overlay.style.top = `${rect.top}px`;
      overlay.style.left = `${rect.left}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.innerHTML = `
        <div class="jt-modal-card">
          <button class="jt-modal-close" title="Close">✕</button>
          <div class="jt-modal-title">Did you apply for this job?</div>
          <div class="jt-modal-body">If you have already applied for this job, mark it as applied. Otherwise, just reload the job details.</div>
          <div class="jt-modal-btn-row">
            <button class="jt-modal-btn" id="jt-modal-no">No, not yet</button>
            <button class="jt-modal-btn primary" id="jt-modal-yes">Yes, I applied</button>
          </div>
        </div>
      `;
      const close = () => overlay.remove();
      overlay.querySelector('.jt-modal-close').addEventListener('click', () => { close(); if (onDismiss) onDismiss(); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); if (onDismiss) onDismiss(); } });
      overlay.querySelector('#jt-modal-no').addEventListener('click', () => { close(); if (onNo) onNo(); });
      overlay.querySelector('#jt-modal-yes').addEventListener('click', () => { close(); if (onYes) onYes(); });
      this.shadow.appendChild(overlay);
    }

    renderError(message, retryFn, retryLabel) {
      this.clearFooter();
      this.setBody(`
        <div class="jt-error" style="text-align:center">${esc(message)}</div>
        ${retryFn ? `<div style="text-align:center"><button class="jt-btn small" id="jt-retry">${esc(retryLabel || 'Try again')}</button></div>` : ''}
      `);
      if (retryFn) this.panel.querySelector('#jt-retry').addEventListener('click', retryFn);
    }

    // Renders the parsed-job card. `state` carries everything the footer
    // button handlers need (job data, resumes, selected resume, callbacks).
    renderJob(state) {
      const { job, resumes, selectedResumeId, extraSkillsChecked } = state;
      const resume = resumes.find((r) => r._id === selectedResumeId) || resumes[0];
      const { cleanSkill, skillsMatch } = global.SKVKSkillsData;
      // cleanSkill() strips any leftover "Category:" label from older/legacy
      // parsed data (see skillUtils.js) so matching isn't thrown off by it.
      const resumeSkills = (resume?.skills || []).map((s) => cleanSkill(s));

      // skillsMatch() requires an exact match after canonicalising known
      // aliases (JS/JavaScript, K8s/Kubernetes, etc). The old check used
      // bidirectional .includes(), which meant "Java" always "matched"
      // "JavaScript" and "Go" always "matched" "Django" — two unrelated
      // skills that simply happen to be substrings of one another.
      const matchedSkills = job.skillsFound.filter((s) => resumeSkills.some((rs) => skillsMatch(s, rs)));
      const missingSkills = job.skillsFound.filter((s) => !matchedSkills.includes(s));
      const totalKeywords = job.skillsFound.length;
      const percent = totalKeywords ? Math.round((matchedSkills.length / totalKeywords) * 100) : 0;

      const skillChips = [
        ...matchedSkills.map((s) => `<span class="jt-chip matched"><span class="check">✓</span>${esc(s)}</span>`),
        ...missingSkills.map((s) => {
          const checked = extraSkillsChecked.has(s);
          return `<button class="jt-chip selectable ${checked ? 'checked' : ''}" data-skill="${esc(s)}">${checked ? '<span class="check">✓</span>' : '+'}${esc(s)}</button>`;
        })
      ].join('');

      const qualHtml = job.qualificationPhrases.length
        ? `<ul class="jt-qual-list">${job.qualificationPhrases.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>`
        : `<div style="font-size:12px;color:#6a7196;">No explicit requirements list detected on this page.</div>`;

      const highlightsHtml = job.highlights.length
        ? `<ul class="jt-highlights">${job.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`
        : `<div style="font-size:12px;color:#6a7196;">No benefits or sponsorship info detected.</div>`;

      const resumeOptions = resumes.map((r) => `<option value="${r._id}" ${r._id === resume?._id ? 'selected' : ''}>${esc(r.title)}${r.isDefault ? ' (default)' : ''}</option>`).join('');

      this.setBody(`
        <h2 class="jt-jobtitle">${esc(job.title || 'Untitled role')}</h2>
        <div class="jt-meta-row">
          ${job.company ? `<span class="jt-pill">${esc(job.company)}</span>` : ''}
          ${job.location ? `<span class="jt-pill">${esc(job.location)}</span>` : ''}
          ${job.employmentType ? `<span class="jt-pill">${esc(job.employmentType)}</span>` : ''}
          ${job.experience?.seniority ? `<span class="jt-pill">${esc(job.experience.seniority)}</span>` : ''}
          ${job.experience?.years ? `<span class="jt-pill">${esc(job.experience.years)} exp</span>` : ''}
        </div>
        ${job.salary ? `<div class="jt-meta-row"><span class="jt-pill salary">${esc(job.salary)}</span></div>` : ''}

        <div class="jt-section">
          <div class="jt-section-title">Resume in use</div>
          <div class="jt-field"><select id="jt-resume-select">${resumeOptions}</select></div>
        </div>

        <div class="jt-section">
          <div class="jt-section-title">Keyword match</div>
          <div class="jt-match-row">
            <div class="jt-gauge">${gaugeSvg(percent)}</div>
            <div class="jt-match-copy">Your selected resume has <b>${matchedSkills.length} of ${totalKeywords}</b> keywords found in this posting.</div>
          </div>
        </div>

        <div class="jt-section">
          <div class="jt-section-title">Skills ${missingSkills.length ? '<span style="text-transform:none;font-weight:400;color:#6a7196;">(tap ones you genuinely have)</span>' : ''}</div>
          <div class="jt-chips">${skillChips || '<div style="font-size:12px;color:#6a7196;">No specific skills detected in this posting.</div>'}</div>
        </div>

        <div class="jt-section">
          <div class="jt-section-title">Key highlights</div>
          ${highlightsHtml}
        </div>

        <div class="jt-section">
          <div class="jt-section-title">Qualifications detected</div>
          ${qualHtml}
        </div>

        <div id="jt-result-slot"></div>
      `);
    }

    renderTailorResult(result) {
      const slot = this.panel.querySelector('#jt-result-slot');
      if (!slot) return;
      slot.innerHTML = `
        <div class="jt-section">
          <div class="jt-section-title">Tailored summary</div>
          <div class="jt-tailor-summary">${esc(result.summary || '')}</div>
          <div class="jt-section-title">Reordered skills</div>
          <div class="jt-chips">${(result.skills || []).map((s) => `<span class="jt-chip matched">${esc(s)}</span>`).join('')}</div>
          ${result.suggestions ? `<div class="jt-suggestions">${esc(result.suggestions)}</div>` : ''}
          <div class="jt-btn-row" style="margin-top:10px;">
            <button class="jt-btn primary" id="jt-save-tailor">Save to resume</button>
          </div>
        </div>
      `;
    }

    renderCoverLetter(text) {
      const slot = this.panel.querySelector('#jt-result-slot');
      if (!slot) return;
      slot.innerHTML = `
        <div class="jt-section">
          <div class="jt-section-title">Cover letter draft</div>
          <textarea class="jt-cover" id="jt-cover-text">${esc(text)}</textarea>
          <div class="jt-btn-row" style="margin-top:8px;">
            <button class="jt-btn small" id="jt-copy-cover">Copy</button>
          </div>
        </div>
      `;
    }

    // Shows a Tailor/Cover-letter failure in place, inline with the rest of
    // the job card, instead of a native alert() popup that blocks the page
    // and hides the qualifications/highlights/skills already on screen.
    renderResultError(message, retryFn) {
      const slot = this.panel.querySelector('#jt-result-slot');
      if (!slot) return;
      slot.innerHTML = `
        <div class="jt-section">
          <div class="jt-error" style="padding:14px 4px;text-align:left;">${esc(message)}</div>
          ${retryFn ? '<div style="text-align:center;margin-top:6px;"><button class="jt-btn small" id="jt-result-retry">Try again</button></div>' : ''}
        </div>
      `;
      if (retryFn) this.panel.querySelector('#jt-result-retry')?.addEventListener('click', retryFn);
    }

    renderManualForm(job, onSave) {
      this.clearFooter();
      this.setBody(`
        <div class="jt-section-title" style="margin-top:0;">Enter job details manually</div>
        <div class="jt-field"><label>Job title</label><input id="jt-m-title" value="${esc(job.title)}"/></div>
        <div class="jt-field"><label>Company</label><input id="jt-m-company" value="${esc(job.company)}"/></div>
        <div class="jt-field"><label>Location</label><input id="jt-m-location" value="${esc(job.location)}"/></div>
        <div class="jt-field"><label>Employment type</label><input id="jt-m-type" value="${esc(job.employmentType)}"/></div>
        <div class="jt-field"><label>Salary</label><input id="jt-m-salary" value="${esc(job.salary)}"/></div>
        <div class="jt-btn-row" style="margin-top:10px;">
          <button class="jt-btn ghost" id="jt-m-cancel">Cancel</button>
          <button class="jt-btn primary" id="jt-m-save">Save</button>
        </div>
      `);
      this.panel.querySelector('#jt-m-cancel').addEventListener('click', () => onSave(null));
      this.panel.querySelector('#jt-m-save').addEventListener('click', () => {
        onSave({
          title: this.panel.querySelector('#jt-m-title').value.trim(),
          company: this.panel.querySelector('#jt-m-company').value.trim(),
          location: this.panel.querySelector('#jt-m-location').value.trim(),
          employmentType: this.panel.querySelector('#jt-m-type').value.trim(),
          salary: this.panel.querySelector('#jt-m-salary').value.trim()
        });
      });
    }

    renderFooter({ onManual, onMarkApplied, onTailor, onCoverLetter, onReload, applied }) {
      let footer = this.shadow.querySelector('.jt-footer');
      if (!footer) {
        footer = document.createElement('div');
        footer.className = 'jt-footer';
        this.panel.appendChild(footer);
      }
      footer.innerHTML = `
        <div class="jt-btn-row">
          <button class="jt-btn" id="jt-manual">Enter manually</button>
          <button class="jt-btn" id="jt-applied" ${applied ? 'disabled' : ''}>${applied ? 'Applied ✓' : 'Mark as applied'}</button>
        </div>
        <div class="jt-btn-row">
          <button class="jt-btn primary" id="jt-tailor">Tailor resume</button>
          <button class="jt-btn" id="jt-cover">Cover letter</button>
        </div>
        <button class="jt-btn ghost small" id="jt-reload" style="align-self:center;">Reload job details</button>
      `;
      footer.querySelector('#jt-manual').addEventListener('click', onManual);
      footer.querySelector('#jt-applied').addEventListener('click', onMarkApplied);
      footer.querySelector('#jt-tailor').addEventListener('click', onTailor);
      footer.querySelector('#jt-cover').addEventListener('click', onCoverLetter);
      footer.querySelector('#jt-reload').addEventListener('click', onReload);
    }

    setButtonBusy(id, busyLabel) {
      const btn = this.panel.querySelector(`#${id}`);
      if (!btn) return;
      btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
      btn.disabled = true;
      btn.innerHTML = `<span class="jt-spinner"></span>${busyLabel}`;
    }

    resetButton(id) {
      const btn = this.panel.querySelector(`#${id}`);
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || btn.textContent;
    }
  }

  global.SKVKPanelUI = { SKVKPanel };
})(typeof window !== 'undefined' ? window : globalThis);
