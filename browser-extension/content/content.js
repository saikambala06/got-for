// SKVK Assistant — content script
// Orchestrates: parse the page -> load resumes -> render the panel -> wire
// up Enter Manually / Mark as Applied / Tailor Resume / Cover Letter.

(function () {
  if (window.__skvkAssistantLoaded) return;
  window.__skvkAssistantLoaded = true;

  const { parseJobFromPage } = window.SKVKParser;
  const { SKVKPanel } = window.SKVKPanelUI;
  const { TailorStudio } = window.SKVKTailorStudio;
  const { cleanSkill, skillsMatch } = window.SKVKSkillsData;

  const panel = new SKVKPanel();
  const studio = new TailorStudio();

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const state = {
    job: null,
    manualOverrides: {},
    resumes: [],
    selectedResumeId: null,
    extraSkillsChecked: new Set(),
    applied: false
  };

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

  function currentJob() {
    return { ...state.job, ...state.manualOverrides };
  }

  function handleDashboard() {
    send('tabs:openDashboard').catch(() => {});
  }

  async function handleLogin(email, password, onError) {
    try {
      const { user } = await send('auth:login', { email, password });
      panel.setProfile(user, handleLogout, handleDashboard);
      loadAndRender();
    } catch (err) {
      onError(err.message || 'Login failed');
    }
  }

  async function handleLogout() {
    await send('auth:logout').catch(() => {});
    panel.setProfile(null, handleLogout, handleDashboard);
    panel.renderLoginForm(handleLogin);
    state.job = null;
  }

  // Bumped every time loadAndRender() starts. Each running call captures the
  // token it started with and checks it again after every await — if a
  // newer call has started in the meantime (user reloaded, clicked "Yes, I
  // applied", or the SPA navigated to a different posting before the first
  // call's network requests finished), the stale call stops immediately
  // instead of writing its (now out-of-date) resumes/AI-analysis data into
  // state.job. Without this guard, a slow response for job A landing after
  // job B has already started loading would silently splice job A's
  // skills/highlights/qualifications onto job B's card — the "merged data"
  // bug where a posting shows a blend of two different jobs' details.
  let loadToken = 0;

  async function loadAndRender() {
    const myToken = ++loadToken;
    panel.renderLoading('Reading this job posting…');
    const parsed = parseJobFromPage();
    if (myToken !== loadToken) return;
    if (!parsed) {
      panel.renderError("This doesn't look like a job posting page.", () => window.location.reload(), 'Refresh');
      return;
    }
    state.job = parsed;
    state.manualOverrides = {};
    state.extraSkillsChecked = new Set();
    state.applied = false;

    const authState = await send('auth:getState').catch(() => ({ loggedIn: false }));
    if (myToken !== loadToken) return;
    panel.setProfile(authState.loggedIn ? authState.user : null, handleLogout, handleDashboard);
    if (!authState.loggedIn) {
      panel.renderLoginForm(handleLogin);
      return;
    }

    // Log the view once we know this is a real job posting being shown to a
    // logged-in user — fire-and-forget so a slow/failed network call never
    // blocks or breaks rendering of the panel itself.
    send('jobs:trackView', {
      title: state.job.title,
      company: state.job.company,
      jobUrl: window.location.href
    }).catch(() => {});

    try {
      state.resumes = await send('resumes:list');
    } catch (err) {
      if (myToken !== loadToken) return;
      panel.renderError(`Could not load your resumes: ${err.message}`);
      return;
    }
    if (myToken !== loadToken) return;

    if (!state.resumes.length) {
      panel.renderError('You don\u2019t have any resumes in SKVK yet. Create one in the dashboard, then reload this panel.');
      return;
    }

    state.selectedResumeId = state.resumes.find((r) => r.isDefault)?._id || state.resumes[0]._id;

    // The on-page regex extraction (skillsFound / qualificationPhrases /
    // highlights) is a fast baseline that works with no network call, but
    // it's brittle: it only fires off literal section headings and a fixed
    // skills taxonomy, so postings with unusual formatting or phrasing come
    // back mostly empty. Enhance it with an AI read of the same description
    // text, which understands paraphrased requirements and non-standard
    // section titles. If the AI call fails (no API key configured, network
    // issue, etc.) we silently keep the regex baseline already computed —
    // the panel still works, just with a coarser read of the posting.
    panel.renderLoading('Analyzing job requirements with AI…');
    try {
      const jobForAnalysis = state.job;
      const analysis = await send('job:analyze', {
        jobTitle: jobForAnalysis.title,
        company: jobForAnalysis.company,
        jobDescription: jobForAnalysis.description
      });
      // A newer load may have replaced state.job while this request was in
      // flight. Only apply the result if it still belongs to the job that's
      // actually on screen right now.
      if (myToken !== loadToken || state.job !== jobForAnalysis) return;
      if (analysis) {
        if (analysis.skills?.length) state.job.skillsFound = analysis.skills;
        if (analysis.qualifications?.length) state.job.qualificationPhrases = analysis.qualifications;
        if (analysis.highlights?.length) state.job.highlights = analysis.highlights;
        if (analysis.experience?.years || analysis.experience?.seniority) {
          state.job.experience = {
            years: analysis.experience.years || state.job.experience?.years || '',
            seniority: analysis.experience.seniority || state.job.experience?.seniority || ''
          };
        }
      }
    } catch (_) {
      // Keep the regex-based baseline already on state.job.
      if (myToken !== loadToken) return;
    }

    if (myToken !== loadToken) return;
    renderCard();
  }

  // "Reload job details" always asks first whether the user already
  // applied, so applied-state doesn't silently get lost on a re-parse.
  // "No, not yet" simply dismisses the popup — it does not reload/re-parse
  // the panel. Only "Yes, I applied" (mark + reload) triggers a reload.
  function confirmReload() {
    panel.showReloadConfirm({
      onYes: async () => { await markApplied(); loadAndRender(); }
    });
  }

  function renderCard() {
    panel.renderJob({
      job: currentJob(),
      resumes: state.resumes,
      selectedResumeId: state.selectedResumeId,
      extraSkillsChecked: state.extraSkillsChecked
    });
    wireCardEvents();
    panel.renderFooter({
      onManual: openManualForm,
      onMarkApplied: markApplied,
      onTailor: tailorResume,
      onCoverLetter: draftCoverLetter,
      onReload: confirmReload,
      applied: state.applied
    });
  }

  function wireCardEvents() {
    const select = panel.panel.querySelector('#jt-resume-select');
    if (select) {
      select.addEventListener('change', (e) => {
        state.selectedResumeId = e.target.value;
        renderCard();
      });
    }
    panel.panel.querySelectorAll('.jt-chip.selectable').forEach((chip) => {
      chip.addEventListener('click', () => {
        const skill = chip.dataset.skill;
        if (state.extraSkillsChecked.has(skill)) state.extraSkillsChecked.delete(skill);
        else state.extraSkillsChecked.add(skill);
        renderCard();
      });
    });
  }

  function openManualForm() {
    panel.renderManualForm(currentJob(), (values) => {
      if (values) {
        state.manualOverrides = { ...state.manualOverrides, ...values };
      }
      renderCard();
    });
  }

  async function markApplied() {
    panel.setButtonBusy('jt-applied', 'Saving…');
    const job = currentJob();
    try {
      await send('jobs:create', {
        title: job.title,
        company: job.company || 'Unknown',
        location: job.location,
        salary: job.salary,
        status: 'Applied',
        source: 'SKVK Assistant',
        jobUrl: job.url,
        skills: job.skillsFound
      });
      state.applied = true;
      renderCard();
    } catch (err) {
      panel.resetButton('jt-applied');
      alert(`Could not save this application: ${err.message}`);
    }
  }

  // ─── Tailor Studio (full review flow) ───────────────────────────────────
  const studioState = { diff: null, tailoringLevel: 'high', decisions: {}, resume: null, mode: 'review' };

  // Persisted across quick-download sessions on this tab (mirrors "we'll
  // remember" copy in the UI). A real deployment would save these to the
  // user's account instead.
  const quickDownloadOpts = {
    template: 'Classic',
    textColor: '#0f172a',
    accent: '#16a34a',
    format: 'pdf',
    tailoringLevel: 'high',
    noMetrics: false
  };

  function matchScoreFor(skillsList, job) {
    const total = job.skillsFound?.length || 0;
    if (!total) return 0;
    const clean = (skillsList || []).map((s) => cleanSkill(s));
    const matched = job.skillsFound.filter((s) => clean.some((rs) => skillsMatch(s, rs)));
    return Math.round((matched.length / total) * 100);
  }

  // Builds the skills/summary/experience the person would end up with if
  // they accepted exactly the changes currently marked "accepted".
  function projectedResume() {
    const { diff, decisions, resume } = studioState;
    const summary = decisions.summary !== false ? diff.summary.new : diff.summary.old;
    const skills = diff.skills; // AI already returns the full merged/reordered list
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

  // "Tailor resume" opens the picker first — "Tailor your resume" — where the
  // person picks a resume and a mode (Review & edit vs Quick Download).
  // Picking "Review & edit" and continuing lands on the full AI review studio.
  function openTailorPicker() {
    studio.renderPicker(
      { resumes: state.resumes, selectedResumeId: state.selectedResumeId },
      {
        onCancel: () => studio.unmount(),
        onContinue: (resumeId, mode) => {
          state.selectedResumeId = resumeId;
          studioState.mode = mode;
          openStudio();
        }
      }
    );
  }

  function openStudio() {
    const job = currentJob();
    studio.renderLoading('Matching it against your resume…');
    fetchTailorDiff(job);
  }

  async function fetchTailorDiff(job) {
    try {
      const resume = state.resumes.find((r) => r._id === state.selectedResumeId);
      studioState.resume = resume;
      const result = await send('resumes:tailor', {
        resumeId: state.selectedResumeId,
        jobTitle: job.title,
        jobDescription: job.description,
        emphasizeSkills: Array.from(state.extraSkillsChecked),
        tailoringLevel: studioState.tailoringLevel
      });
      studioState.diff = result;
      studioState.decisions = {};
      // Auto-apply every AI suggestion — Quick Download skips the manual
      // accept/reject review and always starts from the fully-tailored draft.
      studioState.decisions = { summary: true };
      studioState.diff.experience.forEach((r) => r.bullets.forEach((b, bi) => {
        studioState.decisions[`exp:${r.index}:${bi}`] = true;
      }));
      if (studioState.mode === 'quick') {
        quickDownloadOpts.tailoringLevel = studioState.tailoringLevel;
        renderQuickDownloadScreen(job);
        return;
      }
      renderStudio(job);
    } catch (err) {
      studio.renderError(`Tailoring failed: ${err.message}`, () => { studio.unmount(); });
    }
  }

  function renderStudio(job) {
    const proj = projectedResume();
    const currentScore = matchScoreFor(studioState.resume.skills, job);
    const projectedScore = matchScoreFor(proj.skills, job);
    studio.render(
      {
        resume: studioState.resume,
        diff: studioState.diff,
        tailoringLevel: studioState.tailoringLevel,
        decisions: studioState.decisions,
        currentScore,
        projectedScore
      },
      {
        onBack: () => studio.unmount(),
        onLevelChange: (lv) => {
          if (lv === studioState.tailoringLevel) return;
          studioState.tailoringLevel = lv;
          studio.renderLoading('Re-tailoring at ' + lv + ' intensity…');
          fetchTailorDiff(job);
        },
        onToggle: (key, accept) => {
          studioState.decisions[key] = accept;
          renderStudio(job);
        },
        onApplyAll: () => {
          studioState.decisions = { summary: true };
          studioState.diff.experience.forEach((r) => r.bullets.forEach((b, bi) => {
            studioState.decisions[`exp:${r.index}:${bi}`] = true;
          }));
          renderStudio(job);
        },
        onResetChanges: () => {
          studioState.decisions = {};
          renderStudio(job);
        },
        onDownload: () => {
          studio.renderDownloadDrawer({}, {
            onConfirmDownload: (opts, btn) => downloadTailoredResume(proj, opts, btn)
          });
        }
      }
    );
  }

  // ─── Quick Download (dark theme, live preview, editable) ────────────────

  function renderQuickDownloadScreen(job) {
    const proj = projectedResume();
    studio.renderQuickDownload(
      {
        resumes: state.resumes,
        selectedResumeId: state.selectedResumeId,
        previewHtml: resumeToHtml(proj, quickDownloadOpts),
        opts: quickDownloadOpts,
        planUsage: null
      },
      {
        onBack: () => studio.unmount(),
        // Template / colors / format / no-metrics: no re-tailoring needed,
        // just re-render the preview instantly with the new opts.
        onChange: (nextOpts) => {
          Object.assign(quickDownloadOpts, nextOpts);
          renderQuickDownloadScreen(job);
        },
        // Tailoring level changes the actual AI content, so re-run the tailor
        // call, then land back on this same screen once it resolves.
        onLevelChange: (lv) => {
          if (lv === studioState.tailoringLevel) return;
          studioState.tailoringLevel = lv;
          quickDownloadOpts.tailoringLevel = lv;
          studio.renderLoading('Re-tailoring at ' + lv + ' intensity…');
          fetchTailorDiff(job);
        },
        // Switching resumes re-fetches the diff against the new resume.
        onResumeChange: (resumeId) => {
          state.selectedResumeId = resumeId;
          studio.renderLoading('Matching it against your resume…');
          fetchTailorDiff(job);
        },
        onDownload: (opts, btn) => downloadTailoredResume(projectedResume(), opts, btn)
      }
    );
  }

  function tailorResume() {
    const job = currentJob();
    send('tabs:openTailor', {
      resumeId: state.selectedResumeId,
      jobTitle: job.title,
      company: job.company,
      jobDescription: job.description
    }).catch((err) => alert(`Could not open Tailor Resume: ${err.message}`));
  }

  // ─── Resume export (client-side, no server dependency) ─────────────────

  // Removes injected numbers/percentages/dollar amounts from bullet text
  // (used by the "No metrics" toggle). Heuristic, client-side, no AI call —
  // safe to run on every keystroke of the live preview.
  function stripMetrics(text) {
    return String(text || '')
      .replace(/\$[\d,]+(\.\d+)?\s*[kKmMbB]?\+?/g, '')
      .replace(/\b\d[\d,]*(\.\d+)?\s*%/g, '')
      .replace(/\b\d[\d,]*(\.\d+)?\s*(x|X)\b/g, '')
      .replace(/\b\d[\d,]*(\.\d+)?\+?\s*(users?|customers?|clients?|engineers?|members?|teams?|hours?|days?|weeks?|months?|years?|projects?|releases?|deployments?|servers?|nodes?|requests?|incidents?|tickets?)\b/gi, '$1')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;])/g, '$1')
      .replace(/\(\s*\)/g, '')
      .trim();
  }

  // Per-template look: font stack, heading treatment, and whether the accent
  // color is used as a rule under headings or as heading text color.
  const TEMPLATE_STYLES = {
    'Classic': { font: "Georgia, 'Times New Roman', serif", headingMode: 'rule', headingCase: 'uppercase', nameCase: 'none' },
    'Harvard': { font: "'Times New Roman', Times, serif", headingMode: 'rule-bold', headingCase: 'uppercase', nameCase: 'none' },
    "Jake's": { font: "Calibri, Arial, sans-serif", headingMode: 'rule-thin', headingCase: 'uppercase', nameCase: 'none' },
    'Modern': { font: "'Segoe UI', Arial, sans-serif", headingMode: 'color', headingCase: 'none', nameCase: 'none' },
    'Minimal': { font: "Helvetica, Arial, sans-serif", headingMode: 'plain', headingCase: 'uppercase', nameCase: 'none' }
  };

  function resumeToHtml(resume, opts) {
    const p = resume.personal || {};
    const accent = opts.accent || '#16a34a';
    const textColor = opts.textColor || '#0f172a';
    const noMetrics = !!opts.noMetrics;
    const tpl = TEMPLATE_STYLES[opts.template] || TEMPLATE_STYLES.Classic;
    const clean = (s) => esc(noMetrics ? stripMetrics(s) : s);

    const headingCss = {
      rule: `border-bottom:2px solid ${accent}; padding-bottom:3px;`,
      'rule-bold': `border-bottom:3px double ${accent}; padding-bottom:4px; font-weight:800;`,
      'rule-thin': `border-bottom:1px solid ${accent}; padding-bottom:2px;`,
      color: `color:${accent};`,
      plain: `color:${textColor}; opacity:0.75;`
    }[tpl.headingMode];

    const contact = [p.email, p.phone, p.location, p.linkedin].filter(Boolean).map(esc).join(' &nbsp;|&nbsp; ');
    const skillsHtml = (resume.skills || []).map((s) => esc(s)).join(', ');
    const expHtml = (resume.experience || []).map((e) => `
      <div style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;font-weight:700;">
          <span>${esc(e.role || '')}</span><span>${esc(e.dates || '')}</span>
        </div>
        <div style="font-style:italic;color:#444;margin-bottom:4px;">${esc(e.company || '')}</div>
        <ul style="margin:0;padding-left:18px;">
          ${(e.description || '').split('\n').filter(Boolean).map((l) => `<li>${clean(l.replace(/^[-•*]\s*/, ''))}</li>`).join('')}
        </ul>
      </div>`).join('');
    const eduHtml = (resume.education || []).map((ed) => `
      <div style="margin-bottom:8px;"><strong>${esc(ed.school || '')}</strong> — ${esc(ed.degree || '')} ${esc(ed.field || '')}</div>`).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(p.name || 'Resume')}</title>
      <style>
        body{ font-family: ${tpl.font}; color:${textColor}; padding:40px; max-width:760px; margin:0 auto; }
        h1{ text-align:center; margin-bottom:2px; text-transform:${tpl.nameCase}; }
        .contact{ text-align:center; font-size:12px; color:#555; margin-bottom:18px; }
        h2{ font-size:13px; text-transform:${tpl.headingCase}; letter-spacing:0.05em; ${headingCss} margin-top:22px; }
        @media print { body{ padding:0; } }
      </style></head><body>
      <h1>${esc(p.name || '')}</h1>
      <div class="contact">${contact}</div>
      <h2>Summary</h2><p>${clean(resume.summary || '')}</p>
      <h2>Skills</h2><p>${skillsHtml}</p>
      <h2>Experience</h2>${expHtml}
      <h2>Education</h2>${eduHtml}
      </body></html>`;
  }

  // Lazily loads html2pdf.js (html2canvas + jsPDF) into the *host page*,
  // same technique used by public/tailor.html. Cached on window so repeated
  // downloads don't re-fetch it.
  let _html2pdfLoading = null;
  function loadHtml2Pdf() {
    if (window.html2pdf) return Promise.resolve();
    if (_html2pdfLoading) return _html2pdfLoading;
    _html2pdfLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      s.onload = resolve;
      s.onerror = () => { _html2pdfLoading = null; reject(new Error('Could not load PDF generator')); };
      document.head.appendChild(s);
    });
    return _html2pdfLoading;
  }

  // Renders the resume HTML off-screen and saves it as an actual PDF file.
  // Replaces the old window.open()+print() flow, which produced blank PDFs
  // whenever the popup was blocked or print() fired before the new window
  // had finished laying out its content.
  async function renderHtmlToPdf(html, fileBase) {
    await loadHtml2Pdf();
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-99999px';
    container.style.top = '0';
    container.innerHTML = html;
    document.body.appendChild(container);
    try {
      const bodyEl = container.querySelector('body') || container;
      await window.html2pdf()
        .set({
          margin: 0,
          filename: `${fileBase}.pdf`,
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] }
        })
        .from(bodyEl)
        .save();
    } finally {
      document.body.removeChild(container);
    }
  }

  async function downloadTailoredResume(resume, opts, btn) {
    const html = resumeToHtml(resume, opts);
    const fileBase = (resume.personal?.name || 'resume').replace(/\s+/g, '_');
    if (opts.format === 'docx') {
      // Lightweight Word-compatible export: Word opens HTML saved with a
      // .doc extension and the right MIME/header just fine.
      const wrapped = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>${html}</html>`;
      const blob = new Blob(['\ufeff', wrapped], { type: 'application/msword' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${fileBase}.doc`;
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }
    const prevText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing PDF…'; }
    try {
      await renderHtmlToPdf(html, fileBase);
    } catch (err) {
      alert(`Could not generate PDF: ${err.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevText; }
    }
  }

  async function draftCoverLetter() {
    panel.setButtonBusy('jt-cover', 'Writing…');
    const job = currentJob();
    try {
      const text = await send('resumes:coverLetter', {
        resumeId: state.selectedResumeId,
        jobTitle: job.title,
        company: job.company,
        jobDescription: job.description
      });
      panel.resetButton('jt-cover');
      panel.renderCoverLetter(text);
      panel.panel.querySelector('#jt-copy-cover')?.addEventListener('click', () => {
        const ta = panel.panel.querySelector('#jt-cover-text');
        ta.select();
        navigator.clipboard.writeText(ta.value).catch(() => document.execCommand('copy'));
      });
    } catch (err) {
      panel.resetButton('jt-cover');
      panel.renderResultError(`Cover letter generation failed: ${err.message}`, draftCoverLetter);
    }
  }

  // Heuristic: only auto-open on pages that look like an actual job posting,
  // so the launcher tab (not the full panel) is what shows up everywhere else.
  function looksLikeJobPage() {
    if (document.querySelector('script[type="application/ld+json"]')) {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        if (/jobposting/i.test(s.textContent)) return true;
      }
    }
    const url = location.href.toLowerCase();
    if (/job|career|greenhouse|lever\.co|workday|jobright/.test(url)) return true;
    return false;
  }

  // The panel never opens on its own. It only appears in response to the
  // user clicking the toolbar icon (see background.js), and only if this
  // particular page looks like a job posting — otherwise we tell them so
  // and leave the page untouched.
  // Shown when the assistant is opened on a page that doesn't look like a
  // job posting: the panel opens and stays docked as a sidebar (it does NOT
  // auto-close), with the notice centered in the body and a Reload button
  // underneath so the user can re-check after navigating to a listing.
  function renderNotJobPage() {
    state.job = null;
    panel.renderEmptyState(
      "This doesn't look like a job posting page.",
      'Open a job listing, then reload job details.',
      recheckPage
    );
  }

  function recheckPage() {
    if (looksLikeJobPage()) {
      loadAndRender();
    } else {
      renderNotJobPage();
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'panel:toggle') {
      if (!panel.isOpen) {
        panel.open();
        if (looksLikeJobPage()) {
          loadAndRender();
        } else {
          renderNotJobPage();
        }
      } else {
        panel.close();
      }
      sendResponse({ ok: true });
    }
  });
})();
