/**
 * PikPak Ultra Pro Max - Network Traffic Interceptor
 * Single Responsibility: Hooks fetch & XMLHttpRequest to intercept share metadata & stream URLs
 */

(function (root) {
  const LOG_STYLE = "color: #38bdf8; font-weight: bold; background: #0b1528; padding: 2px 6px; border-radius: 4px;";
  const LOG_SUCCESS = "color: #4ade80; font-weight: bold; background: #0b2815; padding: 2px 6px; border-radius: 4px;";

  let autoInterceptedShareId = null;
  let autoInterceptedParentId = null;
  let autoInterceptedFileId = null;
  let autoInterceptedUrl = null;
  let autoInterceptedPlaylist = [];
  const streamCallbacks = [];
  const playlistCallbacks = [];

  function notifyStreamUrl(url) {
    autoInterceptedUrl = url;
    streamCallbacks.forEach((cb) => {
      try { cb(url); } catch (_) {}
    });
  }

  function notifyPlaylist(videos) {
    autoInterceptedPlaylist = videos;
    playlistCallbacks.forEach((cb) => {
      try { cb(videos); } catch (_) {}
    });
  }

  function processResponseData(data) {
    if (!data) return;
    if (data.file_info?.id) {
      autoInterceptedFileId = data.file_info.id;
    }
    if (data.files && Array.isArray(data.files)) {
      const videos = [];
      data.files.forEach((item) => {
        if (item && item.kind !== "drive#folder") {
          const ext = (item.name || "").substring((item.name || "").lastIndexOf(".")).toLowerCase();
          const isVid = /\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|3gp|rmvb)/i.test(ext) || (item.mime_type || "").startsWith("video/");
          if (isVid) {
            videos.push({
              id: item.id,
              name: item.name,
              size: parseInt(item.size, 10) || 0,
              mimeType: item.mime_type,
              isVideo: true,
              thumbnailLink: item.thumbnail_link || item.icon_link || "",
            });
          }
        }
      });
      if (videos.length > 0) {
        console.log(`%c[PikPak Ultra] 🎯 Bắt được ${videos.length} video từ API:`, LOG_SUCCESS, videos);
        notifyPlaylist(videos);
      }
    }
    if (data.web_content_link) {
      console.log("%c[PikPak Ultra] 🎯 Bắt được web_content_link:", LOG_SUCCESS, data.web_content_link);
      notifyStreamUrl(data.web_content_link);
    } else if (data.medias && data.medias.length > 0) {
      const orig = data.medias.find((m) => m.media_name === "original") || data.medias[0];
      if (orig?.link?.url) {
        console.log("%c[PikPak Ultra] 🎯 Bắt được stream URL:", LOG_SUCCESS, orig.link.url);
        notifyStreamUrl(orig.link.url);
      }
    }
  }

  // Hook window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);

      if (url.includes("/drive/v1/share")) {
        try {
          const parsed = new URL(url, window.location.origin);
          const sId = parsed.searchParams.get("share_id");
          const pId = parsed.searchParams.get("parent_id");
          const fId = parsed.searchParams.get("file_id");
          if (sId) autoInterceptedShareId = sId;
          if (pId !== null && pId !== undefined) autoInterceptedParentId = pId;
          if (fId) autoInterceptedFileId = fId;
        } catch (_) {}
      }

      if (url.includes("/drive/") || url.includes("/file/") || url.includes("mypikpak")) {
        const clone = response.clone();
        clone.json().then((data) => processResponseData(data)).catch(() => {});
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
          processResponseData(data);
        }
      } catch (_) {}
    });
    return origXHRSend.apply(this, args);
  };

  root.PikPakNetwork = {
    getIntercepted: () => ({
      shareId: autoInterceptedShareId,
      parentId: autoInterceptedParentId,
      fileId: autoInterceptedFileId,
      streamUrl: autoInterceptedUrl,
      playlist: autoInterceptedPlaylist,
    }),
    onStreamUrl: (cb) => streamCallbacks.push(cb),
    onPlaylist: (cb) => playlistCallbacks.push(cb),
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
