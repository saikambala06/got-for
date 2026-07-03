redirectIfAuth();

document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}Form`).classList.add('active');
  });
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  setButtonLoading(btn, true);
  
  try {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    const data = await apiCall('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    
    setToken(data.token);
    setUser(data.user);
    showToast('Login successful!', 'success');
    setTimeout(() => window.location.href = '/dashboard', 800);
  } catch (err) {
    showToast(err.message, 'error');
    setButtonLoading(btn, false);
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('registerBtn');
  setButtonLoading(btn, true);
  
  try {
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    
    const data = await apiCall('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });
    
    setToken(data.token);
    setUser(data.user);
    showToast('Account created! Loading demo data...', 'success');
    setTimeout(() => window.location.href = '/dashboard', 1200);
  } catch (err) {
    showToast(err.message, 'error');
    setButtonLoading(btn, false);
  }
});