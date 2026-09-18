# Fix PikPak public video-list links

## Goal

Make the extension reliably play videos from PikPak public list/folder URLs, including the provided `.../s/<share>/<route-token>` link, without mistaking the route token for a video ID or silently selecting the wrong file.

## Tasks

- [x] **Add a single share-context resolver** in `content/main.js` that treats network/query values as authoritative, classifies URL-only tokens as unresolved route context, and never passes an unverified route token to the restore flow. Verify with the provided URL that the context contains the share ID but no fabricated video file ID.

- [x] **Make playlist prefetch resilient** in `content/main.js`: resolve the requested parent first, retry the share root when the result has no media, and only cache `lastPrefetchedKey` after a successful playlist result. Verify that the provided list route produces all available media items.

- [x] **Improve clicked-item ID resolution** in `content/main.js`: read stable DOM/data IDs where available, then match the clicked filename against the resolved playlist using an exact normalized-name helper. Verified `v9.mp4` and `v8.avi` resolve to their own items; the AVI path reaches the expected browser-format limitation.

- [x] **Unify the click fallback path** in `content/main.js` around the resilient playlist resolver. It now retries root resolution before showing “Không tìm thấy video…” and never falls back to `currentPlaylist[0]` for an unmatched click.

- [x] **Harden media-type guards** before restore/playback so folder IDs and unresolved route tokens are rejected with a useful diagnostic instead of reaching Cloud restore. The click path now requires a resolved media item before fallback playback.

- [x] **Run static and browser verification**: `node --check` passed for all changed JavaScript files, the provided list link was reloaded in Dia, and `v9.mp4` played successfully. AVI resolution was verified through the Cloud step and reports the existing no-transcoded-MP4 limitation.

## Done when

- The provided URL opens the clicked video rather than showing “Không tìm thấy video để lưu vào Cloud.”
- The selected video ID is the matching `VONNu...` item ID, never the `AAAD...` route token or the first arbitrary playlist item.
- Root, nested-folder, and single-file share links all resolve without restoring a folder as a video.
- AVI files without a PikPak transcoded MP4 stream still require external playback or download.
- No unrelated files or API authentication/stream logic are changed.
