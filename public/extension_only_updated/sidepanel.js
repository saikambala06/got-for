'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let API_URL    = 'https://got-for.vercel.app';
let token      = null;
let resumes    = [];
let currentJob = null;
let userSkills = [];
let aiData     = null; // AI-extracted enrichment

// ── Helpers ───────────────────────────────────────────────────────────────────
const $  = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);

function showToast(msg, duration = 3000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function api(path, options = {}) {
  return fetch(API_URL + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body
      ? typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
      : undefined,
  }).then(async (r) => {
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
    return json;
  });
}

// ── Persistence ───────────────────────────────────────────────────────────────
async function loadSaved() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['token', 'apiUrl'], (data) => {
      if (data.token)  token   = data.token;
      if (data.apiUrl) API_URL = data.apiUrl;
      resolve(!!token);
    });
  });
}

function saveAuth(t, url) { token = t; API_URL = url; chrome.storage.local.set({ token: t, apiUrl: url }); }
function clearAuth()       { token = null; chrome.storage.local.remove(['token', 'apiUrl']); }

// ── Auth ──────────────────────────────────────────────────────────────────────
async function doLogin() {
  const email = $('loginEmail').value.trim();
  const pass  = $('loginPass').value;
  const url   = $('apiUrl').value.trim().replace(/\/$/, '');
  $('authErr').textContent = '';
  if (!email || !pass) { $('authErr').textContent = 'Email and password are required'; return; }

  $('loginBtn').textContent = 'Signing in…';
  $('loginBtn').disabled = true;
  try {
    API_URL = url;
    const data = await api('/api/auth/login', { method: 'POST', body: { email, password: pass } });
    saveAuth(data.token, url);
    await boot();
  } catch (err) {
    $('authErr').textContent = err.message || 'Login failed';
    $('loginBtn').textContent = 'Sign In';
    $('loginBtn').disabled = false;
  }
}

function doLogout() {
  clearAuth();
  resumes = []; currentJob = null; userSkills = []; aiData = null;
  $('mainScreen').style.display = 'none';
  $('authScreen').style.display = 'flex';
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  $('authScreen').style.display = 'none';
  $('mainScreen').style.display = 'flex';

  try {
    const data = await api('/api/resumes');
    resumes = data.resumes || [];
    populateResumeSelect();
    userSkills = [...new Set(resumes.flatMap((r) => r.skills || []))];
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('unauthorized')) {
      clearAuth(); doLogout(); return;
    }
  }

  chrome.storage.session.get(['latestJobData'], (data) => {
    if (data.latestJobData) showJob(data.latestJobData);
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] })
        .catch(() => {});
    }
  });
}

// ── Resume select ─────────────────────────────────────────────────────────────
function populateResumeSelect() {
  const sel = $('resumeSelect');
  if (!resumes.length) {
    sel.innerHTML = '<option value="">No resumes found — create one on JobTrail</option>';
    $('tailorBtn').disabled = true;
    return;
  }
  sel.innerHTML = resumes.map((r) =>
    `<option value="${r._id}">${r.title}${r.isDefault ? ' ★' : ''}</option>`
  ).join('');
  const def = resumes.find((r) => r.isDefault);
  if (def) sel.value = def._id;
  $('tailorBtn').disabled = false;
  updateSkillsTab();
  sel.addEventListener('change', updateSkillsTab);
}

function selectedResume() {
  const id = $('resumeSelect').value;
  return resumes.find((r) => r._id === id) || null;
}

// ── AI Extraction ─────────────────────────────────────────────────────────────
async function runAIExtraction(job) {
  if (!job.description) return;

  // Show loading indicator
  $('aiLoadingBadge').style.display = 'inline-flex';

  try {
    const result = await api('/api/jobs/extract', {
      method: 'POST',
      body: { description: job.description, title: job.title || '' },
    });
    aiData = result;
    renderAIData(job);
  } catch (err) {
    console.warn('[AI Extract] failed:', err.message);
    // Try regex-only fallback silently
    aiData = regexFallbackExtract(job.description);
    renderAIData(job);
  } finally {
    $('aiLoadingBadge').style.display = 'none';
  }
}

