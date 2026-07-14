(async function () {
  renderShell({ active: 'resumes', title: 'Tailor resume', bodyHtml: '<div id="tailor-root"></div>' });
  const root = document.getElementById('tailor-root');
  root.innerHTML = '';
  renderLoadingInto('main-body', 'Loading your resumes…');

  let ctx;
  try {
    ctx = await loadSession();
  } catch (err) {
    document.getElementById('main-body').innerHTML = `<div class="err-box">${esc(err.message)}</div>`;
    return;
  }

  const { key, session } = ctx;
  const resumes = session.resumes || [];
  let selectedResumeId = session.selectedResumeId || resumes[0]?._id;
  let mode = 'review';

  function render() {
    document.getElementById('main-body').innerHTML = `
      <div class="tailor-card">
        <h1>Tailor your resume</h1>
        <p class="sub">Pick a resume, then choose how to apply AI suggestions.</p>

        <label class="field-label">Resume</label>
        <select class="field" id="t-resume">
          ${resumes.map((r) => `<option value="${r._id}" ${r._id === selectedResumeId ? 'selected' : ''}>${esc(r.name || 'Untitled resume')}${r.isDefault ? ' (Default)' : ''}</option>`).join('')}
        </select>

        <div class="mode-option ${mode === 'review' ? 'selected' : ''}" data-mode="review">
          <div class="mode-radio"><div class="mode-radio-dot"></div></div>
          <div>
            <div class="mode-title">Review &amp; edit <span class="mode-badge">☑ Full tailoring</span></div>
            <div class="mode-desc">Full tailoring — review &amp; edit every AI suggestion before downloading.</div>
          </div>
        </div>
        <div class="mode-option ${mode === 'quick' ? 'selected' : ''}" data-mode="quick">
          <div class="mode-radio"><div class="mode-radio-dot"></div></div>
          <div>
            <div class="mode-title">Quick Download <span class="mode-badge">⚡ Fastest</span></div>
            <div class="mode-desc">Auto-apply every AI suggestion, then download with your saved defaults.</div>
          </div>
        </div>

        <button class="continue-btn" id="t-continue">Continue →</button>
      </div>`;

    document.getElementById('t-resume').addEventListener('change', (e) => { selectedResumeId = e.target.value; });
    document.querySelectorAll('.mode-option').forEach((opt) => {
      opt.addEventListener('click', () => { mode = opt.dataset.mode; render(); });
    });
    document.getElementById('t-continue').addEventListener('click', onContinue);
  }

  async function onContinue() {
    const btn = document.getElementById('t-continue');
    btn.disabled = true;

    session.selectedResumeId = selectedResumeId;
    await saveSession(key, session);

    if (mode === 'quick') {
      btn.textContent = 'Opening…';
      try {
        await send('tailor:openQuickDownload', { sessionId: ctx.sid });
        window.close();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Continue →';
        alert(`Could not open Quick Download: ${err.message}`);
      }
      return;
    }

    // Review & edit — hand off to the tailor studio overlay on the job page
    // this session started from, then close this tab.
    renderLoadingInto('main-body', 'Matching it against your resume…');
    try {
      await send('tailor:startReview', { sessionId: ctx.sid, resumeId: selectedResumeId });
      window.close();
    } catch (err) {
      document.getElementById('main-body').innerHTML = `<div class="err-box">${esc(err.message)}</div>`;
    }
  }

  render();
})();
