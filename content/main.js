(function () {
  const LOG_STYLE = "color: #38bdf8; font-weight: bold; background: #0b1528; padding: 2px 6px; border-radius: 4px;";
  const LOG_ERR = "color: #f87171; font-weight: bold; background: #280b0b; padding: 2px 6px; border-radius: 4px;";
  const LOG_SUCCESS = "color: #4ade80; font-weight: bold; background: #0b2815; padding: 2px 6px; border-radius: 4px;";

  console.log("%c[PikPak Ultra] 🚀 Main World script initialized.", LOG_STYLE);

  const BRIDGE_SOURCE_PAGE = "PIKPAK_PAGE_SCRIPT";
  const BRIDGE_SOURCE_EXT = "PIKPAK_INJECTOR_SCRIPT";

  let pendingRequests = new Map();
  let currentShareId = null;
  let currentParentId = "";
  let resolvedShareData = null;
  let activeStreamData = null;
  let isUnlocked = false;

  let currentPlaylist = [];
  let currentVideoIndex = -1;
  let isAutoUnlocking = false;

  // ====== 1. Communication Bridge ======
  function sendToExtension(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = "req_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now();
      pendingRequests.set(requestId, { resolve, reject, action });
      window.postMessage({ source: BRIDGE_SOURCE_PAGE, requestId, action, payload }, "*");
      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          reject(new Error(`Timeout (30s) gọi action: ${action}`));
        }
      }, 30000);
    });
  }

  let isContextInvalidated = false;
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== BRIDGE_SOURCE_EXT) return;
    const { requestId, response } = event.data;
    if (pendingRequests.has(requestId)) {
      const { resolve, reject, action } = pendingRequests.get(requestId);
      pendingRequests.delete(requestId);
      if (response && response.success) resolve(response.data);
      else {
        if (response?.error?.includes("Extension context invalidated") && !isContextInvalidated) {
          isContextInvalidated = true;
          showToast("Extension vừa cập nhật. Hãy F5 trang web!", true);
        }
        reject(new Error(response?.error || "Phản hồi rỗng từ extension"));
      }
    }
  });

  // ====== 2. Toast UI Helper ======
  function showToast(message, isError = false) {
    let toast = document.getElementById("pikpak-ultra-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "pikpak-ultra-toast";
      (document.body || document.documentElement).appendChild(toast);
    }
    toast.className = isError ? "error show" : "show";
    toast.textContent = message;
    setTimeout(() => toast.classList.remove("show"), 4500);
  }

  // ====== 3. Share Context Extractor ======
  function getShareContext() {
    const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
    let shareId = net.shareId || null;
    let parentId = net.parentId || "";
    const fileId = net.fileId || null;

    const fullHref = window.location.href;
    const sIndex = fullHref.indexOf("/s/");
    if (sIndex !== -1) {
      const cleanPath = fullHref.substring(sIndex + 3).split(/[?#]/)[0];
      const segments = cleanPath.split("/").filter(Boolean);
      if (segments.length >= 1) {
        if (!shareId) shareId = segments[0];
        if (!parentId && segments.length > 1) {
          parentId = segments[segments.length - 1];
        }
      }
    }

    const searchParams = new URLSearchParams(window.location.search);
    if (!shareId && searchParams.get("share_id")) shareId = searchParams.get("share_id");
    if (!parentId && searchParams.get("parent_id")) parentId = searchParams.get("parent_id");
    const paramFileId = searchParams.get("file_id");

    return { shareId, parentId, fileId: fileId || paramFileId };
  }

  // ====== 4. Suppress Limit Modals & Harvest Thumbnails ======
  function suppressModals() {
    if (!isUnlocked) return;
    const selectors = ['[class*="preview"]', '[class*="limit"]', '[class*="countdown"]', '[class*="save-dialog"]', '[class*="vip-modal"]', '[class*="modal-mask"]'];
    document.querySelectorAll(selectors.join(",")).forEach((el) => {
      const text = el.innerText || "";
      if (text.includes("Previewing remaining") || text.includes("Preview remaining") || text.includes("00:30") || text.includes("Save Now") || text.includes("Save to Drive")) {
        el.style.display = "none";
        el.style.pointerEvents = "none";
      }
    });
  }

  function harvestPikPakThumbnails() {
    const covers = document.querySelectorAll("#manager-preview-bar .player-file-cover, .file-list-box .file-list-item");
    if (covers.length > 0 && currentPlaylist.length > 0) {
      covers.forEach((el, idx) => {
        const img = el.querySelector("img");
        if (img?.src && currentPlaylist[idx] && (!currentPlaylist[idx].thumbnailLink || currentPlaylist[idx].thumbnailLink.length < 5)) {
          currentPlaylist[idx].thumbnailLink = img.src;
        }
      });
    }
  }

  const modalObserver = new MutationObserver(() => {
    suppressModals();
    harvestPikPakThumbnails();
    if (window.PikPakPlayer?.isModalOpen) {
      document.querySelectorAll("video:not(#pikpak-ultra-modal-video)").forEach((v) => {
        try { if (!v.paused) v.pause(); v.muted = true; v.volume = 0; } catch (_) {}
      });
    }
    checkAndAutoUnlock();
  });
  modalObserver.observe(document.documentElement, { childList: true, subtree: true });

  // ====== 5. Playlist & Navigation State ======
  async function playVideoByIndex(index) {
    if (!currentPlaylist || currentPlaylist.length === 0) return;
    if (index < 0 || index >= currentPlaylist.length) return;

    currentVideoIndex = index;
    const targetVideo = currentPlaylist[currentVideoIndex];
    console.log(`%c[PikPak Ultra] ⏭️ Chuyển sang video [${currentVideoIndex + 1}/${currentPlaylist.length}]: ${targetVideo.name}`, LOG_STYLE);
    showToast(`Đang tải: ${targetVideo.name}`);

    const { shareId } = getShareContext();
    if (shareId) {
      await loadAndPlayFile(shareId, targetVideo.id);
    }
  }

  function playNextVideo() {
    if (currentPlaylist.length > 0 && currentVideoIndex < currentPlaylist.length - 1) {
      playVideoByIndex(currentVideoIndex + 1);
    } else showToast("Đã là video cuối cùng!");
  }

  function playPrevVideo() {
    if (currentPlaylist.length > 0 && currentVideoIndex > 0) playVideoByIndex(currentVideoIndex - 1);
    else showToast("Đã là video đầu tiên!");
  }

  function updateControls() {}

  // ====== 7. Stream Resolution & Action Handlers ======
  async function handleBypassClick() {
    const { shareId, parentId, fileId } = getShareContext();
    if (!shareId) return showToast("Không tìm thấy share ID!", true);
    try {
      showToast("Đang đọc danh sách video...");
      const res = await sendToExtension("RESOLVE_SHARE", { shareId, parentId: parentId || "" });
      const videos = res?.videos || [];
      if (videos.length === 0) {
        const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
        const fallback = activeStreamData?.primaryUrl || net.streamUrl;
        if (fallback) return applyDirectStream(fallback);
        const targetId = fileId || parentId;
        if (targetId) return await loadAndPlayFile(shareId, targetId);
        throw new Error("Không tìm thấy video nào trong liên kết này!");
      }

      currentPlaylist = videos;
      harvestPikPakThumbnails();
      const targetId = fileId || res.targetFileId || parentId;
      const matchedIdx = currentPlaylist.findIndex((v) => v.id === targetId);
      currentVideoIndex = matchedIdx !== -1 ? matchedIdx : 0;
      updateControls();
      showToast(`Đang tải video: ${currentPlaylist[currentVideoIndex].name}`);
      await loadAndPlayFile(shareId, currentPlaylist[currentVideoIndex].id);
    } catch (err) {
      showToast("Lỗi: " + err.message, true);
    }
  }

  async function loadAndPlayFile(shareId, fileId) {
    try {
      const streamData = await sendToExtension("GET_STREAM_URL", { shareId, fileId });
      activeStreamData = streamData;
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
    const currentVideo = document.querySelector("video:not(#pikpak-ultra-modal-video)");
    if (!currentVideo) return;

    if (currentVideo.dataset.ppUnlocked === "true" || currentVideo.dataset.ppUnlocked === "failed" || window.PikPakPlayer?.isModalOpen) {
      return;
    }

    if (isAutoUnlocking) return;
    isAutoUnlocking = true;

    const attempts = parseInt(currentVideo.dataset.ppAttempts || "0", 10);
    currentVideo.dataset.ppAttempts = (attempts + 1).toString();
    if (attempts >= 3) {
      currentVideo.dataset.ppUnlocked = "failed";
      isAutoUnlocking = false;
      console.warn("[PikPak Ultra] Đã thử tự mở khóa 3 lần thất bại. Tạm dừng.");
      return;
    }

    console.log("%c[PikPak Ultra] 🤖 Phát hiện video! Mở Rạp Chiếu...", LOG_STYLE);
    try {
      currentVideo.muted = true;
      currentVideo.volume = 0;
      currentVideo.pause();
      currentVideo.style.display = "none";
    } catch (_) {}

    try {
      const { shareId, parentId, fileId } = getShareContext();

      if (shareId && currentPlaylist.length === 0) {
        try {
          const shareData = resolvedShareData || (await sendToExtension("RESOLVE_SHARE", { shareId, parentId }));
          resolvedShareData = shareData;
          if (shareData?.videos && shareData.videos.length > 0) {
            currentPlaylist = shareData.videos;
            const targetId = fileId || shareData.targetFileId || parentId;
            const matchedIdx = currentPlaylist.findIndex((v) => v.id === targetId);
            currentVideoIndex = matchedIdx !== -1 ? matchedIdx : 0;
          }
        } catch (e) {
          console.warn("[PikPak Ultra] RESOLVE_SHARE:", e.message);
        }
      }

      const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
      if (net.streamUrl) {
        console.log("%c[PikPak Ultra] ⚡ Mở Rạp Chiếu bằng stream URL bắt được:", LOG_SUCCESS, net.streamUrl);
        currentVideo.dataset.ppUnlocked = "true";
        if (currentPlaylist.length > 0 && currentVideoIndex === -1) currentVideoIndex = 0;
        updateControls();
        applyDirectStream(net.streamUrl, {
          playlist: currentPlaylist,
          currentIndex: currentVideoIndex >= 0 ? currentVideoIndex : 0,
        });
        isAutoUnlocking = false;
        return;
      }

      if (shareId && currentPlaylist.length > 0) {
        const playIdx = currentVideoIndex >= 0 ? currentVideoIndex : 0;
        const targetVideo = currentPlaylist[playIdx];
        currentVideo.dataset.ppUnlocked = "true";
        updateControls();
        await loadAndPlayFile(shareId, targetVideo.id);
      } else if (shareId && (fileId || parentId)) {
        const targetId = fileId || parentId;
        currentVideo.dataset.ppUnlocked = "true";
        await loadAndPlayFile(shareId, targetId);
      }
    } catch (err) {
      console.warn("%c[PikPak Ultra] Auto-unlock error:", LOG_STYLE, err.message);
    } finally {
      isAutoUnlocking = false;
    }
  }

  function applyDirectStream(url, meta = {}) {
    isUnlocked = true;
    console.log("%c[PikPak Ultra] 📺 Khởi chạy Cinema Modal Player:", LOG_SUCCESS, { url, meta });

    // Dập tắt triệt để video gốc ở nền
    document.querySelectorAll("video:not(#pikpak-ultra-modal-video)").forEach((v) => {
      try {
        v.pause(); v.muted = true; v.volume = 0; v.style.display = "none";
        v.onplay = () => { if (window.PikPakPlayer?.isModalOpen) { v.pause(); v.muted = true; v.volume = 0; } };
      } catch (_) {}
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
          sendToExtension("REFRESH_STREAM_URL", { shareId: currentShareId, fileId: activeStreamData.fileId }).then((newData) => {
            activeStreamData = newData;
            window.PikPakPlayer.changeSource(newData.primaryUrl);
            showToast("Đã cập nhật link stream mới!");
          });
        }
      },
    });

    suppressModals();
  }

  function handleDownloadClick() {
    const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
    const url = activeStreamData?.primaryUrl || net.streamUrl;
    if (url) {
      const a = document.createElement("a");
      a.href = url; a.download = activeStreamData?.fileName || "video.mp4"; a.target = "_blank";
      (document.body || document.documentElement).appendChild(a);
      a.click(); a.remove();
      showToast("Bắt đầu tải video...");
    } else showToast("Không tìm thấy link download", true);
  }

  // ====== 10. Instant Video Click Interceptor ======
  function handleFileItemClick(e) {
    const itemEl = e.target.closest(
      '.file-list-item, [class*="file-item"], [class*="file_item"], [class*="player-file-cover"], .el-table__row, [class*="grid-item"], [class*="card-item"]'
    );
    if (!itemEl) return;

    if (e.target.closest('input, .el-checkbox, [class*="checkbox"], [class*="more-btn"], [class*="action-btn"], [class*="download"]')) {
      return;
    }

    // 1. Phân biệt thư mục: Tuyệt đối không can thiệp khi bấm vào thư mục
    const isFolder = Boolean(
      itemEl.querySelector('img[src*="folder"], svg[class*="folder"], [class*="folder-icon"], [class*="icon-folder"]') ||
      itemEl.classList.contains("is-folder") ||
      itemEl.getAttribute("data-kind") === "drive#folder" ||
      itemEl.querySelector('[class*="folder"]')
    );
    if (isFolder) return;

    // 2. Kiểm tra phần tử có chắc chắn là video hay không
    const itemText = (itemEl.innerText || "").trim();
    const isVideoExt = /\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|3gp|rmvb|iso)/i.test(itemText);

    let matchedVideo = null, matchedIdx = -1;
    if (currentPlaylist?.length > 0) {
      matchedIdx = currentPlaylist.findIndex((v) => v?.name && (itemText.includes(v.name) || v.name.includes(itemText.split("\n")[0])));
      if (matchedIdx !== -1) matchedVideo = currentPlaylist[matchedIdx];
    }

    if (!matchedVideo && !isVideoExt) return;

    // Đã xác nhận là video: Chặn đứng PikPak mở trình phát gốc
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const { shareId } = getShareContext();
    if (!shareId) return;

    const videoName = matchedVideo ? matchedVideo.name : (itemText.split("\n")[0] || "Video");
    const playIdx = matchedIdx !== -1 ? matchedIdx : 0;
    console.log(`%c[PikPak Ultra] ⚡ Đánh chặn click video: ${videoName}`, LOG_SUCCESS);

    if (window.PikPakPlayer?.showInstantLoading) {
      window.PikPakPlayer.showInstantLoading(videoName, playIdx, currentPlaylist, {
        onPrev: () => playPrevVideo(),
        onNext: () => playNextVideo(),
        onSelect: (idx) => playVideoByIndex(idx),
      });
    }

    if (matchedVideo?.id) {
      currentVideoIndex = playIdx;
      loadAndPlayFile(shareId, matchedVideo.id);
    } else {
      const netPlaylist = window.PikPakNetwork?.getIntercepted()?.playlist;
      if (netPlaylist?.length > 0) {
        currentPlaylist = netPlaylist;
        const target = currentPlaylist.find((v) => itemText.includes(v.name)) || currentPlaylist[0];
        currentVideoIndex = currentPlaylist.indexOf(target);
        loadAndPlayFile(shareId, target.id);
      } else {
        sendToExtension("RESOLVE_SHARE", { shareId }).then((res) => {
          if (res?.videos?.length > 0) {
            currentPlaylist = res.videos;
            harvestPikPakThumbnails();
            const target = currentPlaylist.find((v) => itemText.includes(v.name)) || currentPlaylist[0];
            const idx = currentPlaylist.indexOf(target);
            currentVideoIndex = idx !== -1 ? idx : 0;
            loadAndPlayFile(shareId, target.id);
          }
        }).catch((err) => showToast("Lỗi mở video: " + err.message, true));
      }
    }
  }

  document.addEventListener("click", handleFileItemClick, true);

  async function prefetchPlaylist() {
    const netPlaylist = window.PikPakNetwork?.getIntercepted()?.playlist;
    if (netPlaylist?.length > 0 && currentPlaylist.length === 0) {
      currentPlaylist = netPlaylist;
      harvestPikPakThumbnails();
      updateControls();
      return;
    }

    const { shareId, parentId } = getShareContext();
    if (shareId && currentPlaylist.length === 0) {
      try {
        const res = await sendToExtension("RESOLVE_SHARE", { shareId, parentId });
        if (res?.videos?.length > 0) {
          currentPlaylist = res.videos;
          resolvedShareData = res;
          harvestPikPakThumbnails();
          updateControls();
        }
      } catch (_) {}
    }
  }

  // ====== 9. Polling for DOM changes / SPA Navigation ======
  setInterval(() => {
    if (isContextInvalidated) return;
    checkAndAutoUnlock();
    prefetchPlaylist();

    const { shareId, parentId, fileId } = getShareContext();
    const targetId = fileId || parentId;

    if (currentPlaylist.length > 0 && targetId && currentPlaylist.some((v) => v.id === targetId)) {
      const matchedIdx = currentPlaylist.findIndex((v) => v.id === targetId);
      if (matchedIdx !== -1 && matchedIdx !== currentVideoIndex) {
        currentParentId = parentId;
        playVideoByIndex(matchedIdx);
      }
      return;
    }

    if (shareId && (shareId !== currentShareId || parentId !== currentParentId)) {
      currentShareId = shareId;
      currentParentId = parentId;
      currentPlaylist = [];
      currentVideoIndex = -1;
      resolvedShareData = null;
      isUnlocked = false;
      sendToExtension("TAB_READY", { shareId, parentId }).catch(() => {});
    }
  }, 1000);

  if (window.PikPakNetwork) {
    window.PikPakNetwork.onStreamUrl(() => checkAndAutoUnlock());
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