// Client-side regex fallback (mirrors server-side logic)
function regexFallbackExtract(text) {
  const highlights = [];
  if (/h[\s-]?1b|visa\s+sponsor/i.test(text))        highlights.push('H1B Sponsor Likely');
  if (/medical|health\s+insurance/i.test(text))       highlights.push('Medical Coverage');
  if (/dental/i.test(text))                            highlights.push('Dental');
  if (/vision/i.test(text))                            highlights.push('Vision');
  if (/401\s*[kK]|retirement/i.test(text))             highlights.push('401(k)');
  if (/remote|work\s+from\s+home/i.test(text))         highlights.push('Remote Friendly');
  if (/hybrid/i.test(text))                            highlights.push('Hybrid');
  if (/pto|paid\s+time\s+off|unlimited\s+pto/i.test(text)) highlights.push('PTO');
  if (/equity|stock|rsu/i.test(text))                  highlights.push('Equity');
  if (/bonus/i.test(text))                             highlights.push('Bonus');
  if (/parental|maternity|paternity/i.test(text))      highlights.push('Parental Leave');

  let salary = '', experienceLevel = '', experienceYears = '';
  const sm = text.match(/\$([\d,]+)[Kk]?\s*[-–]\s*\$([\d,]+)[Kk]?/);
  if (sm) salary = `${sm[0].trim()}`;
  if (/senior|sr\./i.test(text))                      experienceLevel = 'Senior';
  else if (/mid[\s-]?level|intermediate/i.test(text)) experienceLevel = 'Mid Level';
  else if (/junior|entry[\s-]?level/i.test(text))     experienceLevel = 'Entry Level';
  else if (/lead|principal/i.test(text))              experienceLevel = 'Lead';
  else if (/director|head of/i.test(text))            experienceLevel = 'Director';
  else if (/manager/i.test(text))                     experienceLevel = 'Manager';
  const yrM = text.match(/(\d+)\+?\s*years?\s+(?:of\s+)?experience/i);
  if (yrM) experienceYears = `${yrM[1]}+ yrs`;

  return { salary, experienceLevel, experienceYears, highlights, skills: [], keywords: [] };
}

// ── Render AI Data ────────────────────────────────────────────────────────────
function renderAIData(job) {
  if (!aiData) return;

  // Re-render pills with new data
  renderHeroPills(job, aiData);

  // Highlights card
  const hl = aiData.highlights || [];
  if (hl.length) {
    $('highlightsList').innerHTML = hl.map((h) =>
      `<li><div class="highlight-dot"></div>${escHtml(h)}</li>`
    ).join('');
    $('highlightsCard').style.display = 'block';
  }

  // Merge AI skills with page-extracted skills
  if (aiData.skills?.length) {
    const merged = [...new Set([...(job.skills || []), ...aiData.skills])];
    currentJob.skills = merged;
    renderSkillsPreview(merged);
    updateSkillsTab();
  }

  // AI keywords in skills tab
  if (aiData.keywords?.length) {
    $('keywordsSection').style.display = 'block';
    $('aiKeywords').innerHTML = aiData.keywords.map((k) =>
      `<span class="chip neutral">${escHtml(k)}</span>`
    ).join('');
  }

  // Update gauge with keyword data
  updateGauge(job.skills || currentJob.skills || []);
}

// ── Render hero pills ─────────────────────────────────────────────────────────
function renderHeroPills(job, extra = {}) {
  const pills = [];
  const loc  = job.location;
  const type = job.jobType;
  const sal  = extra.salary || job.salary || '';
  const expL = extra.experienceLevel || '';
  const expY = extra.experienceYears || '';
  const src  = job.source;

  if (loc)  pills.push(`<span class="pill loc">📍 ${escHtml(loc)}</span>`);
  if (type) pills.push(`<span class="pill type">⏱ ${escHtml(type)}</span>`);
  if (sal)  pills.push(`<span class="pill salary">💰 ${escHtml(sal)}</span>`);
  if (expL) pills.push(`<span class="pill exp">🎯 ${escHtml(expL)}${expY ? ' · ' + expY : ''}</span>`);
  if (src)  pills.push(`<span class="pill src">${escHtml(src)}</span>`);

  $('heroPills').innerHTML = pills.join('');
}

