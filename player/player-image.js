/**
 * PikPak Ultra Pro Max - Dedicated Image Viewer Engine (SOLID Architecture)
 * Single Responsibility: High-resolution image rendering, Pan/Zoom/Rotate gestures & controls
 */

(function (root) {
  class PlayerImageViewerManager {
    constructor(player) {
      this.player = player;
      this.stageEl = null;
      this.canvasWrap = null;
      this.imgEl = null;
      this.zoomBadge = null;
      this.dimBadge = null;

      // Transformation state
      this.scale = 1.0;
      this.translateX = 0;
      this.translateY = 0;
      this.rotation = 0;

      // Mouse drag pan state
      this.isDragging = false;
      this.dragStartX = 0;
      this.dragStartY = 0;
      this.initialTranslateX = 0;
      this.initialTranslateY = 0;

      this.currentImageUrl = null;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.isInitialized = false;
    }

    init() {
      if (this.isInitialized) return;
      this.stageEl = document.getElementById("pp-modal-image-stage");
      this.canvasWrap = document.getElementById("pp-image-canvas-wrap");
      this.imgEl = document.getElementById("pikpak-ultra-modal-image");
      this.zoomBadge = document.getElementById("pp-img-zoom-badge");
      this.dimBadge = document.getElementById("pp-img-dimensions");

      if (!this.imgEl || !this.stageEl) return;

      this.bindGestureEvents();
      this.bindControlEvents();
      this.isInitialized = true;
    }

    bindGestureEvents() {
      const img = this.imgEl;
      const wrap = this.canvasWrap || this.stageEl;

      // Mouse Wheel Zoom (centered at mouse cursor)
      wrap.addEventListener("wheel", (e) => {
        if (!this.player.isModalOpen || !this.player.isImageMode) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.18 : -0.18;
        const rect = img.getBoundingClientRect();
        const focalX = e.clientX - (rect.left + rect.width / 2);
        const focalY = e.clientY - (rect.top + rect.height / 2);
        this.zoom(delta, focalX, focalY);
      }, { passive: false });

      // Drag to Pan
      img.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || this.scale <= 1.02) return;
        e.preventDefault();
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.initialTranslateX = this.translateX;
        this.initialTranslateY = this.translateY;
        img.classList.add("is-dragging");

        const onMouseMove = (moveEv) => {
          if (!this.isDragging) return;
          this.translateX = this.initialTranslateX + (moveEv.clientX - this.dragStartX);
          this.translateY = this.initialTranslateY + (moveEv.clientY - this.dragStartY);
          this.applyTransform(false);
        };

        const onMouseUp = () => {
          this.isDragging = false;
          img.classList.remove("is-dragging");
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      });

      // Double-click toggle (Fit vs 200%)
      img.addEventListener("dblclick", (e) => {
        e.preventDefault();
        if (this.scale > 1.05) {
          this.resetZoom();
        } else {
          const rect = img.getBoundingClientRect();
          const focalX = e.clientX - (rect.left + rect.width / 2);
          const focalY = e.clientY - (rect.top + rect.height / 2);
          this.setScale(2.0, focalX, focalY);
        }
      });
    }

    bindControlEvents() {
      document.getElementById("pp-img-zoom-in")?.addEventListener("click", () => this.zoom(0.25));
      document.getElementById("pp-img-zoom-out")?.addEventListener("click", () => this.zoom(-0.25));
      document.getElementById("pp-img-zoom-badge")?.addEventListener("click", () => this.toggleFitOrActual());
      document.getElementById("pp-img-rotate")?.addEventListener("click", () => this.rotate(90));
    }

    loadImage(imageUrl, meta = {}) {
      this.init();
      this.currentImageUrl = imageUrl;
      this.resetTransform();

      const spinner = document.getElementById("pp-cinema-spinner");
      const spinnerText = document.getElementById("pp-spinner-text");
      if (spinnerText) spinnerText.textContent = meta.fileName ? `Đang mở: ${meta.fileName}` : "Đang nạp hình ảnh...";
      if (spinner) spinner.classList.add("show");

      if (this.dimBadge) this.dimBadge.style.display = "none";

      this.imgEl.onload = () => {
        if (spinner) spinner.classList.remove("show");
        this.naturalWidth = this.imgEl.naturalWidth || 0;
        this.naturalHeight = this.imgEl.naturalHeight || 0;
        if (this.dimBadge && this.naturalWidth && this.naturalHeight) {
          this.dimBadge.textContent = `${this.naturalWidth} × ${this.naturalHeight}`;
          this.dimBadge.style.display = "inline-flex";
        }
        this.resetTransform();
        console.log(`[PikPak Image] ✅ Ảnh đã tải: ${this.naturalWidth}x${this.naturalHeight}`);
      };

      this.imgEl.onerror = () => {
        if (spinner) spinner.classList.remove("show");
        this.player.shortcuts?.showHud("Lỗi nạp hình ảnh", null);
        console.error(`[PikPak Image] ❌ Không thể tải ảnh: ${imageUrl}`);
      };

      this.imgEl.src = imageUrl;
    }

    zoom(delta, focalX = 0, focalY = 0) {
      const oldScale = this.scale;
      const newScale = Math.max(0.3, Math.min(6.0, oldScale + delta));
      this.setScale(newScale, focalX, focalY);
    }

    setScale(newScale, focalX = 0, focalY = 0) {
      const oldScale = this.scale;
      if (newScale === oldScale) return;

      if (focalX !== 0 || focalY !== 0) {
        const ratio = newScale / oldScale;
        this.translateX -= focalX * (ratio - 1);
        this.translateY -= focalY * (ratio - 1);
      }

      this.scale = newScale;
      if (this.scale <= 1.02) {
        this.translateX = 0;
        this.translateY = 0;
      }

      this.applyTransform(true);
      const percent = Math.round(this.scale * 100);
      const icons = root.PikPakIcons || {};
      this.player.shortcuts?.showHud(`${percent}%`, icons.zoomIn);
    }

    toggleFitOrActual() {
      if (Math.abs(this.scale - 1.0) < 0.05) {
        this.setScale(2.0);
      } else {
        this.resetZoom();
      }
    }

    resetZoom() {
      this.scale = 1.0;
      this.translateX = 0;
      this.translateY = 0;
      this.applyTransform(true);
      const icons = root.PikPakIcons || {};
      this.player.shortcuts?.showHud("Vừa màn hình (Fit)", icons.zoomReset);
    }

    rotate(deg = 90) {
      this.rotation = (this.rotation + deg) % 360;
      this.applyTransform(true);
      const icons = root.PikPakIcons || {};
      this.player.shortcuts?.showHud(`${this.rotation}°`, icons.rotate);
    }

    resetTransform() {
      this.scale = 1.0;
      this.translateX = 0;
      this.translateY = 0;
      this.rotation = 0;
      this.applyTransform(false);
    }

    applyTransform(animate = true) {
      if (!this.imgEl) return;
      this.imgEl.style.transition = animate ? "transform 0.14s cubic-bezier(0.16, 1, 0.3, 1)" : "none";
      this.imgEl.style.transform = `translate3d(${this.translateX}px, ${this.translateY}px, 0) scale(${this.scale}) rotate(${this.rotation}deg)`;
      this.imgEl.classList.toggle("is-zoomed", this.scale > 1.05);

      if (this.zoomBadge) {
        this.zoomBadge.textContent = Math.abs(this.scale - 1.0) < 0.05 ? "Fit" : `${Math.round(this.scale * 100)}%`;
      }
    }

    destroy() {
      if (this.imgEl) {
        this.imgEl.removeAttribute("src");
        this.imgEl.onload = null;
        this.imgEl.onerror = null;
      }
      this.currentImageUrl = null;
      this.resetTransform();
    }
  }

  root.PlayerImageViewerManager = PlayerImageViewerManager;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
