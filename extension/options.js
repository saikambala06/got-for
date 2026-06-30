document.addEventListener("DOMContentLoaded", async () => {
  const { dashboardUrl } = await chrome.storage.sync.get("dashboardUrl");
  if (dashboardUrl) document.getElementById("url").value = dashboardUrl;
});

document.getElementById("saveBtn").addEventListener("click", async () => {
  const url = document.getElementById("url").value.trim();
  await chrome.storage.sync.set({ dashboardUrl: url });
  const status = document.getElementById("status");
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 1500);
});
