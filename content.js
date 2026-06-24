// PrivacyLens Content Script
// Runs at document_start in the MAIN world to monitor fingerprinting APIs directly.

window._privacyLensFingerprints = window._privacyLensFingerprints || [];

// Read protection setting from sessionStorage or cookie synchronously with fallback safety
let activeProtection = false;
try {
  const isCookieShield = /(?:^|; ?)_privacyLens_shield=true(?:;|$)/.test(document.cookie || "");
  const isSessionShield = sessionStorage.getItem('_privacyLens_shield') === 'true';
  activeProtection = isSessionShield || isCookieShield;
} catch (e) {
  console.warn("PrivacyLens: Storage or cookies access restricted.", e);
}

function logAttempt(category, detail, spoofed = false) {
  // Avoid duplicate logs for the same detail to prevent spam
  if (!window._privacyLensFingerprints.find(f => f.category === category && f.detail === detail)) {
    window._privacyLensFingerprints.push({ 
      category, 
      detail, 
      timestamp: Date.now(),
      spoofed: spoofed 
    });
  }
}

// --- 1. Hook Canvas & WebGL API ---
try {

  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    this._canvasContextType = type;
    return originalGetContext.apply(this, [type, ...args]);
  };

  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    logAttempt('Canvas Fingerprinting', 'Read Canvas Pixels (toDataURL)', activeProtection);
    // Only spoof if active protection is enabled AND the canvas has a 2D context
    // This avoids breaking WebGL canvas elements
    if (activeProtection && this._canvasContextType === '2d') {
      try {
        const ctx = this.getContext('2d');
        if (ctx) {
          const originalData = ctx.getImageData(0, 0, 1, 1);
          const copyData = ctx.createImageData(1, 1);
          copyData.data.set(originalData.data);
          // Add sub-perceptual noise to disrupt fingerprint hash
          copyData.data[0] = (copyData.data[0] + (Math.random() > 0.5 ? 1 : -1)) & 0xFF;
          ctx.putImageData(copyData, 0, 0);
          const result = originalToDataURL.apply(this, args);
          // Restore original pixel
          ctx.putImageData(originalData, 0, 0);
          return result;
        }
      } catch (e) {
        // Cross-origin canvas might throw error
      }
    }
    return originalToDataURL.apply(this, args);
  };

  const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  if (originalGetImageData) {
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      logAttempt('Canvas Fingerprinting', 'Read Canvas Pixels (getImageData)', activeProtection);
      const imgData = originalGetImageData.apply(this, args);
      if (activeProtection && imgData && imgData.data && imgData.data.length >= 4) {
        // Add sub-perceptual noise to the first pixel's red value
        imgData.data[0] = (imgData.data[0] + (Math.random() > 0.5 ? 1 : -1)) & 0xFF;
      }
      return imgData;
    };
  }

  // --- Hook WebGL API for Fingerprint Detection ---
  const hookWebGLReadPixels = (proto) => {
    if (!proto || !proto.readPixels) return;
    const originalReadPixels = proto.readPixels;
    proto.readPixels = function(...args) {
      logAttempt('WebGL Fingerprinting', 'Read WebGL Pixels (readPixels)', activeProtection);
      return originalReadPixels.apply(this, args);
    };
  };
  if (window.WebGLRenderingContext) hookWebGLReadPixels(WebGLRenderingContext.prototype);
  if (window.WebGL2RenderingContext) hookWebGLReadPixels(WebGL2RenderingContext.prototype);

} catch (e) {
  console.error("PrivacyLens: Failed to hook Canvas/WebGL API", e);
}

// --- 2. Hook Audio Fingerprinting ---
try {
  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
  if (OriginalAudioContext) {
    const SafeAudioContext = new Proxy(OriginalAudioContext, {
      construct(target, argumentsList) {
        logAttempt('Audio Fingerprinting', 'Created AudioContext', activeProtection);
        return Reflect.construct(target, argumentsList);
      }
    });
    window.AudioContext = SafeAudioContext;
    if (window.webkitAudioContext) window.webkitAudioContext = SafeAudioContext;
  }
} catch(e) {}

// --- 3. Hook Navigator API via Prototype ---
try {
  const sensitiveNavProps = ['userAgent', 'hardwareConcurrency', 'deviceMemory', 'plugins', 'mimeTypes'];
  sensitiveNavProps.forEach(prop => {
    const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, prop);
    if (descriptor && descriptor.get) {
      const originalGet = descriptor.get;
      Object.defineProperty(Navigator.prototype, prop, {
        get: function() {
          logAttempt('Hardware/System API', 'Read navigator.' + prop, activeProtection);
          if (activeProtection) {
            if (prop === 'hardwareConcurrency') return 4;
            if (prop === 'deviceMemory') return 8;
            if (prop === 'plugins') return [];
            if (prop === 'mimeTypes') return [];
          }
          return originalGet.call(this);
        }
      });
    }
  });
} catch (e) {
  console.error("PrivacyLens: Failed to hook Navigator API", e);
}

// --- 4. Hook Screen API via Prototype ---
try {
  const sensitiveScreenProps = ['width', 'height', 'colorDepth', 'pixelDepth'];
  sensitiveScreenProps.forEach(prop => {
    const descriptor = Object.getOwnPropertyDescriptor(Screen.prototype, prop);
    if (descriptor && descriptor.get) {
      const originalGet = descriptor.get;
      Object.defineProperty(Screen.prototype, prop, {
        get: function() {
          logAttempt('Screen Metrics', 'Read screen.' + prop, activeProtection);
          if (activeProtection) {
            if (prop === 'width') return 1920;
            if (prop === 'height') return 1080;
            if (prop === 'colorDepth') return 24;
            if (prop === 'pixelDepth') return 24;
          }
          return originalGet.call(this);
        }
      });
    }
  });
} catch (e) {
  console.error("PrivacyLens: Failed to hook Screen API", e);
}

// --- 5. Hook Clipboard API (Malware Detection) ---
try {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    const originalWriteText = navigator.clipboard.writeText;
    navigator.clipboard.writeText = function(text) {
      const userActive = navigator.userActivation ? navigator.userActivation.isActive : true;
      if (activeProtection && !userActive) {
        logAttempt('Security Warning', 'Blocked clipboard hijack attempt (writeText)', activeProtection);
        console.warn("PrivacyLens: Blocked clipboard hijack attempt.");
        return Promise.reject(new Error("Permission denied"));
      }
      return originalWriteText.apply(this, [text]);
    };
  }

  const originalExecCommand = document.execCommand;
  document.execCommand = function(commandId, showUI, value) {
    if (commandId && commandId.toLowerCase() === 'copy') {
      const userActive = navigator.userActivation ? navigator.userActivation.isActive : true;
      if (activeProtection && !userActive) {
        logAttempt('Security Warning', 'Blocked clipboard hijack attempt (execCommand)', activeProtection);
        console.warn("PrivacyLens: Blocked clipboard hijack attempt.");
        return false;
      }
    }
    return originalExecCommand.apply(this, [commandId, showUI, value]);
  };
} catch(e) {}
