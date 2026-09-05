/**
 * PikPak Ultra Pro Max - Seekbar Live Frame Preview Manager
 * Single Responsibility: Synchronizes preview thumbnail video with seekbar hover
 */

(function (root) {
  class PlayerPreviewManager {
    constructor(player) {
      this.player = player;
      this.previewVideo = null;
      this.tooltip = null;
      this.timeLabel = null;
      this.currentStreamUrl = null;
      this.isSeeking = false;
      this.pendingTime = null;
      this.seekThrottleMs = 150;
      this.lastSeekAt = 0;
      this._ready = false;
    }

    init() {
      this.previewVideo = document.getElementById("pp-scrub-preview-video");
      this.tooltip = document.getElementById("pp-scrub-tooltip");
      this.timeLabel = document.getElementById("pp-scrub-preview-time");
      if (!this.previewVideo) return;

      // NOTE: Do NOT set crossOrigin="anonymous" — PikPak stream URLs use
      // auth tokens and don't send CORS headers, so anonymous mode blocks loading.
      this.previewVideo.muted = true;
      this.previewVideo.preload = "auto";

      const onReady = () => {
        this._ready = true;
        if (this.pendingTime !== null) {
          this._doSeek(this.pendingTime);
          this.pendingTime = null;
        }
      };

      this.previewVideo.addEventListener("loadedmetadata", onReady);
      this.previewVideo.addEventListener("canplay", onReady); // fallback for some stream types

      this.previewVideo.addEventListener("seeked", () => {
        // Freeze frame — don't let it play forward
        this.previewVideo.pause();
        this.isSeeking = false;
        if (this.pendingTime !== null) {
          const t = this.pendingTime;
          this.pendingTime = null;
          this._doSeek(t);
        }
      });

      this.previewVideo.addEventListener("error", () => { this._ready = false; });
    }

    setSource(streamUrl) {
      if (!this.previewVideo) this.init();
      if (!this.previewVideo || !streamUrl) return;
      if (this.currentStreamUrl === streamUrl) return;
      this._ready = false;
      this.isSeeking = false;
      this.pendingTime = null;
      this.currentStreamUrl = streamUrl;
      this.previewVideo.muted = true;
      this.previewVideo.src = streamUrl;
      this.previewVideo.load();
    }

    _doSeek(time) {
      if (!this.previewVideo || !isFinite(time)) return;
      try {
        this.isSeeking = true;
        this.previewVideo.currentTime = time;
      } catch (_) {
        this.isSeeking = false;
      }
    }

    updateHover(e, pos, duration) {
      if (!this.tooltip) this.init();
      if (!this.tooltip || !duration) return;

      // Auto-grab source from main player if setSource was not yet called
      if (!this.currentStreamUrl) {
        const src = this.player?.modalVideo?.currentSrc || this.player?.currentStreamUrl;
        if (src) this.setSource(src);
        else return; // no source yet, nothing to show
      }

      const targetTime = Math.max(0, Math.min(duration * 0.9999, pos * duration));
      if (this.timeLabel) this.timeLabel.textContent = this.formatTime(targetTime);

      // Position tooltip with edge-clamping (half of 154px frame = 77px)
      const rect = e.currentTarget.getBoundingClientRect();
      const clampedX = Math.max(82, Math.min(rect.width - 82, e.clientX - rect.left));
      this.tooltip.style.left = `${(clampedX / rect.width) * 100}%`;

      // Throttle seeks to avoid hammering decoder
      const now = Date.now();
      if (now - this.lastSeekAt < this.seekThrottleMs) { this.pendingTime = targetTime; return; }
      this.lastSeekAt = now;

      if (!this._ready) { this.pendingTime = targetTime; return; }
      if (this.isSeeking) { this.pendingTime = targetTime; return; }
      this._doSeek(targetTime);
    }

    show() { if (this.tooltip) this.tooltip.style.opacity = "1"; }
    hide() { if (this.tooltip) this.tooltip.style.opacity = "0"; }

    formatTime(sec) {
      const s = Math.floor(sec || 0);
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), rem = s % 60;
      const p = (n) => String(n).padStart(2, "0");
      return h > 0 ? `${p(h)}:${p(m)}:${p(rem)}` : `${p(m)}:${p(rem)}`;
    }
  }

  root.PlayerPreviewManager = PlayerPreviewManager;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);

