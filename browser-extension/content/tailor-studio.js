// JobTrail Assistant — Tailor Studio
// A full-screen, light-themed review UI (modeled on the "tailor & download"
// flow of tools like LetMeApply): tailoring-level tabs, a live match-score
// badge, per-bullet accept/reject diffs, "Apply all", and a download drawer
// with template/color/format options.

(function (global) {
  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; }
    .ts-overlay {
      position: fixed; inset: 0; z-index: 2147483647; background: #f4f5f7;
      display: flex; flex-direction: column; color: #1a1d29;
    }
    .ts-topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 22px; background: #fff; border-bottom: 1px solid #e4e6ec; flex-shrink: 0;
    }
    .ts-back { background: none; border: 1px solid #d9dce4; border-radius: 999px; padding: 7px 14px;
      font-size: 13px; font-weight: 600; cursor: pointer; color: #1a1d29; }
    .ts-back:hover { background: #f4f5f7; }
    .ts-brand { font-size: 15px; font-weight: 700; }
    .ts-score { display: flex; align-items: center; gap: 10px; }
    .ts-score-ring { position: relative; width: 46px; height: 46px; flex-shrink: 0; }
    .ts-score-copy { font-size: 11.5px; color: #6b7280; line-height: 1.3; }
    .ts-score-copy b { color: #16a34a; font-size: 15px; }

    .ts-controlbar {
      display: flex; align-items: center; gap: 16px; padding: 10px 22px; background: #fff;
      border-bottom: 1px solid #e4e6ec; flex-shrink: 0; flex-wrap: wrap;
    }
    .ts-level-label { font-size: 12.5px; color: #6b7280; font-weight: 600; }
    .ts-level-group { display: flex; border: 1px solid #d9dce4; border-radius: 8px; overflow: hidden; }
    .ts-level-btn { border: none; background: #fff; padding: 6px 14px; font-size: 12.5px; font-weight: 600;
      cursor: pointer; color: #4b5160; border-right: 1px solid #d9dce4; }
    .ts-level-btn:last-child { border-right: none; }
    .ts-level-btn.active { background: #16a34a; color: #fff; }
    .ts-spacer { flex: 1; }
    .ts-pill-btn { border: 1px solid #d9dce4; background: #fff; border-radius: 8px; padding: 6px 12px;
      font-size: 12.5px; font-weight: 600; cursor: pointer; color: #1a1d29; }
    .ts-pill-btn:hover { background: #f4f5f7; }
    .ts-pill-btn.primary { background: #16a34a; color: #fff; border-color: #16a34a; }
    .ts-pill-btn.primary:hover { filter: brightness(1.06); }
    .ts-pill-btn:disabled { opacity: 0.45; cursor: default; }

    .ts-body { flex: 1; overflow-y: auto; padding: 26px 0 110px; display: flex; justify-content: center; }
    .ts-sheet { width: 720px; max-width: calc(100% - 32px); background: #fff; border: 1px solid #e4e6ec;
      border-radius: 12px; padding: 34px 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .ts-sheet h1 { text-align: center; font-size: 21px; margin: 0 0 4px; }
    .ts-sheet .ts-contact { text-align: center; font-size: 12px; color: #6b7280; margin-bottom: 16px; }
    .ts-hr { border: none; border-top: 1px solid #e4e6ec; margin: 14px 0; }
    .ts-heading { font-size: 12.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      color: #1a1d29; margin: 18px 0 8px; }

    .ts-diff { margin-bottom: 6px; }
    .ts-diff-old { font-size: 13px; line-height: 1.55; color: #9aa0ab; text-decoration: line-through;
      background: #fdf2f2; padding: 4px 8px; border-radius: 6px; margin-bottom: 2px; }
    .ts-diff-row { display: flex; align-items: flex-start; gap: 8px; background: #fffbe6; border-radius: 6px; padding: 4px 8px; }
    .ts-diff-new { font-size: 13px; line-height: 1.55; color: #1a1d29; flex: 1; }
    .ts-diff-new.added::before { content: '+ '; color: #16a34a; font-weight: 700; }
    .ts-diff-actions { display: flex; gap: 4px; flex-shrink: 0; }
    .ts-act { width: 22px; height: 22px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px;
      display: flex; align-items: center; justify-content: center; font-weight: 700; }
    .ts-act.yes { background: #dcfce7; color: #16a34a; }
    .ts-act.no { background: #fee2e2; color: #dc2626; }
    .ts-act.active { outline: 2px solid currentColor; }
    .ts-plain { font-size: 13px; line-height: 1.55; color: #1a1d29; padding: 3px 8px; }
    .ts-removed-note { font-size: 11px; color: #9aa0ab; font-style: italic; margin: 2px 0 6px 8px; }

    .ts-skill-tag { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 3px 9px;
      border-radius: 999px; border: 1px solid #d9dce4; margin: 3px 4px 3px 0; }
    .ts-skill-tag.added { background: #fffbe6; border-color: #f5d90a; }

    .ts-bottombar { position: fixed; left: 0; right: 0; bottom: 0; background: #fff; border-top: 1px solid #e4e6ec;
      padding: 12px 22px; display: flex; align-items: center; gap: 14px; z-index: 2; }

    .ts-drawer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 3;
      display: flex; align-items: center; justify-content: center; }
    .ts-drawer { width: 460px; max-width: calc(100% - 32px); max-height: 86vh; overflow-y: auto; background: #fff;
      border-radius: 14px; padding: 24px; }
    .ts-drawer h2 { margin: 0 0 4px; font-size: 19px; }
    .ts-drawer p.sub { margin: 0 0 18px; font-size: 12.5px; color: #6b7280; }
    .ts-drawer-row { display: flex; gap: 16px; margin-bottom: 16px; }
    .ts-drawer-field { flex: 1; }
    .ts-drawer-field label { display: block; font-size: 11.5px; font-weight: 700; color: #4b5160; margin-bottom: 6px; }
    .ts-drawer-field select { width: 100%; padding: 8px 10px; border: 1px solid #d9dce4; border-radius: 8px; font-size: 13px; }
    .ts-swatches { display: flex; gap: 8px; flex-wrap: wrap; }
    .ts-swatch { width: 24px; height: 24px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; }
    .ts-swatch.selected { border-color: #1a1d29; }
    .ts-format-group, .ts-level-group2 { display: flex; border: 1px solid #d9dce4; border-radius: 8px; overflow: hidden; }
    .ts-format-btn { flex: 1; border: none; background: #fff; padding: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; border-right: 1px solid #d9dce4; }
    .ts-format-btn:last-child { border-right: none; }
    .ts-format-btn.active { background: #1a1d29; color: #fff; }
    .ts-drawer-download { width: 100%; margin-top: 18px; background: #16a34a; color: #fff; border: none;
      border-radius: 9px; padding: 12px; font-size: 14px; font-weight: 700; cursor: pointer; }
    .ts-drawer-download:hover { filter: brightness(1.05); }
    .ts-drawer-cancel { display: block; margin: 10px auto 0; background: none; border: none; color: #6b7280;
      font-size: 12.5px; cursor: pointer; }

    .ts-loading { text-align: center; padding: 60px 20px; color: #6b7280; font-size: 13px; }
    .ts-spinner { width: 18px; height: 18px; border: 2px solid #d9dce4; border-top-color: #16a34a; border-radius: 50%;
      display: inline-block; animation: ts-spin 0.7s linear infinite; margin-bottom: 8px; }
    @keyframes ts-spin { to { transform: rotate(360deg); } }

    /* Centered logo loader (replaces the spinner while the resume is matched) */
    .ts-loading-center { flex: 1; display: flex; align-items: center; justify-content: center; }
    .ts-loading-inner { text-align: center; }
    .ts-loading-logo { width: 96px; height: 96px; object-fit: contain; display: block; margin: 0 auto 18px;
      animation: ts-logo-pulse 1.6s ease-in-out infinite; filter: drop-shadow(0 4px 14px rgba(0,0,0,0.12)); }
    @keyframes ts-logo-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
    .ts-loading-text { font-size: 13.5px; color: #6b7280; font-weight: 500; }

    /* Tailor picker modal (resume + mode, shown before matching starts) */
    .ts-picker-backdrop { position: fixed; inset: 0; z-index: 2147483647; background: rgba(15, 17, 26, 0.45);
      display: flex; align-items: center; justify-content: center; padding: 24px; }
    .ts-picker { width: 480px; max-width: 100%; background: #fff; border-radius: 16px; padding: 32px 36px 28px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25); }
    .ts-picker h1 { font-size: 22px; margin: 0 0 6px; text-align: center; }
    .ts-picker p.sub { margin: 0 0 22px; font-size: 13px; color: #6b7280; text-align: center; }
    .ts-picker label.field-label { display: block; font-size: 12px; font-weight: 700; color: #4b5160; margin-bottom: 6px; }
    .ts-picker select { width: 100%; padding: 10px 12px; border: 1px solid #d9dce4; border-radius: 9px; font-size: 13.5px;
      margin-bottom: 18px; background: #fff; }
    .ts-mode-option { display: flex; align-items: flex-start; gap: 12px; border: 1.5px solid #e4e6ec; border-radius: 12px;
      padding: 14px 16px; margin-bottom: 12px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
    .ts-mode-option:hover { background: #f9fafb; }
    .ts-mode-option.selected { border-color: #16a34a; background: #f0fdf4; }
    .ts-mode-radio { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #d9dce4; flex-shrink: 0; margin-top: 2px;
      display: flex; align-items: center; justify-content: center; }
    .ts-mode-option.selected .ts-mode-radio { border-color: #16a34a; }
    .ts-mode-radio-dot { width: 9px; height: 9px; border-radius: 50%; background: #16a34a; display: none; }
    .ts-mode-option.selected .ts-mode-radio-dot { display: block; }
    .ts-mode-title { font-size: 14.5px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .ts-mode-badge { font-size: 11px; font-weight: 700; color: #2563eb; }
    .ts-mode-desc { font-size: 12.5px; color: #6b7280; margin-top: 2px; line-height: 1.4; }
    .ts-picker-continue { width: 100%; margin-top: 8px; background: #16a34a; color: #fff; border: none; border-radius: 10px;
      padding: 13px; font-size: 14.5px; font-weight: 700; cursor: pointer; }
    .ts-picker-continue:hover { filter: brightness(1.05); }
    .ts-picker-cancel { display: block; margin: 12px auto 0; background: none; border: none; color: #6b7280;
      font-size: 12.5px; cursor: pointer; }
  `;

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function scoreRing(percent, size = 46) {
    const r = (size - 8) / 2, c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(100, percent));
    const offset = c - (p / 100) * c;
    const color = p >= 70 ? '#16a34a' : p >= 40 ? '#d97706' : '#dc2626';
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="#e4e6ec" stroke-width="5" fill="none"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-width="5" fill="none"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="${size / 2}" y="${size / 2 + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#1a1d29">${Math.round(p)}</text>
    </svg>`;
  }

  const TEMPLATES = ['Classic', 'Harvard', "Jake's", 'Modern', 'Minimal'];
  const ACCENTS = ['#2563eb', '#16a34a', '#0ea5a4', '#dc2626', '#ec4899', '#d946ef', '#ea580c', '#f59e0b', '#0f172a', '#7c3aed'];

  class TailorStudio {
    constructor() {
      this.host = document.createElement('div');
      this.host.id = 'jobtrail-tailor-studio-host';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLES;
      this.shadow.appendChild(style);
      this.root = document.createElement('div');
      this.shadow.appendChild(this.root);
    }

    mount() {
      if (!this.host.isConnected) (document.documentElement || document.body).appendChild(this.host);
    }
    unmount() {
      if (this.host.isConnected) this.host.remove();
    }

    renderLoading(message) {
      this.mount();
      const logoUrl = chrome.runtime.getURL('assets/tailor-loader.gif');
      this.root.innerHTML = `
        <div class="ts-overlay">
          <div class="ts-topbar"><span class="ts-brand">Tailor resume</span><span></span></div>
          <div class="ts-loading-center">
            <div class="ts-loading-inner">
              <img class="ts-loading-logo" src="${logoUrl}" alt="Loading" />
              <div class="ts-loading-text">${esc(message || 'Matching it against your resume…')}</div>
            </div>
          </div>
        </div>`;
    }

    // Pre-tailoring picker: choose a resume and how to apply AI suggestions
    // (full "review & edit" flow, or a one-click "quick download" using
    // saved defaults). Shown as a centered modal over the current page.
    renderPicker(view, handlers) {
      this.mount();
      const { resumes, selectedResumeId } = view;
      let mode = 'review';
      let resumeId = selectedResumeId || resumes[0]?._id;

      const backdrop = document.createElement('div');
      backdrop.className = 'ts-picker-backdrop';
      backdrop.innerHTML = `
        <div class="ts-picker">
          <h1>Tailor your resume</h1>
          <p class="sub">Pick a resume, then choose how to apply AI suggestions.</p>

          <label class="field-label">Resume</label>
          <select id="ts-p-resume">
            ${resumes.map((r) => `<option value="${r._id}" ${r._id === resumeId ? 'selected' : ''}>${esc(r.name || 'Untitled resume')}${r.isDefault ? ' (Default)' : ''}</option>`).join('')}
          </select>

          <div class="ts-mode-option selected" data-mode="review">
            <div class="ts-mode-radio"><div class="ts-mode-radio-dot"></div></div>
            <div>
              <div class="ts-mode-title">Review &amp; edit <span class="ts-mode-badge">☑ Full tailoring</span></div>
              <div class="ts-mode-desc">Full tailoring — review &amp; edit every AI suggestion before downloading.</div>
            </div>
          </div>
          <div class="ts-mode-option" data-mode="quick">
            <div class="ts-mode-radio"><div class="ts-mode-radio-dot"></div></div>
            <div>
              <div class="ts-mode-title">Quick Download <span class="ts-mode-badge">⚡ Fastest</span></div>
              <div class="ts-mode-desc">Auto-apply every AI suggestion, then download with your saved defaults.</div>
            </div>
          </div>

          <button class="ts-picker-continue" id="ts-p-continue">Continue →</button>
          <button class="ts-picker-cancel" id="ts-p-cancel">Cancel</button>
        </div>`;
      this.shadow.appendChild(backdrop);

      backdrop.querySelector('#ts-p-resume').addEventListener('change', (e) => { resumeId = e.target.value; });
      backdrop.querySelectorAll('.ts-mode-option').forEach((opt) => {
        opt.addEventListener('click', () => {
          backdrop.querySelectorAll('.ts-mode-option').forEach((o) => o.classList.remove('selected'));
          opt.classList.add('selected');
          mode = opt.dataset.mode;
        });
      });
      backdrop.querySelector('#ts-p-cancel').addEventListener('click', () => {
        backdrop.remove();
        handlers.onCancel();
      });
      backdrop.querySelector('#ts-p-continue').addEventListener('click', () => {
        backdrop.remove();
        handlers.onContinue(resumeId, mode);
      });
    }

    renderError(message, onBack) {
      this.mount();
      this.root.innerHTML = `
        <div class="ts-overlay">
          <div class="ts-topbar"><button class="ts-back" id="ts-back">← Back</button><span class="ts-brand">Tailor resume</span><span></span></div>
          <div class="ts-loading" style="color:#dc2626;">${esc(message)}</div>
        </div>`;
      this.root.querySelector('#ts-back').addEventListener('click', onBack);
    }

    // `view` = { resume, diff, job, tailoringLevel, decisions, currentScore, projectedScore }
    // handlers = { onBack, onLevelChange, onToggle (id, accept), onApplyAll, onDownload, onResetChanges }
    render(view, handlers) {
      this.mount();
      const { resume, diff, tailoringLevel, currentScore, projectedScore, decisions } = view;
      const p = resume.personal || {};

      const levelBtns = ['low', 'medium', 'high'].map((lv) =>
        `<button class="ts-level-btn ${lv === tailoringLevel ? 'active' : ''}" data-level="${lv}">${lv[0].toUpperCase() + lv.slice(1)}</button>`
      ).join('');

      const summaryOldChanged = diff.summary.old.trim() !== diff.summary.new.trim();
      const sumAccepted = decisions.summary !== false;
      const summaryHtml = !summaryOldChanged ? `<div class="ts-plain">${esc(diff.summary.new)}</div>` : `
        <div class="ts-diff">
          ${sumAccepted ? `<div class="ts-diff-old">${esc(diff.summary.old)}</div>` : ''}
          <div class="ts-diff-row">
            <div class="ts-diff-new">${esc(sumAccepted ? diff.summary.new : diff.summary.old)}</div>
            <div class="ts-diff-actions">
              <button class="ts-act yes ${sumAccepted ? 'active' : ''}" data-kind="summary" data-value="true">✓</button>
              <button class="ts-act no ${!sumAccepted ? 'active' : ''}" data-kind="summary" data-value="false">✗</button>
            </div>
          </div>
        </div>`;

      const originalSkills = new Set((resume.skills || []).map((s) => s.toLowerCase()));
      const skillsHtml = diff.skills.map((s) => {
        const isNew = !originalSkills.has(s.toLowerCase());
        return `<span class="ts-skill-tag ${isNew ? 'added' : ''}">${esc(s)}</span>`;
      }).join('');

      const expHtml = diff.experience.map((role) => {
        const bulletsHtml = role.bullets.map((b, bi) => {
          const key = `exp:${role.index}:${bi}`;
          const accepted = decisions[key] !== false;
          if (b.action === 'keep') {
            return `<div class="ts-plain">${esc(b.new)}</div>`;
          }
          if (b.action === 'remove') {
            return accepted
              ? `<div class="ts-diff-old">${esc(b.old)}</div><div class="ts-removed-note">Suggested removal
                  <button class="ts-act no active" style="display:inline-flex;margin-left:6px;" data-kind="${key}" data-value="false">✗ keep</button></div>`
              : `<div class="ts-plain">${esc(b.old)} <button class="ts-act yes" style="display:inline-flex;margin-left:6px;" data-kind="${key}" data-value="true">✓ remove</button></div>`;
          }
          // modify / add
          return `<div class="ts-diff">
            ${accepted && b.old ? `<div class="ts-diff-old">${esc(b.old)}</div>` : ''}
            <div class="ts-diff-row">
              <div class="ts-diff-new ${b.action === 'add' ? 'added' : ''}">${esc(accepted ? b.new : (b.old || b.new))}</div>
              <div class="ts-diff-actions">
                <button class="ts-act yes ${accepted ? 'active' : ''}" data-kind="${key}" data-value="true">✓</button>
                <button class="ts-act no ${!accepted ? 'active' : ''}" data-kind="${key}" data-value="false">✗</button>
              </div>
            </div>
          </div>`;
        }).join('');
        return `
          <div class="ts-heading" style="margin-bottom:2px;">${esc(role.role)}</div>
          <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${esc(role.company)}</div>
          ${bulletsHtml}`;
      }).join('<div class="ts-hr"></div>');

      const totalChanges = this.countChanges(diff);
      const acceptedCount = this.countAccepted(diff, decisions);

      this.root.innerHTML = `
        <div class="ts-overlay">
          <div class="ts-topbar">
            <button class="ts-back" id="ts-back">← Back</button>
            <span class="ts-brand">Tailor resume</span>
            <div class="ts-score">
              <div class="ts-score-ring">${scoreRing(currentScore)}</div>
              <div class="ts-score-copy">MATCH SCORE<br/><b>${currentScore}</b> → ~${projectedScore} if you accept all</div>
            </div>
          </div>
          <div class="ts-controlbar">
            <span class="ts-level-label">Tailoring level</span>
            <div class="ts-level-group">${levelBtns}</div>
            <div class="ts-spacer"></div>
            <button class="ts-pill-btn" id="ts-reset">Reset changes</button>
            <button class="ts-pill-btn primary" id="ts-download">Download resume →</button>
          </div>
          <div class="ts-body">
            <div class="ts-sheet">
              <h1>${esc(p.name || 'Your Name')}</h1>
              <div class="ts-contact">${[p.email, p.phone, p.location, p.linkedin].filter(Boolean).map(esc).join(' | ')}</div>
              <hr class="ts-hr"/>
              <div class="ts-heading">Summary</div>
              ${summaryHtml}
              <div class="ts-heading">Skills</div>
              <div>${skillsHtml}</div>
              <div class="ts-heading">Experience</div>
              ${expHtml}
            </div>
          </div>
          <div class="ts-bottombar">
            <button class="ts-pill-btn primary" id="ts-apply-all">Apply all ${totalChanges} changes → ~${projectedScore}</button>
            <span style="font-size:12px;color:#6b7280;">${acceptedCount} of ${totalChanges} changes accepted</span>
            <div class="ts-spacer"></div>
            <button class="ts-pill-btn" id="ts-download-2">Download resume</button>
          </div>
        </div>`;

      this.root.querySelector('#ts-back').addEventListener('click', handlers.onBack);
      this.root.querySelector('#ts-reset').addEventListener('click', handlers.onResetChanges);
      this.root.querySelector('#ts-apply-all').addEventListener('click', handlers.onApplyAll);
      this.root.querySelector('#ts-download').addEventListener('click', handlers.onDownload);
      this.root.querySelector('#ts-download-2').addEventListener('click', handlers.onDownload);
      this.root.querySelectorAll('.ts-level-btn').forEach((btn) => {
        btn.addEventListener('click', () => handlers.onLevelChange(btn.dataset.level));
      });
      this.root.querySelectorAll('[data-kind]').forEach((btn) => {
        btn.addEventListener('click', () => handlers.onToggle(btn.dataset.kind, btn.dataset.value === 'true'));
      });
    }

    countChanges(diff) {
      let n = diff.summary.old.trim() !== diff.summary.new.trim() ? 1 : 0;
      diff.experience.forEach((r) => r.bullets.forEach((b) => { if (b.action !== 'keep') n++; }));
      return n;
    }
    countAccepted(diff, decisions) {
      let n = 0;
      if (diff.summary.old.trim() !== diff.summary.new.trim() && decisions.summary !== false) n++;
      diff.experience.forEach((r) => r.bullets.forEach((b, bi) => {
        if (b.action === 'keep') return;
        const key = `exp:${r.index}:${bi}`;
        if (decisions[key] !== false) n++;
      }));
      return n;
    }

    renderDownloadDrawer(view, handlers) {
      const backdrop = document.createElement('div');
      backdrop.className = 'ts-drawer-backdrop';
      backdrop.innerHTML = `
        <div class="ts-drawer">
          <h2>Download your resume</h2>
          <p class="sub">Choose a template and format for the tailored version.</p>
          <div class="ts-drawer-row">
            <div class="ts-drawer-field">
              <label>Template</label>
              <select id="ts-d-template">${TEMPLATES.map((t) => `<option>${t}</option>`).join('')}</select>
            </div>
          </div>
          <div class="ts-drawer-field" style="margin-bottom:16px;">
            <label>Accent color</label>
            <div class="ts-swatches">${ACCENTS.map((c, i) => `<span class="ts-swatch ${i === 1 ? 'selected' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div>
          </div>
          <div class="ts-drawer-row">
            <div class="ts-drawer-field">
              <label>Format</label>
              <div class="ts-format-group">
                <button class="ts-format-btn active" data-format="pdf">PDF</button>
                <button class="ts-format-btn" data-format="docx">DOCX</button>
              </div>
            </div>
          </div>
          <button class="ts-drawer-download" id="ts-d-go">↓ Download PDF</button>
          <button class="ts-drawer-cancel" id="ts-d-cancel">Cancel</button>
        </div>`;
      this.root.appendChild(backdrop);

      let format = 'pdf';
      let accent = ACCENTS[1];
      let template = TEMPLATES[0];

      backdrop.querySelectorAll('.ts-swatch').forEach((sw) => {
        sw.addEventListener('click', () => {
          backdrop.querySelectorAll('.ts-swatch').forEach((s) => s.classList.remove('selected'));
          sw.classList.add('selected');
          accent = sw.dataset.color;
        });
      });
      backdrop.querySelectorAll('.ts-format-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          backdrop.querySelectorAll('.ts-format-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          format = btn.dataset.format;
          backdrop.querySelector('#ts-d-go').textContent = format === 'pdf' ? '↓ Download PDF' : '↓ Download DOCX';
        });
      });
      backdrop.querySelector('#ts-d-template').addEventListener('change', (e) => { template = e.target.value; });
      backdrop.querySelector('#ts-d-cancel').addEventListener('click', () => backdrop.remove());
      backdrop.querySelector('#ts-d-go').addEventListener('click', () => {
        handlers.onConfirmDownload({ format, accent, template });
        backdrop.remove();
      });
    }
  }

  global.JobTrailTailorStudio = { TailorStudio };
})(typeof window !== 'undefined' ? window : globalThis);
