'use strict';

const { app, BrowserWindow, ipcMain, dialog, protocol, net, nativeImage } = require('electron');
const path = require('path');
const fsp = require('fs/promises');
const ffprobePath = require('ffprobe-static').path;
const media = require('./lib/media');

const { uniqueName, safeMove, moveInto, getCaptureDate, galleryRelDir, scan } = media;

// `trash` v10+ is ESM-only, so load it lazily via dynamic import from CommonJS.
let _trash;
async function trashFiles(paths) {
  if (!_trash) _trash = (await import('trash')).default;
  return _trash(paths);
}

// ---------- session state ----------
const session = {
  source: null,
  dest: null,
  galleryRoot: null,
  stagingDir: null,
  staged: [],       // absolute paths in staging awaiting recycle-bin flush
  kept: 0,          // this-session counts
  discarded: 0,
  priorKept: 0,     // carried over from a previous run on this gallery
  priorDiscarded: 0,
  lastSaveCount: 0, // decisions made at last progress-file write
};

// Coalesced, atomic progress persistence. Rapid decisions collapse to a single
// in-flight write plus one pending snapshot, so writes to .tmg-progress.json never
// overlap (no corruption) and the file is always the latest fully-written counts.
let progressPending = null;
let progressWriting = false;
let progressPromise = Promise.resolve();
function scheduleSave() {
  if (!session.galleryRoot) return;
  progressPending = {
    kept: session.priorKept + session.kept,
    discarded: session.priorDiscarded + session.discarded,
    updated: new Date().toISOString(),
  };
  if (progressWriting) return;
  progressWriting = true;
  progressPromise = (async () => {
    try {
      while (progressPending) {
        const data = progressPending;
        progressPending = null;
        await media.writeProgress(session.galleryRoot, data);
      }
    } finally {
      progressWriting = false;
    }
  })();
}
async function flushProgress() {
  scheduleSave();
  try { await progressPromise; } catch { /* best-effort */ }
}

// Send everything currently staged to the OS Recycle Bin and clear staging.
async function flushStaging() {
  const existing = [];
  for (const p of session.staged) {
    if (await media.exists(p)) existing.push(p);
  }
  let trashed = 0;
  if (existing.length) {
    await trashFiles(existing);
    trashed = existing.length;
  }
  session.staged = [];
  try { await fsp.rm(session.stagingDir, { recursive: true, force: true }); } catch { /* ignore */ }
  return trashed;
}

