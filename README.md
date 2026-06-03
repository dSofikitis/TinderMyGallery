# TinderMyGallery

A desktop app (Electron) for triaging media with a Tinder-style swipe UI — keep the good
ones into a sorted gallery, bin the rest.

## What it does

- **Scans** a folder + all subfolders for photos (jpg/jpeg/png/webp/heic/heif), videos (mov/mp4/avi), audio (mp3/wav).
- **Swipe** one-by-one: right/→/✓ to **keep**, left/←/✕ to **bin**, Ctrl/Cmd+Z/↺ to **undo** (last 200).
- **Keep** = moves the file into `MyGallery/<year>/<month>/<type>/`, dated by EXIF/media metadata (falls back to file date). Folders made only when needed; name clashes auto-rename.
- **Bin** = staged, then sent to the Recycle Bin on Finish *or* on quit.
- **Pre-scan summary**: per-type counts + total size before you start.
- **Live progress + ETA** while swiping; **last-12 thumbnail grid** to catch dupes.
- **Stop & resume**: quit anytime, relaunch on the same folder to continue; progress persists.
- **Safety**: refuses an output location inside the folder being sorted (symlink-aware); creates `MyGallery` at a destination you pick.

## Run

```bash
npm install
npm start
```

## Develop

`npm test` runs the file-operation suite. Dependencies are kept CVE-free (`npm audit`).
