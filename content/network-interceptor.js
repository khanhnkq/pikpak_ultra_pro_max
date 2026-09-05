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
    if (data.file_info?.id) {
      autoInterceptedFileId = data.file_info.id;
    }
    if (data.files && Array.isArray(data.files)) {
      data.files.sort(compareMediaItems);
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
    let streamUrl = "";
    const target = data.file_info || data;
    const fileName = target.name || "";
    const fileExt = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
    const isNonNative = ["avi", "wmv", "flv", "rmvb", "rm", "asf", "divx", "vob", "ts", "m2ts", "3gp"].includes(fileExt) ||
      /video\/(x-msvideo|avi|msvideo|x-ms-wmv|x-flv)/i.test(target.mime_type || "");

    const medias = target.medias || data.medias || [];
    const origMedia = medias.find((m) => {
      const name = (m.media_name || m.resolution_name || "").toLowerCase();
      return (name.includes("original") || name.includes("gốc")) && m.link?.url && !m.link.url.includes("fid=&");
    });
    const directUrl = ((target.web_content_link || data.web_content_link) && !(target.web_content_link || data.web_content_link).includes("fid=&"))
      ? (target.web_content_link || data.web_content_link) : "";

    if (!isNonNative) {
      // Video thông thường: CHỈ chấp nhận Original.
      // Tuyệt đối KHÔNG fallback sang medias[0] (720P/1080P) vì Chrome không hỗ trợ giải mã HLS/transcode trực tiếp!
      streamUrl = origMedia?.link?.url || directUrl;
    } else {
      // File non-native (.avi): thử bản nén MP4 nếu có
      const transcoded = medias.find((m) => {
        const name = (m.media_name || m.resolution_name || "").toLowerCase();
        return !name.includes("original") && !name.includes("gốc") && m.link?.url && !m.link.url.includes("fid=&");
      });
      streamUrl = transcoded?.link?.url || origMedia?.link?.url || directUrl;
    }

    if (streamUrl) {
      notifyStreamUrl(streamUrl);
    }
  }

  function isRelevantEndpoint(url) {
    if (!url) return false;
    return (
      url.includes("/share/") ||
      url.includes("/share") ||
      url.includes("/file") ||
      url.includes("/files") ||
      url.includes("/medias") ||
      url.includes("/download")
    );
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

      if (isRelevantEndpoint(url)) {
        const contentType = response.headers.get("content-type") || "";
        const isJson = contentType.includes("application/json") || contentType.includes("text/json");
        if (isJson) {
          const clone = response.clone();
          const data = await clone.json().catch(() => null);
          if (data) {
            processResponseData(data);
            if (Array.isArray(data.files)) {
              return new Response(JSON.stringify(data), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            }
          }
        }
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
    this.addEventListener("readystatechange", function () {
      if (this.readyState === 4 && this._ppUrl && isRelevantEndpoint(this._ppUrl)) {
        try {
          const ct = this.getResponseHeader ? (this.getResponseHeader("content-type") || "") : "";
          if (!ct || ct.includes("json")) {
            const data = JSON.parse(this.responseText);
            if (data) {
              processResponseData(data);
              if (Array.isArray(data.files)) {
                const modified = JSON.stringify(data);
                try {
                  Object.defineProperty(this, "responseText", { value: modified, configurable: true });
                  Object.defineProperty(this, "response", {
                    value: this.responseType === "json" ? data : modified,
                    configurable: true,
                  });
                } catch (_) {}
              }
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
      streamUrl: autoInterceptedUrl,
      playlist: autoInterceptedPlaylist,
    }),
    onStreamUrl: (cb) => streamCallbacks.push(cb),
    onPlaylist: (cb) => playlistCallbacks.push(cb),
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
