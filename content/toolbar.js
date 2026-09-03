/**
 * PikPak Ultra Pro Max - Floating Navigation Dock Toolbar
 * Single Responsibility: Manages Floating Capsule Toolbar UI and controls
 */

(function (root) {
  class ToolbarManager {
    constructor() {
      this.callbacks = {};
    }

    injectToolbar(callbacks = {}) {
      this.callbacks = callbacks;
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

        <button id="pp-cinema-btn" class="pp-icon-btn" data-tooltip="Rạp Chiếu Video (Tua Full)">
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

        <button id="pp-download-btn" class="pp-icon-btn" data-tooltip="Tải video gốc" style="display: none;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" x2="12" y1="15" y2="3"/>
          </svg>
        </button>

        <button id="pp-close-cinema-btn" class="pp-icon-btn" data-tooltip="Đóng Rạp Chiếu (Phím Esc)" style="display: none;">
          <span style="font-size: 15px; font-weight: 500; line-height: 1;">✕</span>
        </button>
      `;

      document.body.appendChild(toolbar);

      // Event listeners
      document.getElementById("pp-prev-btn")?.addEventListener("click", () => this.callbacks.onPrev?.());
      document.getElementById("pp-next-btn")?.addEventListener("click", () => this.callbacks.onNext?.());
      document.getElementById("pp-cinema-btn")?.addEventListener("click", () => this.callbacks.onCinema?.());
      document.getElementById("pp-download-btn")?.addEventListener("click", () => this.callbacks.onDownload?.());
      document.getElementById("pp-close-cinema-btn")?.addEventListener("click", () => this.callbacks.onCloseCinema?.());

      document.getElementById("pp-file-select")?.addEventListener("change", (e) => {
        this.callbacks.onFileSelect?.(e.target.value);
      });

      document.getElementById("pp-quality-select")?.addEventListener("change", (e) => {
        this.callbacks.onQualitySelect?.(e.target.value);
      });
    }

    updateNavigationControls(playlist, currentIndex) {
      const prevBtn = document.getElementById("pp-prev-btn");
      const nextBtn = document.getElementById("pp-next-btn");
      const fileSelect = document.getElementById("pp-file-select");

      if (playlist && playlist.length > 1) {
        if (prevBtn) {
          prevBtn.disabled = currentIndex <= 0;
          prevBtn.style.display = "inline-flex";
        }
        if (nextBtn) {
          nextBtn.disabled = currentIndex >= playlist.length - 1;
          nextBtn.style.display = "inline-flex";
        }
        if (fileSelect) {
          fileSelect.innerHTML = playlist
            .map((v, i) => `<option value="${v.id}" ${i === currentIndex ? "selected" : ""}>${i + 1}. ${v.name}</option>`)
            .join("");
          fileSelect.style.display = "inline-block";
        }
      } else {
        if (prevBtn) prevBtn.style.display = "none";
        if (nextBtn) nextBtn.style.display = "none";
        if (fileSelect) fileSelect.style.display = "none";
      }
    }

    updateQualities(streams, selectedUrl) {
      const qualitySelect = document.getElementById("pp-quality-select");
      if (qualitySelect && streams && streams.length > 1) {
        qualitySelect.innerHTML = streams
          .map((s) => `<option value="${s.url}" ${s.url === selectedUrl ? "selected" : ""}>${s.quality} (${s.resolution})</option>`)
          .join("");
        qualitySelect.style.display = "inline-block";
      } else if (qualitySelect) {
        qualitySelect.style.display = "none";
      }
    }

    setDownloadVisible(visible) {
      const btn = document.getElementById("pp-download-btn");
      if (btn) btn.style.display = visible ? "inline-flex" : "none";
    }

    setCinemaActive(active) {
      const closeBtn = document.getElementById("pp-close-cinema-btn");
      if (closeBtn) closeBtn.style.display = active ? "inline-flex" : "none";
    }
  }

  root.PikPakToolbar = new ToolbarManager();
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
