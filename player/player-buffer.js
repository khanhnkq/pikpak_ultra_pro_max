/**
 * PikPak Ultra Pro Max - Buffer Accelerator Engine
 * Single Responsibility: Parallel Range Pre-fetching, Continuous Buffer Window & Offline Cache
 */

(function (root) {
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB per chunk
  const DEFAULT_BUFFER_WINDOW_SEC = 180; // 3 minutes buffer window
  const MAX_CONCURRENCY = 2; // 2 parallel range connections for maximum CDN throughput

  class PlayerBufferManager {
    constructor(player) {
      this.player = player;
      this.streamUrl = null;
      this.fileSize = 0;
      this.duration = 0;
      this.bufferWindowSeconds = DEFAULT_BUFFER_WINDOW_SEC;
      this.isFullPreload = false;
      this.isBoosting = false;

      this.activeFetches = new Map(); // chunkIdx -> AbortController
      this.fetchedChunks = new Set(); // set of chunkIdx
      this.chunkBlobs = new Map(); // chunkIdx -> Uint8Array (for full preload merge)
      this.loopTimer = null;
      this.speedCalcTimer = null;

      this.bytesLoadedThisInterval = 0;
      this.currentSpeedBps = 0;
      this.cacheStore = null;

      this.initCacheStorage();
    }

    async initCacheStorage() {
      try {
        if ("caches" in window) {
          this.cacheStore = await caches.open("pp-stream-buffer-v1");
        }
      } catch (e) {
        console.warn("[Buffer Accelerator] CacheStorage not accessible, using memory buffer:", e);
      }
    }

    start(streamUrl, options = {}) {
      this.stop();
      if (!streamUrl) return;

      this.streamUrl = streamUrl;
      this.fileSize = parseInt(options.fileSize, 10) || 0;
      this.bufferWindowSeconds = DEFAULT_BUFFER_WINDOW_SEC;
      this.isFullPreload = false;
      this.isBoosting = true;
      this.fetchedChunks.clear();
      this.chunkBlobs.clear();

      // Retrieve content length if not provided
      if (this.fileSize <= 0) {
        this.probeContentLength(streamUrl);
      }

      this.startSpeedTracker();
      this.loopTimer = setInterval(() => this.tick(), 750);
      this.updateUI();
      console.log("%c[Buffer Accelerator] Bắt đầu tăng tốc bộ đệm (Cửa sổ 3 phút)...", "color: #38bdf8; font-weight: bold;");
    }

    stop() {
      if (this.loopTimer) {
        clearInterval(this.loopTimer);
        this.loopTimer = null;
      }
      if (this.speedCalcTimer) {
        clearInterval(this.speedCalcTimer);
        this.speedCalcTimer = null;
      }

      this.activeFetches.forEach((controller) => {
        try { controller.abort(); } catch (_) {}
      });
      this.activeFetches.clear();

      this.streamUrl = null;
      this.fileSize = 0;
      this.duration = 0;
      this.isBoosting = false;
      this.currentSpeedBps = 0;
      this.bytesLoadedThisInterval = 0;
      this.updateUI();
    }

    setBufferTarget(target) {
      if (target === "all") {
        this.isFullPreload = true;
        this.bufferWindowSeconds = Infinity;
        this.player.shortcuts?.showHud("Chế độ tải toàn bộ file (Offline)", null);
      } else {
        const sec = parseInt(target, 10);
        this.isFullPreload = false;
        this.bufferWindowSeconds = isNaN(sec) ? DEFAULT_BUFFER_WINDOW_SEC : sec;
        const mins = Math.round(this.bufferWindowSeconds / 60);
        this.player.shortcuts?.showHud(`Bộ đệm tải trước: ${mins} phút`, null);
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
          console.log(`[Buffer Accelerator] Detected Content-Length: ${(this.fileSize / (1024 * 1024)).toFixed(1)} MB`);
        }
      } catch (_) {}
    }

    startSpeedTracker() {
      this.speedCalcTimer = setInterval(() => {
        this.currentSpeedBps = this.bytesLoadedThisInterval;
        this.bytesLoadedThisInterval = 0;
        this.updateUI();
      }, 1000);
    }

    handleSeek() {
      // When seeking, cancel chunks that are too far behind or ahead of new position
      const v = this.player.modalVideo;
      if (!v || !this.streamUrl || this.fileSize <= 0) return;

      const dur = v.duration || this.duration;
      if (dur <= 0) return;

      const curTime = v.currentTime || 0;
      const byteRate = this.fileSize / dur;
      const curByte = curTime * byteRate;
      const curChunk = Math.floor(curByte / CHUNK_SIZE);

      // Abort fetches that are before curChunk
      for (const [chunkIdx, controller] of this.activeFetches.entries()) {
        if (chunkIdx < curChunk) {
          try { controller.abort(); } catch (_) {}
          this.activeFetches.delete(chunkIdx);
        }
      }

      this.tick();
    }

    tick() {
      const v = this.player.modalVideo;
      if (!v || !this.streamUrl || !this.player.isModalOpen) return;

      const dur = v.duration || this.duration;
      if (dur > 0) this.duration = dur;
      if (this.fileSize <= 0 || this.duration <= 0) return;

      const curTime = v.currentTime || 0;
      const byteRate = this.fileSize / this.duration;

      // Calculate target byte end
      let targetEndTime;
      if (this.isFullPreload) {
        targetEndTime = this.duration;
      } else {
        targetEndTime = Math.min(this.duration, curTime + this.bufferWindowSeconds);
      }

      const curByte = Math.max(0, curTime * byteRate);
      const targetByte = Math.min(this.fileSize, targetEndTime * byteRate);

      const startChunkIdx = Math.floor(curByte / CHUNK_SIZE);
      const endChunkIdx = Math.floor(targetByte / CHUNK_SIZE);

      // Schedule pending chunks
      for (let idx = startChunkIdx; idx <= endChunkIdx; idx++) {
        if (this.activeFetches.size >= MAX_CONCURRENCY) break;
        if (this.fetchedChunks.has(idx) || this.activeFetches.has(idx)) continue;

        const startByte = idx * CHUNK_SIZE;
        const endByte = Math.min(this.fileSize - 1, (idx + 1) * CHUNK_SIZE - 1);
        this.fetchChunk(idx, startByte, endByte);
      }

      this.updateProgressIndicator(curTime, dur, byteRate);
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
        this.bytesLoadedThisInterval += buffer.byteLength;
        this.fetchedChunks.add(chunkIdx);

        if (this.isFullPreload) {
          this.chunkBlobs.set(chunkIdx, new Uint8Array(buffer));
          this.checkFullPreloadComplete();
        }

        // Cache chunk for offline/fast seek if available
        if (this.cacheStore) {
          try {
            const cacheKey = `${this.streamUrl}#chunk=${chunkIdx}`;
            await this.cacheStore.put(cacheKey, new Response(buffer.slice(0), {
              headers: { "Content-Type": "application/octet-stream" },
            }));
          } catch (_) {}
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          console.warn(`[Buffer Accelerator] Chunk ${chunkIdx} fetch failed:`, err.message);
        }
      } finally {
        this.activeFetches.delete(chunkIdx);
      }
    }

    checkFullPreloadComplete() {
      const totalChunks = Math.ceil(this.fileSize / CHUNK_SIZE);
      if (this.chunkBlobs.size >= totalChunks && this.isFullPreload) {
        console.log("%c[Buffer Accelerator] Đã tải trọn vẹn 100% video vào bộ nhớ!", "color: #4ade80; font-weight: bold;");
        this.player.shortcuts?.showHud("Đã tải xong 100% (Sẵn sàng Offline)", null);

        // Merge chunks into local Blob URL if file is reasonable (< 1.5GB)
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
                console.log("[Buffer Accelerator] Chuyển đổi sang Local Blob URL hoàn tất!");
              }
            }
          } catch (e) {
            console.warn("[Buffer Accelerator] Blob merge warning:", e);
          }
        }
      }
    }

    updateProgressIndicator(curTime, dur, byteRate) {
      if (dur <= 0) return;
      const bufferBar = document.getElementById("pp-progress-buffer");
      if (!bufferBar) return;

      // Find the furthest contiguous chunk from current position
      const curChunk = Math.floor((curTime * byteRate) / CHUNK_SIZE);
      let contiguousEndChunk = curChunk;
      while (this.fetchedChunks.has(contiguousEndChunk + 1)) {
        contiguousEndChunk++;
      }

      const acceleratedByteEnd = Math.min(this.fileSize, (contiguousEndChunk + 1) * CHUNK_SIZE);
      const acceleratedSecEnd = acceleratedByteEnd / byteRate;
      const acceleratedPct = Math.min(100, (acceleratedSecEnd / dur) * 100);

      // Only override bufferBar if accelerated buffer is ahead of native buffer
      const curWidthPct = parseFloat(bufferBar.style.width) || 0;
      if (acceleratedPct > curWidthPct) {
        bufferBar.style.width = `${acceleratedPct}%`;
      }
    }

    updateUI() {
      const btn = document.getElementById("pp-booster-btn");
      if (!btn) return;
      const label = document.getElementById("pp-booster-label");

      if (!this.isBoosting) {
        btn.classList.remove("active", "pulse");
        btn.title = "Tăng tốc bộ đệm (Đang tắt) - Phím B";
        if (label) label.textContent = "Đệm Tắt";
        return;
      }

      btn.classList.add("active");
      if (this.activeFetches.size > 0) {
        btn.classList.add("pulse");
      } else {
        btn.classList.remove("pulse");
      }

      if (this.isFullPreload) {
        const totalChunks = Math.ceil(this.fileSize / CHUNK_SIZE) || 1;
        const pct = Math.round((this.fetchedChunks.size / totalChunks) * 100);
        btn.title = pct >= 100 ? "Tải toàn bộ file: Đã sẵn sàng Offline (100%) - Phím B" : `Đang tải toàn bộ file: ${pct}% - Phím B`;
        if (label) label.textContent = pct >= 100 ? "100% Offline" : `${pct}% Tải`;
      } else {
        const mins = Math.round(this.bufferWindowSeconds / 60);
        if (this.currentSpeedBps > 0) {
          const speedMb = (this.currentSpeedBps / (1024 * 1024)).toFixed(1);
          btn.title = `Tăng tốc bộ đệm (${speedMb} MB/s • Cửa sổ ${mins}m) - Phím B`;
          if (label) label.textContent = `${speedMb} MB/s`;
        } else {
          btn.title = `Tăng tốc bộ đệm (Cửa sổ ${mins} phút) - Phím B`;
          if (label) label.textContent = `Đệm ${mins}m`;
        }
      }
    }
  }

  root.PlayerBufferManager = PlayerBufferManager;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window);
