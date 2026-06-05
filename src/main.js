'use strict';

const { app, BrowserWindow, ipcMain, dialog, protocol, net, nativeImage } = require('electron');
const path = require('path');
const fsp = require('fs/promises');
const ffprobePath = require('ffprobe-static').path.replace('app.asar', 'app.asar.unpacked');
const media = require('./lib/media');

const { uniqueName, safeMove, moveInto, getCaptureDate, galleryRelDir, scan } = media;

let _trash;
async function trashFiles(paths) {
  if (!_trash) _trash = (await import('trash')).default;
  return _trash(paths);
}

const session = {
  source: null,
  dest: null,
  galleryRoot: null,
  stagingDir: null,
  staged: [],
  kept: 0,
  discarded: 0,
  priorKept: 0,
  priorDiscarded: 0,
  lastSaveCount: 0,
};

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
  try { await progressPromise; } catch {}
}

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
  try { await fsp.rm(session.stagingDir, { recursive: true, force: true }); } catch {}
  return trashed;
}

ipcMain.handle('pick-folder', async (_e, title) => {
  const res = await dialog.showOpenDialog({
    title: title || 'Select a folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('init-session', async (_e, source, dest) => {
  const prep = await media.prepareSession(source, dest);
  if (!prep.ok) return prep;

  session.source = prep.source;
  session.dest = prep.dest;
  session.galleryRoot = prep.galleryRoot;
  session.stagingDir = prep.stagingDir;
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

ipcMain.handle('thumbnail', async (_e, filePath) => {
  try {
    if (/\.(heic|heif)$/i.test(filePath)) return await media.sipsDataUrl(filePath, 320);
    const img = await nativeImage.createThumbnailFromPath(filePath, { width: 320, height: 320 });
    if (img.isEmpty()) return null;
    return img.toDataURL();
  } catch { return null; }
});

ipcMain.handle('preview', async (_e, filePath) => {
  return media.sipsDataUrl(filePath, 1600);
});

ipcMain.handle('finish', async () => {
  const trashed = await flushStaging();
  await flushProgress();
  return { trashed };
});

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

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  if (!session.galleryRoot && !session.staged.length) return;
  e.preventDefault();
  quitting = true;
  (async () => {
    try { await flushStaging(); } catch {}
    try { await flushProgress(); } catch {}
    app.quit();
  })();
});