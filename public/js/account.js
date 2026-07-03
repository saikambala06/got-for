if (!requireAuth()) throw new Error('Not authenticated');

renderSidebar('account');
renderTopbar();

// Tab switching
document.querySelectorAll('.account-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.account-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.account-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
  });
});

async function loadProfile() {
  try {
    const data = await apiCall('/auth/me');
    const user = data.user;
    
    document.getElementById('profileName').value = user.name;
    document.getElementById('profileEmail').value = user.email;
    document.getElementById('profileConnected').value = user.connectedAccounts || user.email;
    document.getElementById('profileNameDisplay').textContent = user.name;
    document.getElementById('profileEmailDisplay').textContent = user.email;
    document.getElementById('profileAvatar').textContent = getInitials(user.name);
    
    // Billing
    document.getElementById('billingPlanName').textContent = `${user.plan} Plan`;
    const jobExtPercent = Math.min((user.jobExtractionsUsed / user.jobExtractionsLimit) * 100, 100);
    const tailoredPercent = Math.min((user.tailoredResumesUsed / user.tailoredResumesLimit) * 100, 100);
    document.getElementById('billingJobExt').textContent = `${user.jobExtractionsUsed} / ${user.jobExtractionsLimit}`;
    document.getElementById('billingJobExtBar').style.width = `${jobExtPercent}%`;
    document.getElementById('billingTailored').textContent = `${user.tailoredResumesUsed} / ${user.tailoredResumesLimit}`;
    document.getElementById('billingTailoredBar').style.width = `${tailoredPercent}%`;
  } catch (err) {
    showToast('Failed to load profile', 'error');
  }
}

async function updateProfile(event) {
  event.preventDefault();
  const btn = document.getElementById('updateProfileBtn');
  setButtonLoading(btn, true);
  
  try {
    const name = document.getElementById('profileName').value;
    const email = document.getElementById('profileEmail').value;
    
    const data = await apiCall('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({ name, email })
    });
    
    setUser(data.user);
    document.getElementById('profileNameDisplay').textContent = data.user.name;
    document.getElementById('profileEmailDisplay').textContent = data.user.email;
    document.getElementById('profileAvatar').textContent = getInitials(data.user.name);
    document.getElementById('profileConnected').value = data.user.email;
    renderTopbar();
    
    showToast('Profile updated successfully', 'success');
    setButtonLoading(btn, false);
  } catch (err) {
    showToast(err.message, 'error');
    setButtonLoading(btn, false);
  }
}

async function updatePassword(event) {
  event.preventDefault();
  const btn = document.getElementById('updatePasswordBtn');
  setButtonLoading(btn, true);
  
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  
  if (newPassword !== confirmPassword) {
    showToast('Passwords do not match', 'error');
    setButtonLoading(btn, false);
    return;
  }
  
  try {
    await apiCall('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({
        currentPassword: document.getElementById('currentPassword').value,
        newPassword
      })
    });
    
    showToast('Password updated successfully', 'success');
    document.getElementById('passwordForm').reset();
    setButtonLoading(btn, false);
  } catch (err) {
    showToast(err.message, 'error');
    setButtonLoading(btn, false);
  }
}

loadProfile();