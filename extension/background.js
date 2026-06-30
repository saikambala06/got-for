chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ savedJobs: [] });
});

// Clicking the toolbar icon opens the SK VK side panel on the active tab,
// where the job is parsed and the advanced tools (keyword match, tailor
// resume, cover letter) live.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});
