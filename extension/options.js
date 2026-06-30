document.addEventListener('DOMContentLoaded', async () => {
  const { dashboardUrl } = await chrome.storage.sync.get('dashboardUrl');
  if (dashboardUrl) document.getElementById('url').value = dashboardUrl;
  const { resumeText } = await chrome.storage.local.get('resumeText');
  if (resumeText) document.getElementById('resume').value = resumeText;
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const url = document.getElementById('url').value.trim();
  const resume = document.getElementById('resume').value.trim();
  await chrome.storage.sync.set({ dashboardUrl: url });
  await chrome.storage.local.set({ resumeText: resume });
  const status = document.getElementById('status');
  status.textContent = 'Saved.';
  setTimeout(() => (status.textContent = ''), 1500);
});
