/**
 * PikPak Ultra Pro Max - Popup Logic
 */

document.addEventListener("DOMContentLoaded", async () => {
  const shareUrlInput = document.getElementById("share-url-input");
  const sharePwdInput = document.getElementById("share-pwd-input");
  const pwdGroup = document.getElementById("pwd-group");
  const resolveBtn = document.getElementById("resolve-btn");
  const resolveBtnText = document.getElementById("resolve-btn-text");
  const pasteBtn = document.getElementById("paste-btn");
  const tabBanner = document.getElementById("tab-banner");
  const tabBannerText = document.getElementById("tab-banner-text");
  const headerStatusDot = document.getElementById("header-status-dot");
  const headerStatusText = document.getElementById("header-status-text");
  const resultsSection = document.getElementById("results-section");
  const videoList = document.getElementById("video-list");
  const videoCountBadge = document.getElementById("video-count-badge");
  const autoToolbarToggle = document.getElementById("auto-toolbar-toggle");

  let activeTab = null;
  let detectedShareId = null;

  // 1. Detect current active tab
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0] || null;

    if (activeTab && activeTab.url && activeTab.url.includes("mypikpak.com/s/")) {
      const match = activeTab.url.match(/\/s\/([a-zA-Z0-9_-]+)/);
      if (match) {
        detectedShareId = match[1];
        shareUrlInput.value = activeTab.url;
        headerStatusDot.classList.add("active");
        headerStatusText.textContent = "Sẵn sàng mở khóa";
        tabBannerText.textContent = `Phát hiện share ID: ${detectedShareId}. Bấm nút bên dưới để giải mã video.`;
      }
    } else {
      headerStatusText.textContent = "Sẵn sàng nhận link";
      tabBannerText.textContent = "Dán bất kỳ link chia sẻ mypikpak.com/s/... nào vào ô bên dưới.";
    }
  } catch (err) {
    console.warn("Tab detection error:", err);
  }

  // 2. Paste button
  pasteBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        shareUrlInput.value = text.trim();
        shareUrlInput.focus();
      }
    } catch (_) {
      shareUrlInput.focus();
    }
  });

  // 3. Resolve button click
  resolveBtn.addEventListener("click", async () => {
    const inputUrl = shareUrlInput.value.trim();
    if (!inputUrl) {
      alert("Vui lòng nhập link chia sẻ PikPak!");
      return;
    }

    const match = inputUrl.match(/\/s\/([a-zA-Z0-9_-]+)/);
    const shareId = match ? match[1] : inputUrl;
    const passCode = sharePwdInput.value.trim();

    resolveBtn.disabled = true;
    resolveBtnText.textContent = "Đang phân tích...";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "RESOLVE_SHARE",
        payload: {
          shareId: shareId,
          passCode: passCode,
        },
      });

      if (!response.success) {
        if (response.code === "PASS_CODE_EMPTY" || response.code === "PASS_CODE_ERROR") {
          pwdGroup.style.display = "flex";
          sharePwdInput.focus();
          throw new Error("Link chia sẻ này có mật khẩu. Vui lòng nhập mật khẩu vào ô vừa hiện.");
        }
        throw new Error(response.error || "Không thể phân tích link");
      }

      const data = response.data;
      const videos = data.videos || [];

      if (videos.length === 0) {
        throw new Error("Không tìm thấy video nào trong link chia sẻ này.");
      }

      renderVideoList(shareId, videos);
    } catch (err) {
      alert(err.message || "Lỗi khi trích xuất video");
    } finally {
      resolveBtn.disabled = false;
      resolveBtnText.textContent = "Trích xuất luồng Video";
    }
  });

  // 4. Render Video List
  function renderVideoList(shareId, videos) {
    videoList.innerHTML = "";
    videoCountBadge.textContent = `${videos.length} video`;
    resultsSection.style.display = "block";

    videos.forEach((video) => {
      const card = document.createElement("div");
      card.className = "video-card";

      card.innerHTML = `
        <div class="video-info">
          <span class="video-name" title="${escapeHtml(video.name)}">${escapeHtml(video.name)}</span>
          <span class="video-meta">${formatBytes(video.size)}</span>
        </div>
        <div class="video-actions">
          <button class="mini-btn play" data-action="stream" title="Phát trực tiếp">
            ▶ Phát
          </button>
          <button class="mini-btn" data-action="download" title="Tải file gốc">
            💾
          </button>
          <button class="mini-btn" data-action="copy" title="Copy Direct Stream URL">
            🔗
          </button>
        </div>
      `;

      // Button handlers
      const streamBtn = card.querySelector('[data-action="stream"]');
      const downloadBtn = card.querySelector('[data-action="download"]');
      const copyBtn = card.querySelector('[data-action="copy"]');

      streamBtn.addEventListener("click", async () => {
        streamBtn.disabled = true;
        streamBtn.textContent = "⏳...";

        try {
          const res = await chrome.runtime.sendMessage({
            type: "GET_STREAM_URL",
            payload: { shareId: shareId, fileId: video.id },
          });

          if (res.success && res.data?.primaryUrl) {
            // Open direct stream in a new tab
            chrome.tabs.create({ url: res.data.primaryUrl });
          } else {
            alert(res.error || "Không lấy được link stream");
          }
        } catch (e) {
          alert("Lỗi: " + e.message);
        } finally {
          streamBtn.disabled = false;
          streamBtn.textContent = "▶ Phát";
        }
      });

      downloadBtn.addEventListener("click", async () => {
        downloadBtn.textContent = "⏳";
        try {
          const res = await chrome.runtime.sendMessage({
            type: "GET_STREAM_URL",
            payload: { shareId: shareId, fileId: video.id },
          });

          if (res.success && res.data?.primaryUrl) {
            chrome.tabs.create({ url: res.data.primaryUrl });
          }
        } catch (_) {}
        downloadBtn.textContent = "💾";
      });

      copyBtn.addEventListener("click", async () => {
        copyBtn.textContent = "⏳";
        try {
          const res = await chrome.runtime.sendMessage({
            type: "GET_STREAM_URL",
            payload: { shareId: shareId, fileId: video.id },
          });

          if (res.success && res.data?.primaryUrl) {
            await navigator.clipboard.writeText(res.data.primaryUrl);
            copyBtn.textContent = "✓";
            setTimeout(() => {
              copyBtn.textContent = "🔗";
            }, 2000);
          }
        } catch (_) {
          copyBtn.textContent = "🔗";
        }
      });

      videoList.appendChild(card);
    });
  }

  function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }

  function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));
  }
});
