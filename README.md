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

## Build native binaries

Packaging is handled by [electron-builder](https://www.electron.build/). Output lands in `dist/`.

```bash
npm run build:mac     # macOS  -> .dmg + .zip   (arm64 + x64)
npm run build:win     # Windows -> NSIS installer + .zip (x64)
npm run build:linux   # Linux  -> AppImage + .deb (x64)
npm run build         # all three at once (-mwl)
npm run pack          # quick unpacked app dir (no installer) for testing
```

Each artifact only carries the `ffprobe` binary for the platform/arch it targets
(an `afterPack` hook prunes the rest), and the `ffprobe-static` / `trash` helper
binaries are asar-unpacked so they stay executable inside the packaged app.

**Cross-compiling is unreliable** — `npm run build` works fully only for the OS
you run it on (Windows NSIS needs Wine, Linux `.deb` needs `fpm`/Docker). To get
all three reliably, let CI build each on its own runner:

- `.github/workflows/build.yml` builds macOS/Windows/Linux on native runners.
- Run it manually (**Actions → Build desktop binaries → Run workflow**) for downloadable artifacts, or push a `v*` tag (e.g. `git tag v1.0.0 && git push --tags`) to publish a GitHub Release with the installers attached.

> Builds are **unsigned**. macOS users may need right-click → Open (Gatekeeper),
> and Windows may show a SmartScreen prompt. Add `build/icon.icns`, `build/icon.ico`
> and `build/icon.png` to brand the app, or signing credentials to remove the warnings.

## Documentation

Concise guides live in [`docs/`](docs/):

- [Getting started](docs/getting-started.md)
- [Features](docs/features.md)
- [Configuration](docs/configuration.md)
- [Building native binaries](docs/building.md)
- [IPC reference](docs/ipc.md)
- [Architecture](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)
