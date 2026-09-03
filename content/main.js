/**
 * PikPak Ultra Pro Max - Main World Script
 * Hooks fetch/XHR, intercepts tokens and download URLs, overrides 30s limits,
 * and mounts the unlocked floating player toolbar directly inside the page context.
 */

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

  // Auto-intercepted parameters from PikPak's own background requests
  let autoInterceptedShareId = null;
  let autoInterceptedParentId = null;
  let autoInterceptedUrl = null;

  // ====== 1. Communication Bridge with Injector / Service Worker ======
  function sendToExtension(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = "req_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now();
      pendingRequests.set(requestId, { resolve, reject, action });

      console.log(`%c[PikPak Ultra] 📤 Gửi request tới Extension: ${action}`, LOG_STYLE, payload);

      window.postMessage(
        {
          source: BRIDGE_SOURCE_PAGE,
          requestId: requestId,
          action: action,
          payload: payload,
        },
        "*"
      );

      // 30 second timeout
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

  // ====== 2. Hook window.fetch & XMLHttpRequest ======
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);

      // Detect active share_id and parent_id from PikPak's own API calls
      if (url.includes("/drive/v1/share")) {
        try {
          const parsed = new URL(url, window.location.origin);
          const sId = parsed.searchParams.get("share_id");
          const pId = parsed.searchParams.get("parent_id");
          if (sId) {
            autoInterceptedShareId = sId;
            console.log(`%c[PikPak Ultra] 🎯 Bắt được share_id từ API call: ${sId}`, LOG_STYLE);
          }
          if (pId !== null && pId !== undefined) {
            autoInterceptedParentId = pId;
            console.log(`%c[PikPak Ultra] 🎯 Bắt được parent_id từ API call: ${pId || "(root)"}`, LOG_STYLE);
          }
        } catch (_) {}
      }

      // Detect stream / download links from metadata responses
      if (url.includes("/drive/") || url.includes("/file/") || url.includes("mypikpak")) {
        const clone = response.clone();
        clone
          .json()
          .then((data) => {
            if (data?.web_content_link) {
              autoInterceptedUrl = data.web_content_link;
              console.log("%c[PikPak Ultra] 🎯 Bắt được web_content_link trực tiếp:", LOG_SUCCESS, autoInterceptedUrl);
              checkAndAutoUnlock();
            } else if (data?.medias && data.medias.length > 0) {
              const orig = data.medias.find((m) => m.media_name === "original") || data.medias[0];
              if (orig?.link?.url) {
                autoInterceptedUrl = orig.link.url;
                console.log("%c[PikPak Ultra] 🎯 Bắt được stream URL:", LOG_SUCCESS, autoInterceptedUrl);
                checkAndAutoUnlock();
              }
            }
          })
          .catch(() => {});
      }
    } catch (_) {}

    return response;
  };

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
          if (data?.web_content_link) {
            autoInterceptedUrl = data.web_content_link;
            console.log("%c[PikPak Ultra] 🎯 XHR bắt được web_content_link:", LOG_SUCCESS, autoInterceptedUrl);
            checkAndAutoUnlock();
          }
        }
      } catch (_) {}
    });
    return origXHRSend.apply(this, args);
  };

  // ====== 3. Parse Share ID & Parent ID from URL or Hash ======
  function getShareContext() {
    let shareId = autoInterceptedShareId || null;
    let parentId = autoInterceptedParentId || "";

    const fullHref = window.location.href;

    // Try path: /s/<shareId>/<parentId>
    const pathMatch = window.location.pathname.match(/\/s\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?/);
    if (pathMatch) {
      if (!shareId) shareId = pathMatch[1];
      if (!parentId && pathMatch[2]) parentId = pathMatch[2];
    }

    // Try hash: #/s/<shareId>/<parentId>
    const hashMatch = window.location.hash.match(/s\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?/);
    if (hashMatch) {
      if (!shareId) shareId = hashMatch[1];
      if (!parentId && hashMatch[2]) parentId = hashMatch[2];
    }

    // Try query params
    const searchParams = new URLSearchParams(window.location.search);
    if (!shareId && searchParams.get("share_id")) shareId = searchParams.get("share_id");
    if (!parentId && searchParams.get("parent_id")) parentId = searchParams.get("parent_id");

    return { shareId, parentId };
  }

  // ====== 4. Toast UI Helper ======
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

  // ====== 5. Suppress 30s Limit Modals ======
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

  const modalObserver = new MutationObserver(() => {
    suppressModals();
    checkAndAutoUnlock();
  });
  modalObserver.observe(document.documentElement, { childList: true, subtree: true });

  // ====== 6. Playlist & Navigation State ======
  let currentPlaylist = [];
  let currentVideoIndex = -1;

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

  function updateNavigationControls() {
    const prevBtn = document.getElementById("pp-prev-btn");
    const nextBtn = document.getElementById("pp-next-btn");
    const fileSelect = document.getElementById("pp-file-select");

    if (currentPlaylist.length > 1) {
      if (prevBtn) {
        prevBtn.disabled = currentVideoIndex <= 0;
        prevBtn.style.display = "inline-flex";
      }
      if (nextBtn) {
        nextBtn.disabled = currentVideoIndex >= currentPlaylist.length - 1;
        nextBtn.style.display = "inline-flex";
      }
      if (fileSelect) {
        fileSelect.innerHTML = currentPlaylist
          .map((v, i) => `<option value="${v.id}" ${i === currentVideoIndex ? "selected" : ""}>${i + 1}. ${v.name}</option>`)
          .join("");
        fileSelect.style.display = "inline-block";
      }
    } else {
      if (prevBtn) prevBtn.style.display = "none";
      if (nextBtn) nextBtn.style.display = "none";
      if (fileSelect) fileSelect.style.display = "none";
    }
  }

  // Register navigation handlers with Cinema Player
  if (window.PikPakPlayer) {
    window.PikPakPlayer.setNavigationHandlers({
      onNext: () => playNextVideo(),
      onPrev: () => playPrevVideo(),
      onSelect: (idx) => playVideoByIndex(idx),
    });
  }

  // ====== 7. Floating Minimalist Navigation Dock ======
  function injectToolbar() {
    if (document.getElementById("pikpak-ultra-toolbar")) return;

    const toolbar = document.createElement("div");
    toolbar.id = "pikpak-ultra-toolbar";

    toolbar.innerHTML = `
      <div class="pp-status-orb-container" data-tooltip="PikPak Ultra Sẵn Sàng">
        <span class="pp-status-orb active" id="pp-status-orb"></span>
      </div>

      <button id="pp-prev-btn" class="pp-icon-btn" data-tooltip="Video trước (Phím [)" style="display: none;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="19 20 9 12 19 4 19 20"/>
          <line x1="5" x2="5" y1="19" y2="5"/>
        </svg>
      </button>

      <select id="pp-file-select" class="pp-select" style="display: none; max-width: 160px;">
        <option value="">Danh sách video...</option>
      </select>

      <button id="pp-next-btn" class="pp-icon-btn" data-tooltip="Video tiếp (Phím ])" style="display: none;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 4 15 12 5 20 5 4"/>
          <line x1="19" x2="19" y1="5" y2="19"/>
        </svg>
      </button>

      <select id="pp-quality-select" class="pp-select" style="display: none; max-width: 140px;">
        <option value="">Chất lượng...</option>
      </select>

      <button id="pp-cinema-btn" class="pp-icon-btn btn-cinema" data-tooltip="Rạp Chiếu Video (Tua Full)">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="20" height="20" x="2" y="2" rx="2.18" ry="2.18"/>
          <line x1="7" x2="7" y1="2" y2="22"/>
          <line x1="17" x2="17" y1="2" y2="22"/>
          <line x1="2" x2="22" y1="12" y2="12"/>
          <line x1="2" x2="7" y1="7" y2="7"/>
          <line x1="2" x2="7" y1="17" y2="17"/>
          <line x1="17" x2="22" y1="7" y2="7"/>
          <line x1="17" x2="22" y1="17" y2="17"/>
        </svg>
      </button>

      <button id="pp-download-btn" class="pp-icon-btn btn-download" data-tooltip="Tải video gốc" style="display: none;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" x2="12" y1="15" y2="3"/>
        </svg>
      </button>

      <button id="pp-close-cinema-btn" class="pp-icon-btn" data-tooltip="Đóng Rạp Chiếu (Phím Esc)" style="display: none; background: rgba(255, 59, 48, 0.25); border-color: rgba(255, 59, 48, 0.4); color: #ff453a;">
        <span style="font-size: 15px; font-weight: bold; line-height: 1;">✕</span>
      </button>
    `;

    document.body.appendChild(toolbar);

    const prevBtn = document.getElementById("pp-prev-btn");
    const cinemaBtn = document.getElementById("pp-cinema-btn");
    const nextBtn = document.getElementById("pp-next-btn");
    const downloadBtn = document.getElementById("pp-download-btn");
    const fileSelect = document.getElementById("pp-file-select");
    const qualitySelect = document.getElementById("pp-quality-select");
    const closeCinemaBtn = document.getElementById("pp-close-cinema-btn");

    prevBtn.addEventListener("click", () => playPrevVideo());
    nextBtn.addEventListener("click", () => playNextVideo());
    cinemaBtn.addEventListener("click", () => {
      const url = activeStreamData?.primaryUrl || autoInterceptedUrl;
      if (url) {
        applyDirectStream(url);
      } else if (currentPlaylist.length > 0) {
        playVideoByIndex(currentVideoIndex >= 0 ? currentVideoIndex : 0);
      } else {
        handleBypassClick();
      }
    });
    downloadBtn.addEventListener("click", () => handleDownloadClick());
    closeCinemaBtn.addEventListener("click", () => {
      if (window.PikPakPlayer) window.PikPakPlayer.closeCinemaModal();
    });
    fileSelect.addEventListener("change", (e) => {
      const idx = currentPlaylist.findIndex((v) => v.id === e.target.value);
      if (idx !== -1) playVideoByIndex(idx);
    });
    qualitySelect.addEventListener("change", (e) => {
      if (e.target.value && window.PikPakPlayer) {
        window.PikPakPlayer.changeSource(e.target.value);
      }
    });

    const { shareId } = getShareContext();
    if (shareId) {
      currentShareId = shareId;
      sendToExtension("TAB_READY", { shareId: shareId }).catch(() => {});
    }
  }

  // ====== 7. Action Handlers ======
  // ====== 8. Stream Resolution & Action Handlers ======
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
      const subfolders = resolvedShareData.subfolders || [];

      if (videos.length === 0) {
        if (autoInterceptedUrl) {
          applyDirectStream(autoInterceptedUrl);
          return;
        }

        if (subfolders.length > 0) {
          showToast(`Thư mục này có ${subfolders.length} thư mục con. Hãy nhấp mở thư mục chứa video!`, true);
          return;
        }

        throw new Error("Không tìm thấy video nào trong thư mục này!");
      }

      currentPlaylist = videos;
      currentVideoIndex = 0;
      updateNavigationControls();

      await loadAndPlayFile(shareId, currentPlaylist[0].id);
    } catch (err) {
      console.error("%c[PikPak Ultra] ❌ Lỗi:", LOG_ERR, err);
      showToast(err.message || "Lỗi khi tải video", true);

      if (err.message && (err.message.includes("password") || err.code === "PASS_CODE_EMPTY" || err.code === "PASS_CODE_ERROR")) {
        const pwd = prompt("Link chia sẻ này yêu cầu mật khẩu truy cập. Nhập mật khẩu:");
        if (pwd) {
          sendToExtension("RESOLVE_SHARE", { shareId, passCode: pwd, parentId: parentId || "" })
            .then((data) => {
              resolvedShareData = data;
              handleBypassClick();
            })
            .catch((e) => showToast(e.message, true));
        }
      }
    }
  }

  async function loadAndPlayFile(shareId, fileId) {
    const downloadBtn = document.getElementById("pp-download-btn");

    console.log(`%c[PikPak Ultra] 🎬 Tải stream cho file: ${fileId}`, LOG_STYLE);
    showToast("Đang nạp video full...");

    const streamData = await sendToExtension("GET_STREAM_URL", { shareId, fileId });
    activeStreamData = streamData;

    const streamUrl = streamData.primaryUrl || (streamData.streams && streamData.streams[0]?.url) || autoInterceptedUrl;
    if (!streamUrl) {
      throw new Error("Không lấy được link stream cho video này!");
    }

    // Update index in playlist
    if (currentPlaylist.length > 0) {
      const idx = currentPlaylist.findIndex((v) => v.id === fileId);
      if (idx !== -1) currentVideoIndex = idx;
    }

    // Populate qualities dropdown
    const qualitySelect = document.getElementById("pp-quality-select");
    if (qualitySelect && streamData.streams && streamData.streams.length > 1) {
      qualitySelect.innerHTML = streamData.streams
        .map((s) => `<option value="${s.url}" ${s.url === streamUrl ? "selected" : ""}>${s.quality} (${s.resolution})</option>`)
        .join("");
      qualitySelect.style.display = "inline-block";
    } else if (qualitySelect) {
      qualitySelect.style.display = "none";
    }

    updateNavigationControls();

    // Mount player with playlist context
    applyDirectStream(streamUrl, {
      fileName: streamData.fileName,
      fileSize: streamData.fileSize,
      playlist: currentPlaylist,
      currentIndex: currentVideoIndex,
      streams: streamData.streams,
    });

    if (downloadBtn) downloadBtn.style.display = "inline-flex";
    sendToExtension("VIDEO_STREAMING_ACTIVE").catch(() => {});
  }

  // ====== 9. Auto-Unlock Watcher (Tự động mở Rạp Chiếu Full) ======
  let isAutoUnlocking = false;

  async function checkAndAutoUnlock() {
    const currentVideo = document.querySelector("video:not(#pikpak-ultra-modal-video)");
    if (!currentVideo) return;

    // Skip if already processed by modal
    if (currentVideo.dataset.ppUnlocked === "true" || window.PikPakPlayer?.isModalOpen) {
      return;
    }

    if (isAutoUnlocking) return;
    isAutoUnlocking = true;

    console.log("%c[PikPak Ultra] 🤖 Phát hiện video! Mở Rạp Chiếu...", LOG_STYLE);

    try {
      const { shareId, parentId } = getShareContext();

      // Resolve playlist in advance if not loaded
      if (shareId && currentPlaylist.length === 0) {
        try {
          const shareData = resolvedShareData || (await sendToExtension("RESOLVE_SHARE", { shareId, parentId }));
          resolvedShareData = shareData;
          if (shareData?.videos) {
            currentPlaylist = shareData.videos;
          }
        } catch (_) {}
      }

      // Priority 1: Use direct stream URL intercepted from fetch/XHR
      if (autoInterceptedUrl) {
        console.log("%c[PikPak Ultra] ⚡ Mở Rạp Chiếu bằng stream URL bắt được:", LOG_SUCCESS, autoInterceptedUrl);
        currentVideo.dataset.ppUnlocked = "true";
        if (currentPlaylist.length > 0 && currentVideoIndex === -1) {
          currentVideoIndex = 0;
        }
        updateNavigationControls();
        applyDirectStream(autoInterceptedUrl, {
          playlist: currentPlaylist,
          currentIndex: currentVideoIndex >= 0 ? currentVideoIndex : 0,
        });
        isAutoUnlocking = false;
        return;
      }

      // Priority 2: Use resolved playlist
      if (shareId && currentPlaylist.length > 0) {
        currentVideoIndex = 0;
        updateNavigationControls();
        const targetVideo = currentPlaylist[0];
        currentVideo.dataset.ppUnlocked = "true";
        await loadAndPlayFile(shareId, targetVideo.id);
      }
    } catch (err) {
      console.warn("%c[PikPak Ultra] Auto-unlock:", LOG_STYLE, err.message);
    } finally {
      isAutoUnlocking = false;
    }
  }

  function applyDirectStream(url, meta = {}) {
    console.log("%c[PikPak Ultra] 📺 Khởi chạy Cinema Modal Player:", LOG_SUCCESS, {
      url: url,
      meta: meta,
    });

    const downloadBtn = document.getElementById("pp-download-btn");
    if (downloadBtn) downloadBtn.style.display = "inline-flex";

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
    const url = activeStreamData?.primaryUrl || autoInterceptedUrl;
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

  function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }

  // ====== 10. Polling for DOM changes / SPA Navigation ======
  setInterval(() => {
    // Inject toolbar on share or file pages
    injectToolbar();
    checkAndAutoUnlock();

    const { shareId, parentId } = getShareContext();
    if (shareId && (shareId !== currentShareId || parentId !== currentParentId)) {
      console.log(`%c[PikPak Ultra] 🔄 Chuyển thư mục: shareId=${shareId}, parentId=${parentId}`, LOG_STYLE);
      currentShareId = shareId;
      currentParentId = parentId;
      resolvedShareData = null;
      activeStreamData = null;
      currentPlaylist = [];
      currentVideoIndex = -1;
      isUnlocked = false;

      updateNavigationControls();
      const downloadBtn = document.getElementById("pp-download-btn");
      if (downloadBtn) downloadBtn.style.display = "none";
    }
  }, 1000);
})();