// ── Update gauge ──────────────────────────────────────────────────────────────
function updateGauge(jobSkills) {
  const resume      = selectedResume();
  const resumeSkills = new Set((resume?.skills || userSkills).map((s) => s.toLowerCase()));
  const matched     = jobSkills.filter((s) => resumeSkills.has(s.toLowerCase()));
  const total       = jobSkills.length;
  const pct         = total ? Math.round((matched.length / total) * 100) : 0;

  if (!total) { $('matchCard').style.display = 'none'; return; }

  $('matchCard').style.display = 'block';
  $('gaugePct').textContent   = `${pct}%`;
  $('gaugeText').textContent  = `${pct}%`;
  $('gaugeDetail').innerHTML  = `<strong>${matched.length}</strong> of <strong>${total}</strong> keywords matched`;
  $('matchCardSub').textContent = resume ? `Resume: ${resume.title}` : 'Across all your resumes';

  // Animate gauge arc — circumference = 2π×28 ≈ 175.9
  const circ   = 175.9;
  const offset = circ - (circ * pct / 100);
  const fill   = $('gaugeFill');
  fill.style.strokeDashoffset = offset;

  // Color-code by score
  const color = pct >= 70 ? '#34d399' : pct >= 40 ? '#ff9a4d' : '#e05252';
  fill.style.stroke = color;
  $('gaugePct').style.color = color;
}

// ── Render skills preview in Overview ────────────────────────────────────────
function renderSkillsPreview(jobSkills) {
  if (!jobSkills?.length) { $('skillsPreviewCard').style.display = 'none'; return; }

  const resume       = selectedResume();
  const resumeSkills = new Set((resume?.skills || userSkills).map((s) => s.toLowerCase()));

  $('skillsPreview').innerHTML = jobSkills.slice(0, 14).map((s) => {
    const cls = resumeSkills.has(s.toLowerCase()) ? 'match' : 'neutral';
    const icon = cls === 'match' ? '✓ ' : '';
    return `<span class="chip ${cls}">${icon}${escHtml(s)}</span>`;
  }).join('');
  $('skillsPreviewCard').style.display = 'block';
}

// ── Show job ──────────────────────────────────────────────────────────────────
function showJob(job) {
  currentJob = job;
  aiData     = null;

  $('noJobState').style.display = 'none';
  $('jobState').style.display   = 'flex';

  // Header
  $('hdrTitle').textContent   = job.title   || 'Job Listing';
  $('hdrCompany').textContent = job.company || '';

  // Hero card
  $('heroTitle').textContent   = job.title   || '—';
  $('heroCompany').textContent = job.company || '';
  renderHeroPills(job);

  // Description
  $('descText').textContent = job.description || 'No description found.';

  // Skills (from page extractor)
  renderSkillsPreview(job.skills || []);

  // Reset highlights
  $('highlightsCard').style.display   = 'none';
  $('highlightsList').innerHTML        = '';
  $('keywordsSection').style.display  = 'none';
  $('matchCard').style.display        = 'none';

  // Skills tab: all job skills
  const all = $('allJobSkills');
  if (job.skills?.length) {
    all.innerHTML = job.skills.map((s) => `<span class="chip neutral">${escHtml(s)}</span>`).join('');
  } else {
    all.textContent = 'No skills detected on this page.';
  }

  updateSkillsTab();
  updateGauge(job.skills || []);

  // Fire AI extraction asynchronously
  runAIExtraction(job);
}

