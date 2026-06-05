# Features

## Scan

- Recursively walks the source folder and all subfolders for supported media
  (see [supported types](configuration.md)). Symlinked dirs/files are not followed,
  so scans can't loop, and the app's own `MyGallery` / `.TMG-staging` folders are skipped.
- **Pre-scan summary**: per-type counts and total size, shown before you start swiping.

## Swipe

One item at a time, with a card preview and a keyboard-first UI:

| Action | Keys |
| --- | --- |
| **Keep** | `→` · `✓` |
| **Bin** | `←` · `✕` |
| **Undo** | `Ctrl/Cmd+Z` · `↺` (last 200 decisions) |

- **Live progress + ETA** updates as you go.
- **Last-12 thumbnail grid** shows your recent keeps so you can catch duplicates at a
  glance (static OS thumbnails, generated on the main process).

## Keep → sorted gallery

Kept files move into `MyGallery/<year>/<month>/<type>/`, dated by EXIF (images, via
`exifr`) or container metadata (video/audio, via `ffprobe`), falling back to the file's
modified time. Folders are created only when something lands in them, and name clashes
auto-rename to `name (2).ext`.

## Bin → Recycle Bin

Discards are staged in a hidden `.TMG-staging` folder, then sent to the OS **Recycle
Bin** on **Finish** — or automatically on app quit. Nothing is deleted outright.

## Stop & resume

Progress is persisted in `.tmg-progress.json` inside the gallery (atomic writes). Quit
mid-session and relaunch on the same source/destination to continue where you left off;
discards left in staging are re-adopted so they still reach the bin.

## Safety guard

The export location may not overlap the folder you're sorting. The check is
symlink-aware (paths are resolved with `realpath`), so a symlink can't sneak the gallery
back into the source tree. Unsafe destinations are refused with a clear message.

## HEIC handling

HEIC/HEIF previews and thumbnails are decoded with the macOS `sips` tool, since Chromium
can't render them. Full HEIC preview is therefore **macOS-only**; on other platforms
those cards fall back gracefully. See [troubleshooting](troubleshooting.md).
