// PrivacyLens Extension Popup Script
console.log("PrivacyLens Popup Loaded");

let activeTab = null;

// Wait for the popup DOM to be fully loaded
document.addEventListener("DOMContentLoaded", () => {
  initPopup();
});

/**
 * Initializes the popup UI event listeners and default state.
 */
let isDemoMode = false;

async function initPopup() {
  const analyzeBtn = document.getElementById("analyze-btn");
  const reportBtn = document.getElementById("report-btn");

  // Check if extension API is available, otherwise trigger demo mode
  if (typeof chrome === "undefined" || !chrome.tabs) {
    console.log("PrivacyLens: Running in Web Demo Mode");
    setupDemoMode();
    return;
  }

  // Query the current active tab
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      activeTab = tabs[0];
      const url = new URL(activeTab.url);
      
      // Update website name display
      const websiteEl = document.getElementById("website-name");
      if (websiteEl) {
        websiteEl.textContent = url.hostname || "Unknown Site";
        websiteEl.classList.remove("loading");
      }

      // Check if page protocol is supported (http or https)
      if (!isSupportedProtocol(activeTab.url)) {
        disableAnalysis("System Page");
        return;
      }

      // Try to load cached metrics for the current site if available
      loadCachedData(url.hostname);

      // Initialize shields toggle state
      chrome.storage.local.get(["shield_" + url.hostname], (result) => {
        const toggle = document.getElementById("popup-shields-toggle");
        const enabled = !!result["shield_" + url.hostname];
        if (toggle) {
          toggle.checked = enabled;
        }
        const activeShieldIcon = document.getElementById("popup-active-shield-icon");
        if (activeShieldIcon) {
          activeShieldIcon.style.color = enabled ? "#10B981" : "#EF4444";
        }
      });
    } else {
      disableAnalysis("No active tab");
    }
  } catch (err) {
    console.error("Error initializing popup:", err);
    disableAnalysis("Error");
  }

  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", () => {
      handleAnalyzeClick();
    });
  }

  if (reportBtn) {
    reportBtn.addEventListener("click", () => {
      handleReportClick();
    });
  }

  const shieldsToggle = document.getElementById("popup-shields-toggle");
  if (shieldsToggle) {
    shieldsToggle.addEventListener("change", handlePopupShieldsChange);
  }

  const popupPurgeBtn = document.getElementById("popup-purge-trackers-btn");
  if (popupPurgeBtn) {
    popupPurgeBtn.addEventListener("click", handlePopupPurgeTrackers);
  }
}

/**
 * Fallback setup for local demo/web viewing.
 */
function setupDemoMode() {
  isDemoMode = true;
  const websiteEl = document.getElementById("website-name");
  if (websiteEl) {
    websiteEl.textContent = "demo-shop.com";
    websiteEl.classList.remove("loading");
  }

  const analyzeBtn = document.getElementById("analyze-btn");
  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", () => {
      runDemoAnalysis();
    });
  }

  const reportBtn = document.getElementById("report-btn");
  if (reportBtn) {
    reportBtn.addEventListener("click", () => {
      handleReportClick();
    });
  }
}

/**
 * Simulates analysis in demo mode.
 */
function runDemoAnalysis() {
  const analyzeBtn = document.getElementById("analyze-btn");
  if (analyzeBtn) {
    analyzeBtn.textContent = "Analyzing...";
    analyzeBtn.disabled = true;
  }

  setTimeout(() => {
    updatePrivacyMetrics("demo-shop.com", 64, "Medium");
    if (analyzeBtn) {
      analyzeBtn.textContent = "Analyze Current Website";
      analyzeBtn.disabled = false;
    }
  }, 1000);
}

/**
 * Checks if the protocol is supported for scanning.
 */