// ── Skills tab ────────────────────────────────────────────────────────────────
function updateSkillsTab() {
  if (!currentJob) return;
  const resume       = selectedResume();
  const resumeSkills = new Set((resume?.skills || userSkills).map((s) => s.toLowerCase()));
  const jobSkills    = currentJob.skills || [];

  const matched = jobSkills.filter((s) => resumeSkills.has(s.toLowerCase()));
  const missing = jobSkills.filter((s) => !resumeSkills.has(s.toLowerCase()));
  const pct     = jobSkills.length ? Math.round((matched.length / jobSkills.length) * 100) : 0;

  $('matchScore').textContent      = jobSkills.length ? `${pct}%` : '—';
  $('skillsResumeName').textContent = resume ? resume.title : 'All your resumes combined';

  $('matchedSkills').innerHTML = matched.length
    ? matched.map((s) => `<span class="chip match">✓ ${escHtml(s)}</span>`).join('')
    : '<span style="color:var(--faint); font-size:12px;">None matched yet</span>';

  $('missingSkills').innerHTML = missing.length
    ? missing.map((s) => `<span class="chip missing">${escHtml(s)}</span>`).join('')
    : '<span style="color:var(--green); font-size:12px;">You have all required skills! 🎉</span>';

  // Also re-render skills preview in overview tab
  renderSkillsPreview(jobSkills);
  updateGauge(jobSkills);
}

// ── Tailor ────────────────────────────────────────────────────────────────────
async function doTailor() {
  const resume = selectedResume();
  if (!resume || !currentJob) return;

  const btn = $('tailorBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span>Tailoring…</span>';

  try {
    const data = await api(`/api/resumes/${resume._id}/tailor`, {
      method: 'POST',
      body: { jobTitle: currentJob.title, jobDescription: currentJob.description || '' },
    });
    const t = data.tailored;

    let html = `<div class="tailor-result"><h4>✨ Tailored Successfully</h4>`;
    if (t.suggestions) html += `<div class="result-section"><div class="result-label">What changed</div><div class="result-text">${escHtml(t.suggestions)}</div></div>`;
    if (t.summary)     html += `<div class="result-section"><div class="result-label">New Summary</div><div class="result-text">${escHtml(t.summary)}</div></div>`;
    if (t.skills?.length) html += `<div class="result-section"><div class="result-label">Prioritised Skills</div><div class="result-text">${t.skills.slice(0, 8).map((s) => `<span class="tag accent">${escHtml(s)}</span>`).join('')}</div></div>`;
    html += `<button class="save-btn" id="saveTailoredBtn">💾 Save Tailored Resume</button></div>`;

    const res = $('tailorResult');
    res.innerHTML = html;
    res.style.display = 'block';
    $('saveTailoredBtn').addEventListener('click', () => saveTailored(resume._id, t));
  } catch (err) {
    showToast('Tailoring failed: ' + (err.message || 'unknown error'));
  } finally {
    btn.innerHTML = '<span>✨ Tailor Resume to This Job</span>';
    btn.disabled  = false;
  }
}

async function saveTailored(resumeId, tailored) {
  const resume = resumes.find((r) => r._id === resumeId);
  if (!resume) return;
  const update = { summary: tailored.summary || resume.summary, skills: tailored.skills || resume.skills };
  if (tailored.experience?.length) {
    update.experience = resume.experience.map((e, i) => {
      const change = tailored.experience.find((x) => x.index === i);
      return change ? { ...e, description: change.description } : e;
    });
  }
  try {
    await api(`/api/resumes/${resumeId}`, { method: 'PUT', body: update });
    Object.assign(resume, update);
    showToast('Resume saved ✓');
    $('saveTailoredBtn').textContent = '✓ Saved!';
    $('saveTailoredBtn').style.color = 'var(--green)';
  } catch (err) {
    showToast('Save failed: ' + err.message);
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`panel-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'tailor' && !$('resumeSelect').value && resumes.length) {
      const def = resumes.find((r) => r.isDefault);
      if (def) $('resumeSelect').value = def._id;
    }
    if (btn.dataset.tab === 'skills') updateSkillsTab();
  });
});

// ── Events ────────────────────────────────────────────────────────────────────
$('loginBtn').addEventListener('click', doLogin);
$('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('logoutBtn').addEventListener('click', () => { if (confirm('Sign out?')) doLogout(); });
$('tailorBtn').addEventListener('click', doTailor);

// Messages from content script / background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'JOB_DATA_READY' || msg.type === 'JOB_DATA') {
    showJob(msg.data);
  }
  if (msg.type === 'PAGE_CHANGED') {
    $('noJobState').style.display = 'flex';
    $('jobState').style.display   = 'none';
    currentJob = null; aiData = null;
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const loggedIn = await loadSaved();
  if (loggedIn) await boot();
  else $('authScreen').style.display = 'flex';
})();
