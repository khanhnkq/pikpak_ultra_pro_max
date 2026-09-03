/**
 * PikPak Ultra Pro Max - Keyboard Shortcuts & HUD Manager
 * Single Responsibility: Keybindings, HUD feedback & Shortcuts Modal
 */

(function (root) {
  class PlayerShortcutsManager {
    constructor(player) {
      this.player = player;
      this.hudTimeout = null;
      this.isSpeedBoosting = false;
      this.originalPlaybackRate = 1.0;
      this.spaceHoldTimer = null;
      this.rightArrowHoldTimer = null;
      this.mouseHoldTimer = null;
      this.initGlobalKeyListeners();
      this.initMouseListeners();
    }

    enableSpeedBoost() {
      if (this.isSpeedBoosting) return;
      const v = this.player.modalVideo;
      if (!v) return;
      this.isSpeedBoosting = true;
      this.originalPlaybackRate = v.playbackRate || 1.0;
      v.playbackRate = 2.0;
      const banner = document.getElementById("pp-speed-boost-banner");
      if (banner) banner.classList.add("show");
    }

    disableSpeedBoost() {
      if (!this.isSpeedBoosting) return;
      this.isSpeedBoosting = false;
      const v = this.player.modalVideo;
      if (v) v.playbackRate = this.originalPlaybackRate || 1.0;
      const banner = document.getElementById("pp-speed-boost-banner");
      if (banner) banner.classList.remove("show");
    }

    showHud(text, iconSvg) {
      const hud = document.getElementById("pp-center-hud");
      const hudText = document.getElementById("pp-center-hud-text");
      const hudIcon = document.getElementById("pp-center-hud-icon");
      if (!hud || !hudText) return;

      hudText.textContent = text;
      if (hudIcon) {
        if (iconSvg) {
          hudIcon.innerHTML = iconSvg;
          hudIcon.style.display = "inline-flex";
        } else {
          hudIcon.innerHTML = "";
          hudIcon.style.display = "none";
        }
      }

      hud.classList.add("show");
      clearTimeout(this.hudTimeout);
      this.hudTimeout = setTimeout(() => {
        hud.classList.remove("show");
      }, 750);
    }

    toggleShortcutsModal(forceState) {
      const m = document.getElementById("pp-shortcuts-modal");
      if (!m) return;
      if (typeof forceState === "boolean") {
        m.classList.toggle("show", forceState);
      } else {
        m.classList.toggle("show");
      }
    }

    initGlobalKeyListeners() {
      window.addEventListener("keydown", (e) => {
        if (!this.player.isModalOpen || !this.player.modalVideo) return;

        // Ignore typing in input fields
        if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;

        const v = this.player.modalVideo;
        const dur = v.duration || 0;
        const icons = root.PikPakIcons || {};

        switch (e.key) {
          case "Escape":
            const scModal = document.getElementById("pp-shortcuts-modal");
            const drawer = document.getElementById("pp-playlist-drawer");
            if (scModal && scModal.classList.contains("show")) {
              scModal.classList.remove("show");
            } else if (drawer && drawer.classList.contains("show")) {
              this.player.drawer?.toggle(false);
            } else {
              this.player.closeCinemaModal();
            }
            break;

          case " ":
            e.preventDefault();
            if (e.repeat) {
              this.enableSpeedBoost();
              return;
            }
            clearTimeout(this.spaceHoldTimer);
            this.spaceHoldTimer = setTimeout(() => {
              this.enableSpeedBoost();
            }, 250);
            break;

          case "k":
          case "K":
            e.preventDefault();
            this.player.togglePlay();
            break;

          case "ArrowLeft":
            e.preventDefault();
            v.currentTime = Math.max(0, v.currentTime - 5);
            this.showHud("5s", icons.backward);
            break;

          case "ArrowRight":
            e.preventDefault();
            if (e.repeat) {
              this.enableSpeedBoost();
              return;
            }
            v.currentTime = Math.min(dur, v.currentTime + 5);
            this.showHud("5s", icons.forward);
            clearTimeout(this.rightArrowHoldTimer);
            this.rightArrowHoldTimer = setTimeout(() => {
              this.enableSpeedBoost();
            }, 250);
            break;

          case "j":
          case "J":
            e.preventDefault();
            v.currentTime = Math.max(0, v.currentTime - 10);
            this.showHud("10s", icons.backward);
            break;

          case "l":
          case "L":
            e.preventDefault();
            v.currentTime = Math.min(dur, v.currentTime + 10);
            this.showHud("10s", icons.forward);
            break;

          case "ArrowUp":
            e.preventDefault();
            v.volume = Math.min(1, v.volume + 0.1);
            v.muted = false;
            this.player.updateVolumeUI();
            this.showHud(`${Math.round(v.volume * 100)}%`, icons.volHigh);
            break;

          case "ArrowDown":
            e.preventDefault();
            v.volume = Math.max(0, v.volume - 0.1);
            if (v.volume === 0) v.muted = true;
            this.player.updateVolumeUI();
            this.showHud(v.muted ? "Tắt tiếng" : `${Math.round(v.volume * 100)}%`, v.muted ? icons.volMute : (v.volume < 0.3 ? icons.volLow : icons.volHigh));
            break;

          case "m":
          case "M":
            e.preventDefault();
            v.muted = !v.muted;
            this.player.updateVolumeUI();
            this.showHud(v.muted ? "Tắt tiếng" : `${Math.round(v.volume * 100)}%`, v.muted ? icons.volMute : icons.volHigh);
            break;

          case "f":
          case "F":
            e.preventDefault();
            this.player.toggleFullscreen();
            break;

          case "[":
          case "p":
          case "P":
            e.preventDefault();
            if (this.player.navigationHandlers?.onPrev) {
              this.showHud("Tập trước", icons.prev);
              this.player.navigationHandlers.onPrev();
            }
            break;

          case "]":
          case "n":
          case "N":
            e.preventDefault();
            if (this.player.navigationHandlers?.onNext) {
              this.showHud("Tập tiếp", icons.next);
              this.player.navigationHandlers.onNext();
            }
            break;

          case ">":
          case ".":
            e.preventDefault();
            this.player.stepSpeed(1);
            break;

          case "<":
          case ",":
            e.preventDefault();
            this.player.stepSpeed(-1);
            break;

          case "?":
            e.preventDefault();
            this.toggleShortcutsModal();
            break;

          case "e":
          case "E":
            e.preventDefault();
            if (this.player.drawer) {
              this.player.drawer.toggle();
            }
            break;

          default:
            // Number keys 0 - 9 seek to 0% - 90%
            if (e.key >= "0" && e.key <= "9") {
              e.preventDefault();
              const percent = parseInt(e.key, 10) * 0.1;
              v.currentTime = dur * percent;
              this.showHud(`${Math.round(percent * 100)}%`, icons.seek);
            }
            break;
        }

        this.player.resetIdleTimer();
      });

      window.addEventListener("keyup", (e) => {
        if (!this.player.isModalOpen || !this.player.modalVideo) return;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;

        if (e.key === " ") {
          clearTimeout(this.spaceHoldTimer);
          if (this.isSpeedBoosting) {
            this.disableSpeedBoost();
          } else {
            this.player.togglePlay();
          }
        } else if (e.key === "ArrowRight") {
          clearTimeout(this.rightArrowHoldTimer);
          if (this.isSpeedBoosting) {
            this.disableSpeedBoost();
          }
        }
      });
    }

    initMouseListeners() {
      window.addEventListener("mousedown", (e) => {
        if (!this.player.isModalOpen || e.button !== 0) return;
        if (e.target.closest("#pp-player-controls, .pp-top-btn, .pp-playlist-drawer, .pp-shortcuts-modal, input")) return;
        const video = this.player.modalVideo;
        if (!video || (e.target !== video && !e.target.closest("#pp-video-container"))) return;
        clearTimeout(this.mouseHoldTimer);
        this.mouseHoldTimer = setTimeout(() => {
          this.enableSpeedBoost();
        }, 300);
      });

      window.addEventListener("mouseup", () => {
        clearTimeout(this.mouseHoldTimer);
        if (this.isSpeedBoosting) {
          this.disableSpeedBoost();
        }
      });
    }

    renderShortcutsModalHtml() {
      const icons = root.PikPakIcons || {};
      return `
        <div id="pp-shortcuts-modal">
          <div class="pp-shortcuts-dialog">
            <div class="pp-shortcuts-header">
              <h3>
                ${icons.keyboard || ""}
                Phím tắt Rạp Chiếu Ultra
              </h3>
              <button id="pp-shortcuts-close" class="pp-ctrl-btn">✕</button>
            </div>
            <div class="pp-shortcuts-list">
              <div class="pp-shortcut-row"><span>Phát / Tạm dừng</span><kbd>Space / K</kbd></div>
              <div class="pp-shortcut-row"><span>Tăng tốc 2X (Nhấn giữ)</span><kbd>Giữ Space / → / Chuột</kbd></div>
              <div class="pp-shortcut-row"><span>Tua lùi 5s / 10s</span><kbd>← / J</kbd></div>
              <div class="pp-shortcut-row"><span>Tua tới 5s / 10s</span><kbd>→ / L</kbd></div>
              <div class="pp-shortcut-row"><span>Tăng âm lượng 10%</span><kbd>↑</kbd></div>
              <div class="pp-shortcut-row"><span>Giảm âm lượng 10%</span><kbd>↓</kbd></div>
              <div class="pp-shortcut-row"><span>Tắt / Bật tiếng</span><kbd>M</kbd></div>
              <div class="pp-shortcut-row"><span>Toàn màn hình</span><kbd>F</kbd></div>
              <div class="pp-shortcut-row"><span>Bật danh sách tập</span><kbd>E</kbd></div>
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
    }
  }

  root.PlayerShortcutsManager = PlayerShortcutsManager;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
