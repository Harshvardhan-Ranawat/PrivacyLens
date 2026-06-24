// PrivacyLens Dashboard Script
console.log("PrivacyLens Dashboard Loaded");

let currentDomain = "";
let currentUrl = "";

document.addEventListener("DOMContentLoaded", () => {
  loadDashboardData();
  
  const printBtn = document.getElementById("download-pdf-btn");
  if (printBtn) {
    printBtn.addEventListener("click", () => window.print());
  }

  const clearBtn = document.getElementById("clear-history-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearScanHistory);
  }

  const purgeTrackersBtn = document.getElementById("purge-trackers-btn");
  if (purgeTrackersBtn) {
    purgeTrackersBtn.addEventListener("click", () => purgeCookies(true));
  }

  const purgeAllCookiesBtn = document.getElementById("purge-all-cookies-btn");
  if (purgeAllCookiesBtn) {
    purgeAllCookiesBtn.addEventListener("click", () => purgeCookies(false));
  }

  const activeShieldsToggle = document.getElementById("active-shields-toggle");
  if (activeShieldsToggle) {
    activeShieldsToggle.addEventListener("change", handleShieldsChange);
  }

  // Listen for storage updates to keep the dashboard synchronized in real-time
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && (changes.lastScanData || changes.scanHistory)) {
        console.log("PrivacyLens: Storage updated. Reloading dashboard...");
        loadDashboardData();
      }
    });
  }

  initSidebarNavigation();
});

/**
 * Fetch cached scan metrics from background service worker and render UI.
 */
function loadDashboardData() {
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: "GET_SCAN_DATA" }, (response) => {
      if (response && response.data) {
        renderDashboard(response.data);
      } else {
        showEmptyState();
      }
    });
    loadScanHistory();
  } else {
    // Show mock scan data for local development/web testing!
    console.log("PrivacyLens: Extension environment not detected. Loading demo data.");
    loadMockData();
  }
}

/**
 * Loads scan history
 */
function loadScanHistory() {
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: "GET_SCAN_HISTORY" }, (response) => {
      renderHistoryTable(response && response.data ? response.data : []);
    });
  }
}

/**
 * Clears scan history
 */
function clearScanHistory() {
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: "CLEAR_SCAN_HISTORY" }, (response) => {
      renderHistoryTable([]);
    });
  } else {
    renderHistoryTable([]);
  }
}

/**
 * Loads premium mock data for direct browser viewing.
 */
function loadMockData() {
  const mockMetrics = {
    isHttps: true,
    trackerCount: 2,
    trackersList: ["Google Analytics", "Meta/Facebook Pixel"],
    cookieCount: 18,
    cookiesList: [
      { name: "_ga", domain: ".demo-shop.com", path: "/", secure: false, httpOnly: false, session: false, expirationDate: Math.floor(Date.now() / 1000) + 3600 * 24 * 365 },
      { name: "_gid", domain: ".demo-shop.com", path: "/", secure: false, httpOnly: false, session: false, expirationDate: Math.floor(Date.now() / 1000) + 3600 * 24 },
      { name: "_fbp", domain: ".demo-shop.com", path: "/", secure: true, httpOnly: false, session: false, expirationDate: Math.floor(Date.now() / 1000) + 3600 * 24 * 90 },
      { name: "session_id", domain: "demo-shop.com", path: "/", secure: true, httpOnly: true, session: true, expirationDate: null },
      { name: "cart_token", domain: "demo-shop.com", path: "/", secure: true, httpOnly: false, session: false, expirationDate: Math.floor(Date.now() / 1000) + 3600 * 12 },
      { name: "user_preferences", domain: "demo-shop.com", path: "/settings", secure: true, httpOnly: false, session: false, expirationDate: Math.floor(Date.now() / 1000) + 3600 * 24 * 30 }
    ],
    scriptCount: 38,
    storageCount: 14,
    formFields: 3,
    fingerprintsCount: 2,
    fingerprintsList: [
      { category: "Canvas Fingerprinting", detail: "Read Canvas Pixels (toDataURL)", timestamp: Date.now() },
      { category: "Hardware/System API", detail: "Read navigator.hardwareConcurrency", timestamp: Date.now() }
    ]
  };

  const calculated = calculatePrivacyDetails("demo-shop.com", "https://demo-shop.com", {
    scriptCount: mockMetrics.scriptCount,
    trackers: mockMetrics.trackersList,
    localStorageCount: 10,
    sessionStorageCount: 4,
    isHttps: mockMetrics.isHttps,
    formFields: mockMetrics.formFields,
    fingerprints: mockMetrics.fingerprintsList
  }, mockMetrics.cookiesList);

  calculated.metrics.cookiesList = mockMetrics.cookiesList;
  calculated.scanTime = new Date().toISOString();

  renderDashboard(calculated);

  const mockHistory = [
    { domain: "demo-shop.com", score: calculated.score, riskLevel: calculated.riskLevel, trackerCount: 2, scanTime: new Date().toISOString() },
    { domain: "secure-bank.com", score: 100, riskLevel: "Low", trackerCount: 0, scanTime: new Date(Date.now() - 86400000).toISOString() },
    { domain: "news-daily.com", score: 35, riskLevel: "High", trackerCount: 14, scanTime: new Date(Date.now() - 172800000).toISOString() }
  ];
  renderHistoryTable(mockHistory);
}

