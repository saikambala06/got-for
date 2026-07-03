const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

function setToken(token) {
  localStorage.setItem('token', token);
}

function clearToken() {
  localStorage.removeItem('token');
}

function getUser() {
  const user = localStorage.getItem('user');
  return user ? JSON.parse(user) : null;
}

function setUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
}

function checkAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = '/login';
    return false;
  }
  return true;
}

async function apiCall(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });

    if (response.status === 401) {
      clearToken();
      window.location.href = '/login';
      return null;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  } catch (err) {
    console.error('API Error:', err);
    throw err;
  }
}

function showToast(message, type = 'success') {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function getSidebarHTML(activePage) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboards', path: '/dashboard', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' },
    { id: 'resumes', label: 'Resumes', path: '/resumes', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' },
    { id: 'job-tracker', label: 'Job Tracker', path: '/job-tracker', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><line x1="12" y1="13" x2="12" y2="17"/><line x1="10" y1="15" x2="14" y2="15"/></svg>' },
    { id: 'account', label: 'Account', path: '/account', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' }
  ];

  const navHTML = navItems.map(item => `
    <a href="${item.path}" class="nav-item ${activePage === item.id ? 'active' : ''}">
      ${item.icon}
      <span>${item.label}</span>
    </a>
  `).join('');

  return `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <a href="/dashboard" class="sidebar-logo">LetMe<span class="accent">Apply</span></a>
      </div>
      <nav class="sidebar-nav">
        ${navHTML}
      </nav>
      <div class="sidebar-footer">
        <div class="current-plan">
          <div class="plan-label">CURRENT PLAN</div>
          <div class="plan-name">Free</div>
          <div class="plan-stat"><span>Job Extractions</span><span id="plan-extractions">0/6</span></div>
          <div class="plan-bar"><div class="plan-bar-fill" id="plan-extractions-bar" style="width: 0%"></div></div>
          <div class="plan-stat"><span>Tailored Resumes</span><span id="plan-resumes">0/2</span></div>
          <div class="plan-bar"><div class="plan-bar-fill" id="plan-resumes-bar" style="width: 0%"></div></div>
        </div>
      </div>
    </aside>
  `;
}

function getTopbarHTML() {
  return `
    <div class="topbar">
      <div class="topbar-left">
        <button class="sidebar-toggle" onclick="toggleSidebar()">&#9776;</button>
        <a href="#" class="topbar-link">How it works</a>
        <a href="#" class="topbar-link">Upgrade</a>
      </div>
      <div class="topbar-right">
        <button class="btn btn-ghost btn-sm">Need Help?</button>
        <button class="btn btn-primary btn-sm">Install Extension</button>
      </div>
    </div>
  `;
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

async function loadPlanInfo() {
  try {
    const data = await apiCall('/account/profile');
    if (data && data.user) {
      const extractions = data.user.jobExtractions || 0;
      const extractionsLimit = data.user.jobExtractionsLimit || 6;
      const resumes = data.user.tailoredResumes || 0;
      const resumesLimit = data.user.tailoredResumesLimit || 2;

      const extEl = document.getElementById('plan-extractions');
      const extBar = document.getElementById('plan-extractions-bar');
      const resEl = document.getElementById('plan-resumes');
      const resBar = document.getElementById('plan-resumes-bar');

      if (extEl) extEl.textContent = `${extractions}/${extractionsLimit}`;
      if (extBar) extBar.style.width = `${(extractions / extractionsLimit) * 100}%`;
      if (resEl) resEl.textContent = `${resumes}/${resumesLimit}`;
      if (resBar) resBar.style.width = `${(resumes / resumesLimit) * 100}%`;
    }
  } catch (err) {
    // silently fail - plan info is non-critical
  }
}