function isSupportedProtocol(urlStr) {
  try {
    const url = new URL(urlStr);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (e) {
    return false;
  }
}

/**
 * Disables analysis for unsupported tabs (e.g. chrome:// tabs).
 */
function disableAnalysis(reason) {
  const websiteEl = document.getElementById("website-name");
  const scoreStatusEl = document.getElementById("score-status");
  const analyzeBtn = document.getElementById("analyze-btn");

  if (websiteEl && reason === "System Page") {
    websiteEl.textContent = "Browser settings / System page";
    websiteEl.classList.remove("loading");
  }

  if (scoreStatusEl) {
    scoreStatusEl.textContent = `Unsupported (${reason})`;
  }

  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Cannot Scan This Page";
    analyzeBtn.style.opacity = "0.6";
    analyzeBtn.style.cursor = "not-allowed";
  }

  // Also disable shields toggle and purge button on system/unsupported pages
  const shieldsToggle = document.getElementById("popup-shields-toggle");
  if (shieldsToggle) {
    shieldsToggle.disabled = true;
    const parentLabel = shieldsToggle.closest('label.switch');
    if (parentLabel) {
      parentLabel.style.opacity = "0.5";
      parentLabel.style.pointerEvents = "none";
    }
  }

  const purgeBtn = document.getElementById("popup-purge-trackers-btn");
  if (purgeBtn) {
    purgeBtn.disabled = true;
    purgeBtn.style.opacity = "0.5";
    purgeBtn.style.cursor = "not-allowed";
  }
}

/**
 * Load cached data for the current domain.
 */
function loadCachedData(currentDomain) {
  chrome.runtime.sendMessage({ action: "GET_SCAN_DATA" }, (response) => {
    if (response && response.data && response.data.domain === currentDomain) {
      const data = response.data;
      updatePrivacyMetrics(data.domain, data.score, data.riskLevel);
    }
  });
}

/**
 * Performs website analysis.
 * Injects DOM scanner and queries cookies.
 */
async function handleAnalyzeClick() {
  if (!activeTab || !isSupportedProtocol(activeTab.url)) return;

  const analyzeBtn = document.getElementById("analyze-btn");
  if (analyzeBtn) {
    analyzeBtn.textContent = "Analyzing...";
    analyzeBtn.disabled = true;
  }

  const url = new URL(activeTab.url);
  const domain = url.hostname;

  try {
    // 1. Run DOM scanner script in context of the web page
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      world: "MAIN",
      func: scanDOM
    });

    const domMetrics = (injectionResults && injectionResults[0] && injectionResults[0].result) || {
      scriptCount: 0,
      trackers: [],
      localStorageCount: 0,
      sessionStorageCount: 0,
      isHttps: url.protocol === "https:",
      formFields: 0
    };

    // 2. Query cookies for the domain
    chrome.cookies.getAll({ url: activeTab.url }, (cookies) => {
      const cookieCount = cookies ? cookies.length : 0;
      
      // Calculate Privacy Score
      const analysisResult = calculatePrivacyDetails(domain, activeTab.url, domMetrics, cookies);

      // Save to background worker
      chrome.runtime.sendMessage({ 
        action: "SET_SCAN_DATA", 
        data: analysisResult 
      }, (response) => {
        console.log("Cached scan results:", response);
      });

      // Update popup UI
      updatePrivacyMetrics(analysisResult.domain, analysisResult.score, analysisResult.riskLevel);

      if (analyzeBtn) {
        analyzeBtn.textContent = "Analyze Current Website";
        analyzeBtn.disabled = false;
      }
    });

  } catch (err) {
    console.error("Scan failed:", err);
    if (analyzeBtn) {
      analyzeBtn.textContent = "Scan Failed. Try again.";
      analyzeBtn.disabled = false;
    }
  }
}

/**
 * Script executed inside the web page context to inspect DOM structure.
 */
