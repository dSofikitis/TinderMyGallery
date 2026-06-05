# IPC reference

The renderer has no Node access. It talks to the main process through `window.api`,
exposed by `src/preload.js` via `contextBridge`. Each method wraps one IPC channel in
`src/main.js`. See [architecture](architecture.md).

## `window.api`

| Channel | Call | Description |
| --- | --- | --- |
| `pick-folder` | `pickFolder(title)` | Opens a native folder picker. Returns the chosen path, or `null` if cancelled. |
| `init-session` | `initSession(source, dest)` | Runs the [safety guard](features.md), resolves symlinks, creates `MyGallery`, adopts leftover staging + prior progress. Returns `{ok:true, galleryRoot, priorKept, priorDiscarded, adoptedStaged}` or `{ok:false, reason}`. |
| `scan` | `scan(folder)` | Recursively scans for media. Resolves to a sorted array of `{path, name, type, size}`. Emits `scan-progress` during the walk. |
| `keep` | `keep(item)` | Moves `item` into `MyGallery/<year>/<month>/<type>/`, dated by metadata. Returns `{path}` (final location, after any auto-rename). |
| `discard` | `discard(item)` | Moves `item` into `.TMG-staging`. Returns `{staged}` (staged path). |
| `undo` | `undo(entry)` | Restores a kept/discarded file to `entry.original` from `entry.current`; decrements the matching counter. Returns `{ok:true}`. |
| `thumbnail` | `thumbnail(filePath)` | Returns a data-URL OS thumbnail (HEIC via `sips`), or `null` for audio / undecodable files. |
| `preview` | `preview(filePath)` | Returns a full-size JPEG data URL via `sips` (used for HEIC/HEIF cards), or `null` on failure. |
| `abort-session` | `abortSession()` | Clears in-memory session state (e.g. Cancel on the summary) so nothing is flushed on quit. Staging on disk is left for next time. Returns `{ok:true}`. |
| `finish` | `finish()` | Sends staged discards to the Recycle Bin and persists progress. Returns `{trashed}` (count binned). |

## `scan-progress` event

While `scan` runs, the main process periodically emits `scan-progress` with the running
count of media found:

```js
const off = window.api.onScanProgress((found) => updateCount(found));
// ... later
off();  // onScanProgress returns an unsubscribe function
```

## `tmg://` protocol

A privileged custom scheme for streaming local files into the renderer (image/video
cards) without enabling `file://`. The main process maps a `tmg://` URL to its on-disk
path and fetches it; a missing or unreadable file returns a 404 (which fires the card's
`onerror`).
