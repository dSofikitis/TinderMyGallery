'use strict';

const startScreen = document.getElementById('startScreen');
const startBtn = document.getElementById('startBtn');
const loading = document.getElementById('loading');
const scanCountEl = document.getElementById('scanCount');
const summaryScreen = document.getElementById('summaryScreen');
const summaryBreakdown = document.getElementById('summaryBreakdown');
const summaryResume = document.getElementById('summaryResume');
const summaryStartBtn = document.getElementById('summaryStartBtn');
const summaryCancelBtn = document.getElementById('summaryCancelBtn');
const appEl = document.getElementById('app');
const cardArea = document.getElementById('cardArea');
const counterEl = document.getElementById('counter');
const filenameEl = document.getElementById('filename');
const grid = document.getElementById('grid');
const doneScreen = document.getElementById('doneScreen');
const doneSummary = document.getElementById('doneSummary');
const finishBtn = document.getElementById('finishBtn');
const doneFinishBtn = document.getElementById('doneFinishBtn');
const toastEl = document.getElementById('toast');
const blockedScreen = document.getElementById('blockedScreen');
const blockedMsg = document.getElementById('blockedMsg');
const blockedResumeBtn = document.getElementById('blockedResumeBtn');
const blockedFinishBtn = document.getElementById('blockedFinishBtn');

let items = [];
let index = 0;
const history = [];
const recent = [];
let keptCount = 0;
let discardedCount = 0;
let priorKept = 0;
let priorDiscarded = 0;
let busy = false;
let active = false;
let failedCount = 0;
let consecutiveFails = 0;
const FAIL_STOP_THRESHOLD = 5;
let toastTimer = null;
const decisionTimes = [];

const MAX_HISTORY = 200;
const TYPE_LABEL = { pics: 'PHOTO', vids: 'VIDEO', audio: 'AUDIO' };
const TYPE_GLYPH = { pics: '🖼', vids: '▶', audio: '♪' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mediaUrl = (absPath) => 'tmg://media/' + encodeURIComponent(absPath);

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(i > 0 && v < 10 ? 1 : 0) + ' ' + u[i];
}
function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}

startBtn.addEventListener('click', startFlow);

async function startFlow() {
  const source = await window.api.pickFolder('Select the folder to sort (scanned recursively)');
  if (!source) return;

  let init;
  while (true) {
    const dest = await window.api.pickFolder('Select where to create the MyGallery folder');
    if (!dest) return;
    try {
      init = await window.api.initSession(source, dest);
    } catch (err) {
      alert('Could not start a session:\n' + (err && err.message ? err.message : err));
      continue;
    }
    if (init.ok) break;
    alert(init.reason);
  }
  priorKept = init.priorKept || 0;
  priorDiscarded = init.priorDiscarded || 0;

  startScreen.classList.add('hidden');
  loading.classList.remove('hidden');
  scanCountEl.textContent = '0 media files found';
  const unsub = window.api.onScanProgress((n) => {
    scanCountEl.textContent = n.toLocaleString() + ' media files found';
  });

  try {
    items = await window.api.scan(source);
  } catch (err) {
    unsub();
    loading.classList.add('hidden');
    startScreen.classList.remove('hidden');
    alert('Scan failed:\n' + (err && err.message ? err.message : err));
    return;
  }
  unsub();
  loading.classList.add('hidden');

  if (!items.length) {
    doneSummary.textContent = 'No supported media (jpg, jpeg, png, webp, heic, heif, mov, mp4, avi, mp3, wav) found in that folder.';
    doneFinishBtn.classList.add('hidden');
    doneScreen.classList.remove('hidden');
    return;
  }

  showSummary();
}

