# Building native binaries

Packaging is handled by [electron-builder](https://www.electron.build/). Config lives in
the `build` block of `package.json`; output lands in `dist/`. See also
[getting started](getting-started.md).

## Scripts

| Script | Output |
| --- | --- |
| `npm run build:mac` | macOS `.dmg` + `.zip` (arm64 + x64) |
| `npm run build:win` | Windows NSIS installer + `.zip` (x64) |
| `npm run build:linux` | Linux `AppImage` + `.deb` (x64) |
| `npm run build` | All three at once (`-mwl`) |
| `npm run pack` | Unpacked app dir (`--dir`), no installer — quick local testing |

## Native helpers

- **asarUnpack**: `ffprobe-static` and `trash` are unpacked from the asar archive so their
  binaries stay executable inside the packaged app.
- **afterPack pruning** (`build/afterPack.js`): each artifact ships only the `ffprobe`
  binary for the platform/arch it targets; the hook deletes every other platform/arch
  under `ffprobe-static/bin` (a universal build keeps all arches).

## CI (GitHub Actions)

`.github/workflows/build.yml` builds macOS, Windows, and Linux on their own native
runners — the reliable way to get all three (no Wine/Docker needed).

- **Manual run** (Actions → *Build desktop binaries* → Run workflow) → downloadable build
  artifacts per OS.
- **Push a `v*` tag** (e.g. `git tag v1.0.0 && git push --tags`) → a GitHub Release with
  the installers attached.

CI disables signing auto-discovery (`CSC_IDENTITY_AUTO_DISCOVERY=false`).

## Caveats

- **Cross-compiling is unreliable.** `npm run build` is fully reliable only for the OS you
  run it on (Windows NSIS needs Wine, Linux `.deb` needs `fpm`/Docker). Use CI for all
  three.
- **Builds are unsigned.** macOS may need right-click → Open (Gatekeeper); Windows may
  show a SmartScreen prompt — see [troubleshooting](troubleshooting.md). Add
  `build/icon.icns`, `build/icon.ico`, and `build/icon.png` to brand the app, or signing
  credentials to remove the warnings.
