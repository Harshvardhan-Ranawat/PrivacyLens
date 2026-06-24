// PrivacyLens background service worker
console.log("PrivacyLens background service worker loaded.");

// Listen to message passing from popup and dashboard
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SET_SCAN_DATA") {
    chrome.storage.local.get(["scanHistory"], (result) => {
      let history = [];
      if (result && Array.isArray(result.scanHistory)) {
        history = result.scanHistory;
      }
      
      // Create a heavily sanitized summary object
      const summary = {
        domain: request.data && request.data.domain ? String(request.data.domain) : "Unknown",
        score: request.data && typeof request.data.score === 'number' ? request.data.score : 0,
        riskLevel: request.data && request.data.riskLevel ? String(request.data.riskLevel) : "Unknown",
        scanTime: request.data && request.data.scanTime ? String(request.data.scanTime) : new Date().toISOString(),
        trackerCount: request.data && request.data.metrics && typeof request.data.metrics.trackerCount === 'number' ? request.data.metrics.trackerCount : 0
      };

      // Safe filter
      history = history.filter(item => item && item.domain && item.domain !== summary.domain);
      history.unshift(summary);

      if (history.length > 100) {
        history = history.slice(0, 100);
      }

      // Force deep serialization before storing to bypass any Chrome reference bugs
      const safeHistory = JSON.parse(JSON.stringify(history));
      const safeScanData = JSON.parse(JSON.stringify(request.data));

      chrome.storage.local.set({ 
        lastScanData: safeScanData,
        scanHistory: safeHistory
      }, () => {
        sendResponse({ status: "success" });
      });
    });
    return true;
  }
  
  if (request.action === "GET_SCAN_DATA") {
    chrome.storage.local.get(["lastScanData"], (result) => {
      sendResponse({ data: result.lastScanData || null });
    });
    return true;
  }
  
  if (request.action === "GET_SCAN_HISTORY") {
    chrome.storage.local.get(["scanHistory"], (result) => {
      sendResponse({ data: result.scanHistory || [] });
    });
    return true;
  }

  if (request.action === "CLEAR_SCAN_HISTORY") {
    chrome.storage.local.set({ scanHistory: [] }, () => {
      sendResponse({ status: "success" });
    });
    return true;
  }
  
  if (request.action === "OPEN_DASHBOARD") {
    // Open the dashboard page in a new tab
    const url = chrome.runtime.getURL("dashboard/dashboard.html");
    chrome.tabs.create({ url: url }, () => {
      sendResponse({ status: "success" });
    });
    return true;
  }
});
