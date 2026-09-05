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

  function getFileCategory(item) {
    if (!item) return 4;
    if (item.kind === "drive#folder" || item.kind === "folder" || item.type === "folder") return 1;
    const name = (item.name || "").toLowerCase();
    const ext = name.substring(name.lastIndexOf("."));
    const mime = (item.mime_type || item.mimeType || "").toLowerCase();
    const isVideo = (C.VIDEO_EXTENSIONS || []).includes(ext) || mime.startsWith("video/") || item.isVideo || item.type === "video";
    if (isVideo) return 2;
    const isImage = (C.IMAGE_EXTENSIONS || []).includes(ext) || mime.startsWith("image/") || item.isImage || item.type === "image";
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

  class PikPakClient {
    constructor(options = {}) {
      this.clientId = options.clientId || C.WEB_CLIENT_ID || "YUMx5nI8ZU8Ap8pm";
      this.clientVersion = options.clientVersion || C.WEB_CLIENT_VERSION || "2.0.0";
      this.packageName = options.packageName || C.WEB_PACKAGE_NAME || "mypikpak.com";
      this.algorithms = C.WEB_ALGORITHMS || [];
      this.userAgent = options.userAgent || C.DEFAULT_UA;

      this.apiHosts = options.apiHosts || C.API_HOSTS || ["api-drive.mypikpak.com", "api-drive.mypikpak.net"];
      this.userHosts = options.userHosts || C.USER_HOSTS || ["user.mypikpak.com", "user.mypikpak.net"];
      this.currentApiHostIndex = 0;
      this.currentUserHostIndex = 0;

      this.deviceId = options.deviceId || this.generateDeviceId();
      this.captchaToken = options.captchaToken || "";
      this.passCodeToken = options.passCodeToken || "";
      this.authToken = options.authToken || "";
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
      let s = this.clientId + this.clientVersion + this.packageName + deviceId + timestamp;
      for (let i = 0; i < this.algorithms.length; i++) {
        s = md5Hex(s + this.algorithms[i]);
      }
      return "1." + s;
    }

    getHeaders() {
      const h = {
        "User-Agent": this.userAgent,
        "Content-Type": "application/json",
        "X-Client-ID": this.clientId,
        "X-Device-ID": this.deviceId,
        "X-Client-Version": this.clientVersion,
        "X-Package-Name": this.packageName,
      };
      if (this.captchaToken) {
        h["X-Captcha-Token"] = this.captchaToken;
      }
      if (this.authToken) {
        h["Authorization"] = this.authToken;
      }
      return h;
    }

    setAuthToken(token) {
      this.authToken = token;
      if (token) {
        try {
          const raw = token.replace(/^Bearer\s+/i, "");
          const parts = raw.split(".");
          if (parts.length >= 2) {
            const payloadStr = typeof atob !== "undefined"
              ? atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
              : (typeof Buffer !== "undefined" ? Buffer.from(parts[1], "base64").toString() : "");
            if (payloadStr) {
              const payload = JSON.parse(payloadStr);
              if (payload.client_id) {
                this.clientId = payload.client_id;
              }
              if (payload.sub) {
                this.userId = payload.sub;
              }
            }
          }
        } catch (_) {}
      }
    }

    async refreshCaptcha(action = "GET:/drive/v1/share/detail") {
      const ts = String(Date.now());
      const sign = this.computeCaptchaSign(this.deviceId, ts);

      const body = {
        action: action,
        captcha_token: this.captchaToken || "",
        client_id: this.clientId,
        device_id: this.deviceId,
        meta: {
          captcha_sign: sign,
          client_version: this.clientVersion,
          package_name: this.packageName,
          timestamp: ts,
          user_id: this.userId || "",
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

    async request(path, method = "GET", query = null, body = null, retryCount = 0, captchaRetryCount = 0) {
      const isAuthedSafe = Boolean(
        this.authToken && (path.startsWith("/drive/v1/files") || path.startsWith("/drive/v1/tasks"))
      );
      if (!this.captchaToken && !isAuthedSafe) {
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
        const fetchOptions = {
          method: method,
          headers: this.getHeaders(),
          body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
        };
        if (typeof window !== "undefined") {
          fetchOptions.credentials = "include";
        }

        const resp = await fetch(url, fetchOptions);

        if (resp.status === 401) {
          this.captchaToken = null;
          throw new Error("PikPak Auth Unauthorized (401)");
        }

        const data = await resp.json().catch(() => null);

        if (!resp.ok || data?.error_code) {
          const errCode = data?.error_code || resp.status;
          const errMsg = data?.error_description || data?.error || `HTTP ${resp.status}`;
          // 412, 16, or 9 usually mean captcha expired or invalid
          if ([412, 16, 9].includes(Number(errCode)) && captchaRetryCount < 1) {
            this.captchaToken = null;
            await this.refreshCaptcha(`${method.toUpperCase()}:${path}`);
            return this.request(path, method, query, body, retryCount, captchaRetryCount + 1);
          }
          const apiError = new Error(`PikPak API Error [${errCode}]: ${errMsg}`);
          apiError.code = errCode;
          apiError.data = data;
          throw apiError;
        }

        return data;
      } catch (err) {
        // Switch API host and retry if network failure
        if (retryCount < this.apiHosts.length - 1) {
          this.currentApiHostIndex = (this.currentApiHostIndex + 1) % this.apiHosts.length;
          return this.request(path, method, query, body, retryCount + 1, captchaRetryCount);
        }
        throw err;
      }
    }

    /**
     * Restore / Copy a shared file to personal drive (instant cloud hash pointer copy)
     */
    async restoreShareFile(shareId, fileId, passCodeToken = "") {
      return this.request("/drive/v1/share/restore", "POST", null, {
        share_id: shareId,
        pass_code_token: passCodeToken || this.passCodeToken || "",
        file_ids: [fileId],
      });
    }

    /**
     * Resolve fresh CDN links for a file that already exists in the personal drive.
     * This refreshes expiring links without restoring/copying the shared file again.
     */
    async resolvePersonalStream(fileId, targetName = "") {
      if (!fileId) throw new Error("Missing personal file ID");
      const raw = await this.getUserFileDetail(fileId);
      return this.resolvePersonalStreamFromRaw(raw, fileId, fileId, targetName);
    }

    /**
     * List files in user's personal drive (root or subfolder)
     */
    async getUserFiles(parentId = "", pageToken = "") {
      const q = {
        thumbnail_size: "SIZE_LARGE",
        limit: "100",
        filters: JSON.stringify({ trashed: { eq: false } }),
      };
      if (parentId) q.parent_id = parentId;
      if (pageToken) q.page_token = pageToken;
      return this.request("/drive/v1/files", "GET", q);
    }

    /**
     * Read every item in a personal-drive folder. Restore can finish on a
     * later page, so a single /files request is not enough to locate it.
     */
    async getAllUserFiles(parentId = "") {
      const files = [];
      const seenTokens = new Set();
      let pageToken = "";

      do {
        const res = await this.getUserFiles(parentId, pageToken);
        if (Array.isArray(res?.files)) files.push(...res.files);

        const nextToken = res?.next_page_token || res?.nextPageToken || "";
        if (!nextToken || seenTokens.has(nextToken)) break;
        seenTokens.add(nextToken);
        pageToken = nextToken;
      } while (pageToken);

      return files;
    }

    /**
     * Get file details & official personal streaming links from personal drive
     */
    async getUserFileDetail(fileId) {
      return this.request(`/drive/v1/files/${fileId}`, "GET");
    }

    /**
     * Check one deleted artifact directly. This also works when the artifact is
     * a child file inside a restored folder and is not visible at drive root.
     */
    async isUserFileDeleted(fileId) {
      try {
        const raw = await this.getUserFileDetail(fileId);
        const info = raw?.file_info || raw;
        return !info?.id || info.trashed === true || info.deleted === true || info.status === "deleted";
      } catch (err) {
        if (/\b404\b|not[ _-]?found|does not exist|deleted/i.test(err.message || "")) return true;
        throw err;
      }
    }

    /**
     * Wait until every deleted artifact is no longer readable.
     * batchDelete can acknowledge before the drive index finishes updating.
     */
    async waitForUserFilesDeleted(fileIds = [], maxAttempts = 10) {
      const ids = [...new Set((Array.isArray(fileIds) ? fileIds : [fileIds]).filter(Boolean))];
      if (ids.length === 0) return true;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const deletedStates = await Promise.all(ids.map((id) => this.isUserFileDeleted(id)));
        const remainingIds = ids.filter((_, index) => !deletedStates[index]);
        if (remainingIds.length === 0) return true;

        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      }

      return false;
    }

    /**
     * Permanently delete files from user's personal drive to free up quota immediately
     */
    async deleteUserFiles(fileIds = []) {
      const ids = Array.isArray(fileIds) ? fileIds.filter(Boolean) : [fileIds].filter(Boolean);
      if (ids.length === 0) return null;
      let deleteResult = null;
      try {
        deleteResult = await this.request("/drive/v1/files:batchDelete", "POST", null, { ids });
      } catch (err) {
        console.warn("[PikPakClient] batchDelete failed, trying batchTrash:", err.message);
        deleteResult = await this.request("/drive/v1/files:batchTrash", "POST", null, { ids });
        try {
          await this.request("/drive/v1/files:emptyTrash", "POST", null, {});
        } catch (_) {}
      }

      // Do not let the next restore start while the previous artifact is still
      // visible in the active drive index.
      if (await this.waitForUserFilesDeleted(ids)) return deleteResult;

      // Some accounts acknowledge batchDelete but only complete removal after
      // moving the item through trash. Retry that path before failing closed.
      console.warn("[PikPakClient] batchDelete acknowledged but artifact is still active; retrying batchTrash");
      const trashRes = await this.request("/drive/v1/files:batchTrash", "POST", null, { ids });
      try {
        await this.request("/drive/v1/files:emptyTrash", "POST", null, {});
      } catch (_) {}

      if (await this.waitForUserFilesDeleted(ids)) return trashRes;
      throw new Error("Cloud chưa xác nhận xóa hoàn tất video tạm cũ.");
    }

    /**
     * Recursively search for a video or target file inside a folder
     */
    async findVideoInFolder(folderId, targetName = "", depth = 0, excludedIds = new Set()) {
      if (!folderId || depth > 2) return null;
      try {
        const subFiles = await this.getAllUserFiles(folderId);
        const cleanName = targetName.includes("/") ? targetName.split("/").pop().trim() : targetName.trim();
        const cleanLower = cleanName.toLowerCase();

        // 1. Direct name match among files
        if (cleanLower) {
          const matchedSub = subFiles.find((f) => {
            if (f.kind === "drive#folder" || excludedIds.has(f.id)) return false;
            const fn = (f.name || "").toLowerCase();
            return fn === cleanLower || fn.includes(cleanLower) || cleanLower.includes(fn);
          });
          if (matchedSub) return matchedSub;
        }

        // 2. Search nested subfolders before accepting a non-exact match.
        for (const f of subFiles) {
          if (f.kind === "drive#folder") {
            const nested = await this.findVideoInFolder(f.id, targetName, depth + 1, excludedIds);
            if (nested) return nested;
          }
        }

        // 3. A restored single-file folder has no name match only when the
        // caller did not have a target name. Never return an arbitrary file.
        if (!cleanLower) {
          const videos = subFiles.filter((f) => {
            if (f.kind === "drive#folder" || excludedIds.has(f.id)) return false;
            const ext = (f.name || "").substring((f.name || "").lastIndexOf(".")).toLowerCase();
            return (C.VIDEO_EXTENSIONS || []).includes(ext) || (f.mime_type || "").startsWith("video/");
          });
          if (videos.length === 1) return videos[0];
        }
        return null;
      } catch (err) {
        console.warn(`[PikPakClient] findVideoInFolder error for ${folderId}:`, err.message);
        return null;
      }
    }

    /**
     * Scan user's drive (root and recent folders) to locate restored video
     */
    async findItemInUserDrive(targetName = "", excludedIds = new Set()) {
      const ignoredIds = excludedIds instanceof Set ? excludedIds : new Set(excludedIds || []);
      const cleanName = targetName.includes("/") ? targetName.split("/").pop().trim() : targetName.trim();
      const cleanLower = cleanName.toLowerCase();

      try {
        const rootFiles = await this.getAllUserFiles("");

        // 1. Direct file match at root
        if (cleanLower) {
          const rootMatch = rootFiles.find((f) => {
            if (f.kind === "drive#folder" || ignoredIds.has(f.id)) return false;
            const n = (f.name || "").toLowerCase();
            return n === cleanLower || n.includes(cleanLower) || cleanLower.includes(n);
          });
          if (rootMatch) {
            return { item: rootMatch, folderId: null, videoId: rootMatch.id };
          }
        }

        // 2. Scan every recent folder. The restore endpoint may return a
        // folder ID instead of the child video ID.
        const folders = rootFiles.filter((f) => f.kind === "drive#folder" && !ignoredIds.has(f.id));
        folders.sort((a, b) => {
          const tA = new Date(a.created_time || a.create_time || a.modified_time || a.updated_time || 0).getTime();
          const tB = new Date(b.created_time || b.create_time || b.modified_time || b.updated_time || 0).getTime();
          return tB - tA;
        });

        for (const folder of folders) {
          const video = await this.findVideoInFolder(folder.id, targetName, 0, ignoredIds);
          if (video) {
            return { item: video, folderId: folder.id, videoId: video.id };
          }
        }

        // 3. Only accept a lone root video as a safe fallback. Picking the
        // first arbitrary video can point playback at an older Cloud file.
        const rootVideos = rootFiles.filter((f) => {
          if (f.kind === "drive#folder" || ignoredIds.has(f.id)) return false;
          const ext = (f.name || "").substring((f.name || "").lastIndexOf(".")).toLowerCase();
          return (C.VIDEO_EXTENSIONS || []).includes(ext) || (f.mime_type || "").startsWith("video/");
        });
        if (rootVideos.length === 1) {
          return { item: rootVideos[0], folderId: null, videoId: rootVideos[0].id };
        }
      } catch (err) {
        console.warn("[PikPakClient] findItemInUserDrive error:", err.message);
      }
      return null;
    }

    /**
     * Smart Cloud FIFO pipeline:
     * 1. Restores the shared file to user's personal drive instantly.
     * 2. Finds the restored personal file or containing folder.
     * 3. Extracts official, seekable, full video streams without any 416 preview limits.
     */
    async restoreAndResolveStream(shareId, fileId, passCodeToken = "", targetName = "") {
      console.log(`[PikPakClient] ⚡ Bắt đầu sao chép file ${fileId} vào Cloud cá nhân (target="${targetName}")...`);

      // 1. Luôn bảo đảm có pass_code_token
      let effectivePassCodeToken = passCodeToken || this.passCodeToken;
      if (!effectivePassCodeToken) {
        try {
          console.log("[PikPakClient] 🔑 Đang lấy pass_code_token cho shareId=" + shareId);
          const sInfo = await this.getShareInfo(shareId);
          effectivePassCodeToken = sInfo?.pass_code_token || this.passCodeToken || "";
          console.log("[PikPakClient] 🔑 pass_code_token nhận được:", effectivePassCodeToken ? "OK" : "EMPTY");
        } catch (e) {
          console.warn("[PikPakClient] ⚠️ Không lấy được shareInfo:", e.message);
        }
      }

      let previousRootIds = new Set();
      try {
        const previousRootFiles = await this.getAllUserFiles("");
        previousRootIds = new Set(previousRootFiles.map((item) => item.id).filter(Boolean));
      } catch (e) {
        console.warn("[PikPakClient] ⚠️ Không chụp được snapshot Cloud trước khi restore:", e.message);
      }

      let restoreRes = null;
      let lastRestoreErr = null;
      const maxStorageRetries = 4;
      for (let attempt = 0; attempt <= maxStorageRetries; attempt++) {
        try {
          restoreRes = await this.restoreShareFile(shareId, fileId, effectivePassCodeToken);
          console.log("[PikPakClient] 🚀 Restore response:", restoreRes);
          break;
        } catch (err) {
          lastRestoreErr = err;
          const isStorageError = Number(err.code) === 8 || /insufficient cloud storage|cloud storage/i.test(err.message || "");
          if (!isStorageError || attempt >= maxStorageRetries) {
            console.warn("[PikPakClient] ⚠️ Restore request error:", err.message);
            break;
          }

          const waitMs = 1200 * (attempt + 1);
          console.warn(`[PikPakClient] ⏳ Quota đang đồng bộ sau khi xóa, retry restore sau ${waitMs}ms (${attempt + 1}/${maxStorageRetries})`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }

      let cleanupTargetId = null;
      let actualPlayFileId = null;
      const inspectedIds = new Set();

      const inspectPersonalFile = async (candidateId) => {
        if (!candidateId || inspectedIds.has(candidateId)) return false;
        inspectedIds.add(candidateId);

        try {
          const rawCheck = await this.getUserFileDetail(candidateId);
          const infoCheck = rawCheck?.file_info || rawCheck;
          if (infoCheck?.kind === "drive#folder") {
            const video = await this.findVideoInFolder(infoCheck.id, targetName);
            if (!video) return false;
            cleanupTargetId = infoCheck.id;
            actualPlayFileId = video.id;
            console.log(`[PikPakClient] 🎬 Đã tìm thấy video trong thư mục Cloud: id=${video.id}, name=${video.name}`);
            return true;
          }

          if (infoCheck?.id) {
            cleanupTargetId = infoCheck.id;
            actualPlayFileId = infoCheck.id;
            return true;
          }
        } catch (e) {
          console.log(`[PikPakClient] ℹ️ Candidate ${candidateId} chưa phải file Cloud cá nhân: ${e.message}`);
        }
        return false;
      };

      const getCandidateIds = (payload) => [
        payload?.id,
        payload?.file_id,
        payload?.file?.id,
        payload?.file_info?.id,
        payload?.task?.file_id,
        payload?.task?.params?.file_id,
        payload?.task?.params?.target_file_id,
        payload?.task?.file?.id,
        payload?.task?.result?.file_id,
        payload?.task?.result?.file?.id,
        Array.isArray(payload?.files) ? payload.files[0]?.id : null,
      ].filter(Boolean);

      // 2. Validate IDs returned by restore. Do not treat target_file_id as a
      // personal ID: on share responses it can still refer to the source.
      for (const candidateId of getCandidateIds(restoreRes)) {
        if (await inspectPersonalFile(candidateId)) break;
      }

      // If restore is asynchronous, poll until the task yields a real file.
      const taskId = restoreRes?.task?.id || restoreRes?.task_id || (!restoreRes?.task && restoreRes?.id ? restoreRes.id : null);
      if (!actualPlayFileId && taskId) {
        for (let t = 0; t < 12; t++) {
          await new Promise((r) => setTimeout(r, 800));
          try {
            const taskData = await this.request(`/drive/v1/tasks/${taskId}`, "GET");
            console.log(`[PikPakClient] ⏳ Polling task #${t + 1}:`, taskData);
            for (const candidateId of getCandidateIds(taskData)) {
              if (await inspectPersonalFile(candidateId)) break;
            }
            if (actualPlayFileId) break;
            if (["PHASE_ERROR", "PHASE_FAILED", "PHASE_COMPLETE"].includes(taskData?.task?.phase)) break;
          } catch (_) {}
        }
      }

      // 3. If the API did not expose a usable ID, search the personal drive
      // using an exact name before considering a lone root video.
      if (!actualPlayFileId) {
        console.log(`[PikPakClient] 🔍 Đang quét Cloud cá nhân để định vị video "${targetName}"...`);
        const found = await this.findItemInUserDrive(targetName, previousRootIds);
        if (found) {
          cleanupTargetId = found.folderId || found.videoId;
          actualPlayFileId = found.videoId;
          console.log(`[PikPakClient] 🎯 Đã định vị trong Cloud: folderId=${found.folderId}, videoId=${found.videoId}`);
        }
      }

      if (!actualPlayFileId) {
        throw new Error(
          lastRestoreErr
            ? `Lỗi lưu Cloud: ${lastRestoreErr.message}`
            : `Không định vị được video "${targetName}" vừa lưu vào Cloud cá nhân.`
        );
      }

      // 5. Lấy thông tin chi tiết file từ Cloud cá nhân để trích xuất link stream chính thức
      console.log(`[PikPakClient] ✅ Đã định vị mục trong Cloud cá nhân: cleanupId=${cleanupTargetId}, playId=${actualPlayFileId}. Đang lấy luồng Full...`);
      return this.resolvePersonalStreamFromRaw(
        await this.getUserFileDetail(actualPlayFileId),
        actualPlayFileId,
        cleanupTargetId,
        targetName
      );
    }

    resolvePersonalStreamFromRaw(raw, actualPlayFileId, cleanupTargetId = actualPlayFileId, targetName = "") {
      const info = raw?.file_info || raw;

      const directUrl = info.web_content_link || raw.web_content_link || "";
      const medias = info.medias || raw.medias || [];
      const streams = [];

      const fileName = info.name || raw.name || targetName || "PikPak Video";
      const fileExt = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
      const nonNativeContainers = new Set(["avi", "wmv", "flv", "rmvb", "rm", "asf", "divx", "vob", "ts", "m2ts", "3gp"]);
      const isNonNative = nonNativeContainers.has(fileExt) || /video\/(x-msvideo|avi|msvideo|x-ms-wmv|x-flv)/i.test(info.mime_type || raw.mime_type || "");

      const origSize = parseInt(info.size || raw.size, 10) || 0;
      const origInMedias = medias.find((m) => {
        const name = (m.media_name || m.resolution_name || "").toLowerCase();
        const cat = (m.category || "").toLowerCase();
        return (name.includes("original") || name.includes("gốc") || cat === "category_origin") && m.link?.url;
      });
      const validDirectUrl = directUrl && !directUrl.includes("fid=&") ? directUrl : "";
      const origUrl = validDirectUrl || origInMedias?.link?.url || "";

      if (origUrl) {
        streams.push({
          quality: "Original",
          resolution: info.width && info.height ? `${info.width}x${info.height}` : "Original",
          url: origUrl,
          isOriginal: true,
          fileSize: origSize,
          mimeType: info.mime_type || raw.mime_type || "video/mp4",
        });
      }

      for (const m of medias) {
        if (m.link?.url) {
          const mName = (m.media_name || m.resolution_name || "").toLowerCase();
          if (origUrl && m.link.url === origUrl) continue;
          streams.push({
            quality: m.resolution_name || m.media_name || "Auto",
            resolution: m.resolution_name || (m.width && m.height ? `${m.width}x${m.height}` : "Auto"),
            url: m.link.url,
            isOriginal: false,
            fileSize: parseInt(m.file_size || m.video?.file_size || 0, 10),
            mimeType: m.mime_type || "video/mp4",
          });
        }
      }

      let primaryUrl = "";
      const firstTranscoded = streams.find((s) => !s.isOriginal && s.url);
      if (isNonNative) {
        primaryUrl = firstTranscoded?.url || origUrl || streams[0]?.url || "";
      } else {
        // Transcoded MP4 streams usually seek faster than multi-GB originals.
        primaryUrl = firstTranscoded?.url || streams.find((s) => s.isOriginal)?.url || origUrl || streams[0]?.url || "";
      }

      return {
        personalFileId: cleanupTargetId || actualPlayFileId,
        cleanupFileIds: [cleanupTargetId || actualPlayFileId].filter(Boolean),
        actualPlayFileId: actualPlayFileId,
        fileName: fileName,
        fileSize: origSize,
        primaryUrl: primaryUrl,
        streams: streams,
        isNonNative: isNonNative,
      };
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

      subfolders.sort(compareMediaItems);
      videoFiles.sort(compareMediaItems);
      files.sort(compareMediaItems);

      const mediaFiles = files
        .filter((f) => f.isVideo || f.isImage)
        .sort((a, b) => {
          const catA = a.isVideo ? 2 : 3;
          const catB = b.isVideo ? 2 : 3;
          if (catA !== catB) return catA - catB;
          return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
        });

      return {
        videos: videoFiles,
        subfolders: subfolders,
        allFiles: [...subfolders, ...files],
        mediaFiles: mediaFiles,
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
        // Tự động vô hiệu hóa cache cũ nếu luồng đầu tiên không phải là Original cho video chuẩn
        const isStandard = !cached.data?.isNonNative;
        const hasOriginalFirst = cached.data?.streams?.[0]?.isOriginal === true;
        if (isStandard && !hasOriginalFirst) {
          this.cache.delete(cacheKey);
        } else {
          return cached.data;
        }
      }

      if (!this.passCodeToken) {
        try { await this.getShareInfo(shareId); } catch (_) {}
      }

      const raw = await this.getFileInfo(shareId, fileId);
      const info = raw.file_info || raw;

      const directUrl = info.web_content_link || raw.web_content_link || "";
      const medias = info.medias || raw.medias || [];
      const streams = [];

      const fileName = info.name || raw.name || "";
      const fileExt = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
      const nonNativeContainers = new Set(["avi", "wmv", "flv", "rmvb", "rm", "asf", "divx", "vob", "ts", "m2ts", "3gp"]);
      const isNonNative = nonNativeContainers.has(fileExt) || /video\/(x-msvideo|avi|msvideo|x-ms-wmv|x-flv)/i.test(info.mime_type || raw.mime_type || "");

      const origSize = parseInt(info.size || raw.size, 10) || 0;
      const durSec = parseInt(info.params?.duration || raw.params?.duration || medias?.[0]?.video?.duration || 0, 10);

      // Luôn tìm hoặc khởi tạo luồng Original (File gốc nguyên bản)
      const origInMedias = medias.find((m) => {
        const name = (m.media_name || m.resolution_name || "").toLowerCase();
        return (name.includes("original") || name.includes("gốc")) && m.link?.url && !m.link.url.includes("fid=&");
      });
      const validDirectUrl = (directUrl && !directUrl.includes("fid=&")) ? directUrl : "";
      const origUrl = validDirectUrl || origInMedias?.link?.url || "";

      // 1. Luồng Original luôn được đưa vào VỊ TRÍ ĐẦU TIÊN (Index 0)
      if (origUrl) {
        const origBitrateKbps = origSize > 0 && durSec > 0 ? Math.round((origSize * 8) / (durSec * 1000)) : 0;
        let origBitrateText = "";
        if (origBitrateKbps >= 1000) origBitrateText = `~${(origBitrateKbps / 1000).toFixed(1)} Mbps`;
        else if (origBitrateKbps > 0) origBitrateText = `~${origBitrateKbps} Kbps`;

        streams.push({
          quality: "Original",
          resolution: info.width && info.height ? `${info.width}x${info.height}` : "Original",
          url: origUrl,
          isOriginal: true,
          fileSize: origSize,
          bitrateKbps: origBitrateKbps,
          bitrateText: origBitrateText,
          compressionRatio: 0,
          mimeType: info.mime_type || raw.mime_type || (isNonNative ? `video/${fileExt}` : "video/mp4"),
        });
      }

      // 2. Thêm các luồng khác từ medias (nếu có và không trùng với origUrl)
      for (const m of medias) {
        if (m.link?.url && !m.link.url.includes("fid=&")) {
          const mName = (m.media_name || m.resolution_name || "").toLowerCase();
          // Bỏ qua nếu là luồng Original đã add ở trên
          if (m.link.url === origUrl || mName.includes("original") || mName.includes("gốc")) continue;

          const streamSize = parseInt(m.file_size || m.video?.file_size || 0, 10);
          let bitrateKbps = 0;
          if (m.bitrate || m.video?.bitrate) {
            bitrateKbps = Math.round(parseInt(m.bitrate || m.video?.bitrate, 10) / 1000);
          } else if (streamSize > 0 && durSec > 0) {
            bitrateKbps = Math.round((streamSize * 8) / (durSec * 1000));
          }

          let bitrateText = "";
          if (bitrateKbps >= 1000) bitrateText = `~${(bitrateKbps / 1000).toFixed(1)} Mbps`;
          else if (bitrateKbps > 0) bitrateText = `~${bitrateKbps} Kbps`;

          let compressionRatio = 0;
          if (origSize > 0 && streamSize > 0 && streamSize < origSize) {
            compressionRatio = Math.round((1 - streamSize / origSize) * 100);
          }

          const qDisplay = m.resolution_name || m.media_name || "Transcoded";
          streams.push({
            quality: qDisplay,
            resolution: m.resolution_name || (m.width && m.height ? `${m.width}x${m.height}` : "Auto"),
            url: m.link.url,
            isOriginal: false,
            fileSize: streamSize,
            bitrateKbps: bitrateKbps,
            bitrateText: bitrateText,
            compressionRatio: compressionRatio,
            mimeType: m.mime_type || "video/mp4",
          });
        }
      }

      // 3. Đảm bảo luồng Original luôn đứng đầu danh sách streams cho video thông thường
      streams.sort((a, b) => {
        if (!isNonNative && a.isOriginal !== b.isOriginal) return a.isOriginal ? -1 : 1;
        if (isNonNative && a.isOriginal !== b.isOriginal) return a.isOriginal ? 1 : -1;
        return 0;
      });

      // 4. Prefer a transcoded stream for faster random seeking. Original stays
      // available in the quality menu as a fidelity option.
      let primaryUrl = "";
      const origStream = streams.find((s) => s.isOriginal && s.url);
      const bestTranscoded = streams.find((s) => !s.isOriginal && s.url);

      if (isNonNative && bestTranscoded) {
        primaryUrl = bestTranscoded.url;
      } else {
        primaryUrl = bestTranscoded?.url || origStream?.url || origUrl || streams[0]?.url || "";
      }

      const result = {
        fileId: fileId,
        fileName: fileName || info.name,
        fileSize: origSize,
        primaryUrl: primaryUrl,
        streams: streams,
        isNonNative: isNonNative,
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
