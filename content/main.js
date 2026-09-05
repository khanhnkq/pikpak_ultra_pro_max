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

  function renderDurationBadgesOnWeb() {
    if (window.PikPakPlayer?.isModalOpen) return;
    const items = document.querySelectorAll('.file-item, .grid.file-item, .file-list-item, .el-table__row');
    if (items.length === 0) return;

    if (currentPlaylist.length === 0) {
      const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
      if (net?.playlist?.length > 0) currentPlaylist = net.playlist;
    }

    const icons = window.PikPakIcons || {};

    items.forEach((itemEl) => {
      if (itemEl.dataset.ppProcessed === "1") return;

      const thumb = itemEl.querySelector('.thumbnail') || itemEl.querySelector('.file-cover, .thumbnail-wrap, .player-file-cover');
      if (!thumb) return;

      const hasDuration = Boolean(thumb.querySelector('.pp-web-duration-badge'));
      const hasTypeBadge = Boolean(thumb.querySelector('.pp-type-badge'));
      const fc = thumb.querySelector('.folder-cover');
      const hasFolderBlur = fc ? Boolean(fc.querySelector('.pp-folder-blur')) : true;

      if (hasDuration && hasTypeBadge && hasFolderBlur) {
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
      if (fc && !fc.querySelector('.pp-folder-blur')) {
        const fImg = fc.querySelector('img');
        if (fImg?.src) {
          const b = document.createElement('div');
          b.className = 'pp-folder-blur';
          b.style.backgroundImage = `url("${fImg.src}")`;
          fc.prepend(b);
        }
      }

      itemEl.dataset.ppProcessed = "1";
    });
  }

  function harvestPikPakThumbnails() {
    if (window.PikPakPlayer?.isModalOpen) return;
    document.querySelectorAll("#manager-preview-bar .player-file-cover, .file-list-box .file-list-item").forEach((el, idx) => {
      const src = el.querySelector("img")?.src;
      if (src && currentPlaylist[idx] && (!currentPlaylist[idx].thumbnailLink || currentPlaylist[idx].thumbnailLink.length < 5)) currentPlaylist[idx].thumbnailLink = src;
    });
  }

  let observerThrottleTimer = null;
  function handleDomMutations() {
    suppressModals();
    if (!window.PikPakPlayer?.isModalOpen) {
      harvestPikPakThumbnails();
      renderDurationBadgesOnWeb();
      checkAndAutoUnlock();
    } else {
      document.querySelectorAll(BG_VIDEO_SELECTOR).forEach((v) => {
        try { if (!v.paused) v.pause(); v.muted = true; v.volume = 0; } catch (_) {}
      });
    }
  }

  const modalObserver = new MutationObserver(() => {
    if (observerThrottleTimer) return;
    observerThrottleTimer = setTimeout(() => {
      observerThrottleTimer = null;
      handleDomMutations();
    }, 150);
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
      if (net.streamUrl) {
        currentVideo.dataset.ppUnlocked = "true";
        if (currentPlaylist.length > 0 && currentVideoIndex === -1) currentVideoIndex = 0;
        updateControls();
        applyDirectStream(net.streamUrl, { playlist: currentPlaylist, currentIndex: Math.max(0, currentVideoIndex) });
        return;
      }
      if (shareId && currentPlaylist.length > 0) {
        currentVideo.dataset.ppUnlocked = "true"; updateControls();
        const targetIdx = currentVideoIndex >= 0 ? currentVideoIndex : 0;
        await loadAndPlayFile(shareId, currentPlaylist[targetIdx].id);
      } else if (shareId && (fileId || parentId)) {
        currentVideo.dataset.ppUnlocked = "true";
        await loadAndPlayFile(shareId, fileId || parentId);
      }
    } catch (err) {
      console.warn("[PikPak Ultra] Auto-unlock error:", err.message);
    } finally {
      isAutoUnlocking = false;
    }
  }

  function applyDirectStream(url, meta = {}) {
    if (!url) return;
    if (window.PikPakPlayer?.isModalOpen && window.PikPakPlayer?.currentStreamUrl === url) {
      return;
    }
    isUnlocked = true;
    console.log("%c[PikPak Ultra] 📺 Khởi chạy Cinema Modal Player:", LOG_SUCCESS, { url, meta });

    // Dập tắt triệt để video gốc ở nền
    document.querySelectorAll(BG_VIDEO_SELECTOR).forEach((v) => {
      try { v.pause(); v.muted = true; v.volume = 0; v.style.display = "none"; v.onplay = () => { if (window.PikPakPlayer?.isModalOpen) { v.pause(); v.muted = true; v.volume = 0; } }; } catch (_) {}
    });

    window.PikPakPlayer?.openCinemaModal(url, {
      fileName: meta.fileName || activeStreamData?.fileName || "PikPak Video Stream",
      fileSize: meta.fileSize || activeStreamData?.fileSize || 0,
      playlist: meta.playlist || currentPlaylist,
      currentIndex: meta.currentIndex !== undefined ? meta.currentIndex : currentVideoIndex,
      streams: activeStreamData?.streams || [],
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
  function handleFileItemClick(e) {
    const itemEl = e.target.closest('.file-list-item, [class*="file-item"], [class*="file_item"], .el-table__row, [class*="grid-item"], [class*="card-item"]');
    if (!itemEl || e.target.closest('input, .el-checkbox, [class*="checkbox"], [class*="more-btn"], [class*="action-btn"], [class*="download"]')) return;

    // 1. Phân biệt thư mục: Tuyệt đối không can thiệp khi bấm vào thư mục
    if (itemEl.querySelector('img[src*="folder"], svg[class*="folder"], [class*="folder-icon"], [class*="folder"]') || itemEl.classList.contains("is-folder") || itemEl.getAttribute("data-kind") === "drive#folder") return;

    let vItem = null;
    try {
      const comp = itemEl.__vueParentComponent || itemEl.__vnode?.ctx;
      vItem = comp?.props?.item || comp?.setupState?.item || comp?.data?.item || itemEl.__vue__?.item;
    } catch (_) {}
    if (vItem?.kind === "drive#folder") return;

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
          if (list.length > 0) { currentPlaylist = list; harvestPikPakThumbnails(); loadAndPlayFile(shareId, list[0].id); }
        }).catch((err) => showToast("Lỗi mở media: " + err.message, true));
      }
    }
  }

  document.addEventListener("click", handleFileItemClick, true);

  let lastPrefetchedKey = "";
  let isPrefetching = false;

  async function prefetchPlaylist() {
    if (isPrefetching) return;
    const { shareId, parentId, fileId } = getShareContext();
    if (!shareId) return;

    const netPlaylist = window.PikPakNetwork?.getIntercepted()?.playlist;
    if (netPlaylist?.length > 0) {
      if (currentPlaylist.length === 0) {
        currentPlaylist = netPlaylist;
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
        currentPlaylist = res.mediaFiles || res.videos;
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
      if (url && !isUnlocked) {
        applyDirectStream(url, {
          playlist: currentPlaylist,
          currentIndex: currentVideoIndex >= 0 ? currentVideoIndex : 0,
        });
      } else checkAndAutoUnlock();
    });
    window.PikPakNetwork.onPlaylist((videos) => {
      if (videos?.length > 0) {
        currentPlaylist = videos;
        harvestPikPakThumbnails();
        updateControls();
      }
    });
  }

  prefetchPlaylist();
})();
