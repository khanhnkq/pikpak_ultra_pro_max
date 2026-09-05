/**
 * PikPak Ultra Pro Max - Video Thumbnail Carousel Drawer
 * Single Responsibility: Right Vertical Episode Sidebar UI & Interactions
 */

(function (root) {
  class PlayerDrawerManager {
    constructor(player) {
      this.player = player;
    }

    renderDrawerHtml() {
      const icons = root.PikPakIcons || {};
      return `
        <div class="pp-playlist-drawer" id="pp-playlist-drawer">
          <div class="pp-drawer-header">
            <div class="pp-drawer-title">
              ${icons.playlist || ""}
              <span>Danh sách tập</span>
              <span class="pp-drawer-count" id="pp-drawer-count">1 / 1</span>
            </div>
            <button class="pp-drawer-close" id="pp-drawer-close" title="Đóng (Phím E hoặc Esc)">✕</button>
          </div>

          <div class="pp-drawer-body">
            <div class="pp-drawer-scroll-track" id="pp-drawer-scroll-track"></div>
          </div>
        </div>
      `;
    }

    bindEvents() {
      const playlistBtn = document.getElementById("pp-ctrl-playlist");
      const drawerClose = document.getElementById("pp-drawer-close");

      if (playlistBtn) {
        playlistBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggle();
        });
      }
      if (drawerClose) {
        drawerClose.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggle(false);
        });
      }

      // Đóng danh sách tập khi click ra ngoài (lên video hoặc vùng trống)
      document.addEventListener("click", (e) => {
        const drawer = document.getElementById("pp-playlist-drawer");
        if (!drawer || !drawer.classList.contains("show")) return;
        if (e.target.closest("#pp-playlist-drawer, #pp-ctrl-playlist")) return;
        this.toggle(false);
      });
    }

    scrollToActiveCard(scrollTrack, activeCard, isSmooth = false) {
      if (!scrollTrack || !activeCard) return;
      // Tính toán vị trí cuộn hoàn toàn nội bộ bên trong scrollTrack
      // TUYỆT ĐỐI không gọi scrollIntoView() vì scrollIntoView sẽ làm rung/cuộn cả màn hình window
      const targetTop = activeCard.offsetTop - (scrollTrack.clientHeight / 2) + (activeCard.clientHeight / 2);
      const clampedTop = Math.max(0, targetTop);
      if (isSmooth) {
        scrollTrack.scrollTo({ top: clampedTop, behavior: "smooth" });
      } else {
        scrollTrack.scrollTop = clampedTop;
      }
    }

    render(playlist, currentIndex, onSelect) {
      const scrollTrack = document.getElementById("pp-drawer-scroll-track");
      const drawerCount = document.getElementById("pp-drawer-count");
      const drawer = document.getElementById("pp-playlist-drawer");
      const icons = root.PikPakIcons || {};

      if (!scrollTrack || !playlist || playlist.length === 0) return;

      if (drawerCount) {
        drawerCount.textContent = `${currentIndex + 1} / ${playlist.length}`;
      }

      scrollTrack.innerHTML = playlist
        .map((v, i) => {
          const isCur = i === currentIndex;
          const thumb = v.thumbnailLink || "";
          const isImg = v.type === "image" || v.isImage || /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic)/i.test(v.name || "");
          const typeBadge = isImg ? "Ảnh" : (v.durationText || "Video");
          const fallbackIcon = isImg ? (icons.image || "🖼️") : (icons.play || "▶");
          const sizeStr = v.size > 0 ? `${(v.size / (1024 * 1024)).toFixed(1)} MB` : "";

          return `
            <div class="pp-thumb-card ${isCur ? "active" : ""}" data-index="${i}" title="${v.name || ''}">
              <div class="pp-thumb-media">
                ${thumb ? `<img src="${thumb}" class="pp-thumb-img" loading="lazy" />` : `<div class="pp-thumb-fallback">${fallbackIcon}</div>`}
                <span class="pp-thumb-idx">#${i + 1}</span>
                <span class="pp-thumb-duration">${typeBadge}</span>
                ${isCur ? `<span class="pp-thumb-badge">${isImg ? "Đang xem" : "Đang phát"}</span>` : ""}
              </div>
            </div>
          `;
        })
        .join("");

      scrollTrack.querySelectorAll(".pp-thumb-card").forEach((card) => {
        card.addEventListener("click", () => {
          const idx = parseInt(card.dataset.index, 10);
          if (!isNaN(idx) && onSelect) {
            onSelect(idx);
          }
        });
      });

      const activeCard = scrollTrack.querySelector(".pp-thumb-card.active");
      if (activeCard) {
        if (drawer && drawer.classList.contains("show")) {
          setTimeout(() => this.scrollToActiveCard(scrollTrack, activeCard, true), 50);
        } else {
          this.scrollToActiveCard(scrollTrack, activeCard, false);
        }
      }
    }

    toggle(forceState) {
      const drawer = document.getElementById("pp-playlist-drawer");
      const btn = document.getElementById("pp-ctrl-playlist");
      if (!drawer) return;

      const shouldShow = typeof forceState === "boolean" ? forceState : !drawer.classList.contains("show");

      if (shouldShow) {
        const scrollTrack = document.getElementById("pp-drawer-scroll-track");
        const activeCard = scrollTrack?.querySelector(".pp-thumb-card.active");
        if (activeCard) {
          this.scrollToActiveCard(scrollTrack, activeCard, false);
        }
      }

      drawer.classList.toggle("show", shouldShow);
      if (btn) btn.classList.toggle("active", shouldShow);
    }
  }

  root.PlayerDrawerManager = PlayerDrawerManager;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
