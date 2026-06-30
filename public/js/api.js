// Shared API helper — talks to the Node/Express + MongoDB backend.
// No data is ever stored in localStorage/sessionStorage; the session
// lives in an httpOnly cookie set by the server.

const api = {
  async _req(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error(data.error || 'Something went wrong');
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(url) { return this._req('GET', url); },
  post(url, body) { return this._req('POST', url, body || {}); },
  put(url, body) { return this._req('PUT', url, body || {}); },
  del(url) { return this._req('DELETE', url); },
  async upload(url, formData) {
    const res = await fetch(url, { method: 'POST', credentials: 'include', body: formData });
    let data = {};
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error(data.error || 'Upload failed');
      err.status = res.status;
      throw err;
    }
    return data;
  }
};

function showToast(message, type = 'success') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Guard for pages that require a logged-in user. Redirects to login
// if the session cookie is missing/expired, and otherwise renders
// the user chip in the sidebar.
async function requireSession() {
  try {
    const { user } = await api.get('/api/auth/me');
    document.querySelectorAll('[data-user-name]').forEach((el) => (el.textContent = user.name));
    document.querySelectorAll('[data-user-email]').forEach((el) => (el.textContent = user.email));
    document.querySelectorAll('[data-user-avatar]').forEach((el) => {
      el.textContent = initials(user.name);
      el.style.background = user.avatarColor || '#ff8a3d';
    });
    return user;
  } catch (err) {
    window.location.href = '/login.html';
    return null;
  }
}

function wireLogout() {
  document.querySelectorAll('[data-logout]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { await api.post('/api/auth/logout'); } catch (e) { /* ignore */ }
      window.location.href = '/login.html';
    });
  });
}
