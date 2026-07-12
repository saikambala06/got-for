(function () {
  const TEMPLATES = ['Classic', 'Harvard', "Jake's", 'Modern', 'Minimal'];
  const ACCENTS = ['#2563eb', '#16a34a', '#0ea5a4', '#dc2626', '#ec4899', '#d946ef', '#ea580c', '#f59e0b', '#0f172a', '#7c3aed'];
  const TEXT_COLORS = ['#1a1d29', '#000000'];

  const state = {
    ctx: null,
    resumes: [],
    resumeId: null,
    tailoringLevel: 'high',
    template: TEMPLATES[0],
    accent: ACCENTS[1],
    textColor: TEXT_COLORS[0],
    format: 'pdf',
    noMetrics: true,
    diff: null,
    resume: null
  };

  function applyAllDecisions(diff) {
    const decisions = { summary: true };
    diff.experience.forEach((r) => r.bullets.forEach((b, bi) => { decisions[`exp:${r.index}:${bi}`] = true; }));
    return decisions;
  }

  function projectedResume(resume, diff) {
    const decisions = applyAllDecisions(diff);
    const summary = decisions.summary !== false ? diff.summary.new : diff.summary.old;
    const skills = diff.skills;
    const experience = diff.experience.map((role, ri) => {
      const original = resume.experience[ri];
      const lines = [];
      role.bullets.forEach((b, bi) => {
        const key = `exp:${role.index}:${bi}`;
        const accepted = decisions[key] !== false;
        if (b.action === 'remove') { if (!accepted) lines.push(b.old); return; }
        if (b.action === 'keep') { lines.push(b.new); return; }
        lines.push(accepted ? b.new : (b.old || b.new));
      });
      return { ...original, description: lines.join('\n') };
    });
    return { ...resume, summary, skills, experience };
  }

  function resumeToHtml(resume, opts) {
    const p = resume.personal || {};
    const accent = opts.accent || '#16a34a';
    const contact = [p.email, p.phone, p.location, p.linkedin].filter(Boolean).map(esc).join(' &nbsp;|&nbsp; ');
    const skillsHtml = (resume.skills || []).map((s) => esc(s)).join(', ');
    const expHtml = (resume.experience || []).map((e) => `
      <div style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;font-weight:700;">
          <span>${esc(e.role || '')}</span><span>${esc(e.dates || '')}</span>
        </div>
        <div style="font-style:italic;color:#444;margin-bottom:4px;">${esc(e.company || '')}</div>
        <ul style="margin:0;padding-left:18px;">
          ${(e.description || '').split('\n').filter(Boolean).map((l) => `<li>${esc(l.replace(/^[-•*]\s*/, ''))}</li>`).join('')}
        </ul>
      </div>`).join('');
    const eduHtml = (resume.education || []).map((ed) => `
      <div style="margin-bottom:8px;"><strong>${esc(ed.school || '')}</strong> — ${esc(ed.degree || '')} ${esc(ed.field || '')}</div>`).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(p.name || 'Resume')}</title>
      <style>
        body{ font-family: Georgia, 'Times New Roman', serif; color:${opts.textColor || '#111'}; padding:40px; max-width:760px; margin:0 auto; }
        h1{ text-align:center; margin-bottom:2px; }
        .contact{ text-align:center; font-size:12px; color:#555; margin-bottom:18px; }
        h2{ font-size:13px; text-transform:uppercase; letter-spacing:0.05em; border-bottom:2px solid ${accent}; padding-bottom:3px; margin-top:22px; }
        @media print { body{ padding:0; } }
      </style></head><body>
      <h1>${esc(p.name || '')}</h1>
      <div class="contact">${contact}</div>
      <h2>Summary</h2><p>${esc(resume.summary || '')}</p>
      <h2>Skills</h2><p>${skillsHtml}</p>
      <h2>Experience</h2>${expHtml}
      <h2>Education</h2>${eduHtml}
      </body></html>`;
  }

  function downloadTailoredResume(resume, opts) {
    const html = resumeToHtml(resume, opts);
    if (opts.format === 'docx') {
      // `html` is already a full document (own <html>/<head>/<body>);
      // wrapping it again in <html ...> creates nested roots + a
      // misplaced DOCTYPE that breaks Word's parser (cut off/empty .doc).
      const wrapped = html.replace(
        '<html>',
        `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>`
      );
      const blob = new Blob(['\ufeff', wrapped], { type: 'application/msword' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(resume.personal?.name || 'resume').replace(/\s+/g, '_')}.doc`;
      a.click();
      URL.revokeObjectURL(a.href);
    } else {
      const win = window.open('', '_blank');
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 300);
    }
  }

  async function fetchDiff() {
    renderLoadingInto('main-body', 'Matching it against your resume…');
    try {
      const result = await send('resumes:tailor', {
        resumeId: state.resumeId,
        jobTitle: state.ctx.session.job.title,
        jobDescription: state.ctx.session.job.description,
        emphasizeSkills: [],
        tailoringLevel: state.tailoringLevel
      });
      state.diff = result;
      state.resume = state.resumes.find((r) => r._id === state.resumeId);
      renderPage();
    } catch (err) {
      document.getElementById('main-body').innerHTML = `<div class="err-box">Tailoring failed: ${esc(err.message)}</div>`;
    }
  }

  function renderPreview(proj) {
    const p = proj.personal || {};
    const expHtml = (proj.experience || []).map((e) => `
      <div style="margin-bottom:12px;">
        <div class="qd-role-row"><span>${esc(e.role || '')}</span><span>${esc(e.dates || '')}</span></div>
        <div class="qd-company">${esc(e.company || '')}</div>
        <ul>${(e.description || '').split('\n').filter(Boolean).map((l) => `<li>${esc(l.replace(/^[-•*]\s*/, ''))}</li>`).join('')}</ul>
      </div>`).join('');

    return `
      <div class="qd-panel" style="--qd-accent:${state.accent}">
        <div class="qd-panel-head"><span>Live Preview</span><span class="qd-badge">Auto-Tailored</span></div>
        <div class="qd-sheet" style="color:${state.textColor}">
          <h1>${esc(p.name || 'Your Name')}</h1>
          <div class="qd-role">${esc(proj.experience?.[0]?.role || '')}</div>
          <div class="qd-contact">${[p.email, p.location].filter(Boolean).map(esc).join(' · ')}</div>
          <hr />
          <h2>Experience</h2>
          ${expHtml}
          <h2>Skills</h2>
          <p>${(proj.skills || []).map(esc).join(', ')}</p>
          <h2>Education</h2>
          ${(proj.education || []).map((ed) => `<p><strong>${esc(ed.school || '')}</strong> — ${esc(ed.degree || '')} ${esc(ed.field || '')}</p>`).join('')}
        </div>
      </div>`;
  }

  function renderCustomizer() {
    const formatBtns = ['pdf', 'docx'].map((f) =>
      `<button class="qd-format-btn ${state.format === f ? 'active' : ''}" data-format="${f}">${f.toUpperCase()}</button>`).join('');
    const levelBtns = [['low', 'Low'], ['medium', 'Med'], ['high', 'High']].map(([lv, label]) =>
      `<button class="qd-level-btn ${state.tailoringLevel === lv ? 'active' : ''}" data-level="${lv}">${label}</button>`).join('');
    const textSwatches = TEXT_COLORS.map((c) =>
      `<div class="qd-swatch ${state.textColor === c ? 'selected' : ''}" data-textcolor="${c}" style="background:${c}"></div>`).join('');
    const accentSwatches = ACCENTS.map((c) =>
      `<div class="qd-swatch ${state.accent === c ? 'selected' : ''}" data-accent="${c}" style="background:${c}"></div>`).join('');

    return `
      <div class="qd-panel qd-cust">
        <div class="qd-cust-body">
          <div class="qd-panel-head" style="padding:0;border:none;margin-bottom:8px;"><span class="qd-badge">Quick Download</span></div>
          <h1>Customizations</h1>
          <p class="sub">Saved defaults applied to every quick download.</p>

          <div class="qd-row">
            <div class="qd-field">
              <label>Resume</label>
              <select id="qd-resume">
                ${state.resumes.map((r) => `<option value="${r._id}" ${r._id === state.resumeId ? 'selected' : ''}>${esc(r.name || 'Untitled resume')}</option>`).join('')}
              </select>
            </div>
            <div class="qd-field">
              <label>Template</label>
              <select id="qd-template">${TEMPLATES.map((t) => `<option ${t === state.template ? 'selected' : ''}>${t}</option>`).join('')}</select>
            </div>
          </div>

          <div class="qd-field" style="margin-bottom:18px;">
            <label>Text color</label>
            <div class="qd-swatches">${textSwatches}</div>
          </div>

          <div class="qd-field" style="margin-bottom:18px;">
            <label>Accent color <span style="font-weight:400;color:var(--text-faint);">headings &amp; rules</span></label>
            <div class="qd-swatches">${accentSwatches}</div>
          </div>

          <div class="qd-row">
            <div class="qd-field">
              <label>Format</label>
              <div class="qd-format-group">${formatBtns}</div>
            </div>
            <div class="qd-field">
              <label>Tailoring level</label>
              <div class="qd-level-group">${levelBtns}</div>
            </div>
          </div>

          <div class="qd-toggle-row">
            <div>
              <div class="t-title">No metrics</div>
              <div class="t-desc">When toggled off, AI adds numbers (like "20%" or "500 users") to the bullet points. Toggle on to keep bullet points number-free.</div>
            </div>
            <div class="qd-switch ${state.noMetrics ? 'on' : ''}" id="qd-nometrics"><div class="knob"></div></div>
          </div>

          <button class="qd-download-btn" id="qd-download">↓ Download ${state.format.toUpperCase()}</button>
          <div class="qd-note">🦉 Every quick download uses these settings. Change them anytime — we'll remember.</div>
        </div>
      </div>`;
  }

  function renderPage() {
    const proj = projectedResume(state.resume, state.diff);
    document.getElementById('main-body').innerHTML = `
      <div class="qd-body">${renderPreview(proj)}${renderCustomizer()}</div>`;
    wireEvents(proj);
  }

  function wireEvents(proj) {
    document.getElementById('qd-resume').addEventListener('change', (e) => {
      state.resumeId = e.target.value;
      state.ctx.session.selectedResumeId = state.resumeId;
      saveSession(state.ctx.key, state.ctx.session);
      fetchDiff();
    });
    document.getElementById('qd-template').addEventListener('change', (e) => { state.template = e.target.value; });
    document.querySelectorAll('[data-textcolor]').forEach((el) => {
      el.addEventListener('click', () => { state.textColor = el.dataset.textcolor; renderPage(); });
    });
    document.querySelectorAll('[data-accent]').forEach((el) => {
      el.addEventListener('click', () => { state.accent = el.dataset.accent; renderPage(); });
    });
    document.querySelectorAll('[data-format]').forEach((el) => {
      el.addEventListener('click', () => { state.format = el.dataset.format; renderPage(); });
    });
    document.querySelectorAll('[data-level]').forEach((el) => {
      el.addEventListener('click', () => {
        const lv = el.dataset.level;
        if (lv === state.tailoringLevel) return;
        state.tailoringLevel = lv;
        fetchDiff();
      });
    });
    document.getElementById('qd-nometrics').addEventListener('click', () => { state.noMetrics = !state.noMetrics; renderPage(); });
    document.getElementById('qd-download').addEventListener('click', () => {
      const btn = document.getElementById('qd-download');
      btn.disabled = true;
      btn.textContent = 'Preparing…';
      try {
        downloadTailoredResume(proj, { format: state.format, accent: state.accent, textColor: state.textColor, template: state.template });
      } finally {
        setTimeout(() => { btn.disabled = false; btn.textContent = `↓ Download ${state.format.toUpperCase()}`; }, 500);
      }
    });
  }

  async function init() {
    renderShell({ active: 'resumes', title: 'Quick Download', bodyHtml: '' });
    renderLoadingInto('main-body', 'Loading your resume…');
    let ctx;
    try {
      ctx = await loadSession();
    } catch (err) {
      document.getElementById('main-body').innerHTML = `<div class="err-box">${esc(err.message)}</div>`;
      return;
    }
    state.ctx = ctx;
    state.resumes = ctx.session.resumes || [];
    state.resumeId = ctx.session.selectedResumeId || state.resumes[0]?._id;
    fetchDiff();
  }

  init();
})();
