'use strict';

const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const exifr = require('exifr');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const VIDEO_EXT = new Set(['.mov', '.mp4', '.avi']);
const AUDIO_EXT = new Set(['.mp3', '.wav']);

const GALLERY_NAME = 'MyGallery';
const STAGING_NAME = '.TMG-staging';
const PROGRESS_FILE = '.tmg-progress.json';
const SKIP_DIRS = new Set([GALLERY_NAME, STAGING_NAME]);

function typeOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'pics';
  if (VIDEO_EXT.has(ext)) return 'vids';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return null;
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function realpathSafe(p) {
  try { return await fsp.realpath(p); } catch { return path.resolve(p); }
}

async function uniqueName(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dir, name);
  let i = 2;
  while (await exists(candidate)) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  return candidate;
}

async function safeMove(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    } else {
      throw e;
    }
  }
}

async function moveInto(src, destDir, originalName) {
  await fsp.mkdir(destDir, { recursive: true });
  const target = await uniqueName(destDir, originalName);
  await safeMove(src, target);
  return target;
}

function ffprobeDate(ffprobePath, file) {
  return new Promise((resolve) => {
    let out = '';
    let proc;
    try {
      proc = spawn(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', file]);
    } catch {
      return resolve(null);
    }
    proc.stdout.on('data', (d) => { out += d; });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      try {
        const tags = (JSON.parse(out).format || {}).tags || {};
        const raw = tags.creation_time
          || tags['com.apple.quicktime.creationdate']
          || tags.date;
        if (raw) {
          const d = new Date(raw);
          if (!Number.isNaN(d.getTime())) return resolve(d);
        }
      } catch {}
      resolve(null);
    });
  });
}

async function getCaptureDate(ffprobePath, file, type) {
  try {
    if (type === 'pics') {
      const ex = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'ModifyDate']).catch(() => null);
      const d = ex && (ex.DateTimeOriginal || ex.CreateDate || ex.ModifyDate);
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
    } else {
      const d = await ffprobeDate(ffprobePath, file);
      if (d) return d;
    }
  } catch {}
  try {
    const st = await fsp.stat(file);
    return st.mtime;
  } catch {
    return new Date();
  }
}

let _previewCounter = 0;
async function sipsDataUrl(src, maxDim) {
  const out = path.join(os.tmpdir(), `tmg-prev-${process.pid}-${_previewCounter++}.jpg`);
  try {
    const ok = await new Promise((resolve) => {
      let proc;
      try {
        proc = spawn('sips', ['-s', 'format', 'jpeg', '-Z', String(maxDim), src, '--out', out]);
      } catch { return resolve(false); }
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
    if (!ok) return null;
    const buf = await fsp.readFile(out);
    return 'data:image/jpeg;base64,' + buf.toString('base64');
  } catch {
    return null;
  } finally {
    await fsp.rm(out, { force: true }).catch(() => {});
  }
}

function galleryRelDir(date, type) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return path.join(year, month, type);
}

function isInside(parent, child) {
  if (parent === child) return true;
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}

function overlaps(a, b) {
  return isInside(a, b) || isInside(b, a);
}

function conflictReason(source, gallery, staging) {
  if (overlaps(source, gallery) || overlaps(source, staging)) {
    return (
      `The export location can't sit inside the folder you're sorting.\n\n` +
      `"${GALLERY_NAME}" would be created at:\n${gallery}\n\n` +
      `which overlaps the folder being sorted:\n${source}\n\n` +
      `Please pick a destination outside that folder.`
    );
  }
  return null;
}

function destinationConflict(source, dest) {
  return conflictReason(source, path.join(dest, GALLERY_NAME), path.join(dest, STAGING_NAME));
}

async function prepareSession(source, dest) {
  const realSource = await realpathSafe(source);
  const realDest = await realpathSafe(dest);
  const galleryRoot = await realpathSafe(path.join(realDest, GALLERY_NAME));
  const stagingDir = await realpathSafe(path.join(realDest, STAGING_NAME));

  const reason = conflictReason(realSource, galleryRoot, stagingDir);
  if (reason) return { ok: false, reason };

  try {
    await fsp.mkdir(galleryRoot, { recursive: true });
  } catch (err) {
    return { ok: false, reason: `Could not create the ${GALLERY_NAME} folder here:\n${err.message}` };
  }
  return { ok: true, source: realSource, dest: realDest, galleryRoot, stagingDir };
}

async function listStaging(stagingDir) {
  try {
    const entries = await fsp.readdir(stagingDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => path.join(stagingDir, e.name));
  } catch { return []; }
}

async function readProgress(galleryRoot) {
  try {
    const data = JSON.parse(await fsp.readFile(path.join(galleryRoot, PROGRESS_FILE), 'utf8'));
    return { kept: data.kept || 0, discarded: data.discarded || 0 };
  } catch { return { kept: 0, discarded: 0 }; }
}

let _tmpCounter = 0;
async function writeProgress(galleryRoot, data) {
  if (!galleryRoot) return;
  const target = path.join(galleryRoot, PROGRESS_FILE);
  const tmp = `${target}.${process.pid}.${_tmpCounter++}.tmp`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(data));
    await fsp.rename(tmp, target);
  } catch {
    try { await fsp.rm(tmp, { force: true }); } catch {}
  }
}

async function scan(root, onProgress) {
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(full);
      } else if (e.isFile()) {
        const type = typeOf(e.name);
        if (type) {
          let size = 0;
          try { size = (await fsp.stat(full)).size; } catch {}
          out.push({ path: full, name: e.name, type, size });
          if (onProgress && out.length % 500 === 0) onProgress(out.length);
        }
      }
    }
  }
  await walk(root);
  if (onProgress) onProgress(out.length);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

module.exports = {
  IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, SKIP_DIRS, GALLERY_NAME, STAGING_NAME, PROGRESS_FILE,
  typeOf, exists, realpathSafe, uniqueName, safeMove, moveInto,
  ffprobeDate, getCaptureDate, sipsDataUrl, galleryRelDir, scan,
  isInside, overlaps, conflictReason, destinationConflict, prepareSession,
  listStaging, readProgress, writeProgress,
};