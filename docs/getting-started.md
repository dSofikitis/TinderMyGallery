# Getting started

## Requirements

- **To use it**: nothing — download a built binary for your OS (see [building](building.md)).
- **To develop / build**: Node.js + npm and [Electron](https://www.electronjs.org/) (installed by `npm install`).

## Setup

```bash
npm install
npm start                  # launches the Electron app
```

`npm test` runs the file-operation suite over a temp directory.

## First run

1. **Pick a source folder.** TinderMyGallery scans it (and every subfolder) for
   photos, videos, and audio. See the full [supported types](configuration.md).
2. **Pick a destination.** A `MyGallery/` folder is created there for the files you
   keep. It must sit *outside* the folder you're sorting (a [safety guard](features.md)
   enforces this).
3. **Review the summary.** A pre-scan shows per-type counts and total size before you
   commit to anything.
4. **Swipe.** Go through items one at a time — keep the good ones into a sorted gallery,
   bin the rest. Quit any time and relaunch on the same folder to resume.

See [features](features.md) for the keyboard shortcuts and the full workflow.
