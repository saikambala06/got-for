const DEFAULT_DASHBOARD_URL = 'http://localhost:3000';
let currentJob = null;
let isFavorited = false;
let aiResult = null; // last successful AI analysis for currentJob

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

async function aiAnalyzeJob(job, resumeText) {
  const base = await getDashboardUrl();
  const url = `${base.replace(/\/$/, '')}/api/ai/analyze`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job, resumeText })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error((data && data.error) || `AI request failed (${res.status})`);
  }
  return data.result;
}

function setRingPct(pct) {
  const circumference = 119.4;
  $('ringFill').style.strokeDashoffset = String(circumference * (1 - pct));
}

function renderJob(job, resumeText, ai) {
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

  const skillsList = (ai && ai.skills && ai.skills.length) ? ai.skills : (job.skills && job.skills.length ? job.skills : []);
  const skillsWrap = $('skillsChips');
  skillsWrap.innerHTML = '';

  if (ai) {
    // AI mode: a skill is "on" if the AI judged it as matched in the resume.
    $('aiBadge').style.display = 'inline-block';
    const matchedSet = new Set((ai.matchedSkills || []).map((s) => s.toLowerCase()));
    let matchedCount = 0;
    const list = skillsList.length ? skillsList : ['No specific skills detected'];
    list.forEach((s) => {
      const on = matchedSet.has(s.toLowerCase());
      if (on) matchedCount++;
      const chip = document.createElement('span');
      chip.className = 'chip' + (on ? ' on' : '');
      chip.textContent = (on ? '✓ ' : '') + s;
      skillsWrap.appendChild(chip);
    });
    if (resumeText) {
      $('matchDesc').innerHTML = `AI match score for this resume: <span id="matchFrac"><b style="color:var(--accent2)">${ai.matchScore}%</b></span>`;
      setRingPct(ai.matchScore / 100);
      $('ringCheck').textContent = ai.matchScore >= 50 ? '✓' : '!';
    } else {
      $('matchDesc').innerHTML = `AI found <span id="matchFrac">${list.length} skills</span> in this posting. Add your resume in Settings to get a match score.`;
      setRingPct(0);
      $('ringCheck').textContent = '✦';
    }
  } else {
    $('aiBadge').style.display = 'none';
    const resumeLower = (resumeText || '').toLowerCase();
    let matchedCount = 0;
    const list = skillsList.length ? skillsList : ['No specific skills detected'];
    list.forEach((s) => {
      const on = resumeLower.includes(s.toLowerCase());
      if (on) matchedCount++;
      const chip = document.createElement('span');
      chip.className = 'chip' + (on ? ' on' : '');
      chip.textContent = (on ? '✓ ' : '') + s;
      skillsWrap.appendChild(chip);
    });
    $('matchDesc').innerHTML = `Your resume has <span id="matchFrac">${matchedCount} of ${skillsList.length}</span> keywords that appear in the job description.`;
    setRingPct(skillsList.length ? matchedCount / skillsList.length : 0);
    $('ringCheck').textContent = '✓';
  }

  // Key highlights
  const highlights = (ai && ai.highlights && ai.highlights.length) ? ai.highlights : job.highlights;
  if (highlights && highlights.length) {
    $('highlightsSection').style.display = 'block';
    $('highlightsList').innerHTML = highlights.map((h) => `<li>${h}</li>`).join('');
  } else {
    $('highlightsSection').style.display = 'none';
  }

  // Qualifications, collapsed to 2 with "+N more"
  const qualifications = (ai && ai.qualifications && ai.qualifications.length) ? ai.qualifications : job.qualifications;
  if (qualifications && qualifications.length) {
    $('qualSection').style.display = 'block';
    const list = $('qualList');
    const toggle = $('qualMoreToggle');
    const items = qualifications;
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
    aiResult = null;
    renderJob(currentJob, resumeText, null);
    chrome.storage.local.set({ lastJob: currentJob });

    const statusEl = $('aiStatus');
    statusEl.style.display = 'block';
    statusEl.textContent = '✦ Analyzing this job with AI...';
    try {
      const ai = await aiAnalyzeJob(currentJob, resumeText);
      // Only apply if the user hasn't navigated to a different job meanwhile.
      if (currentJob && currentJob.url === response.job.url) {
        aiResult = ai;
        renderJob(currentJob, resumeText, ai);
        statusEl.textContent = resumeText
          ? '✦ AI analysis complete — skills, highlights and match score generated by AI.'
          : '✦ AI analysis complete. Add your resume in Settings to get a true AI match score.';
      }
    } catch (e) {
      statusEl.textContent = 'AI analysis unavailable right now (showing detected keywords instead). ' + (e.message || '');
    }
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
  btn.innerHTML = '<span class="spinner"></span> Generating with AI...';
  btn.disabled = true;

  let result;
  try {
    const ai = (aiResult && aiResult.matchScore !== undefined)
      ? aiResult
      : await aiAnalyzeJob(currentJob, resumeText);
    aiResult = ai;
    result = {
      matchScore: ai.matchScore,
      missing: ai.missingKeywords,
      suggestedSummary: ai.suggestedSummary || 'AI did not return a summary — try adding more resume detail.',
      bulletTips: ai.bulletTips && ai.bulletTips.length ? ai.bulletTips : ['Add more resume detail for tailored bullet suggestions.'],
      atsChecklist: ai.atsChecklist && ai.atsChecklist.length ? ai.atsChecklist : []
    };
  } catch (e) {
    // Fall back to the local heuristic engine if AI is unavailable.
    result = window.SKVKTailor.generateTailorSuggestions(currentJob, resumeText);
  }

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
