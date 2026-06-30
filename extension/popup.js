const DEFAULT_DASHBOARD_URL = "http://localhost:3000";

function $(id) { return document.getElementById(id); }

async function getDashboardUrl() {
  const { dashboardUrl } = await chrome.storage.sync.get("dashboardUrl");
  return dashboardUrl || DEFAULT_DASHBOARD_URL;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function prefillFromPage() {
  const tab = await getActiveTab();
  if (!tab) return;
  $("jobUrl").value = tab.url || "";

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const guesses = [
          document.querySelector('h1')?.innerText,
          document.title
        ].filter(Boolean);
        return { title: guesses[0] || "", pageTitle: document.title || "" };
      }
    });
    $("jobTitle").value = (result && result.title) || tab.title || "";
  } catch (e) {
    // Page may not allow script injection (e.g. chrome:// pages) — fall back gracefully.
    $("jobTitle").value = tab.title || "";
  }
}

async function refreshSavedCount() {
  const { savedJobs = [] } = await chrome.storage.local.get("savedJobs");
  $("savedCount").textContent = savedJobs.length
    ? `${savedJobs.length} job${savedJobs.length === 1 ? "" : "s"} saved locally`
    : "";
}

async function saveJob() {
  const job = {
    title: $("jobTitle").value.trim(),
    company: $("company").value.trim(),
    url: $("jobUrl").value.trim(),
    savedAt: new Date().toISOString()
  };
  if (!job.title) {
    $("status").style.color = "#f87171";
    $("status").textContent = "Add a job title first.";
    return;
  }

  const { savedJobs = [] } = await chrome.storage.local.get("savedJobs");
  savedJobs.unshift(job);
  await chrome.storage.local.set({ savedJobs });

  $("status").style.color = "#34d399";
  $("status").textContent = "Saved. Open SK VK to add it to your tracker.";
  refreshSavedCount();
}

async function openDashboard() {
  const base = await getDashboardUrl();
  chrome.tabs.create({ url: `${base.replace(/\/$/, "")}/tracker.html` });
}

document.addEventListener("DOMContentLoaded", async () => {
  await prefillFromPage();
  await refreshSavedCount();
  $("saveBtn").addEventListener("click", saveJob);
  $("openBtn").addEventListener("click", openDashboard);
});
