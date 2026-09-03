/**
 * PikPak Ultra Pro Max - Video Thumbnail Carousel Drawer
 * Single Responsibility: Bottom Playlist Carousel Drawer UI & Interactions
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
              <span>Danh sách video</span>
              <span class="pp-drawer-count" id="pp-drawer-count">1 / 1</span>
            </div>
            <button class="pp-drawer-close" id="pp-drawer-close" title="Đóng (Phím E hoặc Esc)">✕</button>
          </div>

          <div class="pp-drawer-body">
            <button class="pp-drawer-arrow left" id="pp-drawer-prev-scroll" title="Cuộn lùi">‹</button>
            <div class="pp-drawer-scroll-track" id="pp-drawer-scroll-track"></div>
            <button class="pp-drawer-arrow right" id="pp-drawer-next-scroll" title="Cuộn tới">›</button>
          </div>
        </div>
      `;
    }

    bindEvents() {
      const playlistBtn = document.getElementById("pp-ctrl-playlist");
      const drawerClose = document.getElementById("pp-drawer-close");
      const prevScroll = document.getElementById("pp-drawer-prev-scroll");
      const nextScroll = document.getElementById("pp-drawer-next-scroll");
      const scrollTrack = document.getElementById("pp-drawer-scroll-track");

      if (playlistBtn) {
        playlistBtn.addEventListener("click", () => this.toggle());
      }
      if (drawerClose) {
        drawerClose.addEventListener("click", () => this.toggle(false));
      }
      if (prevScroll && scrollTrack) {
        prevScroll.addEventListener("click", () => {
          scrollTrack.scrollBy({ left: -320, behavior: "smooth" });
        });
      }
      if (nextScroll && scrollTrack) {
        nextScroll.addEventListener("click", () => {
          scrollTrack.scrollBy({ left: 320, behavior: "smooth" });
        });
      }
    }

    render(playlist, currentIndex, onSelect) {
      const scrollTrack = document.getElementById("pp-drawer-scroll-track");
      const drawerCount = document.getElementById("pp-drawer-count");
      const icons = root.PikPakIcons || {};

      if (!scrollTrack || !playlist || playlist.length === 0) return;

      if (drawerCount) {
        drawerCount.textContent = `${currentIndex + 1} / ${playlist.length}`;
      }

      scrollTrack.innerHTML = playlist
        .map((v, i) => {
          const isCur = i === currentIndex;
          const thumb = v.thumbnailLink || "";
          return `
            <div class="pp-thumb-card ${isCur ? "active" : ""}" data-index="${i}">
              ${thumb ? `<img src="${thumb}" class="pp-thumb-img" loading="lazy" />` : `<div class="pp-thumb-fallback">${icons.play || "▶"}</div>`}
              <div class="pp-thumb-overlay">
                ${isCur ? `<span class="pp-thumb-badge">Đang phát</span>` : ""}
                ${v.durationText ? `<span class="pp-thumb-duration">${v.durationText}</span>` : ""}
                <span class="pp-thumb-idx">#${i + 1}</span>
                <span class="pp-thumb-name" title="${v.name}">${v.name}</span>
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

      // Scroll active card into view smoothly
      setTimeout(() => {
        const activeCard = scrollTrack.querySelector(".pp-thumb-card.active");
        if (activeCard) {
          activeCard.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        }
      }, 120);
    }

    toggle(forceState) {
      const drawer = document.getElementById("pp-playlist-drawer");
      const btn = document.getElementById("pp-ctrl-playlist");
      if (!drawer) return;

      const shouldShow = typeof forceState === "boolean" ? forceState : !drawer.classList.contains("show");
      drawer.classList.toggle("show", shouldShow);
      if (btn) btn.classList.toggle("active", shouldShow);

      if (shouldShow) {
        const scrollTrack = document.getElementById("pp-drawer-scroll-track");
        const activeCard = scrollTrack?.querySelector(".pp-thumb-card.active");
        if (activeCard) {
          activeCard.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        }
      }
    }
  }

  root.PlayerDrawerManager = PlayerDrawerManager;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
