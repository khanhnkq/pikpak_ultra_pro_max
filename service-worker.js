/**
 * PikPak Ultra Pro Max - Background Service Worker
 * Coordinates API requests, token management, and streaming resolution.
 */

importScripts("lib/constants.js", "lib/md5.js", "lib/pikpak-api.js");

const client = new self.PikPakClient();

// In-memory tab state
const tabStates = new Map();

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  switch (message.type) {
    case "RESOLVE_SHARE":
      handleResolveShare(message.payload)
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message, code: err.code }));
      return true; // Keep channel open for async response

    case "GET_STREAM_URL":
      handleGetStreamUrl(message.payload)
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message, code: err.code }));
      return true;

    case "REFRESH_STREAM_URL":
      handleRefreshStreamUrl(message.payload)
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message, code: err.code }));
      return true;

    case "TAB_READY":
      if (tabId) {
        tabStates.set(tabId, {
          shareId: message.payload.shareId,
          ready: true,
          timestamp: Date.now(),
        });
        updateBadge(tabId, "READY", "#007aff");
      }
      sendResponse({ success: true });
      return false;

    case "VIDEO_STREAMING_ACTIVE":
      if (tabId) {
        updateBadge(tabId, "FULL", "#34c759");
      }
      sendResponse({ success: true });
      return false;

    case "GET_CURRENT_STATE":
      sendResponse({
        success: true,
        data: tabId ? tabStates.get(tabId) : null,
      });
      return false;

    default:
      sendResponse({ success: false, error: "Unknown action" });
      return false;
  }
});

// Clean up state on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

async function handleResolveShare({ shareId, passCode = "", parentId = "" }) {
  console.log(`[ServiceWorker] ⚡ RESOLVE_SHARE: shareId=${shareId}, parentId=${parentId || "(root)"}`);
  if (!shareId) throw new Error("Missing shareId parameter");

  const result = await client.listFolderFiles(shareId, passCode, parentId);
  console.log(`[ServiceWorker] ✅ RESOLVE_SHARE success: ${result.videos.length} videos, ${result.subfolders.length} subfolders`);

  return {
    shareId,
    parentId,
    videos: result.videos,
    subfolders: result.subfolders,
    allFiles: result.allFiles || [],
    mediaFiles: result.mediaFiles || result.videos,
    totalFiles: result.allFiles.length,
    videoCount: result.videos.length,
    targetFileId: result.targetFileId || null,
  };
}

async function handleGetStreamUrl({ shareId, fileId }) {
  console.log(`[ServiceWorker] 🎬 GET_STREAM_URL: shareId=${shareId}, fileId=${fileId}`);
  if (!shareId || !fileId) throw new Error("Missing shareId or fileId");
  const streams = await client.resolveMediaStreams(shareId, fileId);
  console.log(`[ServiceWorker] ✅ Stream resolved successfully:`, streams.primaryUrl);
  return streams;
}

async function handleRefreshStreamUrl({ shareId, fileId }) {
  console.log(`[ServiceWorker] 🔄 REFRESH_STREAM_URL: shareId=${shareId}, fileId=${fileId}`);
  if (!shareId || !fileId) throw new Error("Missing shareId or fileId");
  const cacheKey = `${shareId}:${fileId}`;
  const previousCached = client.cache.get(cacheKey);
  client.cache.delete(cacheKey);
  try {
    const refreshed = await client.resolveMediaStreams(shareId, fileId);
    if (refreshed?.primaryUrl) {
      return refreshed;
    }
    if (previousCached?.data?.primaryUrl) {
      console.warn(`[ServiceWorker] ⚠️ Refreshed stream had no primaryUrl, falling back to previous cache`);
      client.cache.set(cacheKey, previousCached);
      return previousCached.data;
    }
    return refreshed;
  } catch (err) {
    if (previousCached?.data?.primaryUrl) {
      console.warn(`[ServiceWorker] ⚠️ Refresh error (${err.message}), falling back to previous cache`);
      client.cache.set(cacheKey, previousCached);
      return previousCached.data;
    }
    throw err;
  }
}

function updateBadge(tabId, text, color) {
  try {
    chrome.action.setBadgeText({ tabId: tabId, text: text });
    chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: color });
  } catch (_) {
    // Tab might be closing
  }
}
