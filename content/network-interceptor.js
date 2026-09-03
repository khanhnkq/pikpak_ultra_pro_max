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

  function formatDuration(sec) {
    const s = parseInt(sec, 10);
    if (isNaN(s) || s <= 0) return "";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const remSec = s % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(remSec).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(remSec).padStart(2, "0")}`;
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
            const durSec = parseInt(item.params?.duration || item.medias?.[0]?.video?.duration || 0, 10);
            videos.push({
              id: item.id,
              name: item.name,
              size: parseInt(item.size, 10) || 0,
              duration: durSec,
              durationText: formatDuration(durSec),
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
    let streamUrl = "";
    if (data.medias && data.medias.length > 0) {
      const orig = data.medias.find((m) => m.media_name === "original") || data.medias[0];
      if (orig?.link?.url) streamUrl = orig.link.url;
    }
    if (!streamUrl && data.web_content_link && !data.web_content_link.includes("fid=&")) {
      streamUrl = data.web_content_link;
    }
    if (streamUrl) {
      console.log("%c[PikPak Ultra] 🎯 Bắt được stream URL:", LOG_SUCCESS, streamUrl);
      notifyStreamUrl(streamUrl);
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
