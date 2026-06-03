'use strict';

// Functional test of the real file-operation logic in src/lib/media.js.
// Runs against a throwaway temp directory. No Electron, no Recycle Bin side effects.

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const assert = require('assert');

const media = require('../src/lib/media');
const ffprobePath = require('ffprobe-static').path;

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  console.log('  ✓ ' + name);
  passed++;
}

async function writeFile(p, content, mtime) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content || 'x');
  if (mtime) await fsp.utimes(p, mtime, mtime);
}

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tmg-test-'));
  const src = path.join(root, 'source');
  const gallery = path.join(root, 'out', 'MyGallery');
  const staging = path.join(root, 'out', '.TMG-staging');

  // ---- build a source tree (dates chosen via mtime; no real metadata) ----
  const dJul = new Date(2021, 6, 15, 12, 0, 0); // 2021-07
  const dMar = new Date(2022, 2, 2, 9, 0, 0);   // 2022-03
  const dDec = new Date(2020, 11, 25, 8, 0, 0); // 2020-12

  await writeFile(path.join(src, 'a.jpg'), 'fake', dJul);
  await writeFile(path.join(src, 'sub', 'b.MP4'), 'fake', dMar);      // uppercase ext
  await writeFile(path.join(src, 'sub', 'deep', 'c.wav'), 'fake', dDec);
  await writeFile(path.join(src, 'notes.txt'), 'ignore me');           // non-media
  await writeFile(path.join(src, 'MyGallery', 'old.jpg'), 'fake');     // must be skipped

  console.log('scan():');
  const items = await media.scan(src);
  const names = items.map((i) => i.name).sort();
  check('finds exactly the 3 media files', items.length === 3);
  check('ignores non-media (.txt)', !names.includes('notes.txt'));
  check('skips MyGallery dir contents', !names.includes('old.jpg'));
  check('detects case-insensitive ext (.MP4 -> vids)',
    items.find((i) => i.name === 'b.MP4').type === 'vids');
  check('detects .jpg -> pics', items.find((i) => i.name === 'a.jpg').type === 'pics');
  check('detects .wav -> audio', items.find((i) => i.name === 'c.wav').type === 'audio');

  console.log('image format coverage:');
  check('typeOf .webp -> pics', media.typeOf('a.webp') === 'pics');
  check('typeOf .HEIC -> pics (case-insensitive)', media.typeOf('b.HEIC') === 'pics');
  check('typeOf .heif -> pics', media.typeOf('c.heif') === 'pics');

  if (process.platform === 'darwin') {
    console.log('HEIC decode via sips:');
    const { spawnSync } = require('child_process');
    // a real 2x2 PNG, converted to HEIC with sips, then decoded back by sipsDataUrl
    const pngSrc = path.join(root, 'heic-src.png');
    fs.writeFileSync(pngSrc, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP8z8Dwn4EIwAgAJAUDAH2FmrIAAAAASUVORK5CYII=',
      'base64'));
    const heicSrc = path.join(root, 'photo.heic');
    const conv = spawnSync('sips', ['-s', 'format', 'heic', pngSrc, '--out', heicSrc]);
    if (conv.status === 0 && fs.existsSync(heicSrc)) {
      const url = await media.sipsDataUrl(heicSrc, 320);
      check('sipsDataUrl returns a real jpeg data URL for HEIC',
        typeof url === 'string' && url.startsWith('data:image/jpeg;base64,') && url.length > 200);
      check('sipsDataUrl leaves no temp file behind',
        (await fsp.readdir(os.tmpdir())).every((n) => !n.startsWith('tmg-prev-')));
    } else {
      console.log('  ~ skipped (sips could not create a HEIC in this environment)');
    }
  }

  console.log('date routing (fallback to mtime):');
  const routes = {};
  for (const it of items) {
    const d = await media.getCaptureDate(ffprobePath, it.path, it.type);
    routes[it.name] = media.galleryRelDir(d, it.type);
  }
  check('jpg -> 2021/07/pics', routes['a.jpg'] === path.join('2021', '07', 'pics'));
  check('mp4 -> 2022/03/vids', routes['b.MP4'] === path.join('2022', '03', 'vids'));
  check('wav -> 2020/12/audio', routes['c.wav'] === path.join('2020', '12', 'audio'));

  console.log('keep / moveInto():');
  let firstTarget;
  for (const it of items) {
    const d = await media.getCaptureDate(ffprobePath, it.path, it.type);
    const destDir = path.join(gallery, media.galleryRelDir(d, it.type));
    const target = await media.moveInto(it.path, destDir, it.name);
    if (it.name === 'a.jpg') firstTarget = target;
    check(`moved ${it.name} into gallery`, fs.existsSync(target));
    check(`original ${it.name} removed from source`, !fs.existsSync(it.path));
  }
  check('lazy folders: no empty type dirs created',
    fs.existsSync(path.join(gallery, '2021', '07', 'pics')) &&
    !fs.existsSync(path.join(gallery, '2021', '07', 'vids')) &&
    !fs.existsSync(path.join(gallery, '2021', '07', 'audio')));

  console.log('name-collision auto-rename:');
  const c1 = path.join(src, 'dir1', 'IMG.jpg');
  const c2 = path.join(src, 'dir2', 'IMG.jpg');
  await writeFile(c1, 'one', dJul);
  await writeFile(c2, 'two', dJul);
  const destDir = path.join(gallery, '2021', '07', 'pics');
  const t1 = await media.moveInto(c1, destDir, 'IMG.jpg');
  const t2 = await media.moveInto(c2, destDir, 'IMG.jpg');
  check('first collision keeps original name', path.basename(t1) === 'IMG.jpg');
  check('second collision auto-renamed to "IMG (2).jpg"', path.basename(t2) === 'IMG (2).jpg');
  check('both collision files exist (nothing overwritten)',
    fs.existsSync(t1) && fs.existsSync(t2));
  check('collision contents preserved distinctly',
    fs.readFileSync(t1, 'utf8') === 'one' && fs.readFileSync(t2, 'utf8') === 'two');

  console.log('discard staging + undo restore:');
  const victim = path.join(src, 'trashme.png');
  await writeFile(victim, 'bye', dJul);
  const staged = await media.moveInto(victim, staging, 'trashme.png');
  check('discard moves file into staging', fs.existsSync(staged) && !fs.existsSync(victim));
  // undo a keep: move t2 back to its original source path
  await fsp.mkdir(path.dirname(c2), { recursive: true });
  await media.safeMove(t2, c2);
  check('undo restores kept file to original path', fs.existsSync(c2) && !fs.existsSync(t2));
  // undo a discard: move staged file back
  await media.safeMove(staged, victim);
  check('undo restores discarded file from staging', fs.existsSync(victim) && !fs.existsSync(staged));

  console.log('destination-conflict guard:');
  const G = media.GALLERY_NAME;
  // dest === source  -> output would be source/MyGallery  -> DENY
  check('denies dest equal to source',
    media.destinationConflict('/a/gallery', '/a/gallery') !== null);
  // dest inside source -> DENY
  check('denies dest nested inside source',
    media.destinationConflict('/a/gallery', '/a/gallery/sub') !== null);
  // source literally named MyGallery, dest is its parent -> gallery === source -> DENY
  check('denies when source is the MyGallery one level under dest',
    media.destinationConflict('/a/' + G, '/a') !== null);
  // dest is a sibling -> ALLOW
  check('allows sibling destination',
    media.destinationConflict('/a/gallery', '/a/export') === null);
  // dest is the parent and source is a normal name -> output is a sibling of source -> ALLOW
  check('allows parent destination with normal source name',
    media.destinationConflict('/a/gallery/photos', '/a/gallery') === null);
  // a path that is a string-prefix but NOT a path-parent must not false-positive
  check('does not treat string-prefix siblings as nested',
    media.destinationConflict('/a/gallery', '/a/gallery-export') === null);
  // isInside sanity
  check('isInside: same path', media.isInside('/x/y', '/x/y') === true);
  check('isInside: real child', media.isInside('/x/y', '/x/y/z') === true);
  check('isInside: prefix-but-not-child', media.isInside('/x/y', '/x/yy') === false);
  check('isInside: parent is not inside child', media.isInside('/x/y/z', '/x/y') === false);

  // End-to-end against the real filesystem: a real nested dest must be refused.
  const realSrc = await fsp.realpath(src);
  check('real nested dest produces a conflict reason',
    media.destinationConflict(realSrc, path.join(realSrc, 'export')) !== null);

  console.log('prepareSession() guard (real fs + symlinks):');
  const ps = path.join(root, 'ps');
  const psSource = path.join(ps, 'source');
  const psDest = path.join(ps, 'dest');
  await fsp.mkdir(psSource, { recursive: true });
  await fsp.mkdir(psDest, { recursive: true });

  const okPrep = await media.prepareSession(psSource, psDest);
  check('prepareSession succeeds for safe dirs', okPrep.ok === true);
  check('prepareSession created the gallery', fs.existsSync(path.join(psDest, media.GALLERY_NAME)));

  const insidePrep = await media.prepareSession(psSource, psSource);
  check('prepareSession denies dest === source', insidePrep.ok === false && !!insidePrep.reason);

  // SYMLINK BYPASS (review finding #1): dest/MyGallery is a symlink into source.
  // String comparison would miss it; realpath resolution must catch it.
  const symDest = path.join(ps, 'dest-sym');
  await fsp.mkdir(symDest, { recursive: true });
  await fsp.symlink(psSource, path.join(symDest, media.GALLERY_NAME));
  const symPrep = await media.prepareSession(psSource, symDest);
  check('prepareSession denies a MyGallery symlink pointing into source', symPrep.ok === false);

  // Same attack via the staging dir symlink.
  const symStgDest = path.join(ps, 'dest-sym-stg');
  await fsp.mkdir(symStgDest, { recursive: true });
  await fsp.symlink(psSource, path.join(symStgDest, media.STAGING_NAME));
  const symStgPrep = await media.prepareSession(psSource, symStgDest);
  check('prepareSession denies a .TMG-staging symlink pointing into source', symStgPrep.ok === false);

  // MyGallery already exists as a regular file -> mkdir fails -> ok:false (not a throw).
  const fileGalDest = path.join(ps, 'dest-filegal');
  await fsp.mkdir(fileGalDest, { recursive: true });
  await writeFile(path.join(fileGalDest, media.GALLERY_NAME), 'i am a file, not a dir');
  const fileGalPrep = await media.prepareSession(psSource, fileGalDest);
  check('prepareSession returns ok:false when MyGallery exists as a file', fileGalPrep.ok === false);

  // mkdir failure (review finding #3): read-only destination must yield ok:false, not throw.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (!isRoot) {
    const roDest = path.join(ps, 'readonly');
    await fsp.mkdir(roDest, { recursive: true });
    await fsp.chmod(roDest, 0o555);
    const roPrep = await media.prepareSession(psSource, roDest);
    check('prepareSession returns ok:false when gallery mkdir fails (read-only dest)',
      roPrep.ok === false && !!roPrep.reason);
    await fsp.chmod(roDest, 0o755); // restore so cleanup can remove it
  } else {
    console.log('  ~ skipped read-only mkdir test (running as root)');
  }

  console.log('staging adoption + progress persistence:');
  const stg = okPrep.stagingDir;
  await fsp.mkdir(stg, { recursive: true });
  await writeFile(path.join(stg, 'left1.jpg'), 'x');
  await writeFile(path.join(stg, 'left2.mp4'), 'x');
  const adopted = await media.listStaging(stg);
  check('listStaging finds leftover staged files', adopted.length === 2);
  check('listStaging on a missing dir returns []',
    (await media.listStaging(path.join(root, 'nope'))).length === 0);

  await media.writeProgress(okPrep.galleryRoot, { kept: 7, discarded: 3 });
  const prog = await media.readProgress(okPrep.galleryRoot);
  check('progress round-trips kept/discarded', prog.kept === 7 && prog.discarded === 3);
  check('readProgress defaults to zeros when missing',
    (await media.readProgress(path.join(root, 'nope'))).kept === 0);

  // Atomic writes: even 30 concurrent writers must leave a valid (never corrupt) file.
  await Promise.all(
    Array.from({ length: 30 }, (_, i) => media.writeProgress(okPrep.galleryRoot, { kept: i, discarded: 0 })),
  );
  const afterRace = await media.readProgress(okPrep.galleryRoot);
  check('progress file stays valid JSON after concurrent writes',
    typeof afterRace.kept === 'number' && afterRace.kept >= 0 && afterRace.kept <= 29);
  check('no leftover .tmp progress files after concurrent writes',
    (await fsp.readdir(okPrep.galleryRoot)).every((n) => !n.endsWith('.tmp')));

  console.log('scan size + progress callback:');
  await writeFile(path.join(psSource, 'pic.jpg'), 'hello', dJul);
  let progressCalls = 0;
  const scanned = await media.scan(psSource, () => { progressCalls++; });
  check('scan returns media with a numeric size', scanned.length >= 1 && typeof scanned[0].size === 'number');
  check('scan reports a real (>0) size', scanned[0].size > 0);
  check('scan invokes onProgress (at least the final tick)', progressCalls >= 1);

  // cleanup
  await fsp.rm(root, { recursive: true, force: true });
  console.log(`\nALL ${passed} CHECKS PASSED`);
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err.message);
  process.exit(1);
});
