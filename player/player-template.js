/**
 * PikPak Ultra Pro Max - Player DOM Template Builder
 * Single Responsibility: Generates Cinema Modal HTML structures
 */

(function (root) {
  function renderPlayerModalHtml(drawerHtml, shortcutsModalHtml) {
    const icons = root.PikPakIcons || {};
    return `
      <div class="pp-player-container" id="pp-player-container">
        <!-- Top info badge -->
        <div class="pp-modal-top-info" id="pp-modal-top-info" style="display: none;">
          <span class="pp-modal-counter" id="pp-modal-counter">1 / 1</span>
          <span class="pp-modal-title" id="pp-modal-filename">Đang tải video...</span>
        </div>

        <!-- Top Right Action Group: Download & Close -->
        <div class="pp-modal-top-actions" id="pp-modal-top-actions">
          <button id="pp-cinema-download-btn" class="pp-top-btn" title="Tải video gốc (Download)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" x2="12" y1="15" y2="3"/>
            </svg>
          </button>
          <button id="pp-cinema-close-btn" class="pp-top-btn" title="Đóng Rạp Chiếu (Phím Esc)">
            <span style="font-size: 16px; font-weight: 500; line-height: 1;">✕</span>
          </button>
        </div>

        <!-- 2X Speed Boost HUD Banner -->
        <div class="pp-center-hud" id="pp-speed-boost-banner">
        <span class="pp-center-hud-text" id="pp-speed-boost-text">2x</span>
          <span class="pp-boost-arrows">${icons.forward || ""}</span>
        </div>

        <!-- Center Feedback HUD -->
        <div class="pp-center-hud" id="pp-center-hud">
          <div id="pp-center-hud-icon"></div>
          <span id="pp-center-hud-text"></span>
        </div>

        <!-- Center Loading Spinner -->
        <div class="pp-cinema-spinner" id="pp-cinema-spinner">
          <div class="pp-spinner-ring"></div>
          <span class="pp-spinner-text" id="pp-spinner-text">Đang tải video...</span>
        </div>

        <!-- Custom HTML5 Video without native controls -->
        <video id="pikpak-ultra-modal-video" playsinline preload="auto"></video>

        <!-- Bottom Video Thumbnail Carousel Drawer -->
        ${drawerHtml}

        <!-- Bottom Controls Overlay Scrim -->
        <div class="pp-player-controls" id="pp-player-controls">
          <!-- Scrubber / Progress Bar -->
          <div class="pp-progress-area" id="pp-progress-area">
            <div class="pp-scrub-tooltip" id="pp-scrub-tooltip">
              <div class="pp-scrub-preview-frame">
                <video id="pp-scrub-preview-video" class="pp-scrub-preview-video" muted playsinline preload="auto"></video>
              </div>
              <div class="pp-scrub-preview-time" id="pp-scrub-preview-time">00:00</div>
            </div>
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
                ${icons.play || ""}
              </button>
              <button id="pp-ctrl-prev" class="pp-ctrl-btn" title="Video trước ([ / P)">
                ${icons.prev || ""}
              </button>
              <button id="pp-ctrl-next" class="pp-ctrl-btn" title="Video tiếp (] / N)">
                ${icons.next || ""}
              </button>

              <!-- Volume Group -->
              <div class="pp-volume-group">
                <button id="pp-ctrl-volume" class="pp-ctrl-btn" title="Tắt / Bật tiếng (M)">
                  ${icons.volHigh || ""}
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
              <button id="pp-ctrl-playlist" class="pp-ctrl-btn" title="Danh sách tập (Phím E)">
                ${icons.playlist || ""}
              </button>

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

              <button id="pp-ctrl-pip" class="pp-ctrl-btn" title="Hình trong hình (PiP)">
                ${icons.pip || ""}
              </button>
              <button id="pp-ctrl-shortcuts" class="pp-ctrl-btn" title="Danh sách phím tắt (?)">
                ${icons.keyboard || ""}
              </button>
              <button id="pp-ctrl-fullscreen" class="pp-ctrl-btn" title="Toàn màn hình (F)">
                ${icons.fullscreen || ""}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Shortcuts Modal -->
      ${shortcutsModalHtml}
    `;
  }

  root.PikPakPlayerTemplate = {
    renderPlayerModalHtml,
  };
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof self !== "undefined"
      ? self
      : window,
);
