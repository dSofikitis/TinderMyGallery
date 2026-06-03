'use strict';

// Pure, Electron-free media/file logic. Shared by main.js and the tests.

const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const exifr = require('exifr');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const VIDEO_EXT = new Set(['.mov', '.mp4', '.avi']);
const AUDIO_EXT = new Set(['.mp3', '.wav']);

// Folder names we create under the chosen destination.
const GALLERY_NAME = 'MyGallery';
const STAGING_NAME = '.TMG-staging';
// Small JSON kept inside the gallery to remember cumulative progress across sessions.
const PROGRESS_FILE = '.tmg-progress.json';
// Folders we create ourselves — never scan them back in.
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

// Resolve symlinks / `..` / case-folding to a real on-disk path. If the path does
// not exist yet, fall back to a lexically-resolved absolute path. Crucially, when
// the path IS an existing symlink this returns the link's TARGET, so containment
// checks can't be fooled by a symlink that points back into the source tree.
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
      // Cross-device move: copy then unlink.
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
      } catch { /* ignore */ }
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
  } catch { /* fall through */ }
  // Fallback: file modified time.
  try {
    const st = await fsp.stat(file);
    return st.mtime;
  } catch {
    return new Date();
  }
}

// Decode an image to a JPEG data URL via the macOS `sips` tool, resized so its
// longest side is <= maxDim. This is how we render HEIC/HEIF, which Chromium can't
// decode and which Electron's nativeImage returns only a generic file icon for.
// Returns a data URL string, or null if sips is unavailable/fails (e.g. non-macOS).
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
    await fsp.rm(out, { force: true }).catch(() => { /* ignore */ });
  }
}

// Target subfolder (relative to the gallery root) for a kept item.
function galleryRelDir(date, type) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return path.join(year, month, type);
}

// True if `child` is the same as, or located somewhere inside, `parent`.
// Both args should be absolute (ideally realpath-resolved) paths.
function isInside(parent, child) {
  if (parent === child) return true;
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}

// True if the two directory trees overlap (one contains the other, or they're equal).
function overlaps(a, b) {
  return isInside(a, b) || isInside(b, a);
}

// Safety guard core: the gallery/staging output dirs must not overlap the source
// tree. All three args must be absolute, realpath-resolved paths.
// Returns a human-readable reason string if unsafe, else null.
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

// Convenience pure check from raw (already-resolved) source/dest paths.
function destinationConflict(source, dest) {
  return conflictReason(source, path.join(dest, GALLERY_NAME), path.join(dest, STAGING_NAME));
}

// Resolve everything to real on-disk paths (following any existing symlinks for the
// gallery/staging dirs), refuse unsafe destinations, then create the gallery.
// Returns {ok:true, source, dest, galleryRoot, stagingDir} or {ok:false, reason}.
// This is the single guarded entry point used by the IPC handler — kept here so it
// can be unit-tested without Electron.
async function prepareSession(source, dest) {
  const realSource = await realpathSafe(source);
  const realDest = await realpathSafe(dest);
  // realpathSafe resolves a pre-existing symlink to its target; for a not-yet-created
  // dir it returns the lexical path. Either way we check the REAL location.
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

// Files currently sitting in staging (flat list of absolute paths). Used to adopt
// discards left over from a session that was closed before flushing to the bin.
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

// Atomic write: write to a unique temp file then rename over the target, so a crash
// mid-write can never leave a truncated/corrupt progress file, and even concurrent
// writers (each with its own temp) end up with one complete file — last rename wins.
let _tmpCounter = 0;
async function writeProgress(galleryRoot, data) {
  if (!galleryRoot) return;
  const target = path.join(galleryRoot, PROGRESS_FILE);
  const tmp = `${target}.${process.pid}.${_tmpCounter++}.tmp`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(data));
    await fsp.rename(tmp, target);
  } catch {
    try { await fsp.rm(tmp, { force: true }); } catch { /* ignore */ }
  }
}

// Recursively collect supported media. `onProgress(found)` is called periodically
// so the UI can show live counts during a long walk. Symlinked dirs/files are not
// followed (isDirectory()/isFile() are false for symlinks), avoiding cycles.
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
          try { size = (await fsp.stat(full)).size; } catch { /* ignore */ }
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
