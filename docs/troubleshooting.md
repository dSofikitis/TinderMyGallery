# Troubleshooting

**HEIC/HEIF won't preview (blank card or generic icon)**
Full HEIC/HEIF decoding uses the macOS `sips` tool, so it only works on macOS. On Windows
and Linux those cards can't render — you can still keep/bin them; only the preview is
unavailable. See [features](features.md).

**"The export location can't sit inside the folder you're sorting"**
The [safety guard](features.md) refuses a destination that overlaps the source (the check
follows symlinks). Pick a destination *outside* the folder you're sorting.

**A file I binned is gone**
Discards go to the OS **Recycle Bin** (on Finish or on quit), not permanent deletion.
Recover it from the Recycle Bin / Trash. Until then it sits in `.TMG-staging` at the
destination.

**Resuming a session**
Relaunch and pick the **same** source and destination. Cumulative counts are read from
`.tmg-progress.json` in the gallery, and any discards still in `.TMG-staging` are
re-adopted so they still reach the bin.

**"App can't be opened" / SmartScreen warning**
Builds are unsigned. On macOS, right-click the app → **Open** to bypass Gatekeeper. On
Windows, choose **More info → Run anyway** on the SmartScreen prompt. See
[building](building.md).

**ffprobe / native-binary errors in a packaged build**
`ffprobe-static` and `trash` are asar-unpacked so their binaries stay executable, and
`main.js` rewrites the ffprobe path from `app.asar` to `app.asar.unpacked`. If you repack
with a changed config, keep those entries (and the `afterPack` hook) intact.

**Start over on a destination**
Stop the app and delete `.tmg-progress.json` (and `.TMG-staging`) at the destination. The
next run treats it as a fresh gallery; existing files in `MyGallery/` are left untouched.
