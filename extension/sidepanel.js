const DEFAULT_DASHBOARD_URL = 'http://localhost:3000';
let currentJob = null;
let isFavorited = false;

function $(id) { return document.getElementById(id); }

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getSavedResume() {
  const { resumeText } = await chrome.storage.local.get('resumeText');
  return resumeText || '';
}

async function getDashboardUrl() {
  const { dashboardUrl } = await chrome.storage.sync.get('dashboardUrl');
  return dashboardUrl || DEFAULT_DASHBOARD_URL;
}

function setRing(matched, total) {
  const circumference = 119.4;
  const pct = total ? matched / total : 0;
  $('ringFill').style.strokeDashoffset = String(circumference * (1 - pct));
  $('matchFrac').textContent = `${matched} of ${total}`;
}

function renderJob(job, resumeText) {
  $('emptyState').style.display = 'none';
  $('jobView').style.display = 'block';

  $('jobTitle').textContent = job.title || 'Untitled role';
  $('jobCompany').textContent = job.company || '';
  $('metaLoc').textContent = job.location ? `• ${job.location}` : '';
  if (job.jobType) { $('metaType').style.display = 'inline-block'; $('metaType').textContent = job.jobType; }
  else { $('metaType').style.display = 'none'; }

  if (job.salary) {
    $('salaryRow').style.display = 'flex';
    $('salaryRow').innerHTML = `<span class="badge">${job.salary}</span>`;
  } else {
    $('salaryRow').style.display = 'none';
  }

  // Skills chips, checked if present in saved resume text
  const skillsWrap = $('skillsChips');
  skillsWrap.innerHTML = '';
  const resumeLower = (resumeText || '').toLowerCase();
  let matchedCount = 0;
  const skills = job.skills && job.skills.length ? job.skills : ['No specific skills detected'];
  skills.forEach((s) => {
    const on = resumeLower.includes(s.toLowerCase());
    if (on) matchedCount++;
    const chip = document.createElement('span');
    chip.className = 'chip' + (on ? ' on' : '');
    chip.textContent = (on ? '✓ ' : '') + s;
    skillsWrap.appendChild(chip);
  });
  setRing(matchedCount, job.skills ? job.skills.length : 0);

  // Key highlights
  if (job.highlights && job.highlights.length) {
    $('highlightsSection').style.display = 'block';
    $('highlightsList').innerHTML = job.highlights.map((h) => `<li>${h}</li>`).join('');
  } else {
    $('highlightsSection').style.display = 'none';
  }

  // Qualifications, collapsed to 2 with "+N more"
  if (job.qualifications && job.qualifications.length) {
    $('qualSection').style.display = 'block';
    const list = $('qualList');
    const toggle = $('qualMoreToggle');
    const items = job.qualifications;
    const collapsedCount = 2;
    function render(expanded) {
      const shown = expanded ? items : items.slice(0, collapsedCount);
      list.innerHTML = shown.map((q) => `<li>${q}</li>`).join('');
      if (items.length > collapsedCount) {
        toggle.style.display = 'inline-block';
        toggle.textContent = expanded ? 'Show less' : `+${items.length - collapsedCount} more`;
        toggle.onclick = () => render(!expanded);
      } else {
        toggle.style.display = 'none';
      }
    }
    render(false);
  } else {
    $('qualSection').style.display = 'none';
  }

  // Reset tailor panel to closed each fresh job load
  $('tailorPanel').classList.remove('open');
  $('tailorResults').style.display = 'none';
}

async function loadAndScrape() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;
  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_JOB' });
  } catch (e) {
    response = null;
  }
  const resumeText = await getSavedResume();
  if (response && response.ok) {
    currentJob = response.job;
    renderJob(currentJob, resumeText);
    chrome.storage.local.set({ lastJob: currentJob });
  } else {
    $('emptyState').style.display = 'block';
    $('jobView').style.display = 'none';
  }
}