function scanDOM() {
  const scripts = Array.from(document.querySelectorAll('script'));
  const scriptSrcs = scripts.map(s => s.src).filter(Boolean);
  const trackers = [];
  const trackerSignatures = {
    'Google Tag Manager': /googletagmanager\.com/i,
    'Google Analytics': /google-analytics\.com|analytics\.js|ga\.js/i,
    'Meta/Facebook Pixel': /connect\.facebook\.net|facebook\.com\/tr/i,
    'TikTok Pixel': /tiktok\.com\/i18n\/pixel/i,
    'Hotjar': /hotjar\.com/i,
    'Hubspot': /hs-scripts\.com|hs-analytics\.net/i,
    'Mixpanel': /mixpanel\.com/i,
    'Amplitude': /amplitude\.com/i,
    'Crazy Egg': /crazyegg\.com/i,
    'DoubleClick': /doubleclick\.net/i
  };

  for (const src of scriptSrcs) {
    for (const [name, regex] of Object.entries(trackerSignatures)) {
      if (regex.test(src) && !trackers.includes(name)) {
        trackers.push(name);
      }
    }
  }

  // Count cookies set in JS (document.cookie)
  let documentCookieCount = 0;
  try {
    documentCookieCount = document.cookie ? document.cookie.split(";").length : 0;
  } catch (e) {
    // Storage access might be restricted
  }

  let localStorageCount = 0;
  try {
    localStorageCount = window.localStorage ? window.localStorage.length : 0;
  } catch (e) {}

  let sessionStorageCount = 0;
  try {
    sessionStorageCount = window.sessionStorage ? window.sessionStorage.length : 0;
  } catch (e) {}

  return {
    scriptCount: scripts.length,
    trackers: trackers,
    localStorageCount: localStorageCount,
    sessionStorageCount: sessionStorageCount,
    isHttps: window.location.protocol === 'https:',
    formFields: document.querySelectorAll('input').length,
    documentCookieCount: documentCookieCount,
    fingerprints: window._privacyLensFingerprints || []
  };
}

/**
 * Calculates score, risk level, and compile details.
 */
function calculatePrivacyDetails(domain, url, domMetrics, cookies) {
  let score = 100;
  const deductions = [];

  // 1. SSL security
  if (!domMetrics.isHttps) {
    score -= 35;
    deductions.push({ category: "Security", detail: "Site does not use HTTPS", penalty: 35 });
  }

  // 2. Trackers
  const trackerCount = domMetrics.trackers.length;
  if (trackerCount > 0) {
    const penalty = Math.min(trackerCount * 15, 45); // Max 45 points deduction for trackers
    score -= penalty;
    deductions.push({ category: "Trackers", detail: `${trackerCount} advertising/analytic tracker(s) found`, penalty });
  }

  // 3. Cookies
  const cookieCount = cookies ? cookies.length : 0;
  if (cookieCount > 0) {
    const penalty = Math.min(cookieCount * 1.5, 20); // Max 20 points deduction for cookies
    score -= penalty;
    deductions.push({ category: "Cookies", detail: `${cookieCount} cookie(s) stored on browser`, penalty });
  }

  // 4. Scripts count (generic bloat / third parties)
  const scriptCount = domMetrics.scriptCount;
  if (scriptCount > 25) {
    const penalty = scriptCount > 50 ? 15 : 8;
    score -= penalty;
    deductions.push({ category: "Scripts", detail: `${scriptCount} scripts loaded on page (High script activity increases exposure)`, penalty });
  }

  // 5. Storage keys
  const storageCount = domMetrics.localStorageCount + domMetrics.sessionStorageCount;
  if (storageCount > 10) {
    score -= 5;
    deductions.push({ category: "Storage", detail: `Large local/session storage utilization (${storageCount} entries)`, penalty: 5 });
  }

  // 6. Fingerprinting & Security Warnings
  const fingerprintsCount = domMetrics.fingerprints ? domMetrics.fingerprints.length : 0;
  if (fingerprintsCount > 0) {
    const hasSecurityRisk = domMetrics.fingerprints.some(f => f.category === 'Security Warning');
    const hasCanvas = domMetrics.fingerprints.some(f => f.category === 'Canvas Fingerprinting');
    
    // Check if the attempts were actively spoofed by our shields
    const allSpoofed = domMetrics.fingerprints.every(f => f.spoofed);
    
    let penalty = 0;
    if (hasSecurityRisk) {
      if (allSpoofed) {
        deductions.push({ category: "Security Shield", detail: "Clipboard Hijack attempt blocked", penalty: 0 });
      } else {
        penalty = 100; // Critical Security Risk
        deductions.push({ category: "Security Threat", detail: "Malicious API usage detected (e.g., Clipboard Hijacking)", penalty });
      }
    } else {
      if (allSpoofed) {
        deductions.push({ category: "Fingerprint Shield", detail: `${fingerprintsCount} device profiling attempt(s) successfully spoofed`, penalty: 0 });
      } else {
        const uniqueCategories = new Set(domMetrics.fingerprints.map(f => f.category));
        const onlyBasicAPIs = Array.from(uniqueCategories).every(cat => cat === 'Hardware/System API' || cat === 'Screen Metrics');
        
        if (onlyBasicAPIs) {
          deductions.push({ 
            category: "System Query", 
            detail: `${fingerprintsCount} standard hardware/screen API read(s) detected (non-tracking)`, 
            penalty: 0 
          });
        } else {
          penalty = hasCanvas ? 25 : Math.min(fingerprintsCount * 5, 20);
          deductions.push({ category: "Fingerprinting", detail: `${fingerprintsCount} device API access attempt(s) detected`, penalty });
        }
      }
    }
    score -= penalty;
  }

  // Apply Active Protection Shield Bonus
  const shieldsToggle = document.getElementById("popup-shields-toggle") || document.getElementById("active-shields-toggle");
  const shieldsActive = shieldsToggle ? shieldsToggle.checked : false;
  if (shieldsActive) {
    score += 15;
    deductions.unshift({ 
      category: "Shield Active", 
      detail: "Active protection shield is guarding your device (+15 pts)", 
      penalty: -15 
    });
  }

  // Clean score bounds
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Determine Risk Level
  let riskLevel = "Unknown";
  if (score >= 80) riskLevel = "Low";
  else if (score >= 50) riskLevel = "Medium";
  else riskLevel = "High";

  // Structure details for Dashboard to read
  return {
    domain,
    url,
    score,
    riskLevel,
    scanTime: new Date().toISOString(),
    metrics: {
      isHttps: domMetrics.isHttps,
      trackerCount,
      trackersList: domMetrics.trackers,
      fingerprintsCount,
      fingerprintsList: domMetrics.fingerprints || [],
      cookieCount,
      cookiesList: (cookies || []).map(c => ({
        name: c.name,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        session: c.session,
        expirationDate: c.expirationDate
      })),
      scriptCount,
      storageCount,
      formFields: domMetrics.formFields
    },
    deductions
  };
}