function showSummary() {
  const stat = { pics: { n: 0, b: 0 }, vids: { n: 0, b: 0 }, audio: { n: 0, b: 0 } };
  let totalB = 0;
  for (const it of items) {
    const s = stat[it.type];
    s.n++; s.b += it.size || 0; totalB += it.size || 0;
  }
  const row = (label, s) =>
    `<div class="brow"><span>${label}</span><span>${s.n.toLocaleString()}</span><span>${formatBytes(s.b)}</span></div>`;
  summaryBreakdown.innerHTML =
    `<div class="brow bhead"><span>Type</span><span>Count</span><span>Size</span></div>` +
    row('Photos', stat.pics) + row('Videos', stat.vids) + row('Audio', stat.audio) +
    `<div class="brow btot"><span>Total</span><span>${items.length.toLocaleString()}</span><span>${formatBytes(totalB)}</span></div>`;

  const prior = priorKept + priorDiscarded;
  summaryResume.textContent = prior > 0
    ? `Resuming — already sorted into this destination: ${priorKept.toLocaleString()} kept, ${priorDiscarded.toLocaleString()} binned. The ${items.length.toLocaleString()} above are what's left.`
    : '';
  summaryScreen.classList.remove('hidden');
}

function beginSwiping() {
  summaryScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  active = true;
  index = 0;
  keptCount = 0;
  discardedCount = 0;
  failedCount = 0;
  consecutiveFails = 0;
  decisionTimes.length = 0;
  renderGrid();
  updateCounter();
  next();
}

function resetToStart() {
  try { window.api.abortSession(); } catch {}
  summaryScreen.classList.add('hidden');
  appEl.classList.add('hidden');
  doneScreen.classList.add('hidden');
  blockedScreen.classList.add('hidden');
  items = []; index = 0; history.length = 0; recent.length = 0;
  keptCount = 0; discardedCount = 0; failedCount = 0; consecutiveFails = 0;
  active = false; busy = false;
  startScreen.classList.remove('hidden');
}

function next() {
  if (index >= items.length) { showDone(); return; }
  renderCard(items[index]);
  filenameEl.textContent = items[index].name;
}

function renderCard(item) {
  cardArea.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = TYPE_LABEL[item.type];
  card.appendChild(badge);

  let media;
  if (item.type === 'pics') {
    media = document.createElement('img');
    media.draggable = false;
    media.onerror = () => markCardUnreadable(card);
    if (/\.(heic|heif)$/i.test(item.name)) {
      window.api.preview(item.path)
        .then((url) => {
          if (!media.isConnected) return;
          if (url) media.src = url; else markCardUnreadable(card);
        })
        .catch(() => markCardUnreadable(card));
    } else {
      media.src = mediaUrl(item.path);
    }
  } else if (item.type === 'vids') {
    media = document.createElement('video');
    media.src = mediaUrl(item.path);
    media.controls = true;
    media.onerror = () => markCardUnreadable(card);
  } else {
    media = document.createElement('div');
    media.className = 'audio-card';
    const icon = document.createElement('div');
    icon.className = 'audio-ic';
    icon.textContent = '♪';
    const audio = document.createElement('audio');
    audio.src = mediaUrl(item.path);
    audio.controls = true;
    media.append(icon, audio);
  }
  card.appendChild(media);
  cardArea.appendChild(card);
  attachDrag(card);
}

function markCardUnreadable(card) {
  if (!card || card.querySelector('.card-error')) return;
  card.classList.add('unreadable');
  const note = document.createElement('div');
  note.className = 'card-error';
  note.textContent = '⚠ Can’t preview this file — it may be missing or not downloaded from iCloud. You can still bin or skip it.';
  card.appendChild(note);
}

