/**
 * PikPak Ultra Pro Max - Buffer Manager Engine
 * Single Responsibility: Native Buffer Monitoring, Smooth Progress Tracking & Safe Offline Cache
 */

(function (root) {
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB per chunk for full preload
  const DEFAULT_BUFFER_WINDOW_SEC = 180; // 3 minutes buffer window

  class PlayerBufferManager {
    constructor(player) {
      this.player = player;
      this.streamUrl = null;
      this.fileSize = 0;
      this.duration = 0;
      this.bufferWindowSeconds = DEFAULT_BUFFER_WINDOW_SEC;
      this.bufferedAheadSeconds = 0;
      this.isFullPreload = false;
      this.isBoosting = true;

      this.activeFetches = new Map(); // chunkIdx -> AbortController
      this.fetchedChunks = new Set(); // set of chunkIdx
      this.chunkBlobs = new Map(); // chunkIdx -> Uint8Array
      this.loopTimer = null;
      this.cacheStore = null;

      this.initCacheStorage();
    }

    async initCacheStorage() {
      try {
        if ("caches" in window) {
          this.cacheStore = await caches.open("pp-stream-buffer-v1");
        }
      } catch (_) {}
    }

    start(streamUrl, options = {}) {
      this.stop();
      if (!streamUrl) return;

      this.streamUrl = streamUrl;
      this.fileSize = parseInt(options.fileSize, 10) || 0;
      this.bufferWindowSeconds = DEFAULT_BUFFER_WINDOW_SEC;
      this.bufferedAheadSeconds = 0;
      this.isFullPreload = false;
      this.isBoosting = true;
      this.fetchedChunks.clear();
      this.chunkBlobs.clear();

      this.loopTimer = setInterval(() => this.tick(), 1000);
      this.updateUI();
    }

    stop() {
      if (this.loopTimer) {
        clearInterval(this.loopTimer);
        this.loopTimer = null;
      }

      this.activeFetches.forEach((controller) => {
        try { controller.abort(); } catch (_) {}
      });
      this.activeFetches.clear();

      this.streamUrl = null;
      this.fileSize = 0;
      this.duration = 0;
      this.bufferedAheadSeconds = 0;
      this.isBoosting = false;
      this.isFullPreload = false;
      this.updateUI();
    }

    setBufferTarget(target) {
      if (target === "all") {
        this.isFullPreload = true;
        this.bufferWindowSeconds = Infinity;
        this.player.shortcuts?.showHud("Chế độ tải toàn bộ file (Offline)", null);
        if (this.fileSize <= 0 && this.streamUrl) {
          this.probeContentLength(this.streamUrl);
        }
      } else {
        const sec = parseInt(target, 10);
        this.isFullPreload = false;
        this.bufferWindowSeconds = isNaN(sec) ? DEFAULT_BUFFER_WINDOW_SEC : sec;
        const mins = Math.round(this.bufferWindowSeconds / 60);
        this.player.shortcuts?.showHud(`Bộ đệm mục tiêu: ${mins} phút`, null);
      }
      this.updateUI();
      this.tick();
    }

    async probeContentLength(url) {
      try {
        const res = await fetch(url, { method: "HEAD" });
        const len = res.headers.get("content-length");
        if (len) {
          this.fileSize = parseInt(len, 10);
        }
      } catch (_) {}
    }

    handleSeek() {
      this.tick();
    }

    tick() {
      const v = this.player.modalVideo;
      if (!v || !this.streamUrl || !this.player.isModalOpen) return;

      const dur = v.duration || this.duration;
      if (dur > 0) this.duration = dur;
      const curTime = v.currentTime || 0;

      // Đồng bộ tiến trình bộ đệm native từ video element
      this.updateNativeBufferProgress(v, curTime, dur);

      // Chỉ thực hiện tải ngầm khi người dùng CHỦ ĐỘNG chọn "all" (Tải toàn bộ file Offline)
      if (this.isFullPreload && this.fileSize > 0 && dur > 0) {
        const byteRate = this.fileSize / dur;
        const curByte = Math.max(0, curTime * byteRate);
        const startChunkIdx = Math.floor(curByte / CHUNK_SIZE);
        const totalChunks = Math.ceil(this.fileSize / CHUNK_SIZE);

        for (let idx = startChunkIdx; idx < totalChunks; idx++) {
          if (this.activeFetches.size >= 1) break; // Chỉ dùng 1 kết nối để không tranh chấp với player
          if (this.fetchedChunks.has(idx) || this.activeFetches.has(idx)) continue;

          const startByte = idx * CHUNK_SIZE;
          const endByte = Math.min(this.fileSize - 1, (idx + 1) * CHUNK_SIZE - 1);
          if (startByte < endByte && endByte < this.fileSize) {
            this.fetchChunk(idx, startByte, endByte);
          }
        }
      }
    }

    updateNativeBufferProgress(v, curTime, dur) {
      if (!v || dur <= 0) return;
      const bufferBar = document.getElementById("pp-progress-buffer");
      let bufferedEnd = 0;

      if (v.buffered && v.buffered.length > 0) {
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.buffered.start(i) <= curTime && curTime <= v.buffered.end(i)) {
            bufferedEnd = v.buffered.end(i);
            break;
          }
        }
        if (bufferedEnd === 0 && v.buffered.length > 0) {
          bufferedEnd = v.buffered.end(v.buffered.length - 1);
        }
      }

      if (bufferedEnd > 0) {
        const pct = Math.min(100, (bufferedEnd / dur) * 100);
        if (bufferBar) bufferBar.style.width = `${pct}%`;
        const aheadSec = Math.max(0, Math.round(bufferedEnd - curTime));
        this.bufferedAheadSeconds = aheadSec;
      }

      this.updateUI();
    }

    async fetchChunk(chunkIdx, startByte, endByte) {
      const controller = new AbortController();
      this.activeFetches.set(chunkIdx, controller);

      try {
        const res = await fetch(this.streamUrl, {
          headers: {
            Range: `bytes=${startByte}-${endByte}`,
          },
          signal: controller.signal,
        });

        if (!res.ok && res.status !== 206) {
          throw new Error(`HTTP ${res.status}`);
        }

        const buffer = await res.arrayBuffer();
        this.fetchedChunks.add(chunkIdx);

        if (this.isFullPreload) {
          this.chunkBlobs.set(chunkIdx, new Uint8Array(buffer));
          this.checkFullPreloadComplete();
        }

        if (this.cacheStore) {
          try {
            const cacheKey = `${this.streamUrl}#chunk=${chunkIdx}`;
            await this.cacheStore.put(cacheKey, new Response(buffer.slice(0), {
              headers: { "Content-Type": "application/octet-stream" },
            }));
          } catch (_) {}
        }
      } catch (err) {
        // Lỗi fetch chunk offline được xử lý âm thầm, tuyệt đối không ảnh hưởng đến video đang phát
      } finally {
        this.activeFetches.delete(chunkIdx);
      }
    }

    checkFullPreloadComplete() {
      const totalChunks = Math.ceil(this.fileSize / CHUNK_SIZE);
      if (this.chunkBlobs.size >= totalChunks && this.isFullPreload) {
        console.log("%c[Buffer Accelerator] Đã tải trọn vẹn 100% video vào bộ nhớ!", "color: #4ade80; font-weight: bold;");
        this.player.shortcuts?.showHud("Đã tải xong 100% (Sẵn sàng Offline)", null);

        if (this.fileSize < 1.5 * 1024 * 1024 * 1024) {
          try {
            const parts = [];
            for (let i = 0; i < totalChunks; i++) {
              if (this.chunkBlobs.has(i)) parts.push(this.chunkBlobs.get(i));
            }
            if (parts.length === totalChunks) {
              const blob = new Blob(parts, { type: "video/mp4" });
              const localBlobUrl = URL.createObjectURL(blob);
              const v = this.player.modalVideo;
              if (v) {
                const cur = v.currentTime;
                const paused = v.paused;
                v.src = localBlobUrl;
                v.currentTime = cur;
                if (!paused) v.play().catch(() => {});
              }
            }
          } catch (_) {}
        }
      }
    }

    updateUI() {
      const btn = document.getElementById("pp-booster-btn");
      if (!btn) return;
      const label = document.getElementById("pp-booster-label");

      if (this.isFullPreload) {
        const totalChunks = Math.ceil(this.fileSize / CHUNK_SIZE) || 1;
        const pct = Math.round((this.fetchedChunks.size / totalChunks) * 100);
        btn.classList.add("active");
        btn.title = pct >= 100 ? "Đã sẵn sàng Offline (100%) - Phím B" : `Đang tải Offline: ${pct}% - Phím B`;
        if (label) label.textContent = pct >= 100 ? "100% Offline" : `${pct}% Tải`;
      } else {
        btn.classList.add("active");
        const ahead = this.bufferedAheadSeconds || 0;
        if (ahead >= 60) {
          const mins = Math.round(ahead / 60);
          btn.title = `Bộ đệm đã sẵn sàng ${mins} phút - Phím B`;
          if (label) label.textContent = `Đệm ${mins}m`;
        } else if (ahead > 0) {
          btn.title = `Bộ đệm đã sẵn sàng ${ahead}s - Phím B`;
          if (label) label.textContent = `Đệm ${ahead}s`;
        } else {
          btn.title = "Bộ đệm video (Đang tự động tối ưu) - Phím B";
          if (label) label.textContent = "Đệm Auto";
        }
      }
    }
  }

  root.PlayerBufferManager = PlayerBufferManager;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
