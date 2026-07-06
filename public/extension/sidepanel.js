'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let API_URL   = 'https://got-for.vercel.app';
let token     = null;
let resumes   = [];
let currentJob = null;
let userSkills = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
const $  = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);

function showToast(msg, duration = 3000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function api(path, options = {}) {
  return fetch(API_URL + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
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
      if (data.token) token = data.token;
      if (data.apiUrl) API_URL = data.apiUrl;
      resolve(!!token);
    });
  });
}

function saveAuth(t, url) {
  token = t;
  API_URL = url;
  chrome.storage.local.set({ token: t, apiUrl: url });
}

function clearAuth() {
  token = null;
  chrome.storage.local.remove(['token', 'apiUrl']);
}

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
  resumes = []; currentJob = null; userSkills = [];
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
    // Collect all skills from all resumes
    userSkills = [...new Set(resumes.flatMap((r) => r.skills || []))];
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('unauthorized')) {
      clearAuth(); doLogout(); return;
    }
  }

  // Check if there's already job data from a previous page
  chrome.storage.session.get(['latestJobData'], (data) => {
    if (data.latestJobData) showJob(data.latestJobData);
  });

  // Ask active tab's content script for current job data
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['content.js'],
      }).catch(() => {}); // already injected is fine
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
  // Pre-select default resume
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

// ── Show job ──────────────────────────────────────────────────────────────────
function showJob(job) {
  currentJob = job;
  $('noJobState').style.display = 'none';
  $('jobState').style.display = 'flex';

  // Header
  $('hdrTitle').textContent    = job.title    || 'Job Listing';
  $('hdrCompany').textContent  = job.company  || '';

  // Overview tab
  $('infoTitle').textContent   = job.title    || '—';
  $('infoCompany').textContent = job.company  || '—';
  $('infoSource').textContent  = job.source   || 'Job Page';
  if (job.location) { $('rowLocation').style.display = 'flex'; $('infoLocation').textContent = job.location; }
  if (job.jobType)  { $('rowJobType').style.display  = 'flex'; $('infoJobType').textContent  = job.jobType;  }

  // Skills preview in overview
  const prev = $('infoSkillsPreview');
  if (job.skills?.length) {
    prev.innerHTML = job.skills.map((s) => `<span class="tag accent">${s}</span>`).join('');
  } else {
    prev.textContent = 'No skills detected';
  }

  // Description
  $('descText').textContent = job.description || 'No description found.';

  // All job skills
  const all = $('allJobSkills');
  if (job.skills?.length) {
    all.innerHTML = job.skills.map((s) => `<span class="chip neutral">${s}</span>`).join('');
  } else {
    all.textContent = 'No skills detected on this page.';
  }

  updateSkillsTab();
}

function updateSkillsTab() {
  if (!currentJob) return;
  const resume = selectedResume();
  const resumeSkillsRaw = resume?.skills || userSkills;
  const resumeSkills    = new Set(resumeSkillsRaw.map((s) => s.toLowerCase()));
  const jobSkills       = currentJob.skills || [];

  const matched  = jobSkills.filter((s) => resumeSkills.has(s.toLowerCase()));
  const missing  = jobSkills.filter((s) => !resumeSkills.has(s.toLowerCase()));
  const pct      = jobSkills.length ? Math.round((matched.length / jobSkills.length) * 100) : 0;

  $('matchScore').textContent   = jobSkills.length ? `${pct}%` : '—';
  $('skillsResumeName').textContent = resume ? resume.title : 'All your resumes combined';

  $('matchedSkills').innerHTML  = matched.length  ? matched.map( (s) => `<span class="chip match">${s}</span>`).join('')   : '<span style="color:var(--faint); font-size:12px;">None matched yet</span>';
  $('missingSkills').innerHTML  = missing.length  ? missing.map( (s) => `<span class="chip missing">${s}</span>`).join('') : '<span style="color:var(--green); font-size:12px;">You have all required skills! 🎉</span>';
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

    let html = `<div class="tailor-result">
      <h4>✨ Tailored Successfully</h4>`;

    if (t.suggestions) {
      html += `<div class="result-section">
        <div class="result-label">What changed</div>
        <div class="result-text">${escHtml(t.suggestions)}</div>
      </div>`;
    }

    if (t.summary) {
      html += `<div class="result-section">
        <div class="result-label">New Summary</div>
        <div class="result-text">${escHtml(t.summary)}</div>
      </div>`;
    }

    if (t.skills?.length) {
      html += `<div class="result-section">
        <div class="result-label">Prioritised Skills</div>
        <div class="result-text">${t.skills.slice(0,8).map((s) => `<span class="tag accent">${escHtml(s)}</span>`).join('')}</div>
      </div>`;
    }

    html += `<button class="save-btn" id="saveTailoredBtn">💾 Save Tailored Resume</button>
    </div>`;

    const res = $('tailorResult');
    res.innerHTML = html;
    res.style.display = 'block';

    $('saveTailoredBtn').addEventListener('click', () => saveTailored(resume._id, t));
  } catch (err) {
    showToast('Tailoring failed: ' + (err.message || 'unknown error'));
  } finally {
    btn.innerHTML = '<span>✨ Tailor Resume to This Job</span>';
    btn.disabled = false;
  }
}

async function saveTailored(resumeId, tailored) {
  const resume = resumes.find((r) => r._id === resumeId);
  if (!resume) return;

  // Apply tailored changes to the resume object
  const update = {
    summary: tailored.summary || resume.summary,
    skills:  tailored.skills  || resume.skills,
  };

  if (tailored.experience?.length) {
    const exp = resume.experience.map((e, i) => {
      const change = tailored.experience.find((x) => x.index === i);
      return change ? { ...e, description: change.description } : e;
    });
    update.experience = exp;
  }

  try {
    await api(`/api/resumes/${resumeId}`, { method: 'PUT', body: update });
    // Update local cache
    Object.assign(resume, update);
    showToast('Resume saved ✓');
    $('saveTailoredBtn').textContent = '✓ Saved!';
    $('saveTailoredBtn').style.color = 'var(--green)';
  } catch (err) {
    showToast('Save failed: ' + err.message);
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
  });
});

// ── Events ────────────────────────────────────────────────────────────────────
$('loginBtn').addEventListener('click', doLogin);
$('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('logoutBtn').addEventListener('click', () => { if (confirm('Sign out?')) doLogout(); });
$('tailorBtn').addEventListener('click', doTailor);

// Listen for job data from content script via background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'JOB_DATA_READY' || msg.type === 'JOB_DATA') {
    showJob(msg.data);
  }
  if (msg.type === 'PAGE_CHANGED') {
    $('noJobState').style.display = 'flex';
    $('jobState').style.display   = 'none';
    currentJob = null;
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const loggedIn = await loadSaved();
  if (loggedIn) {
    await boot();
  } else {
    $('authScreen').style.display = 'flex';
  }
})();