function attachDrag(card) {
  let dragging = false;
  let startX = 0, startY = 0, dx = 0, dy = 0;

  card.addEventListener('pointerdown', (e) => {
    if (['VIDEO', 'AUDIO', 'INPUT', 'BUTTON'].includes(e.target.tagName)) return;
    if (busy) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY; dx = 0; dy = 0;
    card.setPointerCapture(e.pointerId);
    card.style.transition = 'none';
  });

  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 22}deg)`;
    card.classList.toggle('hint-keep', dx > 40);
    card.classList.toggle('hint-no', dx < -40);
  });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('hint-keep', 'hint-no');
    card.style.transition = 'transform 0.3s ease';
    if (dx > 120) commit('keep');
    else if (dx < -120) commit('discard');
    else card.style.transform = '';
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

async function commit(action) {
  if (busy || index >= items.length) return;
  busy = true;

  const card = cardArea.querySelector('.card');
  if (card) {
    const dir = action === 'keep' ? 1 : -1;
    card.style.transition = 'transform 0.35s ease, opacity 0.35s ease';
    card.style.transform = `translateX(${dir * 1400}px) rotate(${dir * 25}deg)`;
    card.style.opacity = '0';
  }

  const item = items[index];
  let entry;
  try {
    if (action === 'keep') {
      const res = await window.api.keep(item);
      entry = { action, original: item.path, current: res.path, item: { path: res.path, type: item.type, name: item.name } };
      keptCount++;
      addToGrid(entry.item);
    } else {
      const res = await window.api.discard(item);
      entry = { action, original: item.path, current: res.staged, item };
      discardedCount++;
    }
    history.push(entry);
    if (history.length > MAX_HISTORY) history.shift();
    consecutiveFails = 0;
  } catch (err) {
    busy = false;
    failedCount++;
    consecutiveFails++;
    index++;
    if (consecutiveFails >= FAIL_STOP_THRESHOLD) { showBlocked(err); return; }
    toast(`Skipped (couldn't ${action}): ${item.name}`);
    updateCounter();
    next();
    return;
  }

  decisionTimes.push(performance.now());
  if (decisionTimes.length > 25) decisionTimes.shift();

  index++;
  await wait(330);
  busy = false;
  updateCounter();
  next();
}

async function undo() {
  if (busy || !history.length) return;
  busy = true;
  const entry = history.pop();
  try {
    await window.api.undo({ action: entry.action, current: entry.current, original: entry.original });
  } catch (err) {
    history.push(entry);
    busy = false;
    alert('Undo failed:\n' + (err && err.message ? err.message : err));
    return;
  }
  if (entry.action === 'keep') {
    keptCount--;
    removeFromGrid(entry.current);
  } else {
    discardedCount--;
  }
  index = Math.max(0, index - 1);
  doneScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  busy = false;
  updateCounter();
  next();
}

function etaText() {
  const remaining = items.length - index;
  if (decisionTimes.length < 2 || remaining <= 0) return '';
  const span = decisionTimes[decisionTimes.length - 1] - decisionTimes[0];
  if (span <= 0) return '';
  const per = span / (decisionTimes.length - 1);
  return '~' + formatDuration(per * remaining) + ' left';
}

function updateCounter() {
  if (!active) { counterEl.textContent = ''; return; }
  const remaining = Math.max(0, items.length - index);
  const eta = etaText();
  counterEl.textContent =
    `${index.toLocaleString()} / ${items.length.toLocaleString()} reviewed   ·   ✓ ${keptCount}   ✕ ${discardedCount}` +
    (failedCount ? `   ·   ⚠ ${failedCount} skipped` : '') +
    `   ·   ${remaining.toLocaleString()} left${eta ? '   ·   ' + eta : ''}`;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2800);
}