/**
 * Renders the dashboard with real scan data.
 */
function renderDashboard(data) {
  const { domain, url, score, riskLevel, scanTime, metrics, deductions } = data;
  currentDomain = domain;
  currentUrl = url;

  // Set Active Protection toggle state
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["shield_" + domain], (result) => {
      const enabled = !!result["shield_" + domain];
      const toggle = document.getElementById("active-shields-toggle");
      if (toggle) {
        toggle.checked = enabled;
      }
      updateShieldWidgetState(enabled);
    });
  } else {
    const toggle = document.getElementById("active-shields-toggle");
    updateShieldWidgetState(toggle ? toggle.checked : false);
  }

  // 1. Title and basic headers
  document.getElementById("domain-title").textContent = domain;
  
  const scanDate = new Date(scanTime);
  document.getElementById("scan-time-txt").textContent = `Scan executed: ${scanDate.toLocaleString()}`;

  // 2. Set HTTPS protocol badge
  const protocolBadge = document.getElementById("protocol-badge");
  if (protocolBadge) {
    if (metrics.isHttps) {
      protocolBadge.textContent = "HTTPS Secure";
      protocolBadge.className = "badge badge-secure";
    } else {
      protocolBadge.textContent = "HTTP Insecure";
      protocolBadge.className = "badge badge-insecure";
    }
  }

  // 3. Set Risk Badge
  const riskBadge = document.getElementById("risk-badge");
  if (riskBadge) {
    riskBadge.textContent = `Risk: ${riskLevel}`;
    riskBadge.className = `badge-risk risk-${riskLevel.toLowerCase()}`;
  }

  // 4. Update and Animate Score Ring
  const scoreNumEl = document.getElementById("score-value");
  const scoreRingEl = document.getElementById("score-ring");
  
  if (scoreNumEl) scoreNumEl.textContent = score;
  if (scoreRingEl) {
    // Animate dasharray
    setTimeout(() => {
      scoreRingEl.style.strokeDasharray = `${score}, 100`;
    }, 100);

    // Apply color based on risk
    if (riskLevel === "Low") {
      scoreRingEl.style.stroke = "#10B981"; // Emerald
    } else if (riskLevel === "Medium") {
      scoreRingEl.style.stroke = "#F59E0B"; // Amber
    } else if (riskLevel === "High") {
      scoreRingEl.style.stroke = "#EF4444"; // Rose
    }
  }

  // 5. Update Score Summary Headlines
  const scoreHeadline = document.getElementById("score-headline");
  const scoreDesc = document.getElementById("score-desc");
  if (scoreHeadline && scoreDesc) {
    if (riskLevel === "Low") {
      scoreHeadline.textContent = "Privacy Profile: Solid";
      scoreDesc.textContent = "This website respects user privacy. It utilizes HTTPS encryption, has very few data storage records, and does not run popular ad trackers.";
    } else if (riskLevel === "Medium") {
      scoreHeadline.textContent = "Privacy Profile: Moderate Exposure";
      
      let factors = [];
      if (!metrics.isHttps) {
        factors.push("lacks HTTPS encryption");
      }
      if (metrics.trackerCount > 0) {
        factors.push("loads third-party advertising/analytics trackers");
      }
      if (metrics.cookieCount > 10) {
        factors.push("deposits a moderate volume of cookies");
      }
      if (metrics.fingerprintsCount > 0) {
        factors.push("accesses browser APIs commonly used for device fingerprinting");
      }
      
      if (factors.length > 0) {
        let factorsText = "";
        if (factors.length === 1) {
          factorsText = factors[0];
        } else if (factors.length === 2) {
          factorsText = `${factors[0]} and ${factors[1]}`;
        } else {
          factorsText = `${factors.slice(0, -1).join(", ")}, and ${factors[factors.length - 1]}`;
        }
        scoreDesc.textContent = `This site has some privacy exposure because it ${factorsText}.`;
      } else {
        scoreDesc.textContent = "This site has some tracking exposure. It either drops several trackers or deposits high volumes of cookies to track your sessions across visits.";
      }
    } else {
      scoreHeadline.textContent = "Privacy Profile: High Exposure Warning";
      
      const hasSecurityThreat = deductions && deductions.some(d => d.category === "Security Threat");
      let desc = "CRITICAL: This site has significant privacy and security issues. ";
      
      if (hasSecurityThreat) {
        desc += "Malicious API usage was detected, such as attempts to hijack or write to your clipboard without consent.";
      } else {
        let issues = [];
        if (!metrics.isHttps) {
          issues.push("lacking HTTPS encryption (data is transmitted insecurely)");
        }
        if (metrics.trackerCount > 0) {
          issues.push(`loading ${metrics.trackerCount} ad/analytics tracker(s)`);
        }
        if (metrics.fingerprintsCount > 0) {
          const hasCanvas = metrics.fingerprintsList && metrics.fingerprintsList.some(f => f.category === 'Canvas Fingerprinting');
          issues.push(hasCanvas ? "attempting device canvas fingerprinting" : "accessing browser APIs to profile your device");
        }
        if (metrics.cookieCount > 15) {
          issues.push(`storing a high volume of cookies (${metrics.cookieCount})`);
        }
        
        if (issues.length > 0) {
          let issuesText = "";
          if (issues.length === 1) {
            issuesText = issues[0];
          } else if (issues.length === 2) {
            issuesText = `${issues[0]} and ${issues[1]}`;
          } else {
            issuesText = `${issues.slice(0, -1).join(", ")}, and ${issues[issues.length - 1]}`;
          }
          desc += `The scan identified high exposure indicators including ${issuesText}.`;
        } else {
          desc += "It may load multiple advertising/social pixel trackers or have a high script/telemetry footprint designed to monitor your behavior.";
        }
      }
      scoreDesc.textContent = desc;
    }
  }

  // 6. Populate Telemetry Summary counts
  document.getElementById("stat-cookies").textContent = metrics.cookieCount;
  document.getElementById("stat-trackers").textContent = metrics.trackerCount;
  document.getElementById("stat-scripts").textContent = metrics.scriptCount;
  document.getElementById("stat-storage").textContent = metrics.storageCount;
  
  const statFingerprintsEl = document.getElementById("stat-fingerprints");
  if (statFingerprintsEl) statFingerprintsEl.textContent = metrics.fingerprintsCount || 0;

  // 7. Render Risk Deductions List
  const deductionsListEl = document.getElementById("deductions-list");
  if (deductionsListEl) {
    if (deductions && deductions.length > 0) {
      deductionsListEl.innerHTML = "";
      deductions.forEach(item => {
        const itemEl = document.createElement("div");
        itemEl.className = "deduction-item";
        itemEl.innerHTML = `
          <div class="deduction-info">
            <span class="deduction-category">${item.category}</span>
            <span class="deduction-text">${item.detail}</span>
          </div>
          <span class="deduction-penalty">-${item.penalty} pts</span>
        `;
        deductionsListEl.appendChild(itemEl);
      });
    } else {
      deductionsListEl.innerHTML = `<div class="no-deductions-msg">✨ Excellent! No privacy deductions computed.</div>`;
    }
  }

  // 8. Render Trackers list
  const trackersContainerEl = document.getElementById("trackers-list-container");
  if (trackersContainerEl) {
    if (metrics.trackersList && metrics.trackersList.length > 0) {
      trackersContainerEl.innerHTML = "";
      metrics.trackersList.forEach(tracker => {
        const trackerEl = document.createElement("div");
        trackerEl.className = "tracker-item";
        trackerEl.innerHTML = `
          <div class="tracker-name-wrapper">
            <span class="tracker-bullet"></span>
            <span class="tracker-name">${tracker}</span>
          </div>
          <span class="tracker-badge">Analytics/Ad Network</span>
        `;
        trackersContainerEl.appendChild(trackerEl);
      });
    } else {
      trackersContainerEl.innerHTML = `<div class="empty-list-msg">No third-party trackers detected.</div>`;
    }
  }

  // 8.5 Render Fingerprints list
  const fingerprintsContainerEl = document.getElementById("fingerprints-list-container");
  if (fingerprintsContainerEl) {
    if (metrics.fingerprintsList && metrics.fingerprintsList.length > 0) {
      fingerprintsContainerEl.innerHTML = "";
      metrics.fingerprintsList.forEach(fp => {
        const fpEl = document.createElement("div");
        fpEl.className = "tracker-item";
        fpEl.innerHTML = `
          <div class="tracker-name-wrapper">
            <span class="tracker-bullet" style="background: #a855f7;"></span>
            <span class="tracker-name">${fp.category}: ${fp.detail}</span>
          </div>
          <span class="tracker-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc;">Fingerprinting API</span>
        `;
        fingerprintsContainerEl.appendChild(fpEl);
      });
    } else {
      fingerprintsContainerEl.innerHTML = `<div class="empty-list-msg">No device fingerprinting API access detected.</div>`;
    }
  }

  // 9. Generate Recommendations List
  renderRecommendations(metrics);

  // 10. Render Cookies Table
  renderCookiesTable(metrics.cookiesList);
}

