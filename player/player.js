/**
 * PikPak Ultra Pro Max - Dedicated Cinema Player Engine (SOLID Architecture)
 */

(function (root) {
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

      // State
      this.isDraggingProgress = false;
      this.wasPlayingBeforeDrag = false;
      this.idleTimeout = null;
      this.speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
      this.currentSpeedIdx = 2; // default 1.0x

      // Sub-modules (DIP & SRP)
      this.shortcuts = new root.PlayerShortcutsManager(this);
      this.drawer = new root.PlayerDrawerManager(this);
      this.preview = root.PlayerPreviewManager ? new root.PlayerPreviewManager(this) : null;
    }

    setNavigationHandlers(handlers) {
      this.navigationHandlers = handlers;
    }

    resetIdleTimer() {
      const c = document.getElementById("pp-player-container"); if (!c) return;
      c.classList.remove("pp-inactive"); clearTimeout(this.idleTimeout);
      if (!this.modalVideo || this.modalVideo.paused) return;
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
      if (this.modalVideo.paused) {
        this.modalVideo.play().catch(() => {});
        this.shortcuts.showHud("Phát", icons.play);
      } else {
        this.modalVideo.pause();
        this.shortcuts.showHud("Tạm dừng", icons.pause);
      }
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

    ensureModalDom() {
      const existing = document.getElementById("pikpak-ultra-cinema-modal");
      if (existing) {
        const v = existing.querySelector("#pikpak-ultra-modal-video");
        const ctrl = existing.querySelector("#pp-player-controls");
        if (v && ctrl) {
          this.modalContainer = existing;
          this.modalVideo = v;
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

      // Mouse inactivity
      container.addEventListener("mousemove", () => this.resetIdleTimer());
      container.addEventListener("mouseenter", () => this.resetIdleTimer());

      // Click video to toggle play
      v.addEventListener("click", (e) => {
        if (e.target === v) this.togglePlay();
      });

      // Double-click gestures
      v.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const rect = v.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        if (clickX < width * 0.3) {
          v.currentTime = Math.max(0, v.currentTime - 10);
          this.shortcuts.showHud("-10s", null);
        } else if (clickX > width * 0.7) {
          v.currentTime = Math.min(v.duration, v.currentTime + 10);
          this.shortcuts.showHud("+10s", null);
        } else {
          this.toggleFullscreen();
        }
      });

      // Progress bar: hover preview (only shows tooltip, does NOT move played bar)
      const handleHoverMove = (e) => {
        const rect = progressArea.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (v.duration) this.preview?.updateHover(e, pos, v.duration);
      };

      // Progress bar: scrubbing (moves played bar + seeks video)
      const handleScrubMove = (e) => {
        const rect = progressArea.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const playedBar = document.getElementById("pp-progress-played");
        if (playedBar) playedBar.style.width = `${pos * 100}%`;
        if (v.duration) this.preview?.updateHover(e, pos, v.duration);
        return pos;
      };

      progressArea.addEventListener("mouseenter", () => {
        this.isHoveringProgress = true;
        this.preview?.show();
      });
      progressArea.addEventListener("mouseleave", () => {
        this.isHoveringProgress = false;
        if (!this.isDraggingProgress) {
          this.preview?.hide();
          // Restore played bar to real playback position immediately
          const dur = v.duration || 0;
          if (dur > 0) {
            const playedBar = document.getElementById("pp-progress-played");
            if (playedBar) playedBar.style.width = `${(v.currentTime / dur) * 100}%`;
          }
        }
      });
      progressArea.addEventListener("mousemove", (e) => handleHoverMove(e));

      progressArea.addEventListener("mousedown", (e) => {
        this.isDraggingProgress = true;
        progressArea.classList.add("dragging");
        this.wasPlayingBeforeDrag = !v.paused;
        if (this.wasPlayingBeforeDrag) v.pause();

        const pos = handleScrubMove(e);
        if (v.duration) v.currentTime = pos * v.duration;

        const onMouseMove = (moveEvent) => {
          const movePos = handleScrubMove(moveEvent);
          if (v.duration) v.currentTime = movePos * v.duration;
        };

        const onMouseUp = () => {
          this.isDraggingProgress = false;
          this.isHoveringProgress = false;
          progressArea.classList.remove("dragging");
          this.preview?.hide();
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
          if (this.wasPlayingBeforeDrag) v.play().catch(() => {});
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      });

      // Controls buttons
      document.getElementById("pp-ctrl-play").addEventListener("click", () => this.togglePlay());
      document.getElementById("pp-ctrl-prev").addEventListener("click", () => this.navigationHandlers?.onPrev?.());
      document.getElementById("pp-ctrl-next").addEventListener("click", () => this.navigationHandlers?.onNext?.());
      document.getElementById("pp-ctrl-volume").addEventListener("click", () => { v.muted = !v.muted; this.updateVolumeUI(); });

      document.getElementById("pp-volume-slider")?.addEventListener("input", (e) => {
        v.volume = parseFloat(e.target.value); v.muted = false; this.updateVolumeUI();
      });

      // Speed dropdown
      const speedBtn = document.getElementById("pp-speed-btn"), speedMenu = document.getElementById("pp-speed-menu");
      speedBtn?.addEventListener("click", (e) => { e.stopPropagation(); speedMenu?.classList.toggle("show"); });
      speedMenu?.querySelectorAll(".pp-dropdown-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          this.setPlaybackSpeed(parseFloat(item.dataset.speed));
          speedMenu.classList.remove("show");
        });
      });

      document.addEventListener("click", () => {
        speedMenu?.classList.remove("show");
        document.getElementById("pp-quality-menu")?.classList.remove("show");
      });

      // Top Action Buttons (Download & Close)
      document.getElementById("pp-cinema-close-btn")?.addEventListener("click", () => this.closeCinemaModal());
      document.getElementById("pp-cinema-download-btn")?.addEventListener("click", () => this.onDownloadHandler?.());

      // PiP, Shortcuts & Fullscreen
      document.getElementById("pp-ctrl-pip")?.addEventListener("click", () => {
        if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
        else if (document.pictureInPictureEnabled) v.requestPictureInPicture().catch(() => {});
      });
      document.getElementById("pp-ctrl-shortcuts")?.addEventListener("click", () => this.shortcuts.toggleShortcutsModal());
      document.getElementById("pp-shortcuts-close")?.addEventListener("click", () => this.shortcuts.toggleShortcutsModal(false));
      document.getElementById("pp-ctrl-fullscreen")?.addEventListener("click", () => this.toggleFullscreen());

      // Video end & error listeners
      v.addEventListener("ended", () => {
        console.log("[PikPak Cinema] 🏁 Video kết thúc! Tự động chuyển tập...");
        if (this.navigationHandlers?.onNext) this.navigationHandlers.onNext();
      });
      let retryCount = 0;
      let lastErrorTime = 0;
      v.addEventListener("error", () => {
        const now = Date.now();
        console.error(`[PikPak Cinema] ❌ Lỗi video: code=${v.error?.code}`);
        if (now - lastErrorTime < 4000) return;
        lastErrorTime = now;
        if (retryCount < 2 && this.refreshCallback) {
          retryCount++;
          console.warn(`[PikPak Cinema] Đang thử kết nối lại link stream (${retryCount}/2)...`);
          this.refreshCallback();
        }
      });
      v.addEventListener("loadedmetadata", () => this.updateProgress());
      v.addEventListener("playing", () => this.updatePlayPauseUI());
    }

    showInstantLoading(title, index = 0, playlist = [], navigationHandlers = {}) {
      this.ensureModalDom();
      this.navigationHandlers = navigationHandlers;
      (document.body || document.documentElement).classList.add("pp-cinema-active");

      document.querySelectorAll("video:not(#pikpak-ultra-modal-video)").forEach((v) => {
        try { v.pause(); v.muted = true; v.volume = 0; v.style.display = "none"; } catch (_) {}
      });

      const titleEl = document.getElementById("pp-modal-filename"), counterEl = document.getElementById("pp-modal-counter");
      const topInfo = document.getElementById("pp-modal-top-info"), spinner = document.getElementById("pp-cinema-spinner");
      const spinnerText = document.getElementById("pp-spinner-text");

      if (titleEl) titleEl.textContent = title || "Đang tải video...";
      if (spinnerText) spinnerText.textContent = title ? `Đang mở: ${title}` : "Đang nạp luồng phát...";
      if (spinner) spinner.classList.add("show");

      if (playlist?.length > 0) {
        if (counterEl) {
          counterEl.textContent = `${index + 1} / ${playlist.length}`;
          counterEl.style.display = "inline-flex";
        }
        document.getElementById("pp-ctrl-prev").style.opacity = index <= 0 ? "0.3" : "1";
        document.getElementById("pp-ctrl-next").style.opacity = index >= playlist.length - 1 ? "0.3" : "1";
      }

      if (topInfo) topInfo.style.display = "flex";
      this.drawer.render(playlist || [], index, (idx) => {
        if (this.navigationHandlers?.onSelect) this.navigationHandlers.onSelect(idx);
      });

      this.modalContainer.classList.add("active");
      this.isModalOpen = true;
    }

    openCinemaModal(streamUrl, options = {}) {
      this.ensureModalDom();
      this.onDownloadHandler = options.onDownload || null;

      this.currentStreamUrl = streamUrl;
      this.currentOptions = options;
      this.refreshCallback = options.onRefreshRequest || null;

      // Update top info
      const topInfo = document.getElementById("pp-modal-top-info");
      const titleEl = document.getElementById("pp-modal-filename");
      const counterEl = document.getElementById("pp-modal-counter");

      if (titleEl) titleEl.textContent = options.fileName || "PikPak Video Stream";

      if (options.playlist && options.playlist.length > 0) {
        const total = options.playlist.length;
        const curIdx = options.currentIndex >= 0 ? options.currentIndex : 0;
        if (counterEl) {
          counterEl.textContent = `${curIdx + 1} / ${total}`;
          counterEl.style.display = "inline-flex";
        }
        document.getElementById("pp-ctrl-prev").style.opacity = curIdx <= 0 ? "0.3" : "1";
        document.getElementById("pp-ctrl-next").style.opacity = curIdx >= total - 1 ? "0.3" : "1";
      } else if (counterEl) {
        counterEl.style.display = "none";
      }

      if (topInfo) topInfo.style.display = "flex";

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
        const curQuality = options.streams.find((s) => s.url === streamUrl)?.quality || "1080P";
        if (qualityLabel) qualityLabel.textContent = curQuality;

        qualityMenu.innerHTML = options.streams
          .map((s) => `<div class="pp-dropdown-item ${s.url === streamUrl ? "active" : ""}" data-url="${s.url}">${s.quality} (${s.resolution})</div>`)
          .join("");

        qualityMenu.querySelectorAll(".pp-dropdown-item").forEach((item) => {
          item.addEventListener("click", (e) => {
            e.stopPropagation();
            if (item.dataset.url) {
              this.changeSource(item.dataset.url, true);
              qualityMenu.classList.remove("show");
              if (qualityLabel) qualityLabel.textContent = item.textContent.split(" ")[0];
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

      // Hide spinner
      const spinner = document.getElementById("pp-cinema-spinner");
      if (spinner) spinner.classList.remove("show");

      // Tối ưu hiệu năng: Dập tắt triệt để video gốc ở nền
      (document.body || document.documentElement).classList.add("pp-cinema-active");
      document.querySelectorAll("video:not(#pikpak-ultra-modal-video)").forEach((v) => {
        try {
          v.pause();
          v.muted = true;
          v.volume = 0;
          v.style.display = "none";
        } catch (_) {}
      });

      // Mount stream to modal video
      this.modalVideo.pause();
      this.modalVideo.removeAttribute("src");
      this.modalVideo.src = streamUrl;
      this.modalVideo.currentTime = 0;
      this.modalVideo.load();
      this.preview?.setSource(streamUrl);

      this.modalContainer.classList.add("active");
      this.isModalOpen = true;

      const playPromise = this.modalVideo.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log("[PikPak Cinema] ▶️ Video bắt đầu phát!");
            this.updatePlayPauseUI();
          })
          .catch((err) => {
            console.warn("[PikPak Cinema] Muted fallback autoplay:", err.message);
            this.modalVideo.muted = true;
            this.modalVideo.play().catch(() => {});
            this.updateVolumeUI();
          });
      }

      this.resetIdleTimer();
      console.log("%c[PikPak Ultra] 🎬 Cinema Player Engine hoàn thiện!", "color: #0a84ff; font-weight: bold;");
    }

    closeCinemaModal() {
      if (!this.modalContainer) return;
      this.modalContainer.classList.remove("active");
      this.isModalOpen = false;
      (document.body || document.documentElement).classList.remove("pp-cinema-active");
      document.getElementById("pp-cinema-spinner")?.classList.remove("show");
      if (this.modalVideo) this.modalVideo.pause();
      this.drawer.toggle(false);
      document.querySelectorAll("video:not(#pikpak-ultra-modal-video)").forEach((v) => {
        try { v.style.display = ""; v.muted = false; } catch (_) {}
      });
      console.log("[PikPak Ultra] Cinema Modal Player đã đóng.");
    }

    changeSource(newUrl, isUser = false) {
      if (!this.modalVideo) return;
      const curTime = this.modalVideo.currentTime || 0;
      this.currentStreamUrl = newUrl;
      this.modalVideo.src = newUrl;
      this.modalVideo.currentTime = curTime;
      this.modalVideo.load();
      this.preview?.setSource(newUrl);
      this.modalVideo.play().catch(() => {});
      if (isUser) this.shortcuts.showHud("Đổi độ phân giải", null);
    }
  }

  root.PikPakPlayer = new VideoStreamController();
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
