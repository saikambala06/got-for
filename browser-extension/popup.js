function send(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res) return reject(new Error('No response from background script'));
      if (!res.ok) return reject(new Error(res.error || 'Request failed'));
      resolve(res.data);
    });
  });
}

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');

async function refresh() {
  const state = await send('auth:getState').catch(() => ({ loggedIn: false }));
  document.getElementById('apiBase').value = state.apiBase || 'http://localhost:4000';

  if (state.loggedIn && state.user) {
    loginView.style.display = 'none';
    appView.style.display = 'block';
    document.getElementById('userName').textContent = state.user.name || 'Signed in';
    document.getElementById('userEmail').textContent = state.user.email || '';
    document.getElementById('avatar').textContent = (state.user.name || '?')[0].toUpperCase();
    document.getElementById('avatar').style.background = state.user.avatarColor || '#ff9a4d';
  } else {
    loginView.style.display = 'block';
    appView.style.display = 'none';
  }
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const apiBase = document.getElementById('apiBase').value.trim().replace(/\/$/, '');
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';

  if (!email || !password) { errorEl.textContent = 'Enter your email and password.'; return; }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Logging in…';
  try {
    await send('auth:login', { email, password, apiBase });
    await refresh();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Log in';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await send('auth:logout');
  await refresh();
});

document.getElementById('dashboardBtn').addEventListener('click', async () => {
  const state = await send('auth:getState').catch(() => ({ apiBase: 'http://localhost:4000' }));
  chrome.tabs.create({ url: state.apiBase });
});

document.getElementById('showPanelBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        'content/skills-data.js',
        'content/job-parser.js',
        'content/panel-ui.js',
        'content/content.js'
      ]
    });
  } catch (_) { /* already injected on this page */ }
  chrome.tabs.sendMessage(tab.id, { type: 'panel:toggle' }, () => {
    if (chrome.runtime.lastError) { /* content script still initializing; ignore */ }
    window.close();
  });
});

refresh();
