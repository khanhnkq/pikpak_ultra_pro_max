/**
 * PikPak Ultra Pro Max - Dedicated Cinema Player Engine (SOLID Architecture)
 */

(function (root) {
  const BG_VIDEO_SELECTOR = "video:not(#pikpak-ultra-modal-video):not(#pp-scrub-preview-video)";

  function formatTime(s) {
    s = Math.floor(isNaN(s) || s < 0 ? 0 : s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
  }

  class VideoStreamController {
    constructor() {
      this.modalContainer = null;
      this.modalVideo = null;
      this.currentStreamUrl = null;
      this.currentOptions = {};
      this.refreshCallback = null;
      this.navigationHandlers = null;
      this.isModalOpen = false;
      this.isSwitchingSource = false;
      this.isRefreshingStream = false;
      this.streamRefreshCount = 0;
      this.streamLoadTimeout = null;
      this.hasPushedHistoryState = false;

      // State
      this.isDraggingProgress = false;
      this.wasPlayingBeforeDrag = false;
      this.idleTimeout = null;
      this.speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
      this.currentSpeedIdx = 2; // default 1.0x
      this.isImageMode = false;
      this.onDownloadHandler = null;

      // Sub-modules (DIP & SRP)
      this.shortcuts = new root.PlayerShortcutsManager(this);
      this.drawer = new root.PlayerDrawerManager(this);
      this.preview = root.PlayerPreviewManager ? new root.PlayerPreviewManager(this) : null;
      this.imageViewer = root.PlayerImageViewerManager ? new root.PlayerImageViewerManager(this) : null;
      this.bufferManager = root.PlayerBufferManager ? new root.PlayerBufferManager(this) : null;
    }

    setNavigationHandlers(handlers) {
      this.navigationHandlers = handlers;
    }

    resetIdleTimer() {
      const c = document.getElementById("pp-player-container"); if (!c) return;
      c.classList.remove("pp-inactive"); clearTimeout(this.idleTimeout);
      if (!this.isImageMode && (!this.modalVideo || this.modalVideo.paused)) return;
      this.idleTimeout = setTimeout(() => {
        if (!this.isDraggingProgress) { c.classList.add("pp-inactive"); document.querySelectorAll(".pp-dropdown-menu").forEach((m) => m.classList.remove("show")); }
      }, 2600);
    }

    stepSpeed(dir) {
      let idx = this.speeds.indexOf(this.modalVideo?.playbackRate);
      if (idx === -1) idx = this.currentSpeedIdx;
      this.setPlaybackSpeed(this.speeds[Math.max(0, Math.min(this.speeds.length - 1, idx + dir))]);
    }

    setPlaybackSpeed(speed) {
      if (!this.modalVideo) return;
      this.modalVideo.playbackRate = speed;
      this.currentSpeedIdx = this.speeds.indexOf(speed);
      const label = document.getElementById("pp-speed-label");
      if (label) label.textContent = `${speed}x`;
      document.querySelectorAll("#pp-speed-menu .pp-dropdown-item").forEach((item) => {
        item.classList.toggle("active", parseFloat(item.dataset.speed) === speed);
      });
      const icons = root.PikPakIcons || {};
      this.shortcuts.showHud(`${speed}x`, icons.speed);
    }

    togglePlay() {
      if (!this.modalVideo) return;
      const icons = root.PikPakIcons || {};
      if (this.modalVideo.paused) { this.modalVideo.play().catch(() => {}); this.shortcuts.showHud("Phát", icons.play); }
      else { this.modalVideo.pause(); this.shortcuts.showHud("Tạm dừng", icons.pause); }
      this.updatePlayPauseUI();
    }

    updatePlayPauseUI() {
      const btn = document.getElementById("pp-ctrl-play");
      const icons = root.PikPakIcons || {};
      if (btn && this.modalVideo) btn.innerHTML = this.modalVideo.paused ? icons.play : icons.pause;
    }

    updateVolumeUI() {
      const v = this.modalVideo, volBtn = document.getElementById("pp-ctrl-volume"), volSlider = document.getElementById("pp-volume-slider");
      const icons = root.PikPakIcons || {};
      if (!v || !volBtn || !volSlider) return;
      volSlider.value = v.muted ? 0 : v.volume;
      volBtn.innerHTML = (v.muted || v.volume === 0) ? icons.volMute : (v.volume < 0.5 ? icons.volLow : icons.volHigh);
    }

    toggleFullscreen() {
      const c = document.getElementById("pp-player-container"), fsBtn = document.getElementById("pp-ctrl-fullscreen");
      const icons = root.PikPakIcons || {}; if (!c) return;
      if (!document.fullscreenElement) { c.requestFullscreen().catch(() => {}); if (fsBtn) fsBtn.innerHTML = icons.exitFullscreen; }
      else { document.exitFullscreen().catch(() => {}); if (fsBtn) fsBtn.innerHTML = icons.fullscreen; }
    }

    purgeUnusedMediaAndLayers() {
      // 1. Dập tắt và xóa sổ ngay lập tức mọi thẻ video/audio không thuộc extension
      document.querySelectorAll("video:not(#pikpak-ultra-modal-video):not(#pp-scrub-preview-video), audio").forEach((v) => {
        try {
          v.pause();
          v.muted = true;
          v.volume = 0;
          v.removeAttribute("src");
          v.src = "";
          v.load();
        } catch (_) {}
        try {
          const parent = v.closest(
            '.el-overlay, [class*="video-player"], [class*="preview-player"], [class*="dplayer"], [class*="artplayer"], #manager-preview-bar, .preview-bar, div.player-container, div.video-container, div[class*="play-modal"], div[class*="preview-layer"], div[class*="play-layer"], div[class*="preview-box"], div[class*="player-box"]'
          );
          if (parent && parent !== document.body && parent !== document.documentElement && !parent.closest('#pikpak-ultra-cinema-modal') && !parent.contains(document.getElementById("pikpak-ultra-cinema-modal"))) {
            parent.remove(); // XÓA NGAY LẬP TỨC KHỎI DOM
          } else {
            v.remove();
          }
        } catch (_) {
          try { v.remove(); } catch (__) {}
        }
      });

      // 2. Tìm và xóa sổ triệt để mọi layer player modal gốc của PikPak đang xuất hiện
      const nativeLayerSelectors = [
        'div.preview-layer',
        'div[class*="play-modal"]',
        'div[class*="preview-player"]',
        'div[class*="video-modal"]',
        'div[class*="play-layer"]',
        'div[class*="preview-box"]',
        'div[class*="player-box"]',
        'div.player-container:not(.pp-player-container)',
        'div.video-container:not(#pp-video-container)',
        '#manager-preview-bar',
        '.dplayer',
        '.artplayer-app',
        '.artplayer',
        '.preview-bar',
        '.video-preview',
        '.media-preview'
      ];
      document.querySelectorAll(nativeLayerSelectors.join(", ")).forEach((layer) => {
        if (!layer.closest('#pikpak-ultra-cinema-modal') && !layer.contains(document.getElementById("pikpak-ultra-cinema-modal"))) {
          try {
            layer.querySelectorAll("video, audio").forEach((m) => {
              m.pause();
              m.muted = true;
              m.volume = 0;
              m.removeAttribute("src");
              m.src = "";
              m.load();
              m.remove();
            });
            layer.remove(); // XÓA NGAY LẬP TỨC KHỎI DOM
          } catch (_) {}
        }
      });
    }

    ensureModalDom() {
      // Đảm bảo chỉ có DUY NHẤT 1 modal extension, xóa mọi modal thừa nếu có
      const allModals = document.querySelectorAll("#pikpak-ultra-cinema-modal");
      if (allModals.length > 1) {
        for (let i = 1; i < allModals.length; i++) {
          try {
            allModals[i].querySelectorAll("video").forEach((v) => { v.pause(); v.removeAttribute("src"); v.src = ""; v.load(); });
            allModals[i].remove();
          } catch (_) {}
        }
      }

      this.purgeUnusedMediaAndLayers();

      const existing = document.getElementById("pikpak-ultra-cinema-modal");
      if (existing) {
        const v = existing.querySelector("#pikpak-ultra-modal-video");
        const ctrl = existing.querySelector("#pp-player-controls");
        if (v && ctrl) {
          this.modalContainer = existing;
          this.modalVideo = v;
          this.imageViewer?.init();
          return;
        }
        console.log("[PikPak Ultra] 🔄 Tái tạo lại Cinema Modal DOM mới...");
        existing.remove();
      }

      const modal = document.createElement("div");
      modal.id = "pikpak-ultra-cinema-modal";

      const templateBuilder = root.PikPakPlayerTemplate;
      const drawerHtml = this.drawer.renderDrawerHtml();
      const shortcutsHtml = this.shortcuts.renderShortcutsModalHtml();

      modal.innerHTML = templateBuilder.renderPlayerModalHtml(drawerHtml, shortcutsHtml);
      (document.body || document.documentElement).appendChild(modal);

      this.modalContainer = modal;
      this.modalVideo = modal.querySelector("#pikpak-ultra-modal-video");

      this.initPlayerEventBindings();
      this.drawer.bindEvents();
      this.imageViewer?.init();
    }

    updateProgress() {
      const v = this.modalVideo;
      if (!v || this.isDraggingProgress) return;
      const cur = v.currentTime || 0, dur = v.duration || 0;
      const pct = dur > 0 ? (cur / dur) * 100 : 0;
      // Don't overwrite played bar while user is hovering (preview mode)
      if (!this.isHoveringProgress) {
        const playedBar = document.getElementById("pp-progress-played");
        if (playedBar) playedBar.style.width = `${pct}%`;
      }
      const curTimeEl = document.getElementById("pp-time-current");
      const totalTimeEl = document.getElementById("pp-time-total");
      if (curTimeEl) curTimeEl.textContent = formatTime(cur);
      if (totalTimeEl && dur > 0) totalTimeEl.textContent = formatTime(dur);

      const bufferBar = document.getElementById("pp-progress-buffer");
      if (bufferBar && v.buffered.length > 0) {
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.buffered.start(i) <= cur && cur <= v.buffered.end(i)) {
            bufferBar.style.width = `${(v.buffered.end(i) / dur) * 100}%`;
            break;
          }
        }
      }
    }

    initPlayerEventBindings() {
      const v = this.modalVideo;
      const container = document.getElementById("pp-player-container");
      const progressArea = document.getElementById("pp-progress-area");

      // Video event listeners
      v.addEventListener("timeupdate", () => this.updateProgress());
      v.addEventListener("play", () => this.updatePlayPauseUI());
      v.addEventListener("pause", () => this.updatePlayPauseUI());
      v.addEventListener("volumechange", () => this.updateVolumeUI());
      v.addEventListener("seeking", () => this.bufferManager?.handleSeek());

      // Mouse & Click gestures
      container.addEventListener("mousemove", () => this.resetIdleTimer());
      container.addEventListener("mouseenter", () => this.resetIdleTimer());
      v.addEventListener("click", (e) => { if (e.target === v) this.togglePlay(); });
      v.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const rect = v.getBoundingClientRect(), clickX = e.clientX - rect.left;
        if (clickX < rect.width * 0.3) { v.currentTime = Math.max(0, v.currentTime - 10); this.shortcuts.showHud("-10s", null); }
        else if (clickX > rect.width * 0.7) { v.currentTime = Math.min(v.duration, v.currentTime + 10); this.shortcuts.showHud("+10s", null); }
        else this.toggleFullscreen();
      });

      // Progress bar: hover preview & scrubbing
      const getPos = (e) => Math.max(0, Math.min(1, (e.clientX - progressArea.getBoundingClientRect().left) / progressArea.getBoundingClientRect().width));
      progressArea.addEventListener("mouseenter", () => { this.isHoveringProgress = true; this.preview?.show(); });
      progressArea.addEventListener("mouseleave", () => {
        this.isHoveringProgress = false;
        if (!this.isDraggingProgress) {
          this.preview?.hide();
          const dur = v.duration || 0;
          if (dur > 0) document.getElementById("pp-progress-played")?.style.setProperty("width", `${(v.currentTime / dur) * 100}%`);
        }
      });
      progressArea.addEventListener("mousemove", (e) => { const p = getPos(e); if (v.duration) this.preview?.updateHover(e, p, v.duration); });
      progressArea.addEventListener("mousedown", (e) => {
        this.isDraggingProgress = true; progressArea.classList.add("dragging");
        this.wasPlayingBeforeDrag = !v.paused; if (this.wasPlayingBeforeDrag) v.pause();
        const setPos = (ev) => {
          const p = getPos(ev);
          document.getElementById("pp-progress-played")?.style.setProperty("width", `${p * 100}%`);
          if (v.duration) { v.currentTime = p * v.duration; this.preview?.updateHover(ev, p, v.duration); }
        };
        setPos(e);
        const onMove = (ev) => setPos(ev);
        const onUp = () => {
          this.isDraggingProgress = false; this.isHoveringProgress = false;
          progressArea.classList.remove("dragging"); this.preview?.hide();
          window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp);
          if (this.wasPlayingBeforeDrag) v.play().catch(() => {});
        };
        window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
      });

      // Controls buttons
      document.getElementById("pp-ctrl-play")?.addEventListener("click", () => this.togglePlay());
      document.getElementById("pp-ctrl-prev")?.addEventListener("click", () => this.navigationHandlers?.onPrev?.());
      document.getElementById("pp-ctrl-next")?.addEventListener("click", () => this.navigationHandlers?.onNext?.());
      document.getElementById("pp-ctrl-volume")?.addEventListener("click", () => { v.muted = !v.muted; this.updateVolumeUI(); });
      document.getElementById("pp-volume-slider")?.addEventListener("input", (e) => { v.volume = parseFloat(e.target.value); v.muted = false; this.updateVolumeUI(); });

      // Speed dropdown
      const speedBtn = document.getElementById("pp-speed-btn"), speedMenu = document.getElementById("pp-speed-menu");
      speedBtn?.addEventListener("click", (e) => { e.stopPropagation(); speedMenu?.classList.toggle("show"); });
      speedMenu?.querySelectorAll(".pp-dropdown-item").forEach((item) => {
        item.addEventListener("click", (e) => { e.stopPropagation(); this.setPlaybackSpeed(parseFloat(item.dataset.speed)); speedMenu.classList.remove("show"); });
      });

      // Buffer Booster dropdown
      const boosterBtn = document.getElementById("pp-booster-btn"), boosterMenu = document.getElementById("pp-booster-menu");
      boosterBtn?.addEventListener("click", (e) => { e.stopPropagation(); boosterMenu?.classList.toggle("show"); });
      boosterMenu?.querySelectorAll(".pp-dropdown-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          boosterMenu.querySelectorAll(".pp-dropdown-item").forEach((it) => it.classList.remove("active"));
          item.classList.add("active");
          this.bufferManager?.setBufferTarget(item.dataset.buffer);
          boosterMenu.classList.remove("show");
        });
      });

      document.addEventListener("click", () => {
        speedMenu?.classList.remove("show");
        document.getElementById("pp-quality-menu")?.classList.remove("show");
        boosterMenu?.classList.remove("show");
        document.getElementById("pp-download-dropdown")?.classList.remove("show");
      });

      // Top Action Buttons
      document.getElementById("pp-cinema-back-btn")?.addEventListener("click", () => this.closeCinemaModal());
      document.getElementById("pp-cinema-close-btn")?.addEventListener("click", () => this.closeCinemaModal());
      document.getElementById("pp-cinema-download-btn")?.addEventListener("click", (e) => {
        const dlDropdown = document.getElementById("pp-download-dropdown");
        if (dlDropdown && dlDropdown.children.length > 0) {
          e.stopPropagation();
          dlDropdown.classList.toggle("show");
        } else {
          this.onDownloadHandler?.();
        }
      });

      // Browser Back (popstate) & Mouse Back (button 3)
      window.addEventListener("popstate", () => {
        if (this.isModalOpen) {
          console.log("[PikPak Cinema] 🔙 Sự kiện popstate (Browser Back) -> Đang đóng video...");
          this.closeCinemaModal(false);
        }
      });

      window.addEventListener("mouseup", (e) => {
        if (this.isModalOpen && e.button === 3) {
          e.preventDefault();
          e.stopPropagation();
          console.log("[PikPak Cinema] 🔙 Nút Back chuột (Mouse 4) -> Đang đóng video...");
          this.closeCinemaModal();
        }
      });

      // PiP, Shortcuts & Fullscreen
      document.getElementById("pp-ctrl-pip")?.addEventListener("click", () => {
        if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
        else if (document.pictureInPictureEnabled) v.requestPictureInPicture().catch(() => {});
      });
      document.getElementById("pp-ctrl-shortcuts")?.addEventListener("click", () => this.shortcuts.toggleShortcutsModal());
      document.getElementById("pp-shortcuts-close")?.addEventListener("click", () => this.shortcuts.toggleShortcutsModal(false));
      document.getElementById("pp-ctrl-fullscreen")?.addEventListener("click", () => this.toggleFullscreen());

      // Video lifecycle
      v.addEventListener("ended", () => {
        if (this.isSwitchingSource) return;
        this.navigationHandlers?.onNext?.();
      });
      let retryCount = 0, lastErrorTime = 0;
      v.addEventListener("error", () => {
        if (!v.error || v.error.code === 1 || !this.isModalOpen || this.isSwitchingSource) return;
        const now = Date.now(); if (now - lastErrorTime < 2000) return;
        lastErrorTime = now;
        console.warn(`[PikPak Cinema] Video error (code ${v.error.code}, message: ${v.error.message || "none"})`);

        if (!this.failedStreamUrls) this.failedStreamUrls = new Set();
        if (v.src) this.failedStreamUrls.add(v.src);
        if (this.currentStreamUrl) this.failedStreamUrls.add(this.currentStreamUrl);

        // If the faster transcoded CDN fails, immediately try the original
        // file from the same personal Cloud item before refreshing the CDN.
        if (this.tryOriginalFallback()) return;

        // A CDN URL can expire or reject a seek Range (HTTP 416). Ask the
        // caller for a fresh personal-cloud URL before retrying the same URL.
        if (this.refreshCallback && !this.isRefreshingStream) {
          this.isRefreshingStream = true;
          const savePos = v.currentTime || 0;
          const wasPlaying = !v.paused;
          this.setLoadingMessage("CDN tạm thời không nhận vị trí tua, đang làm mới link...");
          Promise.resolve(this.refreshCallback({ currentTime: savePos }))
            .then((result) => {
              if (!result?.url || !this.isModalOpen) throw new Error("CDN mới không hợp lệ");
              if (result.streams?.length) {
                this.currentOptions = { ...this.currentOptions, streams: result.streams };
              }
              if (result.fileSize) this.currentOptions.fileSize = result.fileSize;
              retryCount = 0;
              this.currentStreamUrl = null;
              this.changeSource(result.url, false, wasPlaying);
            })
            .catch((refreshError) => {
              console.warn("[PikPak Cinema] Không thể làm mới CDN:", refreshError.message);
              this.showPlaybackErrorUI(v.error);
            })
            .finally(() => {
              this.isRefreshingStream = false;
            });
          return;
        }

        // Fallback: retry the same URL once for transient decoder/network errors.
        if (retryCount < 1 && this.currentStreamUrl) {
          retryCount++;
          console.log(`[PikPak Cinema] 🔄 Đang tự động kết nối lại luồng video (${retryCount}/1)...`);
          const savePos = v.currentTime || 0;
          v.src = this.currentStreamUrl;
          v.load();
          if (savePos > 0) {
            const onMeta = () => {
              v.removeEventListener("loadedmetadata", onMeta);
              try { v.currentTime = savePos; } catch (_) {}
              v.play().catch(() => {});
            };
            v.addEventListener("loadedmetadata", onMeta);
          } else {
            v.play().catch(() => {});
          }
          return;
        }

        // Display user-friendly recovery UI
        this.showPlaybackErrorUI(v.error);
      });
      v.addEventListener("loadedmetadata", () => {
        this.hidePlaybackErrorUI();
        this.updateProgress();
      });
      v.addEventListener("playing", () => {
        clearTimeout(this.streamLoadTimeout);
        this.streamLoadTimeout = null;
        this.streamRefreshCount = 0;
        this.hidePlaybackErrorUI();
        this.hideLoading();
        this.updatePlayPauseUI();
      });
    }

    setLoadingMessage(message = "Đang nạp luồng phát...") {
      const spinner = document.getElementById("pp-cinema-spinner");
      const spinnerText = document.getElementById("pp-spinner-text");
      if (spinnerText) spinnerText.textContent = message;
      if (spinner) spinner.classList.add("show");
    }

    hideLoading() {
      document.getElementById("pp-cinema-spinner")?.classList.remove("show");
    }

    async refreshCurrentStream(reason = "CDN cần làm mới") {
      if (!this.refreshCallback || this.isRefreshingStream || !this.isModalOpen || !this.modalVideo) return false;
      if (this.streamRefreshCount >= 2) {
        this.showPlaybackErrorUI(this.modalVideo.error);
        return false;
      }

      this.isRefreshingStream = true;
      this.streamRefreshCount++;
      const video = this.modalVideo;
      const savePos = video.currentTime || 0;
      const wasPlaying = !video.paused;
      this.setLoadingMessage(`${reason}, đang lấy CDN mới...`);

      try {
        const result = await this.refreshCallback({ currentTime: savePos, reason });
        if (!result?.url) throw new Error("CDN mới không hợp lệ");
        if (result.streams?.length) {
          this.currentOptions = { ...this.currentOptions, streams: result.streams };
        }
        if (result.fileSize) this.currentOptions.fileSize = result.fileSize;
        this.currentStreamUrl = null;
        this.changeSource(result.url, false, wasPlaying);
        return true;
      } catch (error) {
        console.warn("[PikPak Cinema] Không thể làm mới CDN:", error.message);
        this.showPlaybackErrorUI(video.error);
        return false;
      } finally {
        this.isRefreshingStream = false;
      }
    }

    tryOriginalFallback() {
      const failedUrls = this.failedStreamUrls || new Set();
      const original = this.currentOptions?.streams?.find((stream) =>
        stream?.isOriginal && stream.url && !stream.url.includes("fid=&") && !failedUrls.has(stream.url)
      );
      if (!original?.url || original.url === this.currentStreamUrl) return false;

      console.warn("[PikPak Cinema] ⚠️ CDN không phát được, chuyển sang Origin:", original.url);
      this.currentStreamUrl = null;
      this.changeSource(original.url, false, true);
      return true;
    }

    showInstantLoading(title, index = 0, playlist = [], navigationHandlers = {}) {
      this.ensureModalDom();
      this.navigationHandlers = navigationHandlers;
      this.isSwitchingSource = true;
      this.isRefreshingStream = false;
      this.streamRefreshCount = 0;
      this.currentStreamUrl = null;
      this.refreshCallback = null;
      (document.body || document.documentElement).classList.add("pp-cinema-active");

      this.hidePlaybackErrorUI();
      this.bufferManager?.stop();
      this.preview?.hide();
      if (this.modalVideo) {
        this.modalVideo.pause();
        this.modalVideo.removeAttribute("src");
        this.modalVideo.src = "";
        this.modalVideo.load();
      }

      this.purgeUnusedMediaAndLayers();

      const titleEl = document.getElementById("pp-modal-filename"), counterEl = document.getElementById("pp-modal-counter");
      const topInfo = document.getElementById("pp-modal-top-info"), spinner = document.getElementById("pp-cinema-spinner");
      const spinnerText = document.getElementById("pp-spinner-text");

      if (titleEl) titleEl.textContent = title || "Đang tải video...";
      if (spinnerText) spinnerText.textContent = title ? `Đang mở: ${title}` : "Đang nạp luồng phát...";
      if (spinner) spinner.classList.add("show");

      if (playlist?.length > 1) {
        if (counterEl) {
          counterEl.textContent = `${index + 1} / ${playlist.length}`;
          counterEl.style.display = "inline-flex";
        }
        document.getElementById("pp-ctrl-prev").style.opacity = index <= 0 ? "0.3" : "1";
        document.getElementById("pp-ctrl-next").style.opacity = index >= playlist.length - 1 ? "0.3" : "1";
        if (topInfo) topInfo.style.display = "flex";
      } else {
        if (counterEl) counterEl.style.display = "none";
        if (topInfo) topInfo.style.display = "none";
      }
      this.drawer.render(playlist || [], index, (idx) => {
        if (this.navigationHandlers?.onSelect) this.navigationHandlers.onSelect(idx);
      });

      this.pushHistoryState();
      this.modalContainer.classList.add("active");
      this.isModalOpen = true;
      this.resetIdleTimer();
    }

    openImageModal(imageUrl, options = {}) {
      this.ensureModalDom();
      this.isSwitchingSource = false;
      this.isImageMode = true;
      this.purgeUnusedMediaAndLayers();
      this.onDownloadHandler = options.onDownload || null;
      this.currentStreamUrl = imageUrl;
      this.currentOptions = options;
      if (options.navigationHandlers) {
        this.navigationHandlers = options.navigationHandlers;
      } else if (options.onPrev || options.onNext || options.onSelect) {
        this.navigationHandlers = {
          onPrev: options.onPrev,
          onNext: options.onNext,
          onSelect: options.onSelect,
        };
      }

      const c = document.getElementById("pp-player-container");
      if (c) { c.classList.remove("is-video-mode"); c.classList.add("is-image-mode"); }

      if (this.modalVideo) { this.modalVideo.pause(); this.modalVideo.removeAttribute("src"); this.modalVideo.src = ""; this.modalVideo.load(); }

      const topInfo = document.getElementById("pp-modal-top-info"), titleEl = document.getElementById("pp-modal-filename"), counterEl = document.getElementById("pp-modal-counter");
      if (titleEl) titleEl.textContent = options.fileName || "Hình ảnh";
      if (options.playlist?.length > 1) {
        const curIdx = options.currentIndex >= 0 ? options.currentIndex : 0;
        if (counterEl) { counterEl.textContent = `${curIdx + 1} / ${options.playlist.length}`; counterEl.style.display = "inline-flex"; }
        document.getElementById("pp-ctrl-prev").style.opacity = curIdx <= 0 ? "0.3" : "1";
        document.getElementById("pp-ctrl-next").style.opacity = curIdx >= options.playlist.length - 1 ? "0.3" : "1";
        if (topInfo) topInfo.style.display = "flex";
      } else {
        if (counterEl) counterEl.style.display = "none";
        if (topInfo) topInfo.style.display = "none";
      }

      this.drawer.render(options.playlist || [], options.currentIndex || 0, (idx) => {
        this.navigationHandlers?.onSelect?.(idx);
      });

      this.pushHistoryState();
      this.imageViewer?.loadImage(imageUrl, options);
      this.modalContainer.classList.add("active");
      this.isModalOpen = true;
      (document.body || document.documentElement).classList.add("pp-cinema-active");
      this.resetIdleTimer();
    }

    openCinemaModal(streamUrl, options = {}) {
      this.ensureModalDom();
      this.isSwitchingSource = false;
      this.isRefreshingStream = false;
      this.streamRefreshCount = 0;
      this.isImageMode = false;
      this.failedStreamUrls = new Set();
      this.hidePlaybackErrorUI();

      const c = document.getElementById("pp-player-container");
      if (c) { c.classList.remove("is-image-mode"); c.classList.add("is-video-mode"); }
      this.imageViewer?.destroy();
      this.onDownloadHandler = options.onDownload || null;
      if (options.navigationHandlers) {
        this.navigationHandlers = options.navigationHandlers;
      } else if (options.onPrev || options.onNext || options.onSelect) {
        this.navigationHandlers = {
          onPrev: options.onPrev,
          onNext: options.onNext,
          onSelect: options.onSelect,
        };
      }

      // Safeguard for container & stream selection
      let effectiveStreamUrl = streamUrl;
      const fileName = options.fileName || "";
      const isAviOrNonNative = /\.(avi|wmv|flv|rmvb|rm|asf|divx|vob|ts|m2ts|3gp)(\?|$)/i.test(effectiveStreamUrl || "") ||
        /\.(avi|wmv|flv|rmvb|rm|asf|divx|vob|ts|m2ts|3gp)$/i.test(fileName);

      if (options.streams && options.streams.length > 0) {
        if (isAviOrNonNative) {
          const transcoded = options.streams.find((s) => !s.isOriginal && s.url && !s.url.includes("fid=&"));
          if (transcoded && transcoded.url) {
            console.log(`[PikPak Cinema] 🛡️ File AVI không thể phát trực tiếp, chọn luồng MP4 (${transcoded.quality}):`, transcoded.url);
            effectiveStreamUrl = transcoded.url;
          }
        } else {
          // Stream transcoded thường seek nhanh hơn bản Original nhiều GB.
          const transcoded = options.streams.find((s) => !s.isOriginal && s.url && !s.url.includes("fid=&"));
          const origStream = options.streams.find((s) => s.isOriginal && s.url && !s.url.includes("fid=&"));
          if (transcoded?.url || origStream?.url) {
            const selected = transcoded || origStream;
            console.log(`[PikPak Cinema] 🎬 Video chuẩn: Khởi chạy với luồng ${transcoded ? "Transcoded" : "Original"} (${selected.quality || "Auto"}):`, selected.url);
            effectiveStreamUrl = selected.url;
          }
        }
      }

      this.currentStreamUrl = effectiveStreamUrl;
      this.currentOptions = options;
      this.refreshCallback = options.onRefreshRequest || null;
      this.setLoadingMessage(`Đang nạp: ${fileName || "video"}`);

      // Update top info
      const topInfo = document.getElementById("pp-modal-top-info");
      const titleEl = document.getElementById("pp-modal-filename");
      const counterEl = document.getElementById("pp-modal-counter");

      if (titleEl) titleEl.textContent = options.fileName || "PikPak Video Stream";

      if (options.playlist && options.playlist.length > 1) {
        const total = options.playlist.length;
        const curIdx = options.currentIndex >= 0 ? options.currentIndex : 0;
        if (counterEl) {
          counterEl.textContent = `${curIdx + 1} / ${total}`;
          counterEl.style.display = "inline-flex";
        }
        document.getElementById("pp-ctrl-prev").style.opacity = curIdx <= 0 ? "0.3" : "1";
        document.getElementById("pp-ctrl-next").style.opacity = curIdx >= total - 1 ? "0.3" : "1";
        if (topInfo) topInfo.style.display = "flex";
      } else {
        if (counterEl) counterEl.style.display = "none";
        if (topInfo) topInfo.style.display = "none";
      }

      // Delegate Drawer rendering
      this.drawer.render(options.playlist || [], options.currentIndex || 0, (idx) => {
        if (this.navigationHandlers?.onSelect) this.navigationHandlers.onSelect(idx);
      });

      // Quality Menu
      const qualityWrap = document.getElementById("pp-quality-wrap");
      const qualityMenu = document.getElementById("pp-quality-menu");
      const qualityLabel = document.getElementById("pp-quality-label");

      if (qualityWrap && qualityMenu && options.streams && options.streams.length > 1) {
        qualityWrap.style.display = "block";
        const curStream = options.streams.find((s) => s.url === effectiveStreamUrl) || options.streams.find((s) => s.isOriginal) || options.streams[0];
        const curQuality = curStream?.isOriginal ? "Original" : (curStream?.quality || "Original").split(" ")[0];
        if (qualityLabel) qualityLabel.textContent = curQuality;

        qualityMenu.innerHTML = `
          <div class="pp-dropdown-header">Chất lượng phát & Bitrate</div>
          ${options.streams
            .map((s) => {
              const isActive = s.url === effectiveStreamUrl;
              const metaParts = [];
              if (s.bitrateText) metaParts.push(`<span class="pp-bitrate-text">${s.bitrateText}</span>`);
              if (s.isOriginal) {
                metaParts.push(`<span class="pp-orig-badge">Gốc (Chưa nén)</span>`);
              } else if (s.compressionRatio > 0) {
                metaParts.push(`<span class="pp-compress-badge">Nén -${s.compressionRatio}%</span>`);
              }
              const metaHtml = metaParts.length > 0 ? `<span class="pp-quality-meta">${metaParts.join("")}</span>` : "";
              const label = s.isOriginal ? "Bản gốc (Original)" : s.quality;
              return `
                <div class="pp-dropdown-item ${isActive ? "active" : ""}" data-url="${s.url}">
                  <span class="pp-quality-name">${label}</span>
                  ${metaHtml}
                </div>
              `;
            })
            .join("")}
        `;

        qualityMenu.querySelectorAll(".pp-dropdown-item").forEach((item) => {
          item.addEventListener("click", (e) => {
            e.stopPropagation();
            if (item.dataset.url) {
              const targetUrl = item.dataset.url;
              const matchedStream = options.streams.find((s) => s.url === targetUrl);
              const displayQuality = matchedStream?.isOriginal ? "Original" : (matchedStream?.quality || item.querySelector(".pp-quality-name")?.textContent || "Original").split(" ")[0];
              if (qualityLabel) qualityLabel.textContent = displayQuality;
              this.changeSource(targetUrl, true);
              qualityMenu.classList.remove("show");
            }
          });
        });

        document.getElementById("pp-quality-btn").onclick = (e) => {
          e.stopPropagation();
          qualityMenu.classList.toggle("show");
        };
      } else if (qualityWrap) {
        qualityWrap.style.display = "none";
      }

      // Populate Download Dropdown Menu
      const dlDropdown = document.getElementById("pp-download-dropdown");
      if (dlDropdown) {
        if (options.streams && options.streams.length > 1) {
          const formatBytes = (bytes) => {
            if (!bytes || bytes <= 0) return "";
            if (bytes >= 1024 * 1024 * 1024) return `~${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
            return `~${(bytes / (1024 * 1024)).toFixed(0)} MB`;
          };

          dlDropdown.innerHTML = `
            <div class="pp-dropdown-header">Tùy chọn tải video</div>
            ${options.streams
              .map((s) => {
                const sz = formatBytes(s.fileSize);
                const badge = s.compressionRatio > 0 ? `<span class="pp-compress-badge">Tiết kiệm ${s.compressionRatio}%</span>` : "";
                const isOrig = s.isOriginal ? " (Bản gốc)" : " (Bản nén)";
                return `
                  <div class="pp-dropdown-item pp-download-item" data-url="${s.url}" data-name="${s.quality}">
                    <span class="pp-quality-name">${s.quality}${isOrig}</span>
                    <span class="pp-quality-meta">
                      ${sz ? `<span class="pp-bitrate-text">${sz}</span>` : ""}
                      ${badge}
                    </span>
                  </div>
                `;
              })
              .join("")}
          `;

          dlDropdown.querySelectorAll(".pp-download-item").forEach((item) => {
            item.addEventListener("click", (e) => {
              e.stopPropagation();
              dlDropdown.classList.remove("show");
              const targetUrl = item.dataset.url;
              if (targetUrl) {
                const a = Object.assign(document.createElement("a"), {
                  href: targetUrl,
                  download: options.fileName || "video.mp4",
                  target: "_blank",
                });
                (document.body || document.documentElement).appendChild(a);
                a.click();
                a.remove();
                this.shortcuts?.showHud(`Bắt đầu tải ${item.dataset.name}`, null);
              }
            });
          });
        } else {
          dlDropdown.innerHTML = "";
        }
      }

      // Tối ưu hiệu năng: Xóa sổ triệt để video gốc và các layer thừa ở nền
      (document.body || document.documentElement).classList.add("pp-cinema-active");
      this.purgeUnusedMediaAndLayers();

      this.preview?.setSource(effectiveStreamUrl);
      this.pushHistoryState();
      this.modalContainer.classList.add("active");
      this.isModalOpen = true;

      this.resetIdleTimer();
      this.bufferManager?.start(effectiveStreamUrl, options);
      this.mountStreamSource(effectiveStreamUrl, 0, true);
      console.log("%c[PikPak Ultra] 🎬 Cinema Player Engine hoàn thiện!", "color: #0a84ff; font-weight: bold;");
    }

    closeCinemaModal(shouldRevertHistory = true) {
      if (!this.modalContainer) return;
      this.shortcuts?.clearPendingBackTimer?.();
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
      clearTimeout(this.streamLoadTimeout);
      this.streamLoadTimeout = null;
      this.revertHistoryState(shouldRevertHistory);
      this.isSwitchingSource = false;
      this.hidePlaybackErrorUI();
      this.modalContainer.classList.remove("active");
      this.isModalOpen = false;
      this.isImageMode = false;
      this.isDraggingProgress = false;
      this.isHoveringProgress = false;
      this.preview?.hide();
      this.imageViewer?.destroy();
      this.bufferManager?.stop();
      const c = document.getElementById("pp-player-container");
      if (c) c.classList.remove("is-image-mode", "is-video-mode");
      (document.body || document.documentElement).classList.remove("pp-cinema-active");
      document.getElementById("pp-cinema-spinner")?.classList.remove("show");

      // Fully release main video (pause + src removal + load = free decoder & network)
      if (this.modalVideo) {
        this.modalVideo.pause();
        this.modalVideo.removeAttribute("src");
        this.modalVideo.src = "";
        this.modalVideo.load();
      }

      // Release preview video resources
      const pv = this.preview?.previewVideo;
      if (pv) {
        pv.pause();
        pv.removeAttribute("src");
        pv.src = "";
        pv.load();
      }
      if (this.preview) { this.preview.currentStreamUrl = null; this.preview._ready = false; }

      this.currentStreamUrl = null;
      this.drawer.toggle(false);
      this.purgeUnusedMediaAndLayers();
      console.log("[PikPak Ultra] Cinema Modal Player đã đóng, tài nguyên đã giải phóng.");
    }

    changeSource(newUrl, isUser = false, forceAutoplay = false) {
      if (!this.modalVideo || !newUrl) return;
      if (this.currentStreamUrl === newUrl) return;
      this.hidePlaybackErrorUI();
      const curTime = this.modalVideo.currentTime || 0;
      const wasPlaying = !this.modalVideo.paused;
      this.currentStreamUrl = newUrl;

      // Update quality dropdown UI
      const matched = this.currentOptions?.streams?.find((s) => s.url === newUrl);
      this.setLoadingMessage(`Đang đổi luồng: ${matched?.quality || "Original"}`);
      if (matched) {
        const qualityLabel = document.getElementById("pp-quality-label");
        if (qualityLabel) qualityLabel.textContent = matched.isOriginal ? "Original" : (matched.quality || "Original").split(" ")[0];
        document.querySelectorAll("#pp-quality-menu .pp-dropdown-item").forEach((item) => {
          item.classList.toggle("active", item.dataset.url === newUrl);
        });
      }

      this.preview?.setSource(newUrl);
      this.bufferManager?.start(newUrl, this.currentOptions);
      this.mountStreamSource(newUrl, curTime, wasPlaying || isUser || forceAutoplay);

      if (isUser) this.shortcuts?.showHud("Đổi độ phân giải", null);
    }

    mountStreamSource(url, curTime = 0, autoplay = true) {
      if (!this.modalVideo || !url) return;

      const matched = this.currentOptions?.streams?.find((s) => s.url === url);
      const isOriginal = Boolean(matched?.isOriginal);
      console.log(`[PikPak Cinema] 🎬 Video: Nạp luồng ${isOriginal ? "Original (Bản gốc)" : (matched?.quality || "Transcode")}:`, url);

      this.currentStreamUrl = url;
      clearTimeout(this.streamLoadTimeout);
      this.streamLoadTimeout = setTimeout(() => {
        if (this.isModalOpen && this.currentStreamUrl === url && this.modalVideo.readyState < 3 && !this.isRefreshingStream) {
          if (!this.failedStreamUrls) this.failedStreamUrls = new Set();
          this.failedStreamUrls.add(url);
          if (!this.tryOriginalFallback()) this.refreshCurrentStream("CDN tải quá lâu");
        }
      }, 15000);

      // Nạp trực tiếp 100% bằng Native HTML5 Video Engine (GPU Hardware Acceleration)
      // KHÔNG gán currentTime = 0 trước khi load() vì sẽ gây HTTP Range abort / lỗi 416
      if (this.modalVideo.src !== url) {
        this.modalVideo.src = url;
        this.modalVideo.load();
      }

      const onMetadata = () => {
        this.modalVideo.removeEventListener("loadedmetadata", onMetadata);
        if (curTime > 0) {
          try { this.modalVideo.currentTime = curTime; } catch (_) {}
        }
        if (autoplay) {
          this.modalVideo.play().then(() => {
            this.updatePlayPauseUI();
          }).catch(() => {
            this.modalVideo.muted = true;
            this.updateVolumeUI();
            this.modalVideo.play().catch(() => {});
            this.updatePlayPauseUI();
          });
        }
      };
      this.modalVideo.addEventListener("loadedmetadata", onMetadata);
    }

    showPlaybackErrorUI(error) {
      const spinner = document.getElementById("pp-cinema-spinner");
      if (spinner) spinner.classList.remove("show");

      const overlay = document.getElementById("pp-playback-error-overlay");
      if (!overlay) return;

      const titleEl = document.getElementById("pp-error-title");
      const descEl = document.getElementById("pp-error-desc");
      const fileName = this.currentOptions?.fileName || "";
      const isAviOrNonNative = /\.(avi|wmv|flv|rmvb|rm|asf|divx|vob|ts|m2ts|3gp)$/i.test(fileName) ||
        /\.(avi|wmv|flv|rmvb|rm|asf|divx|vob|ts|m2ts|3gp)(\?|$)/i.test(this.currentStreamUrl || "");

      if (isAviOrNonNative) {
        if (titleEl) titleEl.textContent = "Định dạng AVI không thể phát trực tiếp trên Chrome";
        if (descEl) descEl.textContent = "Trình duyệt không hỗ trợ giải mã trực tiếp định dạng .avi và PikPak chưa sẵn sàng bản nén MP4 cho tập này. Bạn có thể tải video về máy để xem mượt mà bằng VLC, PotPlayer hoặc IINA.";
      } else {
        if (titleEl) titleEl.textContent = "Không thể phát luồng video này";
        if (descEl) descEl.textContent = "Đã thử các luồng phát nhưng không thành công do lỗi mạng hoặc định dạng không hỗ trợ. Bạn có thể tải file hoặc mở bằng phần mềm ngoại vi.";
      }

      // Download button
      const dlBtn = document.getElementById("pp-error-download-btn");
      if (dlBtn) {
        dlBtn.onclick = (e) => {
          e.stopPropagation();
          if (this.onDownloadHandler) {
            this.onDownloadHandler();
          } else if (this.currentStreamUrl) {
            const a = Object.assign(document.createElement("a"), {
              href: this.currentStreamUrl,
              download: fileName || "video",
              target: "_blank",
            });
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
        };
      }

      // Copy stream link button
      const copyBtn = document.getElementById("pp-error-copy-btn");
      if (copyBtn) {
        copyBtn.onclick = async (e) => {
          e.stopPropagation();
          if (this.currentStreamUrl) {
            try {
              await navigator.clipboard.writeText(this.currentStreamUrl);
              this.shortcuts?.showHud("Đã sao chép link stream!", 2500);
            } catch (_) {
              prompt("Link stream của bạn (Ctrl+C / Cmd+C để copy):", this.currentStreamUrl);
            }
          }
        };
      }

      // VLC button
      const vlcBtn = document.getElementById("pp-error-vlc-btn");
      if (vlcBtn) {
        vlcBtn.onclick = (e) => {
          e.stopPropagation();
          if (this.currentStreamUrl) {
            window.location.href = "vlc://" + this.currentStreamUrl;
          }
        };
      }

      // Next video button
      const nextBtn = document.getElementById("pp-error-next-btn");
      if (nextBtn) {
        const playlist = this.currentOptions?.playlist || [];
        const curIdx = this.currentOptions?.currentIndex ?? -1;
        if (playlist.length > 1 && curIdx < playlist.length - 1) {
          nextBtn.style.display = "inline-block";
          nextBtn.onclick = (e) => {
            e.stopPropagation();
            this.hidePlaybackErrorUI();
            this.navigationHandlers?.onNext?.();
          };
        } else {
          nextBtn.style.display = "none";
        }
      }

      overlay.style.display = "flex";
    }

    hidePlaybackErrorUI() {
      const overlay = document.getElementById("pp-playback-error-overlay");
      if (overlay) overlay.style.display = "none";
    }

    pushHistoryState() {
      if (!this.hasPushedHistoryState) {
        try {
          history.pushState({ pikpakCinemaActive: true }, "");
          this.hasPushedHistoryState = true;
        } catch (_) {}
      }
    }

    revertHistoryState(shouldRevert = true) {
      if (this.hasPushedHistoryState) {
        this.hasPushedHistoryState = false;
        if (shouldRevert) {
          try {
            if (history.state?.pikpakCinemaActive) {
              history.back();
            }
          } catch (_) {}
        }
      }
    }
  }

  root.PikPakPlayer = new VideoStreamController();
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
