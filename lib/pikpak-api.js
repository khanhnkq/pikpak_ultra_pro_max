/**
 * PikPak API Client (Guest / Share Mode)
 * Resolves public shares and extracts direct streaming/download URLs
 * without requiring account login or saving to personal drive.
 */
(function (root) {
  const C = root.PikPakConstants || (typeof require !== "undefined" ? require("./constants.js") : {});
  const md5Hex = root.md5Hex || (typeof require !== "undefined" ? require("./md5.js").md5Hex : null);

  function formatDuration(sec) {
    const s = parseInt(sec, 10);
    if (isNaN(s) || s <= 0) return "";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const remSec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(remSec).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(remSec).padStart(2, "0")}`;
  }

  class PikPakClient {
    constructor(options = {}) {
      this.apiHosts = options.apiHosts || C.API_HOSTS || ["api-drive.mypikpak.net", "api-drive.mypikpak.com"];
      this.userHosts = options.userHosts || C.USER_HOSTS || ["user.mypikpak.net", "user.mypikpak.com"];
      this.currentApiHostIndex = 0;
      this.currentUserHostIndex = 0;

      this.deviceId = options.deviceId || this.generateDeviceId();
      this.captchaToken = options.captchaToken || "";
      this.passCodeToken = options.passCodeToken || "";
      this.cache = new Map();
      this.maxCacheSize = 100;
    }

    pruneCache() {
      const now = Date.now();
      for (const [key, item] of this.cache.entries()) {
        if (item.expiresAt && now >= item.expiresAt) {
          this.cache.delete(key);
        }
      }
      while (this.cache.size >= this.maxCacheSize) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) this.cache.delete(oldestKey);
        else break;
      }
    }

    get apiHost() {
      return this.apiHosts[this.currentApiHostIndex % this.apiHosts.length];
    }

    get userHost() {
      return this.userHosts[this.currentUserHostIndex % this.userHosts.length];
    }

    generateDeviceId() {
      const hex = "0123456789abcdef";
      let s = "";
      for (let i = 0; i < 32; i++) {
        s += hex.charAt(Math.floor(Math.random() * 16));
      }
      return s;
    }

    computeCaptchaSign(deviceId, timestamp) {
      if (!md5Hex) {
        throw new Error("MD5 implementation not loaded");
      }
      let s = C.WEB_CLIENT_ID + C.WEB_CLIENT_VERSION + C.WEB_PACKAGE_NAME + deviceId + timestamp;
      for (let i = 0; i < C.WEB_ALGORITHMS.length; i++) {
        s = md5Hex(s + C.WEB_ALGORITHMS[i]);
      }
      return "1." + s;
    }

    getHeaders() {
      return {
        "User-Agent": C.DEFAULT_UA,
        "Content-Type": "application/json",
        "X-Client-ID": C.WEB_CLIENT_ID,
        "X-Device-ID": this.deviceId,
        "X-Captcha-Token": this.captchaToken || "",
      };
    }

    async refreshCaptcha(action = "GET:/drive/v1/share/detail") {
      const ts = String(Date.now());
      const sign = this.computeCaptchaSign(this.deviceId, ts);

      const body = {
        action: action,
        captcha_token: this.captchaToken || "",
        client_id: C.WEB_CLIENT_ID,
        device_id: this.deviceId,
        meta: {
          captcha_sign: sign,
          client_version: C.WEB_CLIENT_VERSION,
          package_name: C.WEB_PACKAGE_NAME,
          timestamp: ts,
          user_id: "",
        },
        redirect_uri: "",
      };

      let lastError = null;
      for (let attempt = 0; attempt < this.userHosts.length; attempt++) {
        const host = this.userHosts[(this.currentUserHostIndex + attempt) % this.userHosts.length];
        const url = `https://${host}/v1/shield/captcha/init`;

        try {
          const resp = await fetch(url, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(body),
          });

          const data = await resp.json().catch(() => null);
          if (resp.ok && data?.captcha_token) {
            this.currentUserHostIndex = (this.currentUserHostIndex + attempt) % this.userHosts.length;
            this.captchaToken = data.captcha_token;
            return this.captchaToken;
          }

          const errMsg = data?.error_description || data?.error || `HTTP ${resp.status}`;
          lastError = new Error(`Captcha init failed (${host}): ${errMsg}`);
        } catch (err) {
          lastError = err;
        }
      }

      throw lastError || new Error("Failed to initialize PikPak captcha token on all user hosts");
    }

    async request(path, method = "GET", query = null, body = null, retryCount = 0) {
      if (!this.captchaToken) {
        await this.refreshCaptcha(`${method.toUpperCase()}:${path}`);
      }

      let queryString = "";
      if (query && Object.keys(query).length > 0) {
        const parts = [];
        for (const k in query) {
          if (query[k] !== undefined && query[k] !== null && query[k] !== "") {
            parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`);
          }
        }
        if (parts.length > 0) {
          queryString = `?${parts.join("&")}`;
        }
      }

      const url = `https://${this.apiHost}${path}${queryString}`;

      try {
        const resp = await fetch(url, {
          method: method,
          headers: this.getHeaders(),
          body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
        });

        const text = await resp.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (_) {
          // Non-JSON response
        }

        // Token expired or invalid
        if (data?.error_code === 9 && retryCount < 2) {
          await this.refreshCaptcha(`${method.toUpperCase()}:${path}`);
          return this.request(path, method, query, body, retryCount + 1);
        }

        if (data?.error_code) {
          const err = new Error(`PikPak API Error [${data.error_code}]: ${data.error_description || data.error || text}`);
          err.code = data.error_code;
          err.data = data;
          throw err;
        }

        if (!resp.ok) {
          throw new Error(`PikPak HTTP Error [${resp.status}]: ${text}`);
        }

        return data;
      } catch (err) {
        // Switch API host and retry if network failure
        if (retryCount < this.apiHosts.length - 1) {
          this.currentApiHostIndex = (this.currentApiHostIndex + 1) % this.apiHosts.length;
          return this.request(path, method, query, body, retryCount + 1);
        }
        throw err;
      }
    }

    /**
     * Parse share URL or extract share_id
     * Handles https://mypikpak.com/s/<share_id>/<parent_id> or plain shareId
     */
    static parseShareUrl(input) {
      if (!input) throw new Error("Empty share link or ID");

      const trimmed = input.trim();
      const sIndex = trimmed.indexOf("/s/");
      if (sIndex !== -1) {
        const cleanPath = trimmed.substring(sIndex + 3).split(/[?#]/)[0];
        const segments = cleanPath.split("/").filter(Boolean);
        if (segments.length >= 1) {
          return {
            shareId: segments[0],
            initialParentId: segments.length > 1 ? segments[segments.length - 1] : "",
          };
        }
      }

      // If just a raw ID was provided
      if (/^[a-zA-Z0-9_-]{10,40}$/.test(trimmed)) {
        return {
          shareId: trimmed,
          initialParentId: "",
        };
      }

      throw new Error(`Invalid PikPak share URL: ${input}`);
    }

    async getShareInfo(shareId, passCode = "") {
      const data = await this.request("/drive/v1/share", "GET", {
        share_id: shareId,
        pass_code: passCode || "",
        thumbnail_size: "SIZE_LARGE",
        limit: "100",
      });

      if (data?.pass_code_token) {
        this.passCodeToken = data.pass_code_token;
      }
      return data;
    }

    async getShareDetail(shareId, parentId = "", pageToken = "") {
      return this.request("/drive/v1/share/detail", "GET", {
        share_id: shareId,
        parent_id: parentId || "",
        pass_code_token: this.passCodeToken || "",
        thumbnail_size: "SIZE_LARGE",
        with_audit: "true",
        limit: "100",
        page_token: pageToken || "",
        filters: JSON.stringify({
          phase: { eq: "PHASE_TYPE_COMPLETE" },
          trashed: { eq: false },
        }),
      });
    }

    async getFileInfo(shareId, fileId) {
      return this.request("/drive/v1/share/file_info", "GET", {
        share_id: shareId,
        file_id: fileId,
        pass_code_token: this.passCodeToken || "",
      });
    }

    /**
     * Retrieves files in the specified folder (or current view) with depth-controlled search
     */
    async listFolderFiles(shareId, passCode = "", parentId = "") {
      console.log(`[PikPakClient] Listing folder files: shareId=${shareId}, parentId=${parentId || "(root)"}`);

      if (!this.passCodeToken || passCode) {
        try { await this.getShareInfo(shareId, passCode); } catch (_) {}
      }

      const files = [];
      const subfolders = [];
      let pageToken = "";

      const tryResolveAsDirectFile = async (targetId) => {
        try {
          const rootRes = await this.listFolderFiles(shareId, passCode, "");
          if (rootRes && (rootRes.videos.length > 0 || rootRes.allFiles.length > 0)) {
            rootRes.targetFileId = targetId;
            if (!rootRes.allFiles.some((v) => v.id === targetId)) {
              try {
                const raw = await this.getFileInfo(shareId, targetId);
                const fi = raw?.file_info || raw;
                if (fi?.id && fi.kind !== "drive#folder") {
                  const ext = (fi.name || "").substring(fi.name.lastIndexOf(".")).toLowerCase();
                  const isV = (C.VIDEO_EXTENSIONS || []).includes(ext) || (fi.mime_type || "").startsWith("video/");
                  const isI = (C.IMAGE_EXTENSIONS || []).includes(ext) || (fi.mime_type || "").startsWith("image/");
                  const single = {
                    id: fi.id, name: fi.name, size: parseInt(fi.size, 10) || 0,
                    mimeType: fi.mime_type, isVideo: isV, isImage: isI,
                    type: isV ? "video" : (isI ? "image" : "other"),
                    thumbnailLink: fi.thumbnail_link, iconLink: fi.icon_link,
                  };
                  if (isV) rootRes.videos.unshift(single);
                  if (isV || isI) rootRes.mediaFiles.unshift(single);
                  rootRes.allFiles.unshift(single);
                }
              } catch (_) {}
            }
            return rootRes;
          }
        } catch (_) {}
        return null;
      };

      // 1. Fetch contents of current folder
      do {
        console.log(`[PikPakClient] Fetching detail: parentId=${parentId || "(root)"}, pageToken=${pageToken || "none"}`);
        let res;
        try {
          res = await this.getShareDetail(shareId, parentId, pageToken);
        } catch (err) {
          if (parentId) {
            console.log(`[PikPakClient] 🔍 parentId=${parentId} lỗi truy vấn. Thử phân giải file trực tiếp...`);
            const directFileRes = await tryResolveAsDirectFile(parentId);
            if (directFileRes) return directFileRes;
            console.log(`[PikPakClient] 🔄 Thử lại với thư mục gốc (root)...`);
            return this.listFolderFiles(shareId, passCode, "");
          }
          throw err;
        }

        if (res.share_status === "PASS_CODE_EMPTY" || res.share_status === "PASS_CODE_ERROR") {
          const err = new Error("Share requires password or password is incorrect");
          err.code = res.share_status;
          throw err;
        }

        if (res.share_status && res.share_status !== "OK") {
          throw new Error(`Share error: ${res.share_status} (${res.share_status_text || ""})`);
        }

        const items = res.files || [];
        for (const item of items) {
          if (item.kind === "drive#folder") {
            subfolders.push({
              id: item.id,
              name: item.name,
              kind: "folder",
            });
          } else {
            const ext = (item.name || "").substring(item.name.lastIndexOf(".")).toLowerCase();
            const isVideo = (C.VIDEO_EXTENSIONS || []).includes(ext) || (item.mime_type || "").startsWith("video/");
            const isImage = (C.IMAGE_EXTENSIONS || []).includes(ext) || (item.mime_type || "").startsWith("image/");
            const dur = parseInt(item.params?.duration || item.medias?.[0]?.video?.duration || 0, 10);
            files.push({
              id: item.id,
              name: item.name,
              size: parseInt(item.size, 10) || 0,
              duration: dur,
              durationText: formatDuration(dur),
              mimeType: item.mime_type,
              isVideo, isImage,
              type: isVideo ? "video" : (isImage ? "image" : "other"),
              thumbnailLink: item.thumbnail_link,
              iconLink: item.icon_link,
              createdTime: item.created_time,
            });
          }
        }

        pageToken = res.next_page_token || "";
      } while (pageToken);

      const videoFiles = files.filter((f) => f.isVideo);
      console.log(`[PikPakClient] Folder results: ${videoFiles.length} videos, ${subfolders.length} subfolders found.`);

      // If parentId was passed but 0 items found, check if parentId is actually a direct file
      if (parentId && files.length === 0 && subfolders.length === 0) {
        console.log(`[PikPakClient] 🔍 parentId=${parentId} trả về 0 items. Thử phân giải file trực tiếp...`);
        const directFileRes = await tryResolveAsDirectFile(parentId);
        if (directFileRes) return directFileRes;
      }

      // 2. If no videos in current folder, but subfolders exist, inspect the first 2 subfolders
      if (videoFiles.length === 0 && subfolders.length > 0 && !parentId) {
        console.log(`[PikPakClient] No videos at root, quick-checking first ${Math.min(3, subfolders.length)} subfolders...`);
        for (let i = 0; i < Math.min(3, subfolders.length); i++) {
          const sf = subfolders[i];
          try {
            const subRes = await this.getShareDetail(shareId, sf.id, "");
            const subItems = subRes.files || [];
            for (const item of subItems) {
              if (item.kind !== "drive#folder") {
                const ext = (item.name || "").substring(item.name.lastIndexOf(".")).toLowerCase();
                const isVideo = (C.VIDEO_EXTENSIONS || []).includes(ext) || (item.mime_type || "").startsWith("video/");
                if (isVideo) {
                  const sDur = parseInt(item.params?.duration || item.medias?.[0]?.video?.duration || 0, 10);
                  videoFiles.push({
                    id: item.id,
                    name: `${sf.name} / ${item.name}`,
                    size: parseInt(item.size, 10) || 0,
                    duration: sDur,
                    durationText: formatDuration(sDur),
                    mimeType: item.mime_type,
                    isVideo: true,
                    thumbnailLink: item.thumbnail_link,
                  });
                }
              }
            }
          } catch (e) {
            console.warn(`[PikPakClient] Quick-check subfolder ${sf.name} failed:`, e);
          }
        }
      }

      return {
        videos: videoFiles,
        subfolders: subfolders,
        allFiles: files,
        mediaFiles: files.filter((f) => f.isVideo || f.isImage),
        currentParentId: parentId,
      };
    }

    async listAllFiles(shareId, passCode = "") {
      const res = await this.listFolderFiles(shareId, passCode, "");
      return res.allFiles;
    }

    /**
     * Resolves playable media URLs for a file
     */
    async resolveMediaStreams(shareId, fileId) {
      this.pruneCache();
      const cacheKey = `${shareId}:${fileId}`;
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.data;
      }

      if (!this.passCodeToken) {
        try { await this.getShareInfo(shareId); } catch (_) {}
      }

      const raw = await this.getFileInfo(shareId, fileId);
      const info = raw.file_info || raw;

      const directUrl = info.web_content_link || "";
      const medias = info.medias || [];
      const streams = [];

      // Add playable media streams from medias array first (highest reliability)
      for (const m of medias) {
        if (m.link?.url) {
          const isOriginal = m.media_name === "original";
          streams.push({
            quality: m.media_name || (isOriginal ? "Original" : "Transcoded"),
            resolution: m.resolution_name || (m.width && m.height ? `${m.width}x${m.height}` : "Auto"),
            url: m.link.url,
            isOriginal: isOriginal,
            mimeType: m.mime_type || "video/mp4",
          });
        }
      }

      // Add direct URL only if not broken (does not contain fid=&)
      if (directUrl && !directUrl.includes("fid=&")) {
        streams.push({
          quality: "Download",
          resolution: info.width && info.height ? `${info.width}x${info.height}` : "Original",
          url: directUrl,
          isOriginal: streams.length === 0,
          mimeType: info.mime_type || "video/mp4",
        });
      }

      // Pick original media stream or first available working media stream
      const primaryUrl = streams.find((s) => s.isOriginal)?.url || streams[0]?.url || directUrl || info.thumbnail_link || "";

      const result = {
        fileId: fileId,
        fileName: info.name,
        fileSize: parseInt(info.size, 10) || 0,
        primaryUrl: primaryUrl,
        streams: streams,
        expiresAt: Date.now() + (C.URL_CACHE_TTL || 3 * 60 * 60 * 1000),
      };

      this.cache.set(cacheKey, {
        expiresAt: result.expiresAt - 5 * 60 * 1000, // 5 min safety buffer
        data: result,
      });
      this.pruneCache();

      return result;
    }
  }

  root.PikPakClient = PikPakClient;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { PikPakClient };
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