/**
 * Builds actionable recommendations.
 */
function renderRecommendations(metrics) {
  const container = document.getElementById("recommendations-container");
  if (!container) return;

  container.innerHTML = "";
  const recs = [];

  // Security Recommendation
  if (!metrics.isHttps) {
    recs.push({
      icon: "🔒",
      title: "Encrypted Connections Required",
      desc: "This site does not use HTTPS. Do not enter credentials, financial information, or personal identifiers."
    });
  } else {
    recs.push({
      icon: "✅",
      title: "HTTPS Encryption Active",
      desc: "Your connection is encrypted, preventing local network eavesdropping on the contents of this site."
    });
  }

  // Tracker Recommendation
  if (metrics.trackerCount > 0) {
    recs.push({
      icon: "🛡️",
      title: "Use Content Blockers",
      desc: `Detected ${metrics.trackerCount} tracking networks. Consider installing Privacy Badger or uBlock Origin to block tracking beacons.`
    });
  }

  // Cookie Recommendation
  if (metrics.cookieCount > 15) {
    recs.push({
      icon: "🧹",
      title: "Perform Cookie Cleanup",
      desc: `This website sets a high volume of cookies (${metrics.cookieCount}). Clear cookies periodically to limit session persistence.`
    });
  }

  // Fingerprinting Recommendation
  if (metrics.fingerprintsCount > 0) {
    const hasCanvas = metrics.fingerprintsList && metrics.fingerprintsList.some(f => f.category === 'Canvas Fingerprinting');
    recs.push({
      icon: "💻",
      title: hasCanvas ? "Canvas Fingerprinting Detected" : "Hardware Fingerprinting Detected",
      desc: "This website is profiling your specific device to track you without cookies. Consider using a privacy extension that randomizes Canvas and Hardware fingerprints."
    });
  }

  // Form Fields on insecure site
  if (!metrics.isHttps && metrics.formFields > 0) {
    recs.push({
      icon: "⚠️",
      title: "Insecure Forms Detected",
      desc: "There are input fields on an HTTP connection. Avoid submitting any sensitive data on this page."
    });
  }

  // Fallback if clean
  if (recs.length === 1 && metrics.isHttps) {
    recs.push({
      icon: "🌟",
      title: "Keep it up!",
      desc: "This site shows excellent privacy indicators. Continue using secure, tracker-free sites whenever possible."
    });
  }

  recs.forEach(rec => {
    const recEl = document.createElement("div");
    recEl.className = "rec-item";
    recEl.innerHTML = `
      <span class="rec-icon">${rec.icon}</span>
      <div class="rec-details">
        <span class="rec-title">${rec.title}</span>
        <span class="rec-desc">${rec.desc}</span>
      </div>
    `;
    container.appendChild(recEl);
  });
}