function showBlocked(err) {
  active = false;
  busy = false;
  appEl.classList.add('hidden');
  const perm = err && (err.code === 'EACCES' || err.code === 'EPERM');
  blockedMsg.textContent = perm
    ? `${FAIL_STOP_THRESHOLD} files in a row couldn't be moved — "permission denied".\n\n` +
      `Moving a file needs WRITE access to the folder it currently lives in (reading it doesn't — that's why you can still see them). Likely causes:\n` +
      `• The source folders are read-only. Fix in Terminal:  chmod -R u+w "<your source folder>"\n` +
      `• macOS Full Disk Access not granted (System Settings › Privacy & Security).\n` +
      `• iCloud files not downloaded (Finder → right-click → Download Now).\n\n` +
      `Fix it, then relaunch on the same folder to continue. Skipped files stay where they are.`
    : `${FAIL_STOP_THRESHOLD} files in a row couldn't be processed:\n${err && err.message ? err.message : err}\n\n` +
      `They've been left in place. You can skip past them or stop here.`;
  blockedScreen.classList.remove('hidden');
}

function resumeFromBlocked() {
  blockedScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  active = true;
  consecutiveFails = 0;
  updateCounter();
  next();
}

async function addToGrid(item) {
  recent.unshift(item);
  if (recent.length > 48) recent.length = 48;
  renderGrid();
  if (item.type !== 'audio' && !item.thumb) {
    try {
      const t = await window.api.thumbnail(item.path);
      if (t) { item.thumb = t; if (recent.includes(item)) renderGrid(); }
    } catch {}
  }
}
function removeFromGrid(currentPath) {
  const i = recent.findIndex((r) => r.path === currentPath);
  if (i >= 0) recent.splice(i, 1);
  renderGrid();
}
function renderGrid() {
  grid.innerHTML = '';
  const shown = recent.slice(0, 12);
  for (const r of shown) {
    const cell = document.createElement('div');
    cell.className = 'thumb';
    if (r.thumb) {
      const img = document.createElement('img');
      img.src = r.thumb;
      cell.appendChild(img);
    } else {
      const g = document.createElement('div');
      g.className = 'thumb-glyph';
      g.textContent = TYPE_GLYPH[r.type] || '♪';
      cell.appendChild(g);
    }
    grid.appendChild(cell);
  }
  for (let i = shown.length; i < 12; i++) {
    const cell = document.createElement('div');
    cell.className = 'thumb empty';
    grid.appendChild(cell);
  }
}

function showDone() {
  active = true;
  appEl.classList.add('hidden');
  doneFinishBtn.classList.remove('hidden');
  doneSummary.textContent =
    `Reviewed ${items.length.toLocaleString()} file(s) · Kept ${keptCount} · Discarded ${discardedCount}` +
    (failedCount ? ` · ${failedCount} skipped (couldn't be moved — left in place)` : '') + '. ' +
    `Discards go to the Recycle Bin when you click Finish (or when you quit).`;
  doneScreen.classList.remove('hidden');
}

async function finalize() {
  if (busy) return;
  busy = true;
  let res;
  try {
    res = await window.api.finish();
  } catch (err) {
    busy = false;
    alert('Could not empty staged files to the Recycle Bin:\n' + (err && err.message ? err.message : err));
    return;
  }
  busy = false;
  active = false;
  appEl.classList.add('hidden');
  doneScreen.classList.remove('hidden');
  doneSummary.textContent =
    `Done! Kept ${keptCount} file(s). Sent ${res.trashed} to the Recycle Bin. You can close the app now.`;
  doneFinishBtn.classList.add('hidden');
  finishBtn.disabled = true;
}

summaryStartBtn.addEventListener('click', beginSwiping);
summaryCancelBtn.addEventListener('click', resetToStart);
blockedResumeBtn.addEventListener('click', resumeFromBlocked);
blockedFinishBtn.addEventListener('click', finalize);
document.getElementById('yesBtn').addEventListener('click', () => commit('keep'));
document.getElementById('noBtn').addEventListener('click', () => commit('discard'));
document.getElementById('undoBtn').addEventListener('click', undo);
finishBtn.addEventListener('click', finalize);
doneFinishBtn.addEventListener('click', finalize);

window.addEventListener('keydown', (e) => {
  if (!active) return;
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight') commit('keep');
  else if (e.key === 'ArrowLeft') commit('discard');
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
});