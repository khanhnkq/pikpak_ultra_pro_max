/**
 * PikPak Ultra Pro Max - Dedicated Cinema Player Engine (SOLID Architecture)
 */

(function (root) {
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "00:00";
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
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
    }

    setNavigationHandlers(handlers) {
      this.navigationHandlers = handlers;
    }

    resetIdleTimer() {
      const container = document.getElementById("pp-player-container");
      if (!container) return;

      container.classList.remove("pp-inactive");
      clearTimeout(this.idleTimeout);

      if (!this.modalVideo || this.modalVideo.paused) return; // Don't auto-hide when paused

      this.idleTimeout = setTimeout(() => {
        if (!this.isDraggingProgress) {
          container.classList.add("pp-inactive");
          document.querySelectorAll(".pp-dropdown-menu").forEach((m) => m.classList.remove("show"));
        }
      }, 2600);
    }

    stepSpeed(dir) {
      let idx = this.speeds.indexOf(this.modalVideo.playbackRate);
      if (idx === -1) idx = this.currentSpeedIdx;
      let nextIdx = Math.max(0, Math.min(this.speeds.length - 1, idx + dir));
      this.setPlaybackSpeed(this.speeds[nextIdx]);
    }

    setPlaybackSpeed(speed) {
      if (!this.modalVideo) return;
      this.modalVideo.playbackRate = speed;
      this.currentSpeedIdx = this.speeds.indexOf(speed);

      const label = document.getElementById("pp-speed-label");
      if (label) label.textContent = `${speed}x`;

      document.querySelectorAll("#pp-speed-menu .pp-dropdown-item").forEach((item) => {
        const itemSpeed = parseFloat(item.dataset.speed);
        item.classList.toggle("active", itemSpeed === speed);
      });

      this.shortcuts.showHud(`⚡ ${speed}x`, null);
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
      if (!btn || !this.modalVideo) return;
      btn.innerHTML = this.modalVideo.paused ? icons.play : icons.pause;
    }

    updateVolumeUI() {
      const v = this.modalVideo;
      const volBtn = document.getElementById("pp-ctrl-volume");
      const volSlider = document.getElementById("pp-volume-slider");
      const icons = root.PikPakIcons || {};
      if (!v || !volBtn || !volSlider) return;

      volSlider.value = v.muted ? 0 : v.volume;

      if (v.muted || v.volume === 0) {
        volBtn.innerHTML = icons.volMute;
      } else if (v.volume < 0.5) {
        volBtn.innerHTML = icons.volLow;
      } else {
        volBtn.innerHTML = icons.volHigh;
      }
    }

    toggleFullscreen() {
      const container = document.getElementById("pp-player-container");
      const fsBtn = document.getElementById("pp-ctrl-fullscreen");
      const icons = root.PikPakIcons || {};
      if (!container) return;

      if (!document.fullscreenElement) {
        container.requestFullscreen().catch(() => {});
        if (fsBtn) fsBtn.innerHTML = icons.exitFullscreen;
      } else {
        document.exitFullscreen().catch(() => {});
        if (fsBtn) fsBtn.innerHTML = icons.fullscreen;
      }
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
      document.body.appendChild(modal);

      this.modalContainer = modal;
      this.modalVideo = modal.querySelector("#pikpak-ultra-modal-video");

      this.initPlayerEventBindings();
      this.drawer.bindEvents();
    }

    updateProgress() {
      const v = this.modalVideo;
      if (!v || this.isDraggingProgress) return;

      const cur = v.currentTime || 0;
      const dur = v.duration || 0;
      const pct = dur > 0 ? (cur / dur) * 100 : 0;

      const playedBar = document.getElementById("pp-progress-played");
      const curTimeEl = document.getElementById("pp-time-current");
      const totalTimeEl = document.getElementById("pp-time-total");

      if (playedBar) playedBar.style.width = `${pct}%`;
      if (curTimeEl) curTimeEl.textContent = formatTime(cur);
      if (totalTimeEl && dur > 0) totalTimeEl.textContent = formatTime(dur);

      // Update buffer
      const bufferBar = document.getElementById("pp-progress-buffer");
      if (bufferBar && v.buffered.length > 0) {
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.buffered.start(i) <= cur && cur <= v.buffered.end(i)) {
            const bufPct = (v.buffered.end(i) / dur) * 100;
            bufferBar.style.width = `${bufPct}%`;
            break;
          }
        }
      }
    }

    initPlayerEventBindings() {
      const v = this.modalVideo;
      const container = document.getElementById("pp-player-container");
      const progressArea = document.getElementById("pp-progress-area");
      const tooltip = document.getElementById("pp-scrub-tooltip");

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

      // Progress bar scrubbing
      const handleScrubMove = (e) => {
        const rect = progressArea.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const playedBar = document.getElementById("pp-progress-played");
        if (playedBar) playedBar.style.width = `${pos * 100}%`;
        if (tooltip && v.duration) {
          tooltip.style.left = `${pos * 100}%`;
          tooltip.textContent = formatTime(pos * v.duration);
        }
        return pos;
      };

      progressArea.addEventListener("mouseenter", () => (tooltip.style.opacity = "1"));
      progressArea.addEventListener("mouseleave", () => {
        if (!this.isDraggingProgress) tooltip.style.opacity = "0";
      });
      progressArea.addEventListener("mousemove", (e) => handleScrubMove(e));

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
          progressArea.classList.remove("dragging");
          tooltip.style.opacity = "0";
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
          if (this.wasPlayingBeforeDrag) v.play().catch(() => {});
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      });

      // Controls buttons
      document.getElementById("pp-ctrl-play").addEventListener("click", () => this.togglePlay());
      document.getElementById("pp-ctrl-prev").addEventListener("click", () => {
        if (this.navigationHandlers?.onPrev) this.navigationHandlers.onPrev();
      });
      document.getElementById("pp-ctrl-next").addEventListener("click", () => {
        if (this.navigationHandlers?.onNext) this.navigationHandlers.onNext();
      });

      // Volume controls
      document.getElementById("pp-ctrl-volume").addEventListener("click", () => {
        v.muted = !v.muted;
        this.updateVolumeUI();
      });

      const volSlider = document.getElementById("pp-volume-slider");
      volSlider.addEventListener("input", (e) => {
        v.volume = parseFloat(e.target.value);
        v.muted = false;
        this.updateVolumeUI();
      });

      // Speed dropdown
      const speedBtn = document.getElementById("pp-speed-btn");
      const speedMenu = document.getElementById("pp-speed-menu");
      speedBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        speedMenu.classList.toggle("show");
      });
      speedMenu.querySelectorAll(".pp-dropdown-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          this.setPlaybackSpeed(parseFloat(item.dataset.speed));
          speedMenu.classList.remove("show");
        });
      });

      // Close menus on outside click
      document.addEventListener("click", () => {
        speedMenu.classList.remove("show");
        const qMenu = document.getElementById("pp-quality-menu");
        if (qMenu) qMenu.classList.remove("show");
      });

      // PiP, Shortcuts & Fullscreen
      document.getElementById("pp-ctrl-pip").addEventListener("click", () => {
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(() => {});
        } else if (document.pictureInPictureEnabled) {
          v.requestPictureInPicture().catch(() => {});
        }
      });
      document.getElementById("pp-ctrl-shortcuts").addEventListener("click", () => this.shortcuts.toggleShortcutsModal());
      document.getElementById("pp-shortcuts-close").addEventListener("click", () => this.shortcuts.toggleShortcutsModal(false));
      document.getElementById("pp-ctrl-fullscreen").addEventListener("click", () => this.toggleFullscreen());

      // Video end & error listeners
      v.addEventListener("ended", () => {
        console.log("[PikPak Cinema] 🏁 Video kết thúc! Tự động chuyển tập...");
        if (this.navigationHandlers?.onNext) this.navigationHandlers.onNext();
      });
      v.addEventListener("error", () => {
        console.error(`[PikPak Cinema] ❌ Lỗi video: code=${v.error?.code}`);
        if (this.refreshCallback) this.refreshCallback();
      });
      v.addEventListener("loadedmetadata", () => this.updateProgress());
      v.addEventListener("playing", () => this.updatePlayPauseUI());
    }

    openCinemaModal(streamUrl, options = {}) {
      this.ensureModalDom();

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
              this.changeSource(item.dataset.url);
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

      // Tối ưu hiệu năng: Dập tắt triệt để video gốc ở nền
      document.body.classList.add("pp-cinema-active");
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

      this.modalContainer.classList.add("active");
      this.isModalOpen = true;

      const closeBtn = document.getElementById("pp-close-cinema-btn");
      if (closeBtn) closeBtn.style.display = "inline-flex";

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
      document.body.classList.remove("pp-cinema-active");

      if (this.modalVideo) this.modalVideo.pause();

      const closeBtn = document.getElementById("pp-close-cinema-btn");
      if (closeBtn) closeBtn.style.display = "none";

      this.drawer.toggle(false);

      document.querySelectorAll("video:not(#pikpak-ultra-modal-video)").forEach((v) => {
        try {
          v.style.display = "";
          v.muted = false;
        } catch (_) {}
      });

      console.log("[PikPak Ultra] Cinema Modal Player đã đóng.");
    }

    changeSource(newUrl) {
      if (!this.modalVideo) return;
      const curTime = this.modalVideo.currentTime || 0;
      this.currentStreamUrl = newUrl;
      this.modalVideo.src = newUrl;
      this.modalVideo.currentTime = curTime;
      this.modalVideo.load();
      this.modalVideo.play().catch(() => {});
      this.shortcuts.showHud("Đổi độ phân giải", null);
    }
  }

  root.PikPakPlayer = new VideoStreamController();
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
