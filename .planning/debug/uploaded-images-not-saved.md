# Debug: Uploaded canvas images are not saved to cloud

**Opened:** 2026-09-26
**Status:** fixing
**Reporter:** user (quyvu216@gmail.com, project "Infinite Canvas 2")

## Symptoms

- User uploaded 2 source images (game1.jpg 118534 B, clipboard-image.png 97674 B, also photo 52503 B in Nova1) into canvas projects.
- On another browser/device the uploaded image nodes show broken images (red-circled in screenshot); generated images recover via the byte-size fallback but uploaded ones do not.
- Dragging an image from a web page / another browser window onto the canvas does nothing (no node created). Dragging OS files works.

## Eliminated Hypotheses

- [x] Generation-path asset storage broken: no — 45/45 succeeded generations have assets in MinIO (verified earlier).
- [x] Hydration bug: no — restoreCanvasImage works, but there is nothing to restore for uploaded images.
- [x] BFF worker missing upload: no — worker only runs generation jobs; client uploads never go through it.

## Evidence Log

| Timestamp | Data | Interpretation |
| --------- | ---- | -------------- |
| 2026-09-26 | `select ... where metadata->>'size' in ('118534','97674','52503')` → 0 rows | Uploaded images have NO cloud assets — localforage-only |
| 2026-09-26 | web/src/services/image-storage.ts:37-69 `uploadImage`/`storeImage` only writes localforage | No network persistence anywhere in the upload path |
| 2026-09-26 | debugger agent report (this session): `POST /v1/assets/import` accepts only objectKey/providerUrl, zero web callers | BFF has no byte-upload endpoint |
| 2026-09-26 | project.tsx:2333-2354 handleDrop filters `dataTransfer.files` only | URL drops (text/uri-list) return early — no node |
| 2026-09-26 | project.tsx:1546-1564 createImageFileNode → uploadImage (local only) | Drop-created nodes share the same local-only fate |

## Current Hypothesis

Uploaded images are persisted client-side only. Root cause = missing client→BFF upload path (no endpoint + no call). Fix: add `POST /api/v1/assets/upload` (raw body, sha256 checksum dedupe), call it from `uploadImage` when a Canvas session is active, thread `assetId` into node metadata, backfill legacy nodes during hydration, and extend `handleDrop` to fetch dropped image URLs into upload nodes.

## Fix Attempts

| # | Change | Result | Notes |
| --- | ------ | ------ | ----- |
| 1 | BFF upload route + client cloud-backup + URL drop | pending | |

## Resolution

**Root Cause:** user-uploaded images are stored only in browser IndexedDB (image-storage.ts storeImage); no client→BFF binary upload path exists, so cloud restore is impossible by construction.
**Fix:** pending.
