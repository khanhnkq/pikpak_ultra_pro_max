/**
 * PikPak Ultra Pro Max - Dedicated Cinema Player Engine
 * Features:
 * - Apple TV+ / Netflix modern glassmorphic custom player interface
 * - Smooth progress bar with buffer indicator, hover timestamp & seek preview
 * - Auto-hiding control bar & cursor on mouse idle
 * - Comprehensive hotkeys & on-screen HUD feedback
 * - Double-click to seek / fullscreen
 * - Playback speed selector (0.5x - 2.0x)
 * - Volume slider with smooth mute toggle
 * - Picture-in-Picture & Fullscreen
 * - Seamless playlist navigation (Next / Prev / Auto-Next)
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

  const ICONS = {
    play: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>`,
    pause: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`,
    prev: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    next: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    volHigh: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
    volLow: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
    volMute: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" x2="17" y1="9" y2="15"/><line x1="17" x2="23" y1="9" y2="15"/></svg>`,
    pip: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="14" x="3" y="5" rx="2"/><path d="M21 11v6a2 2 0 0 1-2 2h-6"/><rect width="6" height="4" x="12" y="11" rx="1"/></svg>`,
    fullscreen: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><polyline points="21 15 21 21 15 21"/><polyline points="3 9 3 3 9 3"/></svg>`,
    exitFullscreen: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><polyline points="14 20 14 14 20 14"/><polyline points="10 4 10 10 4 10"/></svg>`,
    keyboard: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/></svg>`,
  };

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
      this.hudTimeout = null;
      this.speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
      this.currentSpeedIdx = 2; // default 1.0x

      this.initGlobalKeyListeners();
    }

    setNavigationHandlers(handlers) {
      this.navigationHandlers = handlers;
    }

    showHud(text, iconSvg) {
      const hud = document.getElementById("pp-center-hud");
      const hudText = document.getElementById("pp-center-hud-text");
      const hudIcon = document.getElementById("pp-center-hud-icon");
      if (!hud || !hudText) return;

      hudText.textContent = text;
      if (hudIcon && iconSvg) hudIcon.innerHTML = iconSvg;
      else if (hudIcon) hudIcon.innerHTML = "";

      hud.classList.add("show");
      clearTimeout(this.hudTimeout);
      this.hudTimeout = setTimeout(() => {
        hud.classList.remove("show");
      }, 750);
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
          // Also hide open dropdowns
          document.querySelectorAll(".pp-dropdown-menu").forEach((m) => m.classList.remove("show"));
        }
      }, 2600);
    }

    initGlobalKeyListeners() {
      window.addEventListener("keydown", (e) => {
        if (!this.isModalOpen || !this.modalVideo) return;

        // Ignore typing in input fields
        if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;

        const v = this.modalVideo;
        const dur = v.duration || 0;

        switch (e.key) {
          case "Escape":
            const scModal = document.getElementById("pp-shortcuts-modal");
            if (scModal && scModal.classList.contains("show")) {
              scModal.classList.remove("show");
            } else {
              this.closeCinemaModal();
            }
            break;

          case " ":
          case "k":
          case "K":
            e.preventDefault();
            this.togglePlay();
            break;

          case "ArrowLeft":
          case "j":
          case "J":
            e.preventDefault();
            const seekBack = e.key.toLowerCase() === "j" ? 10 : 5;
            v.currentTime = Math.max(0, v.currentTime - seekBack);
            this.showHud(`-${seekBack}s`, ICONS.prev);
            break;

          case "ArrowRight":
          case "l":
          case "L":
            e.preventDefault();
            const seekFwd = e.key.toLowerCase() === "l" ? 10 : 5;
            v.currentTime = Math.min(dur, v.currentTime + seekFwd);
            this.showHud(`+${seekFwd}s`, ICONS.next);
            break;

          case "ArrowUp":
            e.preventDefault();
            v.volume = Math.min(1, v.volume + 0.1);
            v.muted = false;
            this.updateVolumeUI();
            this.showHud(`${Math.round(v.volume * 100)}%`, ICONS.volHigh);
            break;

          case "ArrowDown":
            e.preventDefault();
            v.volume = Math.max(0, v.volume - 0.1);
            this.updateVolumeUI();
            this.showHud(`${Math.round(v.volume * 100)}%`, v.volume === 0 ? ICONS.volMute : ICONS.volLow);
            break;

          case "m":
          case "M":
            e.preventDefault();
            v.muted = !v.muted;
            this.updateVolumeUI();
            this.showHud(v.muted ? "Tắt tiếng" : "Bật tiếng", v.muted ? ICONS.volMute : ICONS.volHigh);
            break;

          case "f":
          case "F":
            e.preventDefault();
            this.toggleFullscreen();
            break;

          case "n":
          case "N":
          case "]":
            e.preventDefault();
            if (this.navigationHandlers?.onNext) {
              this.showHud("Video tiếp", ICONS.next);
              this.navigationHandlers.onNext();
            }
            break;

          case "p":
          case "P":
          case "[":
            e.preventDefault();
            if (this.navigationHandlers?.onPrev) {
              this.showHud("Video trước", ICONS.prev);
              this.navigationHandlers.onPrev();
            }
            break;

          case ">":
          case ".":
            e.preventDefault();
            this.stepSpeed(1);
            break;

          case "<":
          case ",":
            e.preventDefault();
            this.stepSpeed(-1);
            break;

          case "?":
            e.preventDefault();
            this.toggleShortcutsModal();
            break;

          default:
            // Number keys 0 - 9 seek to 0% - 90%
            if (e.key >= "0" && e.key <= "9") {
              e.preventDefault();
              const percent = parseInt(e.key, 10) * 0.1;
              v.currentTime = dur * percent;
              this.showHud(`${percent * 100}%`, null);
            }
            break;
        }

        this.resetIdleTimer();
      });
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

      this.showHud(`${speed}x Tốc độ`, null);
    }

    togglePlay() {
      if (!this.modalVideo) return;
      if (this.modalVideo.paused) {
        this.modalVideo.play().catch(() => {});
        this.showHud("Phát", ICONS.play);
      } else {
        this.modalVideo.pause();
        this.showHud("Tạm dừng", ICONS.pause);
      }
      this.updatePlayPauseUI();
    }

    updatePlayPauseUI() {
      const btn = document.getElementById("pp-ctrl-play");
      if (!btn || !this.modalVideo) return;
      btn.innerHTML = this.modalVideo.paused ? ICONS.play : ICONS.pause;
    }

    updateVolumeUI() {
      const v = this.modalVideo;
      const volBtn = document.getElementById("pp-ctrl-volume");
      const volSlider = document.getElementById("pp-volume-slider");
      if (!v || !volBtn || !volSlider) return;

      volSlider.value = v.muted ? 0 : v.volume;

      if (v.muted || v.volume === 0) {
        volBtn.innerHTML = ICONS.volMute;
      } else if (v.volume < 0.5) {
        volBtn.innerHTML = ICONS.volLow;
      } else {
        volBtn.innerHTML = ICONS.volHigh;
      }
    }

    toggleFullscreen() {
      const container = document.getElementById("pp-player-container");
      const fsBtn = document.getElementById("pp-ctrl-fullscreen");
      if (!container) return;

      if (!document.fullscreenElement) {
        container.requestFullscreen().catch(() => {});
        if (fsBtn) fsBtn.innerHTML = ICONS.exitFullscreen;
      } else {
        document.exitFullscreen().catch(() => {});
        if (fsBtn) fsBtn.innerHTML = ICONS.fullscreen;
      }
    }

    toggleShortcutsModal() {
      const m = document.getElementById("pp-shortcuts-modal");
      if (m) m.classList.toggle("show");
    }

    ensureModalDom() {
      if (document.getElementById("pikpak-ultra-cinema-modal")) {
        this.modalContainer = document.getElementById("pikpak-ultra-cinema-modal");
        this.modalVideo = document.getElementById("pikpak-ultra-modal-video");
        return;
      }

      const modal = document.createElement("div");
      modal.id = "pikpak-ultra-cinema-modal";

      modal.innerHTML = `
        <div class="pp-player-container" id="pp-player-container">
          <!-- Top info badge -->
          <div class="pp-modal-top-info" id="pp-modal-top-info" style="display: none;">
            <span class="pp-modal-counter" id="pp-modal-counter">1 / 1</span>
            <span class="pp-modal-title" id="pp-modal-filename">Đang tải video...</span>
          </div>

          <!-- Center Feedback HUD -->
          <div class="pp-center-hud" id="pp-center-hud">
            <div id="pp-center-hud-icon"></div>
            <span id="pp-center-hud-text"></span>
          </div>

          <!-- Custom HTML5 Video without native controls -->
          <video 
            id="pikpak-ultra-modal-video" 
            playsinline 
            preload="auto" 
            crossorigin="anonymous"
          ></video>

          <!-- Bottom Controls Overlay Scrim -->
          <div class="pp-player-controls" id="pp-player-controls">
            <!-- Scrubber / Progress Bar -->
            <div class="pp-progress-area" id="pp-progress-area">
              <div class="pp-scrub-tooltip" id="pp-scrub-tooltip">00:00</div>
              <div class="pp-progress-track">
                <div class="pp-progress-buffer" id="pp-progress-buffer"></div>
                <div class="pp-progress-played" id="pp-progress-played">
                  <div class="pp-progress-thumb"></div>
                </div>
              </div>
            </div>

            <!-- Controls Row -->
            <div class="pp-controls-row">
              <!-- Left Group -->
              <div class="pp-controls-group">
                <button id="pp-ctrl-play" class="pp-ctrl-btn" title="Phát / Tạm dừng (Space / K)">
                  ${ICONS.play}
                </button>

                <button id="pp-ctrl-prev" class="pp-ctrl-btn" title="Video trước ([ / P)">
                  ${ICONS.prev}
                </button>

                <button id="pp-ctrl-next" class="pp-ctrl-btn" title="Video tiếp (] / N)">
                  ${ICONS.next}
                </button>

                <!-- Volume Group -->
                <div class="pp-volume-group">
                  <button id="pp-ctrl-volume" class="pp-ctrl-btn" title="Tắt / Bật tiếng (M)">
                    ${ICONS.volHigh}
                  </button>
                  <div class="pp-volume-slider-wrap">
                    <input type="range" id="pp-volume-slider" class="pp-volume-slider" min="0" max="1" step="0.05" value="1">
                  </div>
                </div>

                <!-- Time Display -->
                <div class="pp-time-display">
                  <span class="pp-time-current" id="pp-time-current">00:00</span>
                  <span>/</span>
                  <span class="pp-time-total" id="pp-time-total">00:00</span>
                </div>
              </div>

              <!-- Right Group -->
              <div class="pp-controls-group">
                <!-- Speed Menu -->
                <div class="pp-menu-wrap">
                  <button id="pp-speed-btn" class="pp-menu-btn" title="Tốc độ phát">
                    <span id="pp-speed-label">1.0x</span>
                  </button>
                  <div class="pp-dropdown-menu" id="pp-speed-menu">
                    <div class="pp-dropdown-item" data-speed="0.5">0.5x</div>
                    <div class="pp-dropdown-item" data-speed="0.75">0.75x</div>
                    <div class="pp-dropdown-item active" data-speed="1.0">1.0x (Chuẩn)</div>
                    <div class="pp-dropdown-item" data-speed="1.25">1.25x</div>
                    <div class="pp-dropdown-item" data-speed="1.5">1.5x</div>
                    <div class="pp-dropdown-item" data-speed="2.0">2.0x</div>
                  </div>
                </div>

                <!-- Quality Menu -->
                <div class="pp-menu-wrap" id="pp-quality-wrap" style="display: none;">
                  <button id="pp-quality-btn" class="pp-menu-btn" title="Chất lượng">
                    <span id="pp-quality-label">1080P</span>
                  </button>
                  <div class="pp-dropdown-menu" id="pp-quality-menu"></div>
                </div>

                <!-- PiP Button -->
                <button id="pp-ctrl-pip" class="pp-ctrl-btn" title="Hình trong hình (PiP)">
                  ${ICONS.pip}
                </button>

                <!-- Shortcuts Cheat Sheet Button -->
                <button id="pp-ctrl-shortcuts" class="pp-ctrl-btn" title="Danh sách phím tắt (?)">
                  ${ICONS.keyboard}
                </button>

                <!-- Fullscreen Button -->
                <button id="pp-ctrl-fullscreen" class="pp-ctrl-btn" title="Toàn màn hình (F)">
                  ${ICONS.fullscreen}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Keyboard Shortcuts Modal -->
        <div id="pp-shortcuts-modal">
          <div class="pp-shortcuts-dialog">
            <div class="pp-shortcuts-header">
              <h3>
                ${ICONS.keyboard}
                Phím tắt Rạp Chiếu Ultra
              </h3>
              <button id="pp-shortcuts-close" class="pp-ctrl-btn">✕</button>
            </div>
            <div class="pp-shortcuts-list">
              <div class="pp-shortcut-row"><span>Phát / Tạm dừng</span><kbd>Space / K</kbd></div>
              <div class="pp-shortcut-row"><span>Tua lùi 5s / 10s</span><kbd>← / J</kbd></div>
              <div class="pp-shortcut-row"><span>Tua tới 5s / 10s</span><kbd>→ / L</kbd></div>
              <div class="pp-shortcut-row"><span>Tăng âm lượng 10%</span><kbd>↑</kbd></div>
              <div class="pp-shortcut-row"><span>Giảm âm lượng 10%</span><kbd>↓</kbd></div>
              <div class="pp-shortcut-row"><span>Tắt / Bật tiếng</span><kbd>M</kbd></div>
              <div class="pp-shortcut-row"><span>Toàn màn hình</span><kbd>F</kbd></div>
              <div class="pp-shortcut-row"><span>Video tiếp theo</span><kbd>] / N</kbd></div>
              <div class="pp-shortcut-row"><span>Video trước</span><kbd>[ / P</kbd></div>
              <div class="pp-shortcut-row"><span>Tăng / Giảm tốc độ</span><kbd>&gt; / &lt;</kbd></div>
              <div class="pp-shortcut-row"><span>Tua nhanh 0% - 90%</span><kbd>0 - 9</kbd></div>
              <div class="pp-shortcut-row"><span>Bật / Tắt phím tắt</span><kbd>?</kbd></div>
              <div class="pp-shortcut-row"><span>Đóng Rạp Chiếu</span><kbd>Esc</kbd></div>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      this.modalContainer = modal;
      this.modalVideo = modal.querySelector("#pikpak-ultra-modal-video");
      this.initPlayerEventBindings();
    }

    initPlayerEventBindings() {
      const v = this.modalVideo;
      const container = document.getElementById("pp-player-container");
      const progressArea = document.getElementById("pp-progress-area");
      const playedBar = document.getElementById("pp-progress-played");
      const bufferBar = document.getElementById("pp-progress-buffer");
      const tooltip = document.getElementById("pp-scrub-tooltip");
      const timeCur = document.getElementById("pp-time-current");
      const timeTotal = document.getElementById("pp-time-total");

      // 1. Idle mouse handler
      container.addEventListener("mousemove", () => this.resetIdleTimer());
      container.addEventListener("click", () => this.resetIdleTimer());

      // 2. Video single click / double click gestures
      let clickTimeout = null;
      v.addEventListener("click", (e) => {
        if (clickTimeout) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
          // Double click gesture
          const rect = v.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const width = rect.width;

          if (clickX < width * 0.3) {
            // Left 30%: seek back 10s
            v.currentTime = Math.max(0, v.currentTime - 10);
            this.showHud("-10s", ICONS.prev);
          } else if (clickX > width * 0.7) {
            // Right 30%: seek fwd 10s
            v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10);
            this.showHud("+10s", ICONS.next);
          } else {
            // Center: toggle fullscreen
            this.toggleFullscreen();
          }
        } else {
          clickTimeout = setTimeout(() => {
            clickTimeout = null;
            this.togglePlay();
          }, 240);
        }
      });

      // 3. Play / Pause button
      document.getElementById("pp-ctrl-play").addEventListener("click", () => this.togglePlay());

      // 4. Video state sync
      v.addEventListener("play", () => this.updatePlayPauseUI());
      v.addEventListener("pause", () => this.updatePlayPauseUI());

      // 5. Time update & scrubber update
      v.addEventListener("timeupdate", () => {
        if (!this.isDraggingProgress && v.duration) {
          const percent = (v.currentTime / v.duration) * 100;
          playedBar.style.width = `${percent}%`;
          timeCur.textContent = formatTime(v.currentTime);
        }
      });

      v.addEventListener("durationchange", () => {
        timeTotal.textContent = formatTime(v.duration);
      });

      // 6. Buffer progress update
      v.addEventListener("progress", () => {
        if (v.duration && v.buffered.length > 0) {
          const bufferedEnd = v.buffered.end(v.buffered.length - 1);
          const percent = (bufferedEnd / v.duration) * 100;
          bufferBar.style.width = `${percent}%`;
        }
      });

      // 7. Scrubber interaction (Click & Drag)
      const updateProgressFromEvent = (e) => {
        const rect = progressArea.getBoundingClientRect();
        const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const percent = offsetX / rect.width;
        playedBar.style.width = `${percent * 100}%`;
        timeCur.textContent = formatTime((v.duration || 0) * percent);
        return percent;
      };

      progressArea.addEventListener("mousedown", (e) => {
        this.isDraggingProgress = true;
        this.wasPlayingBeforeDrag = !v.paused;
        if (this.wasPlayingBeforeDrag) v.pause();
        progressArea.classList.add("dragging");

        const percent = updateProgressFromEvent(e);
        if (v.duration) v.currentTime = v.duration * percent;
      });

      window.addEventListener("mousemove", (e) => {
        if (this.isDraggingProgress) {
          const percent = updateProgressFromEvent(e);
          if (v.duration) v.currentTime = v.duration * percent;
        }

        // Update hover tooltip
        if (progressArea.matches(":hover")) {
          const rect = progressArea.getBoundingClientRect();
          const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
          const percent = offsetX / rect.width;
          const time = (v.duration || 0) * percent;
          tooltip.textContent = formatTime(time);
          tooltip.style.left = `${offsetX}px`;
        }
      });

      window.addEventListener("mouseup", () => {
        if (this.isDraggingProgress) {
          this.isDraggingProgress = false;
          progressArea.classList.remove("dragging");
          if (this.wasPlayingBeforeDrag) v.play().catch(() => {});
        }
      });

      // 8. Prev & Next buttons
      document.getElementById("pp-ctrl-prev").addEventListener("click", () => {
        if (this.navigationHandlers?.onPrev) this.navigationHandlers.onPrev();
      });

      document.getElementById("pp-ctrl-next").addEventListener("click", () => {
        if (this.navigationHandlers?.onNext) this.navigationHandlers.onNext();
      });

      // 9. Volume controls
      const volBtn = document.getElementById("pp-ctrl-volume");
      const volSlider = document.getElementById("pp-volume-slider");

      volBtn.addEventListener("click", () => {
        v.muted = !v.muted;
        this.updateVolumeUI();
      });

      volSlider.addEventListener("input", (e) => {
        v.volume = parseFloat(e.target.value);
        v.muted = false;
        this.updateVolumeUI();
      });

      // 10. Speed menu
      const speedBtn = document.getElementById("pp-speed-btn");
      const speedMenu = document.getElementById("pp-speed-menu");

      speedBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        speedMenu.classList.toggle("show");
      });

      speedMenu.querySelectorAll(".pp-dropdown-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          const speed = parseFloat(item.dataset.speed);
          this.setPlaybackSpeed(speed);
          speedMenu.classList.remove("show");
        });
      });

      // Close dropdowns on outside click
      document.addEventListener("click", () => {
        speedMenu.classList.remove("show");
        const qMenu = document.getElementById("pp-quality-menu");
        if (qMenu) qMenu.classList.remove("show");
      });

      // 11. PiP button
      document.getElementById("pp-ctrl-pip").addEventListener("click", () => {
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(() => {});
        } else if (document.pictureInPictureEnabled) {
          v.requestPictureInPicture().catch(() => {});
        }
      });

      // 12. Shortcuts guide modal
      document.getElementById("pp-ctrl-shortcuts").addEventListener("click", () => this.toggleShortcutsModal());
      document.getElementById("pp-shortcuts-close").addEventListener("click", () => this.toggleShortcutsModal());

      // 13. Fullscreen button
      document.getElementById("pp-ctrl-fullscreen").addEventListener("click", () => this.toggleFullscreen());

      // 14. Auto-advance to next video on end
      v.addEventListener("ended", () => {
        console.log("[PikPak Cinema] 🏁 Video kết thúc! Tự động chuyển sang video tiếp theo...");
        if (this.navigationHandlers?.onNext) {
          this.navigationHandlers.onNext();
        }
      });

      // 15. Error recovery
      v.addEventListener("error", () => {
        console.warn("[PikPak Cinema] Video error encountered:", v.error);
        if (this.refreshCallback) this.refreshCallback();
      });
    }

    /**
     * Opens the dedicated Fullscreen Cinema Modal Video Player
     */
    openCinemaModal(streamUrl, options = {}) {
      this.ensureModalDom();

      this.currentStreamUrl = streamUrl;
      this.currentOptions = options;
      this.refreshCallback = options.onRefreshRequest || null;

      // Update top info title & counter badge
      const topInfo = document.getElementById("pp-modal-top-info");
      const titleEl = document.getElementById("pp-modal-filename");
      const counterEl = document.getElementById("pp-modal-counter");

      if (titleEl) {
        titleEl.textContent = options.fileName || "PikPak Video Stream";
      }

      if (options.playlist && options.playlist.length > 0) {
        const total = options.playlist.length;
        const curIdx = options.currentIndex >= 0 ? options.currentIndex : 0;
        if (counterEl) {
          counterEl.textContent = `${curIdx + 1} / ${total}`;
          counterEl.style.display = "inline-flex";
        }

        const prevBtn = document.getElementById("pp-ctrl-prev");
        const nextBtn = document.getElementById("pp-ctrl-next");
        if (prevBtn) prevBtn.style.opacity = curIdx <= 0 ? "0.3" : "1";
        if (nextBtn) nextBtn.style.opacity = curIdx >= total - 1 ? "0.3" : "1";
      } else {
        if (counterEl) counterEl.style.display = "none";
      }

      if (topInfo) topInfo.style.display = "flex";

      // Populate Qualities menu if multiple streams
      const qualityWrap = document.getElementById("pp-quality-wrap");
      const qualityMenu = document.getElementById("pp-quality-menu");
      const qualityLabel = document.getElementById("pp-quality-label");

      if (qualityWrap && qualityMenu && options.streams && options.streams.length > 1) {
        qualityWrap.style.display = "block";
        const currentQuality = options.streams.find((s) => s.url === streamUrl)?.quality || "1080P";
        if (qualityLabel) qualityLabel.textContent = currentQuality;

        qualityMenu.innerHTML = options.streams
          .map(
            (s) =>
              `<div class="pp-dropdown-item ${s.url === streamUrl ? "active" : ""}" data-url="${s.url}">${s.quality} (${s.resolution})</div>`
          )
          .join("");

        qualityMenu.querySelectorAll(".pp-dropdown-item").forEach((item) => {
          item.addEventListener("click", (e) => {
            e.stopPropagation();
            const newUrl = item.dataset.url;
            if (newUrl) {
              this.changeSource(newUrl);
              qualityMenu.classList.remove("show");
              if (qualityLabel) qualityLabel.textContent = item.textContent.split(" ")[0];
            }
          });
        });

        const qualityBtn = document.getElementById("pp-quality-btn");
        qualityBtn.onclick = (e) => {
          e.stopPropagation();
          qualityMenu.classList.toggle("show");
        };
      } else if (qualityWrap) {
        qualityWrap.style.display = "none";
      }

      // 1. Tối ưu hiệu năng: Tắt & giải phóng GPU/RAM/Network của video nền PikPak
      document.body.classList.add("pp-cinema-active");

      document.querySelectorAll("video:not(#pikpak-ultra-modal-video)").forEach((v) => {
        try {
          v.pause();
          v.muted = true;
          if (v.srcObject) v.srcObject = null;
          v.removeAttribute("src");
          v.load();
          v.style.display = "none";
          v.style.visibility = "hidden";
        } catch (_) {}
      });

      // 2. Mount stream to modal video
      this.modalVideo.pause();
      this.modalVideo.removeAttribute("src");
      this.modalVideo.src = streamUrl;
      this.modalVideo.currentTime = 0;

      // 3. Show modal
      this.modalContainer.classList.add("active");
      this.isModalOpen = true;

      // Show close button on floating dock
      const closeBtn = document.getElementById("pp-close-cinema-btn");
      if (closeBtn) closeBtn.style.display = "inline-flex";

      this.modalVideo.play().catch(() => {
        this.modalVideo.muted = true;
        this.modalVideo.play().catch(() => {});
      });

      this.resetIdleTimer();
      console.log("%c[PikPak Ultra] 🎬 Cinema Player Engine hoàn thiện! Giao diện chuẩn Apple TV+ / Netflix.", "color: #38bdf8; font-weight: bold;");
    }

    closeCinemaModal() {
      if (!this.modalContainer) return;
      this.modalContainer.classList.remove("active");
      this.isModalOpen = false;
      document.body.classList.remove("pp-cinema-active");

      if (this.modalVideo) {
        this.modalVideo.pause();
      }

      // Hide close button on floating dock
      const closeBtn = document.getElementById("pp-close-cinema-btn");
      if (closeBtn) closeBtn.style.display = "none";

      console.log("[PikPak Ultra] Cinema Modal Player đã đóng.");
    }

    changeSource(newUrl) {
      if (!this.modalVideo) return;
      const curTime = this.modalVideo.currentTime || 0;
      this.currentStreamUrl = newUrl;
      this.modalVideo.src = newUrl;
      this.modalVideo.currentTime = curTime;
      this.modalVideo.play().catch(() => {});
      this.showHud("Đổi độ phân giải", null);
    }

    mount(targetVideo, streamUrl, options = {}) {
      this.openCinemaModal(streamUrl, options);
      return this.modalVideo;
    }
  }

  root.PikPakPlayer = new VideoStreamController();
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
