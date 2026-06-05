# Architecture

## Overview

```
renderer/ (HTML/JS UI)  ──tmg://──►  local media files
        │  window.api (contextBridge)
        ▼
preload.js  ──IPC──►  main.js (Electron main)  ──►  src/lib/media.js (pure core)
                            │                              │
                            ├──► exifr / ffprobe (dates)   └──► fs: MyGallery / .TMG-staging
                            └──► trash (Recycle Bin)            .tmg-progress.json
```

- **Main** (`src/main.js`): owns the window, registers IPC handlers and the `tmg://`
  protocol, holds session state, and flushes staged discards + progress on quit.
- **Renderer** (`src/renderer/`): the swipe UI. It has no Node access; it talks to the
  main process only through `window.api`. See [IPC](ipc.md).
- **Preload** (`src/preload.js`): the `contextBridge` that exposes `window.api` —
  the exact, minimal IPC surface.

## The `tmg://` protocol

A privileged custom scheme lets the renderer stream local files for previews without
turning on `file://` access. The main process resolves a `tmg://` URL to the on-disk
path and fetches it, returning a clean 404 if the file is missing.

## Pure core (`src/lib/media.js`)

All file/media logic is Electron-free and unit-tested in isolation: directory scan,
`typeOf`, capture-date extraction, the `MyGallery/<year>/<month>/<type>` layout,
unique-name/safe-move helpers, progress read/write, and the `prepareSession` /
`conflictReason` [safety guard](features.md). `main.js` is a thin Electron shell on top.

## Session state & persistence

The main process tracks the current session (source, gallery root, staging dir, staged
discards, this-session and prior counts). Progress is written to `.tmg-progress.json`
via coalesced **atomic writes** (temp file + rename), so rapid decisions never overlap
or corrupt the file, and a crash can't truncate it.

## Layout & packaging

Output for a session lives under the chosen destination as `MyGallery/` (kept files),
`.TMG-staging/` (pending discards), and `.tmg-progress.json` — see
[configuration](configuration.md). Packaging is electron-builder; native helpers are
asar-unpacked — see [building](building.md).
