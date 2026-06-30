function renderSidebar(active) {
  const items = [
    { key: 'dashboard', href: '/dashboard.html', label: 'Dashboard',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>' },
    { key: 'tracker', href: '/tracker.html', label: 'Job Tracker',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h3l2-2h4l2 2h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M9 13l2 2 4-4"/></svg>' },
    { key: 'resumes', href: '/resumes.html', label: 'Resumes',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>' },
    { key: 'account', href: '/account.html', label: 'Account',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>' }
  ];

  const navHtml = items.map((it) => `
    <a class="nav-item ${it.key === active ? 'active' : ''}" href="${it.href}">
      ${it.icon}<span>${it.label}</span>
    </a>`).join('');

  return `
    <aside class="sidebar">
      <a href="/dashboard.html" class="brand">
        <div class="mark">JT</div>
        <div class="name">Job<span>Trail</span></div>
      </a>
      <nav class="nav">${navHtml}</nav>
      <div class="sidebar-footer">
        <div class="plan-card">
          <div class="plan-title">Current plan</div>
          <div class="plan-name">⚡ Free, forever</div>
          <div class="plan-row"><span>Applications</span><span>Unlimited</span></div>
          <div class="plan-row"><span>Resumes</span><span>Unlimited</span></div>
        </div>
        <div class="user-chip">
          <div class="avatar" data-user-avatar>?</div>
          <div style="min-width:0">
            <div class="uname" data-user-name style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">…</div>
            <div class="uemail" data-user-email style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">…</div>
          </div>
          <button class="logout-btn" data-logout title="Log out">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </div>
    </aside>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('sidebar-root');
  if (root) {
    root.outerHTML = renderSidebar(root.dataset.active);
    wireLogout();
  }
});
