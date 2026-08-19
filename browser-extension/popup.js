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
loginView.style.display = 'none';

async function getAuthState(retried) {
  try {
    return await send('auth:getState');
  } catch (err) {
    // The background service worker can be briefly asleep/waking up when
    // the popup first opens (MV3 behavior) — that transient failure should
    // never be treated as "logged out". Retry once before giving up.
    if (!retried) {
      await new Promise((r) => setTimeout(r, 150));
      return getAuthState(true);
    }
    return { loggedIn: false };
  }
}

async function refresh() {
  const state = await getAuthState();

  if (state.loggedIn && state.user) {
    loginView.style.display = 'none';
    appView.style.display = 'block';
    document.getElementById('userName').textContent = state.user.name || 'Signed in';
    document.getElementById('userEmail').textContent = state.user.email || '';
    const parts = String(state.user.name || '').trim().split(/\s+/).filter(Boolean);
    document.getElementById('avatar').textContent =
      parts.length ? parts.slice(0, 2).map((w) => w[0].toUpperCase()).join('') : '?';
    if (state.user.avatarColor) {
      document.getElementById('avatar').style.background = state.user.avatarColor;
    }
  } else {
    loginView.style.display = 'block';
    appView.style.display = 'none';
  }
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('loginError');
  const showError = (msg) => {
    errorEl.textContent = msg || '';
    errorEl.classList.toggle('show', Boolean(msg));
  };
  showError('');

  if (!email || !password) { showError('Enter your email and password.'); return; }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Logging in…';
  try {
    await send('auth:login', { email, password });
    await refresh();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Log in';
  }
});

// Opens the extension's own parser page — a full tab, not the popup, because
// the review UI needs the room.
document.getElementById('parseBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('parse.html') });
  window.close();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await send('auth:logout');
  await refresh();
});

document.getElementById('dashboardBtn').addEventListener('click', async () => {
  const state = await send('auth:getState').catch(() => ({ apiBase: 'https://got-for.vercel.app' }));
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
