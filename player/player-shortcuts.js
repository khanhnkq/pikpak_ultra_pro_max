/**
 * PikPak Ultra Pro Max - Keyboard Shortcuts & HUD Manager
 * Single Responsibility: Keybindings, HUD feedback & Shortcuts Modal
 */

(function (root) {
  class PlayerShortcutsManager {
    constructor(player) {
      this.player = player;
      this.hudTimeout = null;
      this.initGlobalKeyListeners();
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
          case "k":
          case "K":
            e.preventDefault();
            this.player.togglePlay();
            break;

          case "ArrowLeft":
            e.preventDefault();
            v.currentTime = Math.max(0, v.currentTime - 5);
            this.showHud("-5s", null);
            break;

          case "ArrowRight":
            e.preventDefault();
            v.currentTime = Math.min(dur, v.currentTime + 5);
            this.showHud("+5s", null);
            break;

          case "j":
          case "J":
            e.preventDefault();
            v.currentTime = Math.max(0, v.currentTime - 10);
            this.showHud("-10s", null);
            break;

          case "l":
          case "L":
            e.preventDefault();
            v.currentTime = Math.min(dur, v.currentTime + 10);
            this.showHud("+10s", null);
            break;

          case "ArrowUp":
            e.preventDefault();
            v.volume = Math.min(1, v.volume + 0.1);
            v.muted = false;
            this.player.updateVolumeUI();
            this.showHud(`🔊 ${Math.round(v.volume * 100)}%`, null);
            break;

          case "ArrowDown":
            e.preventDefault();
            v.volume = Math.max(0, v.volume - 0.1);
            if (v.volume === 0) v.muted = true;
            this.player.updateVolumeUI();
            this.showHud(v.muted ? "🔇 Tắt tiếng" : `🔉 ${Math.round(v.volume * 100)}%`, null);
            break;

          case "m":
          case "M":
            e.preventDefault();
            v.muted = !v.muted;
            this.player.updateVolumeUI();
            this.showHud(v.muted ? "🔇 Tắt tiếng" : `🔊 ${Math.round(v.volume * 100)}%`, null);
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
              this.showHud("⏮ Video trước", icons.prev);
              this.player.navigationHandlers.onPrev();
            }
            break;

          case "]":
          case "n":
          case "N":
            e.preventDefault();
            if (this.player.navigationHandlers?.onNext) {
              this.showHud("⏭ Video tiếp", icons.next);
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
              this.showHud(`${Math.round(percent * 100)}%`, null);
            }
            break;
        }

        this.player.resetIdleTimer();
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