function renderTailorResults(result) {
  $('tailorResults').style.display = 'block';
  const scoreEl = $('scoreNum');
  scoreEl.textContent = `${result.matchScore}%`;
  scoreEl.className = 'score-num' + (result.matchScore < 50 ? ' low' : '');

  $('missingChips').innerHTML = result.missing.length
    ? result.missing.map((m) => `<span class="chip">${m}</span>`).join('')
    : '<span class="chip on">✓ Great coverage — no major gaps found</span>';

  $('summaryBox').textContent = result.suggestedSummary;

  $('bulletTips').innerHTML = result.bulletTips.map((t) => `<li>${t}</li>`).join('');
  $('atsList').innerHTML = result.atsChecklist.map((t) => `<li>${t}</li>`).join('');
}

async function handleGenerate() {
  if (!currentJob) return;
  const resumeText = $('resumeInput').value.trim();
  const btn = $('generateBtn');
  const original = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> Generating...';
  btn.disabled = true;

  // Small delay purely for perceived "thinking" — computation itself is instant.
  await new Promise((r) => setTimeout(r, 450));

  const result = window.SKVKTailor.generateTailorSuggestions(currentJob, resumeText);
  renderTailorResults(result);

  if (resumeText) chrome.storage.local.set({ resumeText });

  btn.textContent = original;
  btn.disabled = false;
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadAndScrape();
  const resumeText = await getSavedResume();
  if (resumeText) $('resumeInput').value = resumeText;

  $('reloadBtn').addEventListener('click', loadAndScrape);
  $('emptyReloadBtn').addEventListener('click', loadAndScrape);

  $('helpBtn').addEventListener('click', async () => {
    const base = await getDashboardUrl();
    chrome.tabs.create({ url: `${base.replace(/\/$/, '')}/dashboard.html` });
  });

  $('enterManuallyBtn').addEventListener('click', async () => {
    const base = await getDashboardUrl();
    const params = currentJob
      ? `?title=${encodeURIComponent(currentJob.title || '')}&company=${encodeURIComponent(currentJob.company || '')}&url=${encodeURIComponent(currentJob.url || '')}`
      : '';
    chrome.tabs.create({ url: `${base.replace(/\/$/, '')}/tracker.html${params}` });
  });

  $('favBtn').addEventListener('click', () => {
    isFavorited = !isFavorited;
    $('favBtn').textContent = isFavorited ? '♥' : '♡';
    $('favBtn').classList.toggle('active', isFavorited);
  });

  $('appliedCheck').addEventListener('change', async (e) => {
    if (!currentJob) return;
    const { savedJobs = [] } = await chrome.storage.local.get('savedJobs');
    savedJobs.unshift({ ...currentJob, applied: e.target.checked, savedAt: new Date().toISOString() });
    chrome.storage.local.set({ savedJobs });
  });

  $('tailorBtn').addEventListener('click', () => {
    $('tailorPanel').classList.toggle('open');
    if ($('tailorPanel').classList.contains('open')) {
      $('tailorPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  $('generateBtn').addEventListener('click', handleGenerate);

  $('copySummaryBtn').addEventListener('click', () => {
    navigator.clipboard.writeText($('summaryBox').textContent);
    $('copySummaryBtn').textContent = 'Copied!';
    setTimeout(() => { $('copySummaryBtn').textContent = 'Copy summary'; }, 1200);
  });

  $('coverLetterBtn').addEventListener('click', () => {
    if (!currentJob) return;
    const letter = `Dear ${currentJob.company || 'Hiring Team'},\n\n`
      + `I'm excited to apply for the ${currentJob.title || 'open role'} position. `
      + `My background aligns closely with what you're looking for, particularly in `
      + `${(currentJob.skills || []).slice(0, 3).join(', ') || 'the core requirements you listed'}. `
      + `I'd welcome the chance to discuss how I can contribute to your team.\n\n`
      + `Best regards,`;
    navigator.clipboard.writeText(letter);
    alert('A starter cover letter was copied to your clipboard.');
  });
});
