(function () {
  const LOG_STYLE = "color: #38bdf8; font-weight: bold; background: #0b1528; padding: 2px 6px; border-radius: 4px;";
  const LOG_ERR = "color: #f87171; font-weight: bold; background: #280b0b; padding: 2px 6px; border-radius: 4px;";
  const LOG_SUCCESS = "color: #4ade80; font-weight: bold; background: #0b2815; padding: 2px 6px; border-radius: 4px;";

  console.log("%c[PikPak Ultra] 🚀 Main World script initialized.", LOG_STYLE);

  const BRIDGE_SOURCE_PAGE = "PIKPAK_PAGE_SCRIPT";
  const BRIDGE_SOURCE_EXT = "PIKPAK_INJECTOR_SCRIPT";
  const BG_VIDEO_SELECTOR = "video:not(#pikpak-ultra-modal-video):not(#pp-scrub-preview-video)";

  let pendingRequests = new Map(), currentShareId = null, currentParentId = "";
  let resolvedShareData = null, activeStreamData = null, isUnlocked = false;
  let currentPlaylist = [], currentVideoIndex = -1, isAutoUnlocking = false;

  // ====== 1. Communication Bridge ======
  function sendToExtension(action, payload = {}) {
    if (isContextInvalidated) {
      return Promise.reject(new Error("Extension context invalidated. Hãy F5 tải lại trang!"));
    }
    return new Promise((resolve, reject) => {
      const requestId = "req_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now();
      pendingRequests.set(requestId, { resolve, reject, action });
      window.postMessage({ source: BRIDGE_SOURCE_PAGE, requestId, action, payload }, "*");
      setTimeout(() => {
        if (pendingRequests.delete(requestId)) reject(new Error(`Timeout (30s) gọi action: ${action}`));
      }, 30000);
    });
  }

  let isContextInvalidated = false;
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== BRIDGE_SOURCE_EXT) return;
    const { requestId, response } = event.data;
    if (!pendingRequests.has(requestId)) return;
    const { resolve, reject } = pendingRequests.get(requestId);
    pendingRequests.delete(requestId);
    if (response?.success) resolve(response.data);
    else {
      if (response?.error?.includes("Extension context invalidated") && !isContextInvalidated) {
        isContextInvalidated = true;
        showToast("Extension vừa cập nhật. Hãy F5 trang web!", true);
      }
      reject(new Error(response?.error || "Phản hồi rỗng từ extension"));
    }
  });

  // ====== 2. Toast UI Helper ======
  function showToast(message, isError = false) {
    let t = document.getElementById("pikpak-ultra-toast") || Object.assign(document.createElement("div"), { id: "pikpak-ultra-toast" });
    if (!t.parentElement) (document.body || document.documentElement).appendChild(t);
    const icons = window.PikPakIcons || {}, iconSvg = isError ? (icons.alert || "") : (icons.check || "");
    t.className = isError ? "error show" : "show";
    t.innerHTML = `<span class="pp-toast-icon">${iconSvg}</span><span class="pp-toast-text">${message}</span>`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 3500);
  }

  // ====== 3. Share Context Extractor ======
  function getShareContext() {
    const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
    let shareId = net.shareId || null, parentId = net.parentId || "", fileId = net.fileId || "";
    const sIndex = window.location.href.indexOf("/s/");
    if (sIndex !== -1) {
      const segs = window.location.href.substring(sIndex + 3).split(/[?#]/)[0].split("/").filter(Boolean);
      if (!shareId) shareId = segs[0];
      if (segs.length === 2) { parentId = parentId || segs[1]; fileId = fileId || segs[1]; }
      else if (segs.length >= 3) { parentId = parentId || segs[1]; fileId = fileId || segs[segs.length - 1]; }
    }
    const sp = new URLSearchParams(window.location.search);
    return {
      shareId: shareId || sp.get("share_id") || null,
      parentId: parentId || sp.get("parent_id") || "",
      fileId: fileId || sp.get("file_id") || ""
    };
  }

  // ====== 4. Suppress Limit Modals, Harvest Thumbnails & Badges ======
  function suppressModals() {
    if (!isUnlocked) return;
    document.querySelectorAll('[class*="preview"],[class*="limit"],[class*="countdown"],[class*="save-dialog"],[class*="vip-modal"],[class*="modal-mask"]').forEach((el) => {
      if (/Previewing remaining|Preview remaining|00:30|Save Now|Save to Drive/.test(el.textContent || "")) {
        el.style.display = "none";
        el.style.pointerEvents = "none";
      }
    });
  }

  function formatDuration(sec) {
    const s = parseInt(sec, 10);
    if (isNaN(s) || s <= 0) return "";
    const h = Math.floor(s / 3600), m = String(Math.floor((s % 3600) / 60)).padStart(2, "0"), r = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${m}:${r}` : `${m}:${r}`;
  }

  let isModifyingDom = false;

  function sortPlaylist(list) {
    if (!Array.isArray(list)) return [];
    return [...list].sort((a, b) => {
      const isVidA = Boolean(a.isVideo || a.type === "video" || /\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|3gp|rmvb|iso)/i.test(a.name || ""));
      const isVidB = Boolean(b.isVideo || b.type === "video" || /\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|3gp|rmvb|iso)/i.test(b.name || ""));
      if (isVidA !== isVidB) return isVidA ? -1 : 1; // video first, image second

      // Nếu cả hai đều là video: video dài nhất trước (duration giảm dần)
      if (isVidA && isVidB) {
        const durA = parseInt(a.duration || a.params?.duration || a.medias?.[0]?.video?.duration || 0, 10) || 0;
        const durB = parseInt(b.duration || b.params?.duration || b.medias?.[0]?.video?.duration || 0, 10) || 0;
        if (durA !== durB) return durB - durA;
      }

      return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
    });
  }

  function parseDurationText(text) {
    if (!text) return 0;
    const parts = text.trim().split(":").map((p) => parseInt(p, 10));
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return 0;
  }

  function getElementDuration(el) {
    if (!el) return 0;
    try {
      const comp = el.__vueParentComponent || el.__vnode?.ctx;
      const vItem = comp?.props?.item || comp?.setupState?.item || comp?.data?.item || el.__vue__?.item;
      const s = parseInt(vItem?.params?.duration || vItem?.medias?.[0]?.video?.duration || 0, 10);
      if (s > 0) return s;
    } catch (_) {}

    const badge = el.querySelector(".pp-web-duration-badge");
    if (badge && badge.textContent) {
      const s = parseDurationText(badge.textContent);
      if (s > 0) return s;
    }

    const nameEl = el.querySelector('.name .ellipsis, .name, [class*="file-name"], [class*="title"]');
    const rawName = (nameEl?.textContent || el.querySelector('img')?.alt || el.textContent || '').trim().split('\n')[0].trim().toLowerCase();
    if (rawName && currentPlaylist?.length > 0) {
      const matched = currentPlaylist.find((v) => v?.name && (rawName.includes(v.name.toLowerCase()) || v.name.toLowerCase().includes(rawName)));
      if (matched && matched.duration > 0) return matched.duration;
    }

    return 0;
  }

  function getElementCategory(el) {
    if (!el) return 4;
    // 1. Folder
    if (
      el.classList.contains("pp-folder-card") ||
      el.classList.contains("is-folder") ||
      el.getAttribute("data-kind") === "drive#folder" ||
      el.querySelector('.folder-cover, img[src*="folder"], svg[class*="folder"], [class*="folder-icon"], [class*="folder"]')
    ) {
      return 1;
    }
    let comp = null, vItem = null;
    try {
      comp = el.__vueParentComponent || el.__vnode?.ctx;
      vItem = comp?.props?.item || comp?.setupState?.item || comp?.data?.item || el.__vue__?.item;
      if (vItem) {
        if (vItem.kind === "drive#folder") return 1;
        if (vItem.kind === "drive#video" || vItem.mime_type?.startsWith("video/")) return 2;
        if (vItem.kind === "drive#image" || vItem.mime_type?.startsWith("image/")) return 3;
      }
    } catch (_) {}

    const text = (el.textContent || "").trim();
    const nameEl = el.querySelector('.name .ellipsis, .name, [class*="file-name"], [class*="title"]');
    const name = (nameEl?.textContent || el.querySelector('img')?.alt || text).split("\n")[0].trim().toLowerCase();

    // 2. Video
    if (
      el.querySelector(".play-icon, [class*='play-icon'], .pp-web-duration-badge") ||
      /\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|3gp|rmvb|iso|vob|m2ts)$/i.test(name)
    ) {
      return 2;
    }

    // 3. Image
    if (/\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|tiff|ico)$/i.test(name)) {
      return 3;
    }

    return 4;
  }

  function sortWebDomFiles() {
    if (isModifyingDom || window.PikPakPlayer?.isModalOpen) return;
    const items = document.querySelectorAll('.file-item, .grid.file-item, .file-list-item, .el-table__row');
    if (items.length < 2) return;

    const parentMap = new Map();
    items.forEach((item) => {
      const p = item.parentElement;
      if (!p) return;
      if (!parentMap.has(p)) parentMap.set(p, []);
      parentMap.get(p).push(item);
    });

    parentMap.forEach((children, parent) => {
      let needsSort = false;
      let prevCat = 0;
      let prevDur = Infinity;
      for (const child of children) {
        const cat = getElementCategory(child);
        const dur = cat === 2 ? getElementDuration(child) : 0;
        if (cat < prevCat) {
          needsSort = true;
          break;
        }
        if (cat === 2 && prevCat === 2 && dur > prevDur) {
          needsSort = true;
          break;
        }
        prevCat = cat;
        prevDur = dur;
      }

      if (needsSort) {
        isModifyingDom = true;
        try {
          const sorted = [...children].sort((a, b) => {
            const catA = getElementCategory(a);
            const catB = getElementCategory(b);
            if (catA !== catB) return catA - catB;

            // Nếu cả hai đều là video: video dài nhất trước (duration giảm dần)
            if (catA === 2) {
              const durA = getElementDuration(a);
              const durB = getElementDuration(b);
              if (durA !== durB) return durB - durA;
            }

            const nameElA = a.querySelector('.name .ellipsis, .name, [class*="file-name"], [class*="title"]');
            const nameA = (nameElA?.textContent || a.querySelector('img')?.alt || a.textContent || "").trim();
            const nameElB = b.querySelector('.name .ellipsis, .name, [class*="file-name"], [class*="title"]');
            const nameB = (nameElB?.textContent || b.querySelector('img')?.alt || b.textContent || "").trim();
            return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
          });

          sorted.forEach((el) => parent.appendChild(el));
        } catch (_) {
        } finally {
          setTimeout(() => { isModifyingDom = false; }, 50);
        }
      }
    });
  }

  function renderDurationBadgesOnWeb() {
    if (window.PikPakPlayer?.isModalOpen) return;
    const items = document.querySelectorAll('.file-item, .grid.file-item, .file-list-item, .el-table__row');
    if (items.length === 0) return;

    if (currentPlaylist.length === 0) {
      const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
      if (net?.playlist?.length > 0) currentPlaylist = sortPlaylist(net.playlist);
    }

    const icons = window.PikPakIcons || {};
    isModifyingDom = true;

    try {
      items.forEach((itemEl) => {
        if (itemEl.dataset.ppProcessed === "1") return;

        const thumb = itemEl.querySelector('.thumbnail') || itemEl.querySelector('.file-cover, .thumbnail-wrap, .player-file-cover');
        if (!thumb) return;

        const fc = thumb.querySelector('.folder-cover');
        if (fc) {
          itemEl.classList.add('pp-folder-card');
          thumb.classList.add('pp-folder-card');
        }

        const hasDuration = Boolean(thumb.querySelector('.pp-web-duration-badge'));
        const hasTypeBadge = Boolean(thumb.querySelector('.pp-type-badge'));

        if (hasDuration && hasTypeBadge) {
          itemEl.dataset.ppProcessed = "1";
          return;
        }

        let durationStr = "", vItem = null;
        try {
          const comp = itemEl.__vueParentComponent || itemEl.__vnode?.ctx;
          vItem = comp?.props?.item || comp?.setupState?.item || comp?.data?.item || itemEl.__vue__?.item;
          const s = parseInt(vItem?.params?.duration || vItem?.medias?.[0]?.video?.duration || 0, 10);
          if (s > 0) durationStr = formatDuration(s);
        } catch (_) {}

        const nameEl = itemEl.querySelector('.name .ellipsis, .name, [class*="file-name"], [class*="title"]');
        const rawName = (nameEl?.textContent || itemEl.querySelector('img')?.alt || itemEl.textContent || '').trim().split('\n')[0].trim().toLowerCase();

        if (!durationStr && currentPlaylist?.length > 0) {
          const matched = currentPlaylist.find((v) => v?.name && (rawName.includes(v.name.toLowerCase()) || v.name.toLowerCase().includes(rawName)));
          durationStr = matched?.durationText || (matched?.duration > 0 ? formatDuration(matched.duration) : "");
        }

        if (durationStr && !hasDuration) {
          const badge = document.createElement('span');
          badge.className = 'pp-web-duration-badge';
          badge.textContent = durationStr;
          thumb.appendChild(badge);
        }
        if (!hasTypeBadge) {
          let type = '';
          if (fc || itemEl.classList.contains('is-folder') || vItem?.kind === 'drive#folder') type = 'folder';
          else if (durationStr || itemEl.querySelector('.play-icon') || vItem?.kind === 'drive#video' || /\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|3gp|rmvb|iso)$/i.test(rawName)) type = 'video';
          else if (vItem?.kind === 'drive#image' || /\.(jpg|jpeg|png|webp|gif|bmp|svg|tiff|avif|heic)$/i.test(rawName)) type = 'image';
          if (type && icons[type]) {
            const tb = document.createElement('span');
            tb.className = `pp-type-badge pp-type-${type}`;
            tb.title = type === 'folder' ? 'Thư mục' : type === 'video' ? 'Video' : 'Hình ảnh';
            tb.innerHTML = icons[type];
            thumb.appendChild(tb);
          }
        }

        itemEl.dataset.ppProcessed = "1";
      });
    } finally {
      setTimeout(() => {
        isModifyingDom = false;
      }, 50);
    }
  }

  function harvestPikPakThumbnails() {
    if (window.PikPakPlayer?.isModalOpen || !currentPlaylist || currentPlaylist.length === 0) return;
    document.querySelectorAll("#manager-preview-bar .player-file-cover, .file-list-box .file-list-item").forEach((el, idx) => {
      const src = el.querySelector("img")?.src;
      if (src && currentPlaylist[idx] && (!currentPlaylist[idx].thumbnailLink || currentPlaylist[idx].thumbnailLink.length < 5)) currentPlaylist[idx].thumbnailLink = src;
    });
  }

  let observerThrottleTimer = null;
  function handleDomMutations() {
    if (isModifyingDom) return;
    suppressModals();
    if (!window.PikPakPlayer?.isModalOpen) {
      sortWebDomFiles();
      harvestPikPakThumbnails();
      renderDurationBadgesOnWeb();
      checkAndAutoUnlock();
    } else {
      window.PikPakPlayer?.purgeUnusedMediaAndLayers?.();
    }
  }

  const modalObserver = new MutationObserver(() => {
    if (isModifyingDom || observerThrottleTimer) return;
    observerThrottleTimer = setTimeout(() => {
      observerThrottleTimer = null;
      requestAnimationFrame(() => handleDomMutations());
    }, 300);
  });
  modalObserver.observe(document.documentElement, { childList: true, subtree: true });

  // ====== 5. Playlist & Navigation State ======
  async function playMediaByIndex(index) {
    if (!currentPlaylist || index < 0 || index >= currentPlaylist.length) return;
    currentVideoIndex = index;
    const target = currentPlaylist[currentVideoIndex];
    const isImg = target.type === "image" || target.isImage || /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic)/i.test(target.name || "");
    showToast(`Đang nạp: ${target.name}`);
    const { shareId } = getShareContext();
    if (isImg) await loadAndDisplayImage(shareId, target.id, target);
    else if (shareId) await loadAndPlayFile(shareId, target.id);
  }

  function playNextMedia() { if (currentPlaylist.length > 0 && currentVideoIndex < currentPlaylist.length - 1) playMediaByIndex(currentVideoIndex + 1); else showToast("Đã là mục cuối cùng!"); }
  function playPrevMedia() { if (currentPlaylist.length > 0 && currentVideoIndex > 0) playMediaByIndex(currentVideoIndex - 1); else showToast("Đã là mục đầu tiên!"); }

  async function loadAndDisplayImage(shareId, fileId, targetItem = {}) {
    try {
      let imgUrl = targetItem.thumbnailLink || targetItem.webContentLink || "";
      let fileName = targetItem.name || "Hình ảnh";
      if (fileId && (!imgUrl || !imgUrl.includes("http"))) {
        const res = await sendToExtension("GET_STREAM_URL", { shareId, fileId });
        imgUrl = res.primaryUrl || res.thumbnailLink || imgUrl;
        fileName = res.fileName || fileName;
      }
      if (!imgUrl) throw new Error("Không lấy được đường dẫn ảnh!");
      if (currentPlaylist.length > 0) {
        const idx = currentPlaylist.findIndex((v) => v.id === fileId || (targetItem.name && v.name === targetItem.name));
        if (idx !== -1) currentVideoIndex = idx;
      }
      window.PikPakPlayer?.openImageModal(imgUrl, {
        fileName,
        playlist: currentPlaylist,
        currentIndex: currentVideoIndex,
        onPrev: () => playPrevMedia(),
        onNext: () => playNextMedia(),
        onSelect: (idx) => playMediaByIndex(idx),
        onDownload: () => handleDownloadClick(imgUrl, fileName),
      });
    } catch (err) { showToast("Lỗi nạp ảnh: " + err.message, true); }
  }

  function updateControls() {
    renderDurationBadgesOnWeb();
  }

  // ====== 7. Stream Resolution & Action Handlers ======

  async function loadAndPlayFile(shareId, fileId) {
    try {
      currentShareId = shareId;
      const streamData = await sendToExtension("GET_STREAM_URL", { shareId, fileId });
      activeStreamData = { ...streamData, fileId };
      const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
      const streamUrl = streamData.primaryUrl || (streamData.streams && streamData.streams[0]?.url) || net.streamUrl;
      if (!streamUrl) throw new Error("Không lấy được stream URL!");

      if (currentPlaylist.length > 0) {
        const idx = currentPlaylist.findIndex((v) => v.id === fileId);
        if (idx !== -1) currentVideoIndex = idx;
      }

      updateControls();

      applyDirectStream(streamUrl, {
        fileName: streamData.fileName,
        fileSize: streamData.fileSize,
        playlist: currentPlaylist,
        currentIndex: currentVideoIndex,
        streams: streamData.streams,
      });

      sendToExtension("VIDEO_STREAMING_ACTIVE").catch(() => {});
    } catch (err) {
      showToast("Lỗi nạp video: " + err.message, true);
    }
  }

  // ====== 8. Auto-Unlock Watcher ======
  async function checkAndAutoUnlock() {
    if (window.PikPakPlayer?.isModalOpen || isAutoUnlocking) return;
    const { shareId } = getShareContext();
    if (!shareId) return; // Chỉ auto-unlock khi đang duyệt link chia sẻ công khai
    const currentVideo = document.querySelector(BG_VIDEO_SELECTOR);
    if (!currentVideo || currentVideo.dataset.ppUnlocked === "true" || currentVideo.dataset.ppUnlocked === "failed") return;
    isAutoUnlocking = true;

    const attempts = parseInt(currentVideo.dataset.ppAttempts || "0", 10) + 1;
    currentVideo.dataset.ppAttempts = attempts.toString();
    if (attempts >= 3) { currentVideo.dataset.ppUnlocked = "failed"; isAutoUnlocking = false; return; }

    try { currentVideo.muted = true; currentVideo.volume = 0; currentVideo.pause(); currentVideo.style.display = "none"; } catch (_) {}

    try {
      const { shareId, parentId, fileId } = getShareContext();
      const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
      if (shareId && currentPlaylist.length > 0) {
        currentVideo.dataset.ppUnlocked = "true"; updateControls();
        const targetIdx = currentVideoIndex >= 0 ? currentVideoIndex : 0;
        await loadAndPlayFile(shareId, currentPlaylist[targetIdx].id);
      } else if (shareId && (fileId || parentId)) {
        currentVideo.dataset.ppUnlocked = "true";
        await loadAndPlayFile(shareId, fileId || parentId);
      } else if (net.streamUrl) {
        currentVideo.dataset.ppUnlocked = "true";
        if (currentPlaylist.length > 0 && currentVideoIndex === -1) currentVideoIndex = 0;
        updateControls();
        applyDirectStream(net.streamUrl, { playlist: currentPlaylist, currentIndex: Math.max(0, currentVideoIndex) });
        return;
      }
    } catch (err) {
      console.warn("[PikPak Ultra] Auto-unlock error:", err.message);
    } finally {
      isAutoUnlocking = false;
    }
  }

  function applyDirectStream(url, meta = {}) {
    if (!url) return;
    const allStreams = meta.streams || activeStreamData?.streams || [];
    const mediaName = meta.fileName || activeStreamData?.fileName || "";
    const isAviOrNonNative = /\.(avi|wmv|flv|rmvb|rm|asf|divx|vob|ts|m2ts|3gp)(\?|$)/i.test(url) ||
      /\.(avi|wmv|flv|rmvb|rm|asf|divx|vob|ts|m2ts|3gp)$/i.test(mediaName);

    let effectiveUrl = url;
    if (isAviOrNonNative && allStreams.length > 0) {
      const transcoded = allStreams.find((s) => !s.isOriginal && s.url && !s.url.includes("fid=&"));
      if (transcoded?.url) {
        effectiveUrl = transcoded.url;
      }
    } else if (allStreams.length > 0) {
      // Video thông thường: LUÔN DÙNG BẢN GỐC (Original) để đảm bảo 100% phát mượt mà
      const origStream = allStreams.find((s) => s.isOriginal && s.url && !s.url.includes("fid=&"));
      if (origStream?.url) {
        effectiveUrl = origStream.url;
      }
    }

    if (window.PikPakPlayer?.isModalOpen && window.PikPakPlayer?.currentStreamUrl === effectiveUrl) {
      return;
    }
    isUnlocked = true;
    console.log("%c[PikPak Ultra] 📺 Khởi chạy Cinema Modal Player:", LOG_SUCCESS, { url: effectiveUrl, meta });

    // Dập tắt và xóa sổ triệt để mọi video và layer thừa ở nền
    window.PikPakPlayer?.purgeUnusedMediaAndLayers?.();

    window.PikPakPlayer?.openCinemaModal(effectiveUrl, {
      fileName: meta.fileName || activeStreamData?.fileName || "PikPak Video Stream",
      fileSize: meta.fileSize || activeStreamData?.fileSize || 0,
      playlist: meta.playlist || currentPlaylist,
      currentIndex: meta.currentIndex !== undefined ? meta.currentIndex : currentVideoIndex,
      streams: allStreams,
      onPrev: () => playPrevMedia(),
      onNext: () => playNextMedia(),
      onSelect: (idx) => playMediaByIndex(idx),
      onDownload: () => handleDownloadClick(),
      onRefreshRequest: () => {
        if (currentShareId && activeStreamData?.fileId) {
          sendToExtension("REFRESH_STREAM_URL", { shareId: currentShareId, fileId: activeStreamData.fileId })
            .then((newData) => {
              if (newData && newData.primaryUrl) {
                activeStreamData = newData;
                window.PikPakPlayer.changeSource(newData.primaryUrl);
                showToast("Đã cập nhật link stream mới!");
              } else {
                console.warn("[PikPak Ultra] Refresh stream returned empty primaryUrl");
              }
            })
            .catch((err) => {
              console.warn("[PikPak Ultra] Error refreshing stream URL:", err.message);
            });
        }
      },
    });

    suppressModals();
  }

  function handleDownloadClick(customUrl, customName) {
    const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
    const url = customUrl || activeStreamData?.primaryUrl || net.streamUrl;
    if (url) {
      const a = Object.assign(document.createElement("a"), { href: url, download: customName || activeStreamData?.fileName || "media", target: "_blank" });
      (document.body || document.documentElement).appendChild(a);
      a.click(); a.remove();
      showToast("Bắt đầu tải file...");
    } else showToast("Không tìm thấy link download", true);
  }

  // ====== 10. Instant Media (Video & Image) Click Interceptor ======
  let lastMediaClickTime = 0;
  let activeOpeningMediaKey = null;

  function handleFileItemClick(e) {
    const itemEl = e.target.closest('.file-list-item, [class*="file-item"], [class*="file_item"], .el-table__row, [class*="grid-item"], [class*="card-item"]');
    if (!itemEl || e.target.closest('input, .el-checkbox, [class*="checkbox"], [class*="more-btn"], [class*="action-btn"], [class*="download"]')) return;

    // 1. Phân biệt thư mục: Mở thư mục ngay lập tức chỉ với 1 click
    let comp = null, vItem = null;
    try {
      comp = itemEl.__vueParentComponent || itemEl.__vnode?.ctx;
      vItem = comp?.props?.item || comp?.setupState?.item || comp?.data?.item || itemEl.__vue__?.item;
    } catch (_) {}

    const isFolder = Boolean(
      vItem?.kind === "drive#folder" ||
      itemEl.classList.contains("pp-folder-card") ||
      itemEl.classList.contains("is-folder") ||
      itemEl.getAttribute("data-kind") === "drive#folder" ||
      itemEl.querySelector('.folder-cover, img[src*="folder"], svg[class*="folder"], [class*="folder-icon"], [class*="folder"]')
    );

    if (isFolder) {
      if (e._ppSynthesized) return;
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.target.closest('input, .el-checkbox, [class*="checkbox"], [class*="more-btn"], [class*="action-btn"], [class*="download"], .grid-operation, .el-dropdown')) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const targetEl = e.target || itemEl;

      // Thử gọi hàm mở folder trực tiếp từ Vue component nếu có
      try {
        if (comp) {
          const itemData = vItem || comp.props?.item;
          const methods = [
            comp.setupState?.openFolder,
            comp.setupState?.handleOpen,
            comp.setupState?.handleDblclick,
            comp.setupState?.onItemDblclick,
            comp.setupState?.onDblclick,
            comp.setupState?.openItem,
            comp.ctx?.handleDblclick,
            comp.ctx?.openFolder,
            comp.ctx?.openItem,
          ];
          for (const fn of methods) {
            if (typeof fn === "function") {
              fn(itemData);
              break;
            }
          }
        }
      } catch (_) {}

      // Kích hoạt dblclick để Vue/PikPak mở thư mục ngay lập tức
      const dblClickEvent = new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: 2,
      });
      dblClickEvent._ppSynthesized = true;

      targetEl.dispatchEvent(dblClickEvent);
      if (targetEl !== itemEl) {
        itemEl.dispatchEvent(dblClickEvent);
      }

      // Kích hoạt click thứ 2 với detail = 2 đề phòng PikPak kiểm tra click detail
      const secondClickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: 2,
      });
      secondClickEvent._ppSynthesized = true;
      targetEl.dispatchEvent(secondClickEvent);

      return;
    }

    const itemText = (itemEl.textContent || "").trim();
    const isVideoExt = /\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|3gp|rmvb|iso)/i.test(itemText);
    const isImageExt = /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|tiff)/i.test(itemText);
    const hasPlayIcon = Boolean(itemEl.querySelector(".play-icon, [class*='play-icon']"));

    let matchedMedia = null, matchedIdx = -1;
    if (currentPlaylist?.length > 0) {
      matchedIdx = currentPlaylist.findIndex((v) => v?.name && (itemText.includes(v.name) || v.name.includes(itemText.split("\n")[0])));
      if (matchedIdx !== -1) matchedMedia = currentPlaylist[matchedIdx];
    }

    const isImage = Boolean(matchedMedia?.type === "image" || matchedMedia?.isImage || isImageExt || vItem?.kind === "drive#image" || vItem?.mime_type?.startsWith("image/"));
    const isVideo = Boolean(matchedMedia?.type === "video" || matchedMedia?.isVideo || isVideoExt || hasPlayIcon || vItem?.kind === "drive#video" || vItem?.mime_type?.startsWith("video/"));

    if (!isImage && !isVideo && !matchedMedia) return;

    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const { shareId } = getShareContext();
    if (!shareId) return;

    const mediaName = matchedMedia ? matchedMedia.name : (vItem?.name || itemText.split("\n")[0] || (isImage ? "Hình ảnh" : "Video"));
    const playIdx = matchedIdx !== -1 ? matchedIdx : 0;
    const targetFileId = matchedMedia?.id || vItem?.id;

    // Chặn double-click hoặc nhấn liên tiếp quá nhanh vào cùng 1 media (tránh mở 2 layer)
    const mediaKey = targetFileId || mediaName;
    const now = Date.now();
    if (activeOpeningMediaKey === mediaKey && (now - lastMediaClickTime) < 500) {
      return;
    }
    lastMediaClickTime = now;
    activeOpeningMediaKey = mediaKey;

    if (window.PikPakPlayer?.showInstantLoading) {
      window.PikPakPlayer.showInstantLoading(mediaName, playIdx, currentPlaylist, {
        onPrev: () => playPrevMedia(),
        onNext: () => playNextMedia(),
        onSelect: (idx) => playMediaByIndex(idx),
      });
    }

    if (isImage) {
      const directThumb = vItem?.thumbnail_link || matchedMedia?.thumbnailLink || itemEl.querySelector("img")?.src || "";
      currentVideoIndex = playIdx;
      loadAndDisplayImage(shareId, targetFileId, { name: mediaName, thumbnailLink: directThumb, id: targetFileId });
      return;
    }

    if (targetFileId) {
      currentVideoIndex = playIdx;
      loadAndPlayFile(shareId, targetFileId);
    } else {
      const target = currentPlaylist?.find((v) => itemText.includes(v.name)) || currentPlaylist?.[0];
      if (target) {
        currentVideoIndex = currentPlaylist.indexOf(target);
        loadAndPlayFile(shareId, target.id);
      } else {
        const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
        if (net.streamUrl) applyDirectStream(net.streamUrl);
        else sendToExtension("RESOLVE_SHARE", { shareId }).then((res) => {
          const list = res?.mediaFiles || res?.videos || [];
          if (list.length > 0) { currentPlaylist = sortPlaylist(list); harvestPikPakThumbnails(); loadAndPlayFile(shareId, currentPlaylist[0].id); }
        }).catch((err) => showToast("Lỗi mở media: " + err.message, true));
      }
    }
  }

  document.addEventListener("click", handleFileItemClick, true);

  // Chặn dblclick trên file media để PikPak native player KHÔNG BAO GIỜ mở thêm layer thứ 2
  function handleFileItemDblClick(e) {
    const itemEl = e.target.closest('.file-list-item, [class*="file-item"], [class*="file_item"], .el-table__row, [class*="grid-item"], [class*="card-item"]');
    if (!itemEl) return;
    if (e.target.closest('input, .el-checkbox, [class*="checkbox"], [class*="more-btn"], [class*="action-btn"], [class*="download"]')) return;

    // Phân biệt thư mục: Thư mục cần dblclick để mở nên không được chặn
    let comp = null, vItem = null;
    try {
      comp = itemEl.__vueParentComponent || itemEl.__vnode?.ctx;
      vItem = comp?.props?.item || comp?.setupState?.item || comp?.data?.item || itemEl.__vue__?.item;
    } catch (_) {}

    const isFolder = Boolean(
      vItem?.kind === "drive#folder" ||
      itemEl.classList.contains("pp-folder-card") ||
      itemEl.classList.contains("is-folder") ||
      itemEl.getAttribute("data-kind") === "drive#folder" ||
      itemEl.querySelector('.folder-cover, img[src*="folder"], svg[class*="folder"], [class*="folder-icon"], [class*="folder"]')
    );
    if (isFolder) return;

    // Ngăn chặn sự kiện dblclick phát tán đến Vue component của PikPak
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  document.addEventListener("dblclick", handleFileItemDblClick, true);

  // Đóng video khi người dùng bấm nút Quay lại / Breadcrumb trên giao diện PikPak web
  document.addEventListener("click", (e) => {
    if (window.PikPakPlayer?.isModalOpen) {
      const isNavBack = e.target.closest(
        '.breadcrumb, [class*="breadcrumb"], .back-btn, [class*="nav-back"], [class*="nav_back"], .router-link, [class*="back_button"], [class*="header_back"]'
      );
      if (isNavBack && !e.target.closest('#pikpak-ultra-cinema-modal')) {
        console.log("[PikPak Ultra] 🔙 Phát hiện click nút Back/Breadcrumb trên web -> Đang tắt video...");
        window.PikPakPlayer.closeCinemaModal(false);
      }
    }
  }, true);

  // Lắng nghe popstate từ window để đảm bảo modal luôn tắt khi back
  window.addEventListener("popstate", () => {
    if (window.PikPakPlayer?.isModalOpen) {
      console.log("[PikPak Ultra] 🔙 popstate detected in main.js -> Đang tắt video player...");
      window.PikPakPlayer.closeCinemaModal(false);
    }
  });

  let lastPrefetchedKey = "";
  let isPrefetching = false;

  async function prefetchPlaylist() {
    if (isPrefetching) return;
    const { shareId, parentId, fileId } = getShareContext();
    if (!shareId) return;

    const netPlaylist = window.PikPakNetwork?.getIntercepted()?.playlist;
    if (netPlaylist?.length > 0) {
      if (currentPlaylist.length === 0) {
        currentPlaylist = sortPlaylist(netPlaylist);
        harvestPikPakThumbnails();
        updateControls();
      }
      return;
    }

    const key = `${shareId}_${parentId || "root"}`;
    if (key === lastPrefetchedKey) return;
    lastPrefetchedKey = key;
    isPrefetching = true;

    try {
      let res = await sendToExtension("RESOLVE_SHARE", { shareId, parentId });
      if ((!res?.mediaFiles?.length && !res?.videos?.length) && parentId) {
        try {
          const rootRes = await sendToExtension("RESOLVE_SHARE", { shareId, parentId: "" });
          if (rootRes?.mediaFiles?.length > 0 || rootRes?.videos?.length > 0) res = rootRes;
        } catch (_) {}
      }
      if (res?.mediaFiles?.length > 0 || res?.videos?.length > 0) {
        currentPlaylist = sortPlaylist(res.mediaFiles || res.videos);
        resolvedShareData = res;
        const targetId = res.targetFileId || fileId;
        if (targetId && currentPlaylist.length > 0) {
          const tIdx = currentPlaylist.findIndex((v) => v.id === targetId);
          if (tIdx !== -1) currentVideoIndex = tIdx;
        }
        harvestPikPakThumbnails();
        updateControls();
      }
    } catch (_) {
    } finally {
      isPrefetching = false;
    }
  }

  // ====== 9. Polling for DOM changes / SPA Navigation ======
  let lastCheckedHref = window.location.href;
  setInterval(() => {
    if (isContextInvalidated) return;
    if (!window.PikPakPlayer?.isModalOpen) {
      checkAndAutoUnlock();
    }

    const currentHref = window.location.href;
    const hrefChanged = currentHref !== lastCheckedHref;
    if (hrefChanged) {
      lastCheckedHref = currentHref;
      if (window.PikPakPlayer?.isModalOpen) {
        console.log("[PikPak Ultra] 🔙 Phát hiện URL thay đổi (SPA navigation / Back) -> Tự động đóng video!");
        window.PikPakPlayer.closeCinemaModal(false);
      }
      document.querySelectorAll('[data-pp-processed]').forEach((el) => {
        delete el.dataset.ppProcessed;
      });
    }

    const { shareId, parentId, fileId } = getShareContext();
    const targetId = fileId || parentId;

    if (currentPlaylist.length > 0 && targetId && currentPlaylist.some((v) => v.id === targetId)) {
      const matchedIdx = currentPlaylist.findIndex((v) => v.id === targetId);
      if (matchedIdx !== -1 && matchedIdx !== currentVideoIndex && !window.PikPakPlayer?.isModalOpen) {
        currentParentId = parentId;
        playMediaByIndex(matchedIdx);
      }
      return;
    }

    if (shareId && (shareId !== currentShareId || (parentId !== currentParentId && !currentPlaylist.some((v) => v.id === parentId)))) {
      currentShareId = shareId;
      currentParentId = parentId;
      currentPlaylist = [];
      currentVideoIndex = -1;
      resolvedShareData = null;
      isUnlocked = false;
      sendToExtension("TAB_READY", { shareId, parentId }).catch(() => {});
      prefetchPlaylist();
    }
  }, 1000);

  if (window.PikPakNetwork) {
    window.PikPakNetwork.onStreamUrl((url) => {
      const { shareId, parentId, fileId } = getShareContext();
      if (shareId && (fileId || parentId || currentPlaylist.length > 0)) {
        checkAndAutoUnlock();
      } else if (url && !isUnlocked) {
        applyDirectStream(url, {
          playlist: currentPlaylist,
          currentIndex: currentVideoIndex >= 0 ? currentVideoIndex : 0,
        });
      }
    });
    window.PikPakNetwork.onPlaylist((videos) => {
      if (videos?.length > 0) {
        currentPlaylist = sortPlaylist(videos);
        harvestPikPakThumbnails();
        updateControls();
      }
    });
  }

  prefetchPlaylist();
})();
