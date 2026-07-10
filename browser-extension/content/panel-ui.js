// SKVK Assistant — side panel UI
// Renders inside a Shadow DOM so host-page CSS can never bleed in or out.

(function (global) {
  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'Inter', -apple-system, 'Segoe UI', system-ui, sans-serif; }
    .jt-launcher {
      position: fixed; top: 50%; right: 0; transform: translateY(-50%);
      z-index: 2147483000; background: linear-gradient(135deg, #ff9a4d, #ff5d8f);
      color: #1a1326; border: none; border-radius: 10px 0 0 10px;
      padding: 14px 8px; font-weight: 700; font-size: 12px; letter-spacing: 0.06em;
      writing-mode: vertical-rl; text-orientation: mixed; cursor: pointer;
      box-shadow: -4px 0 18px rgba(0,0,0,0.35);
    }
    .jt-launcher:hover { filter: brightness(1.08); }
    .jt-panel {
      position: fixed; top: 16px; right: 16px; bottom: 16px; width: 360px;
      z-index: 2147483000; background: #111526; color: #eef0fb;
      border: 1px solid #262d49; border-radius: 16px;
      box-shadow: 0 18px 40px -12px rgba(0,0,0,0.6);
      display: flex; flex-direction: column; overflow: hidden; position: relative;
    }
    .jt-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px; border-bottom: 1px solid #262d49; background: #161b30;
      flex-shrink: 0;
    }
    .jt-brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
    .jt-brand .dot { width: 20px; height: 20px; border-radius: 6px; background: linear-gradient(135deg, #ff9a4d, #ff5d8f); flex-shrink:0; }
    .jt-header button.jt-close { background: none; border: none; color: #9aa1c3; font-size: 16px; cursor: pointer; padding: 4px; line-height: 1; }
    .jt-header button.jt-close:hover { color: #eef0fb; }
    .jt-header-right { display: flex; align-items: center; gap: 10px; }
    .jt-profile { position: relative; }
    .jt-avatar { width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(135deg, #ff9a4d, #ff5d8f); color: #1a1326; font-weight: 700; font-size: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; }
    .jt-profile-menu { position: absolute; top: 32px; right: 0; background: #1c2238; border: 1px solid #262d49; border-radius: 10px; padding: 8px; min-width: 160px; box-shadow: 0 10px 24px -8px rgba(0,0,0,0.6); z-index: 5; display: none; }
    .jt-profile-menu.open { display: block; }
    .jt-profile-name { font-size: 12.5px; font-weight: 700; color: #eef0fb; padding: 4px 6px; }
    .jt-profile-email { font-size: 11px; color: #6a7196; padding: 0 6px 6px; border-bottom: 1px solid #262d49; margin-bottom: 6px; }
    .jt-dashboard-btn { width: 100%; text-align: left; background: none; border: none; color: #d7dae8; font-size: 12.5px; padding: 6px; border-radius: 6px; cursor: pointer; }
    .jt-dashboard-btn:hover { background: #262d49; }
    .jt-logout-btn { width: 100%; text-align: left; background: none; border: none; color: #ff8fa3; font-size: 12.5px; padding: 6px; border-radius: 6px; cursor: pointer; }
    .jt-logout-btn:hover { background: #262d49; }
    .jt-notice-toast { position: fixed; top: 20px; right: 20px; z-index: 2147483001; background: #1c2238; color: #eef0fb; border: 1px solid #262d49; border-radius: 10px; padding: 10px 14px; font-size: 12.5px; max-width: 280px; box-shadow: 0 10px 24px -8px rgba(0,0,0,0.6); }
    .jt-body { flex: 1; overflow-y: auto; padding: 16px; }
    .jt-body::-webkit-scrollbar { width: 6px; }
    .jt-body::-webkit-scrollbar-thumb { background: #1c2238; border-radius: 6px; }

    .jt-jobtitle { font-size: 16px; font-weight: 700; margin: 0 0 4px; line-height: 1.3; }
    .jt-meta-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .jt-pill { font-size: 11.5px; padding: 3px 9px; border-radius: 999px; background: #1c2238; color: #9aa1c3; border: 1px solid #262d49; }
    .jt-pill.salary { color: #36d399; border-color: rgba(54,211,153,0.35); background: rgba(54,211,153,0.08); }

    .jt-section { margin-top: 16px; padding-top: 14px; border-top: 1px solid #262d49; }
    .jt-section-title { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #6a7196; font-weight: 700; margin: 0 0 10px; }

    .jt-match-row { display: flex; align-items: center; gap: 14px; }
    .jt-match-copy { flex: 1; font-size: 12.5px; color: #9aa1c3; line-height: 1.5; }
    .jt-match-copy b { color: #eef0fb; }
    .jt-gauge { flex-shrink: 0; }

    .jt-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .jt-chip { font-size: 12px; padding: 5px 10px; border-radius: 8px; background: #1c2238; border: 1px solid #262d49; color: #9aa1c3; display:flex; align-items:center; gap:5px; cursor: default; }
    .jt-chip.matched { color: #36d399; border-color: rgba(54,211,153,0.35); background: rgba(54,211,153,0.08); }
    .jt-chip.selectable { cursor: pointer; }
    .jt-chip.selectable.checked { color: #ffb976; border-color: rgba(255,154,77,0.4); background: rgba(255,154,77,0.1); }
    .jt-chip .check { font-weight: 700; }

    .jt-highlights { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
    .jt-highlights li { font-size: 12.5px; color: #d7dae8; display: flex; gap: 8px; align-items: baseline; }
    .jt-highlights li::before { content: '•'; color: #ff9a4d; font-weight: 700; }

    .jt-qual-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .jt-qual-list li { font-size: 12.5px; color: #9aa1c3; line-height: 1.4; padding-left: 14px; position: relative; }
    .jt-qual-list li::before { content: '—'; position: absolute; left: 0; color: #6a7196; }

    .jt-field { margin-bottom: 8px; }
    .jt-field label { font-size: 11px; color: #6a7196; display:block; margin-bottom: 3px; }
    .jt-field input, .jt-field select { width: 100%; background: #0c0f1c; border: 1px solid #262d49; border-radius: 8px; padding: 7px 9px; color: #eef0fb; font-size: 12.5px; }

    .jt-footer { padding: 12px 16px; border-top: 1px solid #262d49; background: #161b30; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
    .jt-btn-row { display: flex; gap: 8px; }
    .jt-btn { flex: 1; border: 1px solid #262d49; background: #1c2238; color: #d7dae8; border-radius: 9px; padding: 8px 10px; font-size: 12.5px; font-weight: 600; cursor: pointer; text-align: center; }
    .jt-btn:hover { background: #262d49; }
    .jt-btn:disabled { opacity: 0.5; cursor: default; }
    .jt-btn.primary { background: linear-gradient(135deg, #ff9a4d, #ff5d8f); color: #1a1326; border: none; }
    .jt-btn.primary:hover { filter: brightness(1.06); }
    .jt-btn.ghost { background: transparent; }
    .jt-btn.small { flex: none; padding: 6px 10px; font-size: 11.5px; }

    .jt-empty, .jt-loading, .jt-error { font-size: 13px; color: #9aa1c3; text-align: center; padding: 30px 10px; }
    .jt-error { color: #ff8fa3; }
    .jt-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.25); border-top-color: #1a1326; border-radius: 50%; display: inline-block; animation: jt-spin 0.7s linear infinite; margin-right: 6px; vertical-align: -2px; }
    @keyframes jt-spin { to { transform: rotate(360deg); } }

    .jt-tailor-summary { font-size: 12.5px; line-height: 1.5; color: #d7dae8; background: #0c0f1c; border: 1px solid #262d49; border-radius: 10px; padding: 10px; margin-bottom: 10px; white-space: pre-wrap; }
    .jt-tag-new { font-size: 9.5px; background: #ff9a4d; color: #1a1326; border-radius: 5px; padding: 1px 4px; margin-left: 4px; font-weight: 700; }
    .jt-suggestions { font-size: 11.5px; color: #6a7196; margin-top: 8px; font-style: italic; }
    textarea.jt-cover { width: 100%; min-height: 220px; background: #0c0f1c; border: 1px solid #262d49; border-radius: 8px; color: #eef0fb; padding: 10px; font-size: 12px; line-height: 1.5; resize: vertical; }

    .jt-nojob { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; height: 100%; min-height: 320px; gap: 16px; padding: 20px; }
    .jt-nojob .jt-nojob-icon { font-size: 30px; }
    .jt-nojob p { font-size: 13px; color: #9aa1c3; line-height: 1.55; margin: 0; max-width: 260px; }

    .jt-confirm-overlay { position: absolute; inset: 0; background: rgba(8,10,18,0.78); display: flex; align-items: center; justify-content: center; z-index: 20; padding: 20px; }
    .jt-confirm-box { background: #1c2238; border: 1px solid #262d49; border-radius: 12px; padding: 18px; width: 100%; text-align: left; box-shadow: 0 18px 40px -12px rgba(0,0,0,0.6); }
    .jt-confirm-box h3 { margin: 0 0 8px; font-size: 14px; color: #eef0fb; }
    .jt-confirm-box p { margin: 0 0 14px; font-size: 12.5px; color: #9aa1c3; line-height: 1.45; }
    .jt-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
  `;

  function gaugeSvg(percent) {
    const r = 26, c = 2 * Math.PI * r;
    const offset = c - (Math.max(0, Math.min(100, percent)) / 100) * c;
    const color = percent >= 70 ? '#36d399' : percent >= 40 ? '#ffb976' : '#ff8fa3';
    return `
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="${r}" stroke="#1c2238" stroke-width="6" fill="none"/>
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
    }

    open() { this.isOpen = true; this.panel.style.display = 'flex'; this.launcher.style.display = 'none'; }
    close() {
      this.isOpen = false;
      // "Completely close" — remove the panel and its launcher tab from the
      // page entirely, rather than just hiding them. Resetting the loaded
      // flag means the next toolbar-icon click re-injects a fresh instance
      // instead of toggling a hidden one back into view.
      this.host.remove();
      if (typeof window !== 'undefined') window.__skvkAssistantLoaded = false;
    }
    toggle() { this.isOpen ? this.close() : this.open(); }

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
      this.setBody(`<div class="jt-loading"><span class="jt-spinner" style="border-top-color:#ff9a4d"></span>${esc(message || 'Loading…')}</div>`);
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

    // Shown when the panel is opened on a page that doesn't look like a job
    // posting. Unlike the old flashNotice() toast, this keeps the panel
    // open as a persistent sidebar (until the user explicitly closes it)
    // with the message centered in the body and a Reload button beneath it,
    // so the user can navigate to a job listing and retry without reopening
    // the panel from the toolbar icon.
    renderNoJobState(onReload) {
      this.clearFooter();
      this.setBody(`
        <div class="jt-nojob">
          <div class="jt-nojob-icon">🔍</div>
          <p>This doesn't look like a job posting page. Open a job listing in this tab, then reload.</p>
          <button class="jt-btn primary small" id="jt-nojob-reload">Reload job details</button>
        </div>
      `);
      this.panel.querySelector('#jt-nojob-reload').addEventListener('click', onReload);
    }

    // Modal confirmation shown before reloading job details for a job
    // that's already loaded, mirroring the "Did you apply for this job?"
    // prompt: mark-as-applied on Yes, plain reload on No. Rendered as an
    // overlay inside the panel so it stays anchored to the sidebar.
    showApplyConfirm(onYes, onNo) {
      this.shadow.querySelector('.jt-confirm-overlay')?.remove();
      const overlay = document.createElement('div');
      overlay.className = 'jt-confirm-overlay';
      overlay.innerHTML = `
        <div class="jt-confirm-box">
          <h3>Did you apply for this job?</h3>
          <p>If you've already applied, mark it as applied. Otherwise, just reload the job details.</p>
          <div class="jt-confirm-actions">
            <button class="jt-btn small" id="jt-confirm-no">No, not yet</button>
            <button class="jt-btn primary small" id="jt-confirm-yes">Yes, I applied</button>
          </div>
        </div>
      `;
      this.panel.appendChild(overlay);
      const cleanup = () => overlay.remove();
      overlay.querySelector('#jt-confirm-yes').addEventListener('click', () => { cleanup(); onYes(); });
      overlay.querySelector('#jt-confirm-no').addEventListener('click', () => { cleanup(); onNo(); });
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
