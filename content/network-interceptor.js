/**
 * PikPak Ultra Pro Max - Network Traffic Interceptor
 * Single Responsibility: Hooks fetch & XMLHttpRequest to intercept share metadata
 */

(function (root) {
  const LOG_STYLE = "color: #38bdf8; font-weight: bold; background: #0b1528; padding: 2px 6px; border-radius: 4px;";
  let autoInterceptedShareId = null;
  let autoInterceptedParentId = null;
  let autoInterceptedFileId = null;
  let autoInterceptedPlaylist = [];
  const playlistCallbacks = [];

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

  function getFileCategory(item) {
    if (!item) return 4;
    if (item.kind === "drive#folder" || item.type === "folder") return 1;
    const name = (item.name || "").toLowerCase();
    const ext = name.substring(name.lastIndexOf("."));
    const mime = (item.mime_type || item.mimeType || "").toLowerCase();
    const isVideo = /\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|3gp|rmvb|iso|vob|m2ts)$/i.test(name) || mime.startsWith("video/") || item.isVideo || item.type === "video";
    if (isVideo) return 2;
    const isImage = /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|tiff|ico)$/i.test(name) || mime.startsWith("image/") || item.isImage || item.type === "image";
    if (isImage) return 3;
    return 4;
  }

  function getItemDuration(item) {
    if (!item) return 0;
    if (typeof item.duration === "number" && !isNaN(item.duration)) return item.duration;
    const dur = parseInt(item.params?.duration || item.medias?.[0]?.video?.duration || 0, 10);
    return isNaN(dur) ? 0 : dur;
  }

  function compareMediaItems(a, b) {
    const catA = getFileCategory(a);
    const catB = getFileCategory(b);
    if (catA !== catB) return catA - catB;

    // Nếu cả hai đều là video: video dài nhất trước (duration giảm dần)
    if (catA === 2) {
      const durA = getItemDuration(a);
      const durB = getItemDuration(b);
      if (durA !== durB) return durB - durA;
    }

    const nameA = String(a?.name || "");
    const nameB = String(b?.name || "");
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
  }

  function notifyPlaylist(videos) {
    autoInterceptedPlaylist = videos;
    playlistCallbacks.forEach((cb) => {
      try { cb(videos); } catch (_) {}
    });
  }

  function processResponseData(data) {
    if (!data) return;
    if (data.pass_code_token) {
      autoInterceptedPassCodeToken = data.pass_code_token;
    }
    if (data.captcha_token) {
      autoInterceptedCaptchaToken = data.captcha_token;
    }
    if (data.file_info?.id) {
      autoInterceptedFileId = data.file_info.id;
    }
    if (data.files && Array.isArray(data.files)) {
      const mediaList = [];
      data.files.forEach((item) => {
        if (item && item.kind !== "drive#folder") {
          const isVid = getFileCategory(item) === 2;
          const isImg = getFileCategory(item) === 3;
          if (isVid || isImg) {
            const durSec = parseInt(item.params?.duration || item.medias?.[0]?.video?.duration || 0, 10);
            mediaList.push({
              id: item.id,
              name: item.name,
              size: parseInt(item.size, 10) || 0,
              duration: durSec,
              durationText: formatDuration(durSec),
              mimeType: item.mime_type,
              isVideo: isVid,
              isImage: isImg,
              type: isVid ? "video" : "image",
              thumbnailLink: item.thumbnail_link || item.icon_link || "",
              webContentLink: item.web_content_link || "",
            });
          }
        }
      });
      if (mediaList.length > 0) {
        mediaList.sort(compareMediaItems);
        notifyPlaylist(mediaList);
      }
    }
  }

  function isRelevantEndpoint(url) {
    return Boolean(url && /\/drive\/v1\/share(?:[/?]|$)/.test(url));
  }

  let autoInterceptedAuthToken = null;
  let autoInterceptedPassCodeToken = null;
  let autoInterceptedDeviceId = null;
  let autoInterceptedCaptchaToken = null;

  function extractTokenFromStorage() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        if (val && typeof val === "string") {
          if (val.includes('"access_token"')) {
            try {
              const parsed = JSON.parse(val);
              if (parsed.access_token) return `Bearer ${parsed.access_token}`;
            } catch (_) {}
          }
        }
      }
    } catch (_) {}
    return null;
  }

  function extractDeviceIdFromStorage() {
    try {
      return (
        localStorage.getItem("device_id") ||
        localStorage.getItem("pikpak_device_id") ||
        localStorage.getItem("deviceId") ||
        null
      );
    } catch (_) {}
    return null;
  }

  // Hook window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      let reqHeaders = null;
      if (args[0] instanceof Request) {
        reqHeaders = args[0].headers;
      } else if (args[1] && args[1].headers) {
        reqHeaders = args[1].headers;
      }
      if (reqHeaders) {
        let auth = null;
        if (typeof reqHeaders.get === "function") {
          auth = reqHeaders.get("authorization") || reqHeaders.get("Authorization");
          const dId = reqHeaders.get("x-device-id") || reqHeaders.get("X-Device-ID");
          if (dId) autoInterceptedDeviceId = dId;
          const cTok = reqHeaders.get("x-captcha-token") || reqHeaders.get("X-Captcha-Token");
          if (cTok) autoInterceptedCaptchaToken = cTok;
        } else if (typeof reqHeaders === "object") {
          auth = reqHeaders["authorization"] || reqHeaders["Authorization"];
          const dId = reqHeaders["x-device-id"] || reqHeaders["X-Device-ID"];
          if (dId) autoInterceptedDeviceId = dId;
          const cTok = reqHeaders["x-captcha-token"] || reqHeaders["X-Captcha-Token"];
          if (cTok) autoInterceptedCaptchaToken = cTok;
        }
        if (auth && typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
          autoInterceptedAuthToken = auth;
        }
      }
    } catch (_) {}

    const response = await originalFetch.apply(this, args);

    try {
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);

      if (url.includes("/drive/v1/share")) {
        try {
          const parsed = new URL(url, window.location.origin);
          const sId = parsed.searchParams.get("share_id");
          const pId = parsed.searchParams.get("parent_id");
          const fId = parsed.searchParams.get("file_id");
          const pcToken = parsed.searchParams.get("pass_code_token");
          if (sId) autoInterceptedShareId = sId;
          if (pId !== null && pId !== undefined) autoInterceptedParentId = pId;
          if (fId) autoInterceptedFileId = fId;
          if (pcToken) autoInterceptedPassCodeToken = pcToken;
        } catch (_) {}
      }

      if (isRelevantEndpoint(url)) {
        const contentType = response.headers.get("content-type") || "";
        const isJson = contentType.includes("application/json") || contentType.includes("text/json");
        if (isJson) {
          const clone = response.clone();
          const data = await clone.json().catch(() => null);
          if (data) {
            processResponseData(data);
          }
        }
      }
    } catch (_) {}

    return response;
  };

  // Hook XMLHttpRequest
  const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (name && name.toLowerCase() === "authorization" && typeof value === "string" && value.toLowerCase().startsWith("bearer ")) {
      autoInterceptedAuthToken = value;
    }
    return origSetRequestHeader.apply(this, arguments);
  };

  const origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._ppUrl = url;
    return origXHROpen.call(this, method, url, ...rest);
  };

  const origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("readystatechange", function () {
      if (this.readyState === 4 && this._ppUrl && isRelevantEndpoint(this._ppUrl)) {
        try {
          const ct = this.getResponseHeader ? (this.getResponseHeader("content-type") || "") : "";
          if (!ct || ct.includes("json")) {
            const data = JSON.parse(this.responseText);
            if (data) {
              processResponseData(data);
            }
          }
        } catch (_) {}
      }
    });
    return origXHRSend.apply(this, args);
  };

  root.PikPakNetwork = {
    getIntercepted: () => ({
      shareId: autoInterceptedShareId,
      parentId: autoInterceptedParentId,
      fileId: autoInterceptedFileId,
      playlist: autoInterceptedPlaylist,
      authToken: autoInterceptedAuthToken || extractTokenFromStorage(),
      passCodeToken: autoInterceptedPassCodeToken,
      deviceId: autoInterceptedDeviceId || extractDeviceIdFromStorage(),
      captchaToken: autoInterceptedCaptchaToken,
    }),
    getAuthToken: () => autoInterceptedAuthToken || extractTokenFromStorage(),
    getPassCodeToken: () => autoInterceptedPassCodeToken,
    getDeviceId: () => autoInterceptedDeviceId || extractDeviceIdFromStorage(),
    getCaptchaToken: () => autoInterceptedCaptchaToken,
    onPlaylist: (cb) => playlistCallbacks.push(cb),
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
