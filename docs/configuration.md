# Configuration

There is **no config file and no settings** — source and destination are chosen
interactively each run. The only knob is one optional env var (below).

## On-disk layout

Everything is created under the destination you pick:

| Path | Purpose |
| --- | --- |
| `MyGallery/<year>/<month>/<type>/` | Kept files, sorted by capture date and type |
| `.TMG-staging/` | Discards staged before the Recycle Bin flush |
| `.tmg-progress.json` | Cumulative kept/discarded counts (atomic writes) — enables [stop & resume](features.md) |

- `<type>` is one of `pics`, `vids`, `audio`.
- The date comes from EXIF (images) or container metadata (video/audio), falling back to
  the file's modified time.
- `MyGallery` and `.TMG-staging` are never scanned back in, and may not overlap the source
  folder (the [safety guard](features.md)).

## Supported file types

| Type | Extensions |
| --- | --- |
| `pics` | `.jpg` `.jpeg` `.png` `.webp` `.heic` `.heif` |
| `vids` | `.mov` `.mp4` `.avi` |
| `audio` | `.mp3` `.wav` |

HEIC/HEIF preview and thumbnails require macOS (`sips`) — see
[troubleshooting](troubleshooting.md).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `TMG_SMOKE` | Set to `1` to boot the app, confirm the renderer loads, then exit (prints `SMOKE_OK` / `SMOKE_FAIL`). Used for smoke testing only. |
