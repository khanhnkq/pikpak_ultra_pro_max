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

  // Inject player controller and main scripts into page execution context
  function injectScripts() {
    const playerScript = document.createElement("script");
    playerScript.src = chrome.runtime.getURL("player/player.js");
    playerScript.type = "text/javascript";
    playerScript.onload = function () {
      playerScript.remove();

      const mainScript = document.createElement("script");
      mainScript.src = chrome.runtime.getURL("content/main.js");
      mainScript.type = "text/javascript";
      mainScript.onload = function () {
        mainScript.remove();
      };
      (document.head || document.documentElement).appendChild(mainScript);
    };
    (document.head || document.documentElement).appendChild(playerScript);
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
