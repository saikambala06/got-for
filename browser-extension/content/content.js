// JobTrail Assistant — content script
// Orchestrates: parse the page -> load resumes -> render the panel -> wire
// up Enter Manually / Mark as Applied / Tailor Resume / Cover Letter.

(function () {
  if (window.__jobtrailAssistantLoaded) return;
  window.__jobtrailAssistantLoaded = true;

  const { parseJobFromPage } = window.JobTrailParser;
  const { JobTrailPanel } = window.JobTrailPanelUI;

  const panel = new JobTrailPanel();

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

    // Refine the locally-scraped skills/qualifications/highlights with the
    // AI-powered extractor so the panel shows accurate, context-aware data
    // instead of pure client-side regex guesses. If this fails for any
    // reason (offline, server hiccup) we just keep the local parse — the
    // panel never gets stuck.
    panel.renderLoading('Analyzing this job posting with AI…');
    try {
      const extracted = await send('jobs:extract', {
        title: state.job.title,
        company: state.job.company,
        description: state.job.description
      });
      state.job = {
        ...state.job,
        skillsFound: extracted.skills?.length ? extracted.skills : state.job.skillsFound,
        qualificationPhrases: extracted.qualifications?.length ? extracted.qualifications : state.job.qualificationPhrases,
        highlights: extracted.highlights?.length ? extracted.highlights : state.job.highlights,
        employmentType: state.job.employmentType || extracted.employmentType || '',
        salary: state.job.salary || (extracted.salaryMin
          ? `$${extracted.salaryMin.toLocaleString()}${extracted.salaryMax ? ` - $${extracted.salaryMax.toLocaleString()}` : ''}${extracted.salaryPeriod ? `/${extracted.salaryPeriod === 'hour' ? 'hr' : 'yr'}` : ''}`
          : '')
      };
    } catch (err) {
      console.warn('JobTrail: AI extraction unavailable, using locally-parsed data instead:', err.message);
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

  async function tailorResume() {
    panel.setButtonBusy('jt-tailor', 'Tailoring…');
    const job = currentJob();
    try {
      const result = await send('resumes:tailor', {
        resumeId: state.selectedResumeId,
        jobTitle: job.title,
        jobDescription: job.description,
        emphasizeSkills: Array.from(state.extraSkillsChecked)
      });
      panel.resetButton('jt-tailor');
      panel.renderTailorResult(result);
      panel.panel.querySelector('#jt-save-tailor')?.addEventListener('click', () => saveTailored(result));
    } catch (err) {
      panel.resetButton('jt-tailor');
      alert(`Tailoring failed: ${err.message}`);
    }
  }

  async function saveTailored(result) {
    const btn = panel.panel.querySelector('#jt-save-tailor');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await send('resumes:save', {
        resumeId: state.selectedResumeId,
        patch: { summary: result.summary, skills: result.skills }
      });
      if (btn) { btn.textContent = 'Saved ✓'; }
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save to resume'; }
      alert(`Could not save: ${err.message}`);
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
      alert(`Cover letter generation failed: ${err.message}`);
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
