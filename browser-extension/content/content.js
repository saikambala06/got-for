// JobTrail Assistant — content script
// Orchestrates: parse the page -> load resumes -> render the panel -> wire
// up Enter Manually / Mark as Applied / Tailor Resume / Cover Letter.

(function () {
  if (window.__jobtrailAssistantLoaded) return;
  window.__jobtrailAssistantLoaded = true;

  const { parseJobFromPage } = window.JobTrailParser;
  const { JobTrailPanel } = window.JobTrailPanelUI;
  const { TailorStudio } = window.JobTrailTailorStudio;
  const { cleanSkill, skillsMatch } = window.JobTrailSkillsData;

  const panel = new JobTrailPanel();
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

  async function loadAndRender() {
    panel.renderLoading('Reading this job posting…');
    const parsed = parseJobFromPage();
    if (!parsed) {
      panel.renderError("Couldn't find a job posting on this page. Try Enter manually below, or reload once the page finishes loading.");
      return;
    }
    state.job = parsed;
    state.manualOverrides = {};
    state.extraSkillsChecked = new Set();
    state.applied = false;

    const authState = await send('auth:getState').catch(() => ({ loggedIn: false }));
    if (!authState.loggedIn) {
      panel.renderError('Log in to JobTrail from the extension icon in your toolbar to use resume matching, tailoring, and cover letters.');
      return;
    }

    try {
      state.resumes = await send('resumes:list');
    } catch (err) {
      panel.renderError(`Could not load your resumes: ${err.message}`);
      return;
    }

    if (!state.resumes.length) {
      panel.renderError('You don\u2019t have any resumes in JobTrail yet. Create one in the dashboard, then reload this panel.');
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
      const analysis = await send('job:analyze', {
        jobTitle: state.job.title,
        company: state.job.company,
        jobDescription: state.job.description
      });
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
    }

    renderCard();
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
      onReload: loadAndRender,
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
        source: 'JobTrail Assistant',
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
  const studioState = { diff: null, tailoringLevel: 'high', decisions: {}, resume: null };

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
            onConfirmDownload: (opts) => downloadTailoredResume(proj, opts)
          });
        }
      }
    );
  }

  function tailorResume() {
    openStudio();
  }

  // ─── Resume export (client-side, no server dependency) ─────────────────

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
        body{ font-family: Georgia, 'Times New Roman', serif; color:#111; padding:40px; max-width:760px; margin:0 auto; }
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
      // Lightweight Word-compatible export: Word opens HTML saved with a
      // .doc extension and the right MIME/header just fine.
      const wrapped = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>${html}</html>`;
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'panel:toggle') {
      panel.toggle();
      if (panel.isOpen && !state.job) loadAndRender();
      sendResponse({ ok: true });
    }
  });

  if (looksLikeJobPage()) {
    panel.open();
    loadAndRender();
  }
})();
