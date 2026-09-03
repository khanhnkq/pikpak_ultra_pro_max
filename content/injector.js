/**
 * Content Script (ISOLATED World)
 * Injects main.js into the page context and bridges communication
 * between the page's MAIN world and the extension Service Worker.
 */

(function () {
  const BRIDGE_SOURCE_PAGE = "PIKPAK_PAGE_SCRIPT";
  const BRIDGE_SOURCE_EXT = "PIKPAK_INJECTOR_SCRIPT";

  // Inject stylesheet for player UI
  function injectStyles() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = chrome.runtime.getURL("player/player.css");
    (document.head || document.documentElement).appendChild(link);
  }

  // Inject modular player and content scripts in dependency order into page execution context
  function injectScripts() {
    const scripts = [
      "player/icons.js",
      "player/player-shortcuts.js",
      "player/player-drawer.js",
      "player/player-template.js",
      "player/player.js",
      "content/network-interceptor.js",
      "content/toolbar.js",
      "content/main.js",
    ];

    function loadNext(idx) {
      if (idx >= scripts.length) return;
      const scriptEl = document.createElement("script");
      scriptEl.src = chrome.runtime.getURL(scripts[idx]);
      scriptEl.type = "text/javascript";
      scriptEl.onload = function () {
        scriptEl.remove();
        loadNext(idx + 1);
      };
      (document.head || document.documentElement).appendChild(scriptEl);
    }

    loadNext(0);
  }

  // Listen for messages from main.js (Page context)
  window.addEventListener("message", (event) => {
    // Only accept messages from current window and our page script
    if (event.source !== window || !event.data || event.data.source !== BRIDGE_SOURCE_PAGE) {
      return;
    }

    const { requestId, action, payload } = event.data;
    console.log(`%c[PikPak Injector] 📨 Forwarding to background: ${action}`, "color: #38bdf8;", payload);

    if (!chrome.runtime?.id) {
      console.error("[PikPak Injector] ❌ Extension context is invalidated. Please reload the webpage (F5)!");
      window.postMessage(
        {
          source: BRIDGE_SOURCE_EXT,
          requestId: requestId,
          response: { success: false, error: "Extension context invalidated. Hãy F5 tải lại trang!" },
        },
        "*"
      );
      return;
    }

    // Forward to Service Worker
    chrome.runtime.sendMessage(
      {
        type: action,
        payload: payload,
      },
      (response) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          console.error("[PikPak Injector] ❌ chrome.runtime.lastError:", lastErr.message);
        } else {
          console.log(`%c[PikPak Injector] 📥 Background response for ${action}:`, "color: #4ade80;", response);
        }

        window.postMessage(
          {
            source: BRIDGE_SOURCE_EXT,
            requestId: requestId,
            response: lastErr ? { success: false, error: lastErr.message } : response,
          },
          "*"
        );
      }
    );
  });

  injectStyles();
  injectScripts();
})();
