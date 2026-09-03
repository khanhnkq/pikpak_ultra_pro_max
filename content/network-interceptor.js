/**
 * PikPak Ultra Pro Max - Network Traffic Interceptor
 * Single Responsibility: Hooks fetch & XMLHttpRequest to intercept share metadata & stream URLs
 */

(function (root) {
  const LOG_STYLE = "color: #38bdf8; font-weight: bold; background: #0b1528; padding: 2px 6px; border-radius: 4px;";
  const LOG_SUCCESS = "color: #4ade80; font-weight: bold; background: #0b2815; padding: 2px 6px; border-radius: 4px;";

  let autoInterceptedShareId = null;
  let autoInterceptedParentId = null;
  let autoInterceptedUrl = null;
  const streamCallbacks = [];

  function notifyStreamUrl(url) {
    autoInterceptedUrl = url;
    streamCallbacks.forEach((cb) => {
      try {
        cb(url);
      } catch (_) {}
    });
  }

  // Hook window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);

      // Detect active share_id and parent_id from PikPak's own API calls
      if (url.includes("/drive/v1/share")) {
        try {
          const parsed = new URL(url, window.location.origin);
          const sId = parsed.searchParams.get("share_id");
          const pId = parsed.searchParams.get("parent_id");
          if (sId) {
            autoInterceptedShareId = sId;
            console.log(`%c[PikPak Ultra] 🎯 Bắt được share_id từ API call: ${sId}`, LOG_STYLE);
          }
          if (pId !== null && pId !== undefined) {
            autoInterceptedParentId = pId;
            console.log(`%c[PikPak Ultra] 🎯 Bắt được parent_id từ API call: ${pId || "(root)"}`, LOG_STYLE);
          }
        } catch (_) {}
      }

      // Detect stream / download links from metadata responses
      if (url.includes("/drive/") || url.includes("/file/") || url.includes("mypikpak")) {
        const clone = response.clone();
        clone
          .json()
          .then((data) => {
            if (data?.web_content_link) {
              console.log("%c[PikPak Ultra] 🎯 Bắt được web_content_link trực tiếp:", LOG_SUCCESS, data.web_content_link);
              notifyStreamUrl(data.web_content_link);
            } else if (data?.medias && data.medias.length > 0) {
              const orig = data.medias.find((m) => m.media_name === "original") || data.medias[0];
              if (orig?.link?.url) {
                console.log("%c[PikPak Ultra] 🎯 Bắt được stream URL:", LOG_SUCCESS, orig.link.url);
                notifyStreamUrl(orig.link.url);
              }
            }
          })
          .catch(() => {});
      }
    } catch (_) {}

    return response;
  };

  // Hook XMLHttpRequest
  const origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._ppUrl = url;
    return origXHROpen.call(this, method, url, ...rest);
  };

  const origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        if (this._ppUrl && (this._ppUrl.includes("/drive/") || this._ppUrl.includes("mypikpak"))) {
          const data = JSON.parse(this.responseText);
          if (data?.web_content_link) {
            console.log("%c[PikPak Ultra] 🎯 XHR bắt được web_content_link:", LOG_SUCCESS, data.web_content_link);
            notifyStreamUrl(data.web_content_link);
          }
        }
      } catch (_) {}
    });
    return origXHRSend.apply(this, args);
  };

  root.PikPakNetwork = {
    getIntercepted: () => ({
      shareId: autoInterceptedShareId,
      parentId: autoInterceptedParentId,
      streamUrl: autoInterceptedUrl,
    }),
    onStreamUrl: (cb) => streamCallbacks.push(cb),
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
