const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('skvk_token');
}

function setToken(token) {
  localStorage.setItem('skvk_token', token);
}

function removeToken() {
  localStorage.removeItem('skvk_token');
  localStorage.removeItem('skvk_user');
}

function getUser() {
  const userStr = localStorage.getItem('skvk_user');
  return userStr ? JSON.parse(userStr) : null;
}

function setUser(user) {
  localStorage.setItem('skvk_user', JSON.stringify(user));
}

function isLoggedIn() {
  return !!getToken();
}

function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = '/';
    return false;
  }
  return true;
}

function redirectIfAuth() {
  if (isLoggedIn()) {
    window.location.href = '/dashboard';
  }
}

async function apiCall(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });
    
    if (response.status === 401) {
      removeToken();
      window.location.href = '/';
      return null;
    }
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    
    return data;
  } catch (err) {
    if (err.message === 'Failed to fetch') {
      showToast('Cannot connect to server. Please check your connection.', 'error');
    }
    throw err;
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ'}</span>
    <span class="toast-message">${message}</span>
  `;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function getInitials(name) {
  if (!name) return 'SK';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return formatDate(dateStr);
}

function renderSidebar(activePage) {
  const user = getUser();
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  
  sidebar.innerHTML = `
    <div class="sidebar-brand">
      <div class="logo-box">SK</div>
      <div class="brand-name">SK <span>VK</span></div>
    </div>
    <nav class="sidebar-nav">
      <a href="/dashboard" class="${activePage === 'dashboard' ? 'active' : ''}">
        <span class="nav-icon">📊</span> Dashboards
      </a>
      <a href="/resumes" class="${activePage === 'resumes' ? 'active' : ''}">
        <span class="nav-icon">📄</span> Resumes
      </a>
      <a href="/job-tracker" class="${activePage === 'job-tracker' ? 'active' : ''}">
        <span class="nav-icon">💼</span> Job Tracker
      </a>
      <a href="/account" class="${activePage === 'account' ? 'active' : ''}">
        <span class="nav-icon">⚙️</span> Account
      </a>
    </nav>
    <div class="sidebar-plan">
      <div class="sidebar-plan-info">
        <div class="sidebar-plan-name" id="sidebarPlanName">${user?.plan || 'Free'} Plan</div>
        <div class="sidebar-plan-bar">
          <div class="sidebar-plan-fill" id="sidebarPlanFill" style="width:0%"></div>
        </div>
        <div class="sidebar-plan-text" id="sidebarPlanText">0 / 6 Job Extractions</div>
      </div>
      <button class="sidebar-logout" onclick="logout()">
        <span class="nav-icon">🚪</span> Sign Out
      </button>
    </div>
  `;
  
  // Load plan data
  loadSidebarPlan();
}

async function loadSidebarPlan() {
  try {
    const data = await apiCall('/dashboard/stats');
    const plan = data.plan;
    const jobExtPercent = (plan.jobExtractions.used / plan.jobExtractions.limit) * 100;
    
    const fillEl = document.getElementById('sidebarPlanFill');
    const textEl = document.getElementById('sidebarPlanText');
    const nameEl = document.getElementById('sidebarPlanName');
    
    if (fillEl) fillEl.style.width = `${Math.min(jobExtPercent, 100)}%`;
    if (textEl) textEl.textContent = `${plan.jobExtractions.used} / ${plan.jobExtractions.limit} Job Extractions`;
    if (nameEl) nameEl.textContent = `${plan.name} Plan`;
  } catch (err) {
    console.error('Plan load error:', err);
  }
}

function renderTopbar() {
  const user = getUser();
  const topbar = document.getElementById('topbar');
  if (!topbar || !user) return;
  
  topbar.innerHTML = `
    <div></div>
    <div class="topbar-user">
      <div class="topbar-user-info">
        <span class="topbar-user-name">${user.name}</span>
        <span class="topbar-user-email">${user.email}</span>
      </div>
      <div class="topbar-avatar">${getInitials(user.name)}</div>
    </div>
  `;
}

function logout() {
  removeToken();
  window.location.href = '/';
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  const text = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  if (loading) {
    btn.disabled = true;
    if (text) text.classList.add('hidden');
    if (spinner) spinner.classList.remove('hidden');
  } else {
    btn.disabled = false;
    if (text) text.classList.remove('hidden');
    if (spinner) spinner.classList.add('hidden');
  }
}