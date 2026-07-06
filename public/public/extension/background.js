// background.js — opens the sidepanel when the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Auto-open sidepanel when user navigates to a job page
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  const jobSites = [
    'linkedin.com/jobs',
    'indeed.com',
    'greenhouse.io',
    'lever.co',
    'workday.com',
    'myworkdayjobs.com',
    'smartrecruiters.com',
    'ashbyhq.com',
    'icims.com',
    'taleo.net',
    'jobvite.com',
    'rippling.com/ats',
    'breezy.hr',
  ];
  const isJobPage = jobSites.some((site) => tab.url.includes(site));
  if (isJobPage) {
    // Notify sidepanel to refresh job data
    chrome.runtime.sendMessage({ type: 'PAGE_CHANGED', url: tab.url, tabId }).catch(() => {});
  }
});

// Forward messages from content script to sidepanel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'JOB_DATA') {
    // Store latest job data so sidepanel can fetch it
    chrome.storage.session.set({ latestJobData: msg.data }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'JOB_DATA_READY', data: msg.data }).catch(() => {});
  }
  sendResponse({ ok: true });
  return true;
});
