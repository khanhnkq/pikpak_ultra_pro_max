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
      console.log(`%c[PikPak Ultra] 📤 Gửi request tới Extension: ${action}`, LOG_STYLE, payload);

      window.postMessage({ source: BRIDGE_SOURCE_PAGE, requestId, action, payload }, "*");

      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          const timeoutErr = new Error(`Hết thời gian phản hồi (30s) từ extension khi gọi action: ${action}`);
          console.error("%c[PikPak Ultra] ⏱️ Timeout:", LOG_ERR, timeoutErr);
          reject(timeoutErr);
        }
      }, 30000);
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== BRIDGE_SOURCE_EXT) {
      return;
    }

    const { requestId, response } = event.data;
    if (pendingRequests.has(requestId)) {
      const { resolve, reject, action } = pendingRequests.get(requestId);
      pendingRequests.delete(requestId);

      if (response && response.success) {
        console.log(`%c[PikPak Ultra] 📥 Nhận phản hồi thành công (${action}):`, LOG_SUCCESS, response.data);
        resolve(response.data);
      } else {
        const errMsg = response ? response.error : "Phản hồi rỗng từ extension";
        console.error(`%c[PikPak Ultra] ❌ Nhận phản hồi thất bại (${action}):`, LOG_ERR, errMsg);
        reject(new Error(errMsg));
      }
    }
  });

  // ====== 2. Toast UI Helper ======
  function showToast(message, isError = false) {
    let toast = document.getElementById("pikpak-ultra-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "pikpak-ultra-toast";
      document.body.appendChild(toast);
    }
    toast.className = isError ? "error" : "";
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 4500);
  }

  // ====== 3. Share Context Extractor ======
  function getShareContext() {
    const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
    let shareId = net.shareId || null;
    let parentId = net.parentId || "";

    // Path /s/<shareId>/<parentId>
    const pathMatch = window.location.pathname.match(/\/s\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?/);
    if (pathMatch) {
      if (!shareId) shareId = pathMatch[1];
      if (!parentId && pathMatch[2]) parentId = pathMatch[2];
    }

    // Hash #/s/<shareId>/<parentId>
    const hashMatch = window.location.hash.match(/s\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?/);
    if (hashMatch) {
      if (!shareId) shareId = hashMatch[1];
      if (!parentId && hashMatch[2]) parentId = hashMatch[2];
    }

    // Query params
    const searchParams = new URLSearchParams(window.location.search);
    if (!shareId && searchParams.get("share_id")) shareId = searchParams.get("share_id");
    if (!parentId && searchParams.get("parent_id")) parentId = searchParams.get("parent_id");

    return { shareId, parentId };
  }

  // ====== 4. Suppress Limit Modals & Harvest Thumbnails ======
  function suppressModals() {
    if (!isUnlocked) return;
    const selectors = [
      '[class*="preview"]',
      '[class*="limit"]',
      '[class*="countdown"]',
      '[class*="save-dialog"]',
      '[class*="vip-modal"]',
      '[class*="modal-mask"]',
    ];

    document.querySelectorAll(selectors.join(",")).forEach((el) => {
      const text = el.innerText || "";
      if (
        text.includes("Previewing remaining") ||
        text.includes("Preview remaining") ||
        text.includes("00:30") ||
        text.includes("Save Now") ||
        text.includes("Save to Drive")
      ) {
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
        if (img && img.src && currentPlaylist[idx]) {
          if (!currentPlaylist[idx].thumbnailLink || currentPlaylist[idx].thumbnailLink.length < 5) {
            currentPlaylist[idx].thumbnailLink = img.src;
          }
        }
      });
    }
  }

  const modalObserver = new MutationObserver(() => {
    suppressModals();
    harvestPikPakThumbnails();
    if (window.PikPakPlayer?.isModalOpen) {
      document.querySelectorAll("video:not(#pikpak-ultra-modal-video)").forEach((v) => {
        try {
          if (!v.paused) v.pause();
          v.muted = true;
          v.volume = 0;
        } catch (_) {}
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
    } else {
      showToast("Đã là video cuối cùng!");
    }
  }

  function playPrevVideo() {
    if (currentPlaylist.length > 0 && currentVideoIndex > 0) {
      playVideoByIndex(currentVideoIndex - 1);
    } else {
      showToast("Đã là video đầu tiên!");
    }
  }

  function updateControls() {
    if (window.PikPakToolbar) {
      window.PikPakToolbar.updateNavigationControls(currentPlaylist, currentVideoIndex);
    }
  }

  if (window.PikPakPlayer) {
    window.PikPakPlayer.setNavigationHandlers({
      onNext: () => playNextVideo(),
      onPrev: () => playPrevVideo(),
      onSelect: (idx) => playVideoByIndex(idx),
    });
  }

  // ====== 6. Setup Floating Toolbar ======
  function setupToolbar() {
    if (!window.PikPakToolbar) return;

    window.PikPakToolbar.injectToolbar({
      onPrev: () => playPrevVideo(),
      onNext: () => playNextVideo(),
      onCinema: () => {
        const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
        const url = activeStreamData?.primaryUrl || net.streamUrl;
        if (url) {
          applyDirectStream(url);
        } else if (currentPlaylist.length > 0) {
          playVideoByIndex(currentVideoIndex >= 0 ? currentVideoIndex : 0);
        } else {
          handleBypassClick();
        }
      },
      onDownload: () => handleDownloadClick(),
      onCloseCinema: () => {
        if (window.PikPakPlayer) window.PikPakPlayer.closeCinemaModal();
      },
      onFileSelect: (fileId) => {
        const idx = currentPlaylist.findIndex((v) => v.id === fileId);
        if (idx !== -1) playVideoByIndex(idx);
      },
      onQualitySelect: (qualityUrl) => {
        if (qualityUrl && window.PikPakPlayer) {
          window.PikPakPlayer.changeSource(qualityUrl);
        }
      },
    });

    const { shareId } = getShareContext();
    if (shareId && shareId !== currentShareId) {
      currentShareId = shareId;
      sendToExtension("TAB_READY", { shareId: shareId }).catch(() => {});
    }
  }

  // ====== 7. Stream Resolution & Action Handlers ======
  async function handleBypassClick() {
    console.log("%c[PikPak Ultra] 🖱️ Kích hoạt tải video", LOG_STYLE);
    const { shareId, parentId } = getShareContext();
    if (!shareId) {
      showToast("Không tìm thấy share ID!", true);
      return;
    }

    try {
      showToast("Đang đọc danh sách video...");
      resolvedShareData = await sendToExtension("RESOLVE_SHARE", {
        shareId: shareId,
        parentId: parentId || "",
      });

      const videos = resolvedShareData.videos || [];
      if (videos.length === 0) {
        const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
        if (net.streamUrl) {
          applyDirectStream(net.streamUrl);
          return;
        }
        throw new Error("Không tìm thấy video nào trong thư mục này!");
      }

      currentPlaylist = videos;
      harvestPikPakThumbnails();
      currentVideoIndex = 0;
      updateControls();

      const firstVideo = currentPlaylist[0];
      showToast(`Đang tải video: ${firstVideo.name}`);
      await loadAndPlayFile(shareId, firstVideo.id);
    } catch (err) {
      console.error("%c[PikPak Ultra] Lỗi bypass:", LOG_ERR, err);
      showToast("Lỗi: " + err.message, true);
    }
  }

  async function loadAndPlayFile(shareId, fileId) {
    try {
      const streamData = await sendToExtension("GET_STREAM_URL", {
        shareId: shareId,
        fileId: fileId,
      });

      activeStreamData = streamData;
      const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
      const streamUrl = streamData.primaryUrl || (streamData.streams && streamData.streams[0]?.url) || net.streamUrl;

      if (!streamUrl) throw new Error("Không lấy được stream URL!");

      if (currentPlaylist.length > 0) {
        const idx = currentPlaylist.findIndex((v) => v.id === fileId);
        if (idx !== -1) currentVideoIndex = idx;
      }

      if (window.PikPakToolbar) {
        window.PikPakToolbar.updateQualities(streamData.streams, streamUrl);
        window.PikPakToolbar.setDownloadVisible(true);
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
      console.error("%c[PikPak Ultra] Lỗi nạp video:", LOG_ERR, err);
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
    } catch (_) {}

    try {
      const { shareId, parentId } = getShareContext();

      if (shareId && currentPlaylist.length === 0) {
        try {
          const shareData = resolvedShareData || (await sendToExtension("RESOLVE_SHARE", { shareId, parentId }));
          resolvedShareData = shareData;
          if (shareData?.videos && shareData.videos.length > 0) {
            currentPlaylist = shareData.videos;
            const matchedIdx = currentPlaylist.findIndex((v) => v.id === parentId || v.id === shareData.targetFileId);
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
        v.pause();
        v.muted = true;
        v.volume = 0;
        v.style.display = "none";
        v.onplay = () => {
          if (window.PikPakPlayer?.isModalOpen) {
            v.pause();
            v.muted = true;
            v.volume = 0;
          }
        };
      } catch (_) {}
    });

    if (window.PikPakToolbar) window.PikPakToolbar.setDownloadVisible(true);

    if (window.PikPakPlayer) {
      window.PikPakPlayer.openCinemaModal(url, {
        fileName: meta.fileName || activeStreamData?.fileName || "PikPak Video Stream",
        fileSize: meta.fileSize || activeStreamData?.fileSize || 0,
        playlist: meta.playlist || currentPlaylist,
        currentIndex: meta.currentIndex !== undefined ? meta.currentIndex : currentVideoIndex,
        streams: activeStreamData?.streams || [],
        onRefreshRequest: () => {
          console.warn("[PikPak Ultra] Stream hết hạn, tự động refresh...");
          if (currentShareId && activeStreamData?.fileId) {
            sendToExtension("REFRESH_STREAM_URL", {
              shareId: currentShareId,
              fileId: activeStreamData.fileId,
            }).then((newData) => {
              activeStreamData = newData;
              window.PikPakPlayer.changeSource(newData.primaryUrl);
              showToast("Đã cập nhật link stream mới!");
            });
          }
        },
      });
    }

    suppressModals();
  }

  function handleDownloadClick() {
    const net = window.PikPakNetwork ? window.PikPakNetwork.getIntercepted() : {};
    const url = activeStreamData?.primaryUrl || net.streamUrl;
    if (url) {
      console.log("%c[PikPak Ultra] 💾 Bắt đầu tải video:", LOG_STYLE, url);
      const a = document.createElement("a");
      a.href = url;
      a.download = activeStreamData?.fileName || "video.mp4";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast("Bắt đầu tải video...");
    } else {
      showToast("Không tìm thấy link download", true);
    }
  }

  // ====== 9. Polling for DOM changes / SPA Navigation ======
  setInterval(() => {
    setupToolbar();
    checkAndAutoUnlock();

    const { shareId, parentId } = getShareContext();
    if (shareId && (shareId !== currentShareId || parentId !== currentParentId)) {
      currentShareId = shareId;
      currentParentId = parentId;
      currentPlaylist = [];
      currentVideoIndex = -1;
      resolvedShareData = null;
      isUnlocked = false;
      sendToExtension("TAB_READY", { shareId: shareId, parentId: parentId }).catch(() => {});
    }
  }, 1000);

  if (window.PikPakNetwork) {
    window.PikPakNetwork.onStreamUrl(() => checkAndAutoUnlock());
  }

  setupToolbar();
})();