// ---------- IPC ----------
ipcMain.handle('pick-folder', async (_e, title) => {
  const res = await dialog.showOpenDialog({
    title: title || 'Select a folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('init-session', async (_e, source, dest) => {
  // prepareSession resolves symlinks, refuses an output dir that overlaps the source,
  // and creates the gallery — returning {ok:false, reason} on any failure.
  const prep = await media.prepareSession(source, dest);
  if (!prep.ok) return prep;

  session.source = prep.source;
  session.dest = prep.dest;
  session.galleryRoot = prep.galleryRoot;
  session.stagingDir = prep.stagingDir;
  // Adopt any discards left in staging by a prior session so they still reach the bin.
  session.staged = await media.listStaging(prep.stagingDir);
  const prior = await media.readProgress(prep.galleryRoot);
  session.priorKept = prior.kept;
  session.priorDiscarded = prior.discarded;
  session.kept = 0;
  session.discarded = 0;
  session.lastSaveCount = 0;

  return {
    ok: true,
    galleryRoot: session.galleryRoot,
    priorKept: prior.kept,
    priorDiscarded: prior.discarded,
    adoptedStaged: session.staged.length,
  };
});

ipcMain.handle('scan', async (e, folder) => {
  return scan(folder, (found) => {
    if (!e.sender.isDestroyed()) e.sender.send('scan-progress', found);
  });
});

ipcMain.handle('keep', async (_e, item) => {
  const d = await getCaptureDate(ffprobePath, item.path, item.type);
  // Type folders are created lazily inside moveInto — only when something lands in them.
  const destDir = path.join(session.galleryRoot, galleryRelDir(d, item.type));
  const target = await moveInto(item.path, destDir, item.name);
  session.kept++;
  scheduleSave();
  return { path: target };
});

ipcMain.handle('discard', async (_e, item) => {
  await fsp.mkdir(session.stagingDir, { recursive: true });
  const target = await uniqueName(session.stagingDir, item.name);
  await safeMove(item.path, target);
  session.staged.push(target);
  session.discarded++;
  scheduleSave();
  return { staged: target };
});

ipcMain.handle('undo', async (_e, entry) => {
  await fsp.mkdir(path.dirname(entry.original), { recursive: true });
  // Restore to the exact original path (its slot was vacated when we moved it out).
  await safeMove(entry.current, entry.original);
  if (entry.action === 'discard') {
    session.staged = session.staged.filter((p) => p !== entry.current);
    session.discarded = Math.max(0, session.discarded - 1);
  } else {
    session.kept = Math.max(0, session.kept - 1);
  }
  scheduleSave();
  return { ok: true };
});

// Abandon a session that was started but never swiped (e.g. Cancel on the summary
// screen). Clears in-memory state so a stale session can't be flushed on quit.
// Leftover staging on disk (if any) stays put and is re-adopted next time.
ipcMain.handle('abort-session', async () => {
  session.source = null;
  session.dest = null;
  session.galleryRoot = null;
  session.stagingDir = null;
  session.staged = [];
  session.kept = 0;
  session.discarded = 0;
  session.priorKept = 0;
  session.priorDiscarded = 0;
  progressPending = null;
  return { ok: true };
});

// Generate an OS thumbnail (QuickLook on macOS) for a kept image/video. Returns a
// data URL, or null for audio / anything QuickLook can't render — keeps the grid
// light (static images instead of live <video> elements).
ipcMain.handle('thumbnail', async (_e, filePath) => {
  try {
    // HEIC/HEIF: Electron's thumbnailer returns only a generic file icon — decode with sips.
    if (/\.(heic|heif)$/i.test(filePath)) return await media.sipsDataUrl(filePath, 320);
    const img = await nativeImage.createThumbnailFromPath(filePath, { width: 320, height: 320 });
    if (img.isEmpty()) return null;
    return img.toDataURL();
  } catch { return null; }
});

// Full-size preview used to show HEIC/HEIF in the card (Chromium can't decode them).
// Returns a JPEG data URL, or null on failure.
ipcMain.handle('preview', async (_e, filePath) => {
  return media.sipsDataUrl(filePath, 1600);
});

ipcMain.handle('finish', async () => {
  const trashed = await flushStaging();
  await flushProgress();
  return { trashed };
});

// ---------- custom protocol so the renderer can stream local files ----------
protocol.registerSchemesAsPrivileged([{
  scheme: 'tmg',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
}]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#16181d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Smoke-test hook: boot, confirm the renderer loads, then quit.
  if (process.env.TMG_SMOKE) {
    let failed = false;
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) { failed = true; console.error('[renderer console error]', message); }
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      failed = true; console.error('[did-fail-load]', code, desc);
    });
    win.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        console.log(failed ? 'SMOKE_FAIL' : 'SMOKE_OK');
        app.exit(failed ? 1 : 0);
      }, 500);
    });
  }
}

app.whenReady().then(() => {
  protocol.handle('tmg', async (request) => {
    try {
      const u = new URL(request.url);
      let p = decodeURIComponent(u.pathname);
      if (p.startsWith('/')) p = p.slice(1);
      // Await so a missing/unreadable file rejects here and returns a clean 404
      // (which fires the card's onerror) instead of an unhandled console error.
      return await net.fetch('file://' + encodeURI(p), { bypassCustomProtocolHandlers: true });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// On quit, flush any staged discards to the Recycle Bin and persist progress, so
// closing mid-session (without clicking Finish) is safe and resumable.
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  if (!session.galleryRoot && !session.staged.length) return;
  e.preventDefault();
  quitting = true;
  (async () => {
    try { await flushStaging(); } catch { /* ignore */ }
    try { await flushProgress(); } catch { /* ignore */ }
    app.quit();
  })();
});