/**
 * Redirects to the full report dashboard
 */
function handleReportClick() {
  console.log("View Full Report clicked. Opening dashboard...");
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: "OPEN_DASHBOARD" });
  } else {
    // Open relative path in browser context for offline/demo page review
    window.open("../dashboard/dashboard.html", "_blank");
  }
}

/**
 * Helper to update the UI elements with new privacy metrics.
 * @param {string} domain - The website domain name
 * @param {number|null} score - Privacy score from 0-100 (null for unknown)
 * @param {string} riskLevel - "Unknown", "Low", "Medium", "High"
 */
function updatePrivacyMetrics(domain, score, riskLevel) {
  // Update website name
  const websiteEl = document.getElementById("website-name");
  if (websiteEl) {
    websiteEl.textContent = domain;
    websiteEl.classList.remove("loading");
  }

  // Update privacy score
  const scoreEl = document.getElementById("score-value");
  const scoreStatusEl = document.getElementById("score-status");
  if (scoreEl) {
    scoreEl.textContent = score !== null ? `${score}` : "--";
  }
  if (scoreStatusEl) {
    scoreStatusEl.textContent = score !== null ? "Analyzed" : "Not analyzed";
  }

  // Animate the score ring
  const circle = document.getElementById("score-ring");
  if (circle) {
    const strokeDash = score !== null ? score : 0;
    circle.style.strokeDasharray = `${strokeDash}, 100`;

    // Apply color based on risk level
    if (riskLevel === "Low") {
      circle.style.stroke = "#10B981"; // Success Green
    } else if (riskLevel === "Medium") {
      circle.style.stroke = "#F59E0B"; // Warning Orange
    } else if (riskLevel === "High") {
      circle.style.stroke = "#EF4444"; // Danger Red
    } else {
      circle.style.stroke = "#2563EB"; // Default Blue
    }
  }

  // Update risk text and badges
  const riskEl = document.getElementById("risk-level");
  if (riskEl) {
    riskEl.textContent = riskLevel;
    // Reset classes
    riskEl.className = "risk-badge";
    riskEl.classList.add(`risk-${riskLevel.toLowerCase()}`);
  }
}

