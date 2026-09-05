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
    const toInject = ["player/player.css", "content/pikpak-cards.css"];
    toInject.forEach((path) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.type = "text/css";
      link.href = chrome.runtime.getURL(path);
      (document.head || document.documentElement).appendChild(link);
    });
  }

  // Inject modular player and content scripts in dependency order with parallel downloading (async = false)
  function injectScripts() {
    const scripts = [
      "content/network-interceptor.js",
      "player/icons.js",
      "player/player-shortcuts.js",
      "player/player-drawer.js",
      "player/player-preview.js",
      "player/player-template.js",
      "player/player-image.js",
      "player/player-buffer.js",
      "player/player.js",
      "content/main.js",
    ];

    const target = document.head || document.documentElement;
    scripts.forEach((path) => {
      const scriptEl = document.createElement("script");
      scriptEl.src = chrome.runtime.getURL(path);
      scriptEl.type = "text/javascript";
      scriptEl.async = false; // Tải song song nhưng thực thi đúng thứ tự dependency
      scriptEl.onload = function () {
        scriptEl.remove();
      };
      target.appendChild(scriptEl);
    });
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
      console.warn("[PikPak Injector] Extension context invalidated (Extension vừa reload). Cần F5 trang web.");
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

    try {
      chrome.runtime.sendMessage(
        {
          type: action,
          payload: payload,
        },
        (response) => {
          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            console.warn("[PikPak Injector] Runtime message warning:", lastErr.message);
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
    } catch (err) {
      console.warn("[PikPak Injector] Runtime send failed:", err.message);
      window.postMessage(
        {
          source: BRIDGE_SOURCE_EXT,
          requestId: requestId,
          response: { success: false, error: "Extension context invalidated. Hãy F5 tải lại trang!" },
        },
        "*"
      );
    }
  });

  injectStyles();
  injectScripts();
})();
