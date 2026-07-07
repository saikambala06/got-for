// JobTrail Assistant — side panel UI
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
      display: flex; flex-direction: column; overflow: hidden;
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

  // Precise skill-name comparison used to decide whether a job-required
  // skill is already on the resume. A naive `.includes()` substring check
  // wrongly matches "Go" inside "Google Cloud Platform", or "R" inside
  // almost any multi-letter skill — so short tokens (< 4 chars, e.g. R, Go,
  // AWS, SQL) require an exact, whole-word match; longer multi-word skills
  // still allow one to contain the other as a whole word/phrase.
  function normSkill(s) {
    return String(s || '').toLowerCase().trim().replace(/[.\-_/]/g, ' ').replace(/\s+/g, ' ');
  }

  function skillsMatch(a, b) {
    const na = normSkill(a);
    const nb = normSkill(b);
    if (!na || !nb) return false;
    if (na === nb) return true;

    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length <= nb.length ? nb : na;

    // Very short tokens (R, Go, AWS, SQL, C#, ...) must match exactly —
    // never as a substring of something longer.
    if (shorter.length < 4) return false;

    const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`);
    return re.test(longer);
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  class JobTrailPanel {
    constructor() {
      this.host = document.createElement('div');
      this.host.id = 'jobtrail-assistant-host';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLES;
      this.shadow.appendChild(style);
      (document.documentElement || document.body).appendChild(this.host);

      this.launcher = document.createElement('button');
      this.launcher.className = 'jt-launcher';
      this.launcher.textContent = 'JOBTRAIL';
      this.launcher.addEventListener('click', () => this.open());
      this.shadow.appendChild(this.launcher);

      this.panel = document.createElement('div');
      this.panel.className = 'jt-panel';
      this.panel.style.display = 'none';
      this.shadow.appendChild(this.panel);

      this.isOpen = false;
    }

    open() { this.isOpen = true; this.panel.style.display = 'flex'; this.launcher.style.display = 'none'; }
    close() { this.isOpen = false; this.panel.style.display = 'none'; this.launcher.style.display = 'block'; }
    toggle() { this.isOpen ? this.close() : this.open(); }

    setBody(html) {
      this.panel.innerHTML = `
        <div class="jt-header">
          <div class="jt-brand"><span class="dot"></span> JobTrail Assistant</div>
          <button class="jt-close" title="Close">✕</button>
        </div>
        <div class="jt-body">${html}</div>
      `;
      this.panel.querySelector('.jt-close').addEventListener('click', () => this.close());
    }

    renderLoading(message) {
      this.setBody(`<div class="jt-loading"><span class="jt-spinner" style="border-top-color:#ff9a4d"></span>${esc(message || 'Loading…')}</div>`);
    }

    renderError(message, retryFn) {
      this.setBody(`
        <div class="jt-error">${esc(message)}</div>
        ${retryFn ? '<div style="text-align:center"><button class="jt-btn small" id="jt-retry">Try again</button></div>' : ''}
      `);
      if (retryFn) this.panel.querySelector('#jt-retry').addEventListener('click', retryFn);
    }

    // Renders the parsed-job card. `state` carries everything the footer
    // button handlers need (job data, resumes, selected resume, callbacks).
    renderJob(state) {
      const { job, resumes, selectedResumeId, extraSkillsChecked } = state;
      const resume = resumes.find((r) => r._id === selectedResumeId) || resumes[0];
      const resumeSkills = resume?.skills || [];

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
      const added = new Set((result.addedSkills || []).map((s) => s.toLowerCase()));
      const skillsTitle = added.size ? `Updated skills (${added.size} new)` : 'Updated skills';
      slot.innerHTML = `
        <div class="jt-section">
          <div class="jt-section-title">Tailored summary</div>
          <div class="jt-tailor-summary">${esc(result.summary || '')}</div>
          <div class="jt-section-title">${esc(skillsTitle)}</div>
          <div class="jt-chips">${(result.skills || []).map((s) => {
            const isNew = added.has(s.toLowerCase());
            return `<span class="jt-chip matched">${esc(s)}${isNew ? '<span class="jt-tag-new">NEW</span>' : ''}</span>`;
          }).join('')}</div>
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

    renderManualForm(job, onSave) {
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

  global.JobTrailPanelUI = { JobTrailPanel };
})(typeof window !== 'undefined' ? window : globalThis);