function reloadAndScanTab(tabId) {
  const analyzeBtn = document.getElementById("analyze-btn");
  if (analyzeBtn) {
    analyzeBtn.textContent = "Reloading page...";
    analyzeBtn.disabled = true;
  }

  const listener = (updatedTabId, changeInfo, tab) => {
    if (updatedTabId === tabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      if (analyzeBtn) {
        analyzeBtn.textContent = "Scanning page...";
      }
      setTimeout(() => {
        handleAnalyzeClick();
      }, 500);
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
}

/**
 * Handle shields toggle status change from popup.
 */
function handlePopupShieldsChange(e) {
  if (!activeTab) return;
  const enabled = e.target.checked;
  const url = new URL(activeTab.url);
  const domain = url.hostname;

  chrome.storage.local.set({ ["shield_" + domain]: enabled }, () => {
    // Set/remove cookie for synchronous cold start protection
    if (enabled) {
      chrome.cookies.set({
        url: activeTab.url,
        name: "_privacyLens_shield",
        value: "true",
        domain: domain.startsWith("www.") ? domain.substring(4) : domain,
        path: "/"
      });
    } else {
      chrome.cookies.remove({
        url: activeTab.url,
        name: "_privacyLens_shield"
      });
    }

    chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: (shieldEnabled) => {
        if (shieldEnabled) {
          sessionStorage.setItem('_privacyLens_shield', 'true');
        } else {
          sessionStorage.removeItem('_privacyLens_shield');
        }
        location.reload();
      },
      args: [enabled]
    }, () => {
      reloadAndScanTab(activeTab.id);
    });
  });
}

/**
 * Categorize cookies inside popup context.
 */
function categorizeCookie(name, domain) {
  const trackerNames = [
    '_ga', '_gid', '_fbp', '_fbc', '_gat', '_gcl_au', 
    'ysc', 'visitor_info1_live', 'gps', 'pref',
    '__utma', '__utmb', '__utmc', '__utmt', '__utmz',
    '__qca', 'mc', 'fr', 'personalization_id'
  ];
  const trackerDomains = [
    'doubleclick.net', 'google-analytics.com', 'facebook.com', 
    'adnxs.com', 'rubiconproject.com', 'pubmatic.com', 'casalemedia.com'
  ];
  
  const lowerName = name.toLowerCase();
  const lowerDomain = domain.toLowerCase();
  
  if (trackerNames.some(t => lowerName === t || lowerName.startsWith(t + '_')) ||
      trackerDomains.some(d => lowerDomain.includes(d))) {
    return { label: "Tracker/Analytics", type: "tracker" };
  }
  
  const essentialNames = ['sid', 'hsid', 'ssid', 'apisid', 'sapisid', 'login_info', 'session_id', 'token', 'auth', 'jwt', 'connect.sid'];
  if (essentialNames.some(e => lowerName.includes(e))) {
    return { label: "Essential/Session", type: "essential" };
  }
  
  return { label: "Utility/Other", type: "other" };
}

/**
 * Handle purging tracking cookies from popup.
 */
function handlePopupPurgeTrackers() {
  if (!activeTab) return;
  const url = new URL(activeTab.url);

  if (!confirm("Are you sure you want to purge only the tracking cookies for this site? Your login session should be preserved.")) {
    return;
  }

  chrome.cookies.getAll({ url: activeTab.url }, (cookies) => {
    if (!cookies || cookies.length === 0) {
      alert("No cookies found for this site.");
      return;
    }

    let purgedCount = 0;
    let pending = 0;

    cookies.forEach(cookie => {
      const cat = categorizeCookie(cookie.name, cookie.domain);
      if (cat.type === "tracker") {
        pending++;
        const cookieUrl = (cookie.secure ? "https://" : "http://") + cookie.domain.replace(/^\./, "") + cookie.path;
        chrome.cookies.remove({ url: cookieUrl, name: cookie.name }, (result) => {
          if (result) {
            purgedCount++;
          }
          pending--;
          if (pending === 0) {
            alert(`Successfully purged ${purgedCount} tracker cookie(s). Reloading and re-scanning page...`);
            chrome.tabs.reload(activeTab.id, {}, () => {
              const analyzeBtn = document.getElementById("analyze-btn");
              if (analyzeBtn) {
                analyzeBtn.textContent = "Scanning...";
                analyzeBtn.disabled = true;
              }
              setTimeout(() => {
                handleAnalyzeClick();
              }, 1500);
            });
          }
        });
      }
    });

    if (pending === 0) {
      alert("No tracking cookies were found to purge.");
    }
  });
}