/**
 * Render cookies into the data table.
 */
let allCookiesData = []; // Cache globally to support live filtering

function renderCookiesTable(cookies) {
  allCookiesData = cookies || [];
  const tableBody = document.getElementById("cookies-table-body");
  const searchInput = document.getElementById("cookie-search");

  if (!tableBody) return;

  displayFilteredCookies(allCookiesData);

  // Setup search input listener
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.toLowerCase().trim();
      const filtered = allCookiesData.filter(cookie => {
        const cat = categorizeCookie(cookie.name, cookie.domain);
        return cookie.name.toLowerCase().includes(query) || 
               cookie.domain.toLowerCase().includes(query) ||
               (cat && cat.label && cat.label.toLowerCase().includes(query));
      });
      displayFilteredCookies(filtered);
    });
  }
}

/**
 * Filter display helper.
 */
function displayFilteredCookies(cookiesList) {
  const tableBody = document.getElementById("cookies-table-body");
  if (!tableBody) return;

  if (cookiesList.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-table-msg">No matching cookies found.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = "";
  cookiesList.forEach(cookie => {
    const tr = document.createElement("tr");
    
    // HTTPOnly indicator
    const httpOnly = cookie.httpOnly 
      ? '<span class="status-indicator status-yes">Yes</span>' 
      : '<span class="status-indicator status-no">No</span>';

    // Secure indicator
    const secure = cookie.secure 
      ? '<span class="status-indicator status-yes">Yes</span>' 
      : '<span class="status-indicator status-no">No</span>';

    // Session indicator
    const session = cookie.session 
      ? '<span class="status-indicator status-yes">Yes</span>' 
      : '<span class="status-indicator status-no">No</span>';

    // Expiry date format
    let expiration = "Session";
    if (!cookie.session && cookie.expirationDate) {
      const date = new Date(cookie.expirationDate * 1000);
      expiration = date.toLocaleDateString();
    }

    const cat = categorizeCookie(cookie.name, cookie.domain);
    let categoryBadge = "";
    if (cat.type === "tracker") {
      categoryBadge = '<span class="status-indicator" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); padding: 2px 6px; border-radius: 4px;">Tracker</span>';
    } else if (cat.type === "essential") {
      categoryBadge = '<span class="status-indicator" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); padding: 2px 6px; border-radius: 4px;">Essential</span>';
    } else {
      categoryBadge = '<span class="status-indicator" style="background: rgba(100, 116, 139, 0.2); color: #94a3b8; border: 1px solid rgba(100, 116, 139, 0.4); padding: 2px 6px; border-radius: 4px;">Utility</span>';
    }

    tr.innerHTML = `
      <td class="cookie-name" title="${escapeHtml(cookie.name)}">${escapeHtml(cookie.name)}</td>
      <td class="cookie-domain">${escapeHtml(cookie.domain)}</td>
      <td>${categoryBadge}</td>
      <td>${escapeHtml(cookie.path)}</td>
      <td>${httpOnly}</td>
      <td>${secure}</td>
      <td>${session}</td>
      <td>${expiration}</td>
    `;
    tableBody.appendChild(tr);
  });
}

/**
 * Sanitizes input variables to avoid XSS injections
 */
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Show placeholder dashboard.
 */
function showEmptyState() {
  document.getElementById("domain-title").textContent = "No Scan Data Found";
  document.getElementById("scan-time-txt").textContent = "Please go to a website, open the PrivacyLens extension popup, and click 'Analyze Current Website'.";

  const activeShieldsToggle = document.getElementById("active-shields-toggle");
  if (activeShieldsToggle) {
    activeShieldsToggle.disabled = true;
    const parentContainer = activeShieldsToggle.closest('.shield-toggle-container');
    if (parentContainer) {
      parentContainer.style.opacity = '0.5';
      parentContainer.style.pointerEvents = 'none';
    }
  }
}

/**
 * Renders the scan history table.
 */
function renderHistoryTable(history) {
  const tbody = document.getElementById("history-table-body");
  if (!tbody) return;

  if (!history || history.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-table-msg">No scan history available.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  history.forEach(item => {
    const tr = document.createElement("tr");
    
    let badgeClass = "risk-unknown";
    if (item.riskLevel === "Low") badgeClass = "risk-low";
    if (item.riskLevel === "Medium") badgeClass = "risk-medium";
    if (item.riskLevel === "High") badgeClass = "risk-high";

    const scanDate = new Date(item.scanTime);
    const timeStr = isNaN(scanDate.getTime()) ? "Unknown" : scanDate.toLocaleString();

    tr.innerHTML = `
      <td style="font-weight: 500;">${escapeHtml(item.domain || "Unknown")}</td>
      <td><span class="badge-risk ${badgeClass}" style="font-size: 0.75rem; padding: 2px 8px;">${escapeHtml(item.riskLevel || "Unknown")}</span></td>
      <td><strong>${escapeHtml(String(item.score))}</strong>/100</td>
      <td>${escapeHtml(String(item.trackerCount))}</td>
      <td style="color: #64748b; font-size: 0.85rem;">${escapeHtml(timeStr)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Categorize cookies as Trackers, Essential, or Other.
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
 * Purge cookies for the active domain.
 */
function purgeCookies(onlyTrackers = false) {
  if (!currentUrl) {
    alert("No active scan url loaded. Please scan a page first.");
    return;
  }
  
  if (typeof chrome === "undefined" || !chrome.cookies) {
    alert("Cookie deletion is only available when running as an extension.");
    return;
  }

  const confirmMsg = onlyTrackers 
    ? "Are you sure you want to purge only the tracking cookies for this site? Your login session should be preserved."
    : "Are you sure you want to purge ALL cookies for this site? This will log you out of your accounts.";
    
  if (!confirm(confirmMsg)) return;

  chrome.cookies.getAll({ url: currentUrl }, (cookies) => {
    if (!cookies || cookies.length === 0) {
      alert("No cookies found for this site.");
      return;
    }

    let purgedCount = 0;
    let pending = 0;

    cookies.forEach(cookie => {
      const cat = categorizeCookie(cookie.name, cookie.domain);
      if (!onlyTrackers || cat.type === "tracker") {
        pending++;
        const cookieUrl = (cookie.secure ? "https://" : "http://") + cookie.domain.replace(/^\./, "") + cookie.path;
        chrome.cookies.remove({ url: cookieUrl, name: cookie.name }, (result) => {
          if (result) {
            purgedCount++;
          }
          pending--;
          if (pending === 0) {
            finishPurge(purgedCount);
          }
        });
      }
    });

    if (pending === 0) {
      alert("No matching cookies were found to purge.");
    }
  });
}

function finishPurge(count) {
  alert(`Successfully purged ${count} cookie(s). Reloading target website tab to apply changes and re-running scan...`);
  
  chrome.tabs.query({}, (tabs) => {
    const targetTab = tabs && tabs.find(tab => tab.url && new URL(tab.url).hostname === currentDomain);
    if (targetTab) {
      const listener = (updatedTabId, changeInfo, tab) => {
        if (updatedTabId === targetTab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => {
            triggerExtensionScan(targetTab);
          }, 500);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.reload(targetTab.id);
    } else {
      loadDashboardData();
    }
  });
}

/**
 * Handle shields toggle status change.
 */
function handleShieldsChange(e) {
  const enabled = e.target.checked;
  updateShieldWidgetState(enabled);
  
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    console.log("Shield settings are simulated in mock mode.");
    loadMockData();
    return;
  }

  chrome.storage.local.set({ ["shield_" + currentDomain]: enabled }, () => {
    // Set/remove cookie for synchronous cold start protection
    if (enabled) {
      chrome.cookies.set({
        url: currentUrl,
        name: "_privacyLens_shield",
        value: "true",
        domain: currentDomain.startsWith("www.") ? currentDomain.substring(4) : currentDomain,
        path: "/"
      });
    } else {
      chrome.cookies.remove({
        url: currentUrl,
        name: "_privacyLens_shield"
      });
    }

    chrome.tabs.query({}, (tabs) => {
      const targetTab = tabs && tabs.find(tab => tab.url && new URL(tab.url).hostname === currentDomain);
      if (targetTab) {
        // Inject settings to sessionStorage of target tab synchronously
        chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
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
          // Listen for completion and then scan
          const listener = (updatedTabId, changeInfo, tab) => {
            if (updatedTabId === targetTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              setTimeout(() => {
                triggerExtensionScan(targetTab);
              }, 500);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      }
    });
  });
}

/**
 * Trigger DOM/cookie scan on tab from dashboard.
 */
function triggerExtensionScan(activeTab) {
  const url = new URL(activeTab.url);
  const domain = url.hostname;

  chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    world: "MAIN",
    func: scanDOM
  }).then(injectionResults => {
    const domMetrics = (injectionResults && injectionResults[0] && injectionResults[0].result) || {
      scriptCount: 0,
      trackers: [],
      localStorageCount: 0,
      sessionStorageCount: 0,
      isHttps: url.protocol === "https:",
      formFields: 0
    };

    chrome.cookies.getAll({ url: activeTab.url }, (cookies) => {
      const analysisResult = calculatePrivacyDetails(domain, activeTab.url, domMetrics, cookies);
      chrome.runtime.sendMessage({ 
        action: "SET_SCAN_DATA", 
        data: analysisResult 
      }, () => {
        renderDashboard(analysisResult);
        loadScanHistory();
      });
    });
  }).catch(err => {
    console.error("Dashboard trigger scan failed:", err);
  });
}

// Copy-paste scanners from popup.js
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

  let documentCookieCount = 0;
  try {
    documentCookieCount = document.cookie ? document.cookie.split(";").length : 0;
  } catch (e) {}

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

function calculatePrivacyDetails(domain, url, domMetrics, cookies) {
  let score = 100;
  const deductions = [];

  if (!domMetrics.isHttps) {
    score -= 35;
    deductions.push({ category: "Security", detail: "Site does not use HTTPS", penalty: 35 });
  }

  const trackerCount = domMetrics.trackers.length;
  if (trackerCount > 0) {
    const penalty = Math.min(trackerCount * 15, 45);
    score -= penalty;
    deductions.push({ category: "Trackers", detail: `${trackerCount} advertising/analytic tracker(s) found`, penalty });
  }

  const cookieCount = cookies ? cookies.length : 0;
  if (cookieCount > 0) {
    const penalty = Math.min(cookieCount * 1.5, 20);
    score -= penalty;
    deductions.push({ category: "Cookies", detail: `${cookieCount} cookie(s) stored on browser`, penalty });
  }

  const scriptCount = domMetrics.scriptCount;
  if (scriptCount > 25) {
    const penalty = scriptCount > 50 ? 15 : 8;
    score -= penalty;
    deductions.push({ category: "Scripts", detail: `${scriptCount} scripts loaded on page (High script activity increases exposure)`, penalty });
  }

  const storageCount = domMetrics.localStorageCount + domMetrics.sessionStorageCount;
  if (storageCount > 10) {
    score -= 5;
    deductions.push({ category: "Storage", detail: `Large local/session storage utilization (${storageCount} entries)`, penalty: 5 });
  }

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
        penalty = 100;
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

  let riskLevel = "Unknown";
  if (score >= 80) riskLevel = "Low";
  else if (score >= 50) riskLevel = "Medium";
  else riskLevel = "High";

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
 * Update the sidebar shield status widget visuals.
 */
function updateShieldWidgetState(enabled) {
  const indicator = document.getElementById("widget-shield-indicator");
  const textEl = document.getElementById("widget-shield-text");
  if (indicator) {
    indicator.className = "status-dot " + (enabled ? "active" : "inactive");
  }
  if (textEl) {
    textEl.textContent = enabled ? "Shields Enabled" : "Shields Disabled";
    textEl.className = "status-txt " + (enabled ? "active" : "inactive");
  }

  // Update header Active Protection container styles dynamically
  const container = document.getElementById("dashboard-shield-container");
  if (container) {
    if (enabled) {
      container.className = "shield-toggle-container active";
    } else {
      container.className = "shield-toggle-container inactive";
    }
  }
}

/**
 * Setup scroll spy and click handlers for sidebar menu navigation.
 */
function initSidebarNavigation() {
  const menuItems = document.querySelectorAll(".sidebar-menu .menu-item");
  const sections = document.querySelectorAll("section[id]");
  const contentArea = document.querySelector(".content-area");

  // Highlight helper for bottom scroll detection
  const checkAndHighlight = () => {
    const isWindowScrollable = document.documentElement.scrollHeight > window.innerHeight;
    const isWindowBottom = isWindowScrollable 
      ? (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 60) 
      : false;
      
    const isContentScrollable = contentArea ? (contentArea.scrollHeight > contentArea.clientHeight) : false;
    const isContentBottom = isContentScrollable 
      ? (contentArea.scrollTop + contentArea.clientHeight >= contentArea.scrollHeight - 60) 
      : false;
    
    if (isWindowBottom || isContentBottom) {
      menuItems.forEach(item => {
        if (item.getAttribute("href") === "#section-history") {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });
      return true;
    }
    return false;
  };

  // Setup IntersectionObserver for auto-active state on scroll
  const observerOptions = {
    root: null, // viewport
    rootMargin: "-20% 0px -60% 0px", // triggers when section is in middle of viewport
    threshold: 0
  };

  const observer = new IntersectionObserver((entries) => {
    if (checkAndHighlight()) return;

    // Track all currently intersecting sections to handle side-by-side components
    // (IntersectionObserver fires with multiple entries on page load/resize/fast scrolling)
    const intersecting = [];
    sections.forEach(section => {
      // Check active visibility based on custom bounding rectangle or simple flag
      // Wait, we can check if the section is currently intersecting using a Map or standard property
      // But since IntersectionObserver entries list what changed, let's keep a local active set!
    });

    // An elegant way: find which target is actually intersecting.
    // Let's use a module-level variable or query selectors to find currently visible sections
    const visibleSections = Array.from(sections).filter(s => {
      const rect = s.getBoundingClientRect();
      // Section is considered visible if its top is in the upper part of the screen
      return rect.top < window.innerHeight * 0.5 && rect.bottom > window.innerHeight * 0.15;
    });

    if (visibleSections.length > 0) {
      // Find the one that appears first in the menu order
      let targetId = null;
      for (const item of menuItems) {
        const href = item.getAttribute("href");
        if (visibleSections.some(s => `#${s.getAttribute("id")}` === href)) {
          targetId = href.substring(1);
          break;
        }
      }

      if (targetId) {
        menuItems.forEach(item => {
          if (item.getAttribute("href") === `#${targetId}`) {
            item.classList.add("active");
          } else {
            item.classList.remove("active");
          }
        });
      }
    }
  }, observerOptions);

  sections.forEach(section => observer.observe(section));

  // Add scroll listeners to detect bottom and force active highlight on Scan History
  window.addEventListener("scroll", checkAndHighlight);
  if (contentArea) {
    contentArea.addEventListener("scroll", checkAndHighlight);
  }

  // Add instant click response
  menuItems.forEach(item => {
    item.addEventListener("click", () => {
      menuItems.forEach(mi => mi.classList.remove("active"));
      item.classList.add("active");
    });
  });
}
