/**
 * PikPak Ultra Pro Max - Background Service Worker
 * Coordinates API requests, token management, and Cloud restore/delete operations.
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

    case "RESTORE_AND_GET_STREAM":
      handleRestoreAndGetStream(message.payload)
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message, code: err.code }));
      return true;

    case "REFRESH_PERSONAL_STREAM":
      handleRefreshPersonalStream(message.payload)
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message, code: err.code }));
      return true;

    case "DELETE_USER_FILES":
      handleDeleteUserFiles(message.payload)
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

async function handleRestoreAndGetStream({ shareId, fileId, passCodeToken = "", targetName = "", authToken = "", deviceId = "" }) {
  console.log(`[ServiceWorker] ⚡ RESTORE_AND_GET_STREAM: shareId=${shareId}, fileId=${fileId}, targetName=${targetName}`);
  if (deviceId) {
    client.deviceId = deviceId;
  }
  if (authToken) {
    client.setAuthToken(authToken);
  }
  return await client.restoreAndResolveStream(shareId, fileId, passCodeToken, targetName);
}

async function handleRefreshPersonalStream({ fileId, targetName = "", authToken = "", deviceId = "" }) {
  console.log(`[ServiceWorker] 🔄 REFRESH_PERSONAL_STREAM: fileId=${fileId}`);
  if (deviceId) {
    client.deviceId = deviceId;
  }
  if (authToken) {
    client.setAuthToken(authToken);
  }
  return await client.resolvePersonalStream(fileId, targetName);
}

async function handleDeleteUserFiles({ fileIds = [], authToken = "" }) {
  console.log(`[ServiceWorker] 🗑️ DELETE_USER_FILES: fileIds=${JSON.stringify(fileIds)}`);
  if (authToken) {
    client.setAuthToken(authToken);
  }
  return await client.deleteUserFiles(fileIds);
}

function updateBadge(tabId, text, color) {
  try {
    chrome.action.setBadgeText({ tabId: tabId, text: text });
    chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: color });
  } catch (_) {
    // Tab might be closing
  }
}
