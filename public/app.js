import { getAllMemories, saveMemory, removeMemory, clearMemories } from './storage.js';
import { EtherScene } from './scene3d.js';
import { MemoryMusic } from './music.js';

const $ = id => document.getElementById(id);
const photoInput = $('fileInput');
const musicFileInput = $('musicFileInput');
const memoryDialog = $('memoryDialog');
const confirmDialog = $('confirmDialog');
let sceneController = null;
const reduceMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_MUSIC_BYTES = 50 * 1024 * 1024;
const IMAGE_FILE_NAME = /\.(?:avif|gif|heic|heif|jpe?g|png|webp)$/i;
const UNSUPPORTED_IMAGE_TYPES = new Set(['image/svg+xml']);

let memories = [];
let objectUrls = new Map();
let activeId = null;
let importBusy = false;
let reduced = reduceMotionQuery.matches;
let historyIndex = 0;
let historyTimer = null;
let toastTimer = null;
let editTimer = null;
let confirmMode = 'single';
let musicPlayer = null;

function id() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function escapeText(value = '') { return value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]); }
function labelFor(memory) { return memory.date || memory.title || ''; }

function showToast(message, duration = 2900) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}

function resetView() { sceneController?.resetCamera(); }

function activeMemory() { return memories.find(item => item.id === activeId) || null; }

function updateMusicPlaybackButton() {
  const memory = activeMemory();
  const choice = memory?.musicTrack || 'none';
  const playable = choice === 'starlight' || choice === 'tide' || choice === 'dusk' || (choice === 'local' && memory?.musicBlob);
  const button = $('musicPlay');
  button.disabled = !playable;
  button.textContent = musicPlayer?.playing ? 'Ⅱ 暂停' : '▶ 播放';
  button.setAttribute('aria-label', musicPlayer?.playing ? '暂停音乐' : '播放音乐');
}

function updateMusicControls(memory = activeMemory()) {
  if (!memory) return;
  const select = $('musicSelect');
  const localOption = select.querySelector('option[value="local"]');
  localOption.disabled = !memory.musicBlob;
  localOption.textContent = memory.musicBlob
    ? `本地音乐 · ${memory.musicName || '已选择音频'}`
    : '本地音乐（先选择音频）';
  select.value = memory.musicTrack || 'none';
  $('musicTrackLabel').textContent = memory.musicTrack === 'local' && memory.musicName
    ? `仅保存在此设备 · ${memory.musicName}`
    : '音乐只在这张照片打开时播放';
  updateMusicPlaybackButton();
}

function startSelectedMusic(memory) {
  if (!memory || !memory.musicTrack || memory.musicTrack === 'none') {
    musicPlayer.stop();
    return Promise.resolve();
  }
  if (memory.musicTrack === 'local') return musicPlayer.playLocal(memory.musicBlob);
  return musicPlayer.playPreset(memory.musicTrack);
}

async function setMusicTrack(trackId) {
  const memory = activeMemory();
  if (!memory) return;
  if (trackId === 'local' && !memory.musicBlob) {
    $('musicSelect').value = memory.musicTrack || 'none';
    showToast('先选择一段保存在本机的音频。');
    return;
  }
  const previousTrack = memory.musicTrack;
  memory.musicTrack = trackId;
  updateMusicControls(memory);
  const playback = startSelectedMusic(memory).catch(error => {
    showToast(error.message || '音乐无法播放，请尝试其他音频。');
    updateMusicPlaybackButton();
  });
  try {
    await saveMemory(memory);
  } catch {
    if (previousTrack === undefined) delete memory.musicTrack;
    else memory.musicTrack = previousTrack;
    updateMusicControls(memory);
    await startSelectedMusic(memory).catch(() => {});
    showToast('音乐选择未能保存到此设备。');
  }
  await playback;
}

async function chooseLocalMusic(file) {
  const memory = activeMemory();
  if (!memory || !file) return;
  if (!file.type.startsWith('audio/')) {
    showToast('请选择音频文件。');
    return;
  }
  if (file.size > MAX_MUSIC_BYTES) {
    showToast('音频文件不能超过 50 MB。');
    return;
  }
  const previous = { musicBlob: memory.musicBlob, musicName: memory.musicName, musicTrack: memory.musicTrack };
  memory.musicBlob = new Blob([file], { type: file.type });
  memory.musicName = file.name;
  memory.musicTrack = 'local';
  updateMusicControls(memory);
  const playback = musicPlayer.playLocal(memory.musicBlob).catch(error => {
    showToast(error.message || '音频无法播放，请尝试其他文件格式。');
    updateMusicPlaybackButton();
  });
  try {
    await saveMemory(memory);
    showToast('已为这张照片保存本地音乐。');
  } catch {
    Object.assign(memory, previous);
    musicPlayer.stop();
    updateMusicControls(memory);
    showToast('本机存储空间不足，音频没有保存。');
  }
  await playback;
}

function revokeUrl(memoryId) {
  const url = objectUrls.get(memoryId);
  if (url) URL.revokeObjectURL(url);
  objectUrls.delete(memoryId);
}

function urlFor(memory) {
  if (!objectUrls.has(memory.id)) objectUrls.set(memory.id, URL.createObjectURL(memory.preview || memory.blob));
  return objectUrls.get(memory.id);
}

function renderScene() {
  sceneController?.setMemories(memories);
  const accessList = $('photoAccessList');
  accessList.replaceChildren();
  memories.forEach((memory, index) => {
    const button = document.createElement('button');
    const readable = [memory.date, memory.title].filter(Boolean).join('，');
    button.type = 'button';
    button.textContent = readable ? `打开照片：${readable}` : `打开第 ${index + 1} 张照片`;
    button.addEventListener('click', () => openMemory(memory.id));
    accessList.append(button);
  });
  const hasMemories = memories.length > 0;
  $('emptyState').hidden = hasMemories;
  $('sceneCaption').hidden = !hasMemories;
  $('bottomBar').hidden = !hasMemories;
  $('photoCount').textContent = `${String(memories.length).padStart(2, '0')} 段记忆`;
}

async function loadMemories() {
  try {
    memories = await getAllMemories();
    renderScene();
  } catch {
    showToast('无法读取此浏览器的本地记忆。请检查浏览器存储设置。', 5500);
  }
}

function validateImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    let timer;
    const fail = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      const error = new Error('无法读取图片，文件可能已损坏。');
      error.code = 'image-decode';
      reject(error);
    };
    image.onload = () => { clearTimeout(timer); URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = fail;
    timer = setTimeout(fail, 15000);
    image.src = url;
  });
}

function canAttemptImage(file) {
  const type = file.type.toLowerCase();
  return !UNSUPPORTED_IMAGE_TYPES.has(type) && (type.startsWith('image/') || IMAGE_FILE_NAME.test(file.name));
}

function importIssue(file, error) {
  if (error?.message === '本机保存失败' || error?.name === 'QuotaExceededError') return `${file.name}: 本机存储空间不足或不可用`;
  if (error?.code === 'image-decode') return `${file.name}: 此浏览器无法读取该图片，请使用 JPG、PNG 或 WebP`;
  return `${file.name}: 无法导入，请重新选择后再试`;
}

async function makePreview(file, dimensions) {
  const scale = Math.min(1, 1800 / Math.max(dimensions.width, dimensions.height));
  const width = Math.max(1, Math.round(dimensions.width * scale));
  const height = Math.max(1, Math.round(dimensions.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { alpha: file.type === 'image/png' });
  if (!context) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    context.drawImage(bitmap, 0, 0, width, height);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      context.drawImage(image, 0, 0, width, height);
    } finally { URL.revokeObjectURL(url); }
  } finally { bitmap?.close(); }
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob || file), 'image/webp', .88));
}

async function contentHash(file) {
  if (!crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function importFiles(files) {
  if (importBusy) return;
  importBusy = true;
  photoInput.disabled = true;
  const added = [];
  const issues = [];
  try {
    const knownHashes = new Set(memories.map(memory => memory.hash).filter(Boolean));
    let nextOrder = Math.max(-1, ...memories.map(memory => memory.order)) + 1;
    for (const file of files) {
      if (!canAttemptImage(file)) { issues.push(`${file.name}: 请选择常见图片格式`); continue; }
      if (file.size > MAX_FILE_BYTES) { issues.push(`${file.name}: 超过 25 MB`); continue; }
      try {
        const dimensions = await validateImage(file);
        const hash = await contentHash(file);
        if (hash && knownHashes.has(hash)) { issues.push(`${file.name}: 已在记忆中`); continue; }
        if (hash) knownHashes.add(hash);
        const preview = await makePreview(file, dimensions);
        const memory = { id: id(), blob: new Blob([file], { type: file.type }), preview, hash, width: dimensions.width, height: dimensions.height, title: '', date: '', note: '', order: nextOrder++, created: Date.now() };
        await saveMemory(memory);
        added.push(memory);
      } catch (error) {
        issues.push(importIssue(file, error));
      }
    }
    if (added.length) {
      memories.push(...added);
      if (memories.length === added.length) $('emptyState').classList.add('leaving');
      renderScene(new Set(added.map(item => item.id)));
      showToast(`已放入 ${added.length} 张照片，保存在此设备。`);
    }
    if (issues.length) showToast(issues.slice(0, 2).join('；') + (issues.length > 2 ? `；另有 ${issues.length - 2} 项未导入` : ''), 6000);
  } catch (error) {
    console.error('ETHER import error', error);
    showToast('照片导入中断，请刷新页面后重试。', 5500);
  } finally {
    photoInput.value = '';
    photoInput.disabled = false;
    importBusy = false;
  }
}

function openMemory(memoryId) {
  if (activeId) return;
  const memory = memories.find(item => item.id === memoryId);
  if (!memory || !sceneController?.openCollage(memoryId)) return;
  activeId = memoryId;
  const index = memories.indexOf(memory);
  $('editDate').value = memory.date;
  $('editTitle').value = memory.title;
  $('editNote').value = memory.note;
  $('saveState').textContent = '仅保存在此设备';
  $('editPanel').hidden = true;
  $('editToggle').setAttribute('aria-expanded', 'false');
  $('dialogTitle').textContent = memory.title ? `A FRAGMENT OF ${memory.title.toUpperCase()}` : 'A PHOTOGRAPH IN PIECES';
  updateMusicControls(memory);
  startSelectedMusic(memory).catch(error => {
    showToast(error.message || '音乐无法播放，请检查音频格式。');
    updateMusicPlaybackButton();
  });
  updatePuzzleHint(sceneController.puzzleStatus());
  memoryDialog.hidden = false;
  $('experience').classList.add('memory-open');
  $('closeViewer').focus();
  $('liveRegion').textContent = `第 ${index + 1} 张照片已打开`;
}

async function closeMemory() {
  if (!activeId) return;
  musicPlayer.stop();
  if (editTimer) {
    clearTimeout(editTimer);
    editTimer = null;
    await saveEdits();
  }
  $('viewerHint').textContent = '正在将纸片拼回原照片…';
  $('restorePhoto').disabled = true;
  $('closeViewer').disabled = true;
  sceneController?.restorePhoto(activeId);
}

function finishMemoryRestore(memoryId) {
  if (activeId !== memoryId) return;
  musicPlayer.stop();
  activeId = null;
  $('editPanel').hidden = true;
  $('editToggle').setAttribute('aria-expanded', 'false');
  $('restorePhoto').disabled = false;
  $('closeViewer').disabled = false;
  memoryDialog.hidden = true;
  $('experience').classList.remove('memory-open');
  renderScene();
}

function toggleEditor() {
  const panel = $('editPanel');
  panel.hidden = !panel.hidden;
  $('editToggle').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) $('editDate').focus();
}

async function saveEdits() {
  const memory = memories.find(item => item.id === activeId);
  if (!memory) return;
  memory.date = $('editDate').value.trim();
  memory.title = $('editTitle').value.trim();
  memory.note = $('editNote').value;
  $('dialogTitle').textContent = memory.title ? `A FRAGMENT OF ${memory.title.toUpperCase()}` : 'A PHOTOGRAPH IN PIECES';
  $('saveState').textContent = '正在保存…';
  try {
    await saveMemory(memory);
    $('saveState').textContent = '已保存在此设备';
    renderScene();
  } catch {
    $('saveState').textContent = '保存失败';
    showToast('无法保存更改，请检查浏览器空间。');
  }
}

async function deleteActive() {
  const memory = memories.find(item => item.id === activeId);
  if (!memory) return;
  musicPlayer.stop();
  try {
    await removeMemory(memory.id);
    memories = memories.filter(item => item.id !== memory.id);
    revokeUrl(memory.id);
    activeId = null;
    $('editPanel').hidden = true;
    $('restorePhoto').disabled = false;
    $('closeViewer').disabled = false;
    memoryDialog.hidden = true;
    $('experience').classList.remove('memory-open');
    renderScene();
    showToast('照片和对应文字已从此设备删除。');
  } catch {
    showToast('删除失败，请稍后重试。');
  }
}

async function deleteAll() {
  try {
    musicPlayer.stop();
    await clearMemories();
    for (const memory of memories) revokeUrl(memory.id);
    memories = [];
    activeId = null;
    $('restorePhoto').disabled = false;
    $('closeViewer').disabled = false;
    memoryDialog.hidden = true;
    $('experience').classList.remove('memory-open');
    $('editPanel').hidden = true;
    closeHistory();
    renderScene();
    $('emptyState').classList.remove('leaving');
    showToast('此浏览器中的照片和文字记忆已清空。');
  } catch {
    showToast('无法清空本地记忆，请稍后重试。');
  }
}

function prepareConfirmation(mode) {
  confirmMode = mode;
  const all = mode === 'all';
  $('confirmEyebrow').textContent = all ? 'CLEAR THIS QUIET PLACE?' : 'LET THIS MOMENT GO?';
  $('confirmTitle').textContent = all ? '清空全部记忆？' : '删除这张照片？';
  $('confirmCopy').textContent = all ? '此浏览器中保存的所有照片和记忆文字都会被移除。此操作无法撤销。' : '照片和它的记忆文字会从此浏览器中移除。';
  $('confirmDelete').textContent = all ? '全部清空' : '删除';
  confirmDialog.showModal();
}

function openHistory() {
  if (!memories.length) return;
  historyIndex = memories.findIndex(item => item.id === activeId);
  if (historyIndex < 0) historyIndex = 0;
  $('historyRange').max = String(memories.length - 1);
  $('historyPanel').hidden = false;
  renderHistory();
  $('historyToggle').setAttribute('aria-expanded', 'true');
  $('historyRange').focus();
}

function renderHistory() {
  if (!memories.length) return;
  const memory = memories[historyIndex];
  $('historyRange').value = String(historyIndex);
  $('historyPosition').textContent = `${String(historyIndex + 1).padStart(2, '0')} / ${String(memories.length).padStart(2, '0')}`;
  $('historyLabel').textContent = labelFor(memory) || `第 ${historyIndex + 1} 张 · 按导入顺序`;
  sceneController?.focusMemory(memory.id);
}

function setHistoryIndex(index) {
  historyIndex = Math.max(0, Math.min(memories.length - 1, index));
  renderHistory();
}

function closeHistory() {
  clearInterval(historyTimer);
  historyTimer = null;
  $('historyPanel').hidden = true;
  $('historyPlay').textContent = 'Ⅱ';
  $('historyPlay').setAttribute('aria-label', '继续回望');
  $('historyToggle').setAttribute('aria-expanded', 'false');
  sceneController?.focusMemory(null);
  renderScene();
}

function toggleHistoryPlay() {
  if (historyTimer) {
    clearInterval(historyTimer); historyTimer = null;
    $('historyPlay').textContent = '▶';
    $('historyPlay').setAttribute('aria-label', '继续回望');
    return;
  }
  if (historyIndex >= memories.length - 1) setHistoryIndex(0);
  $('historyPlay').textContent = 'Ⅱ';
  $('historyPlay').setAttribute('aria-label', '暂停回望');
  historyTimer = setInterval(() => {
    if (historyIndex >= memories.length - 1) { clearInterval(historyTimer); historyTimer = null; $('historyPlay').textContent = '▶'; $('historyPlay').setAttribute('aria-label', '继续回望'); return; }
    setHistoryIndex(historyIndex + 1);
  }, reduced ? 1700 : 2600);
}

function seedDust() {
  const container = $('dust');
  for (let i = 0; i < 30; i++) {
    const dot = document.createElement('span');
    dot.style.left = `${(i * 37 + 11) % 100}%`;
    dot.style.top = `${(i * 61 + 19) % 100}%`;
    dot.style.setProperty('--opacity', String(.12 + (i % 5) * .035));
    dot.style.setProperty('--duration', `${18 + (i % 7) * 4}s`);
    dot.style.setProperty('--delay', `${-(i % 13)}s`);
    dot.style.setProperty('--drift-x', `${(i % 2 ? 1 : -1) * (5 + i % 8)}px`);
    dot.style.setProperty('--drift-y', `${(i % 3 ? -1 : 1) * (4 + i % 7)}px`);
    container.append(dot);
  }
}

musicPlayer = new MemoryMusic(updateMusicPlaybackButton);
musicPlayer.setVolume(Number($('musicVolume').value) / 100);

function openPhotoPicker() {
  if (importBusy) return;
  try {
    if (typeof photoInput.showPicker === 'function') photoInput.showPicker();
    else photoInput.click();
  } catch {
    photoInput.click();
  }
}

photoInput.addEventListener('change', () => { void importFiles([...photoInput.files]); });
[$('choosePhotos'), $('addMorePhotos')].forEach(button => button.addEventListener('click', openPhotoPicker));
musicFileInput.addEventListener('change', async () => {
  await chooseLocalMusic(musicFileInput.files?.[0]);
  musicFileInput.value = '';
});
$('musicSelect').addEventListener('change', () => { void setMusicTrack($('musicSelect').value); });
$('chooseMusic').addEventListener('click', () => musicFileInput.click());
$('musicPlay').addEventListener('click', () => musicPlayer.toggle().catch(error => showToast(error.message || '音乐无法播放，请检查音频格式。')));
$('musicVolume').addEventListener('input', event => musicPlayer.setVolume(Number(event.target.value) / 100));
$('resetView').addEventListener('click', resetView);
$('motionToggle').addEventListener('click', () => {
  reduced = !reduced;
  document.documentElement.classList.toggle('reduced-motion', reduced);
  $('motionToggle').setAttribute('aria-pressed', String(reduced));
  $('motionToggle').title = reduced ? '恢复动态效果' : '降低动态效果';
  sceneController?.setReducedMotion(reduced);
});
$('restorePhoto').addEventListener('click', closeMemory);
$('editToggle').addEventListener('click', toggleEditor);
$('closeViewer').addEventListener('click', closeMemory);
$('deleteButton').addEventListener('click', () => prepareConfirmation('single'));
$('clearAll').addEventListener('click', () => prepareConfirmation('all'));
$('confirmDelete').addEventListener('click', event => { event.preventDefault(); confirmDialog.close(); if (confirmMode === 'all') deleteAll(); else deleteActive(); });
[$('editDate'), $('editTitle'), $('editNote')].forEach(input => input.addEventListener('input', () => {
  $('saveState').textContent = '正在保存…';
  clearTimeout(editTimer);
  editTimer = setTimeout(saveEdits, 320);
}));
$('historyToggle').addEventListener('click', () => $('historyPanel').hidden ? openHistory() : closeHistory());
$('closeHistory').addEventListener('click', closeHistory);
$('historyPrev').addEventListener('click', () => setHistoryIndex(historyIndex - 1));
$('historyNext').addEventListener('click', () => setHistoryIndex(historyIndex + 1));
$('historyRange').addEventListener('input', event => setHistoryIndex(Number(event.target.value)));
$('historyPlay').addEventListener('click', toggleHistoryPlay);

function updatePuzzleHint({ placed, total, complete }) {
  $('viewerHint').textContent = complete
    ? `${placed} / ${total} 块已拼合 · 可拖出纸片重试，或恢复原照片`
    : `${placed} / ${total} 块已归位 · 拖动错位纸片，接近正确位置会自动吸附`;
}

document.addEventListener('keydown', event => {
  const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (event.key === 'Escape') {
    if (confirmDialog.open) return;
    if (!memoryDialog.hidden) { event.preventDefault(); closeMemory(); } else if (!$('historyPanel').hidden) closeHistory(); else resetView();
    return;
  }
  if (editing) return;
  if (memoryDialog.hidden && !$('historyPanel').hidden && event.key === 'ArrowLeft') { event.preventDefault(); setHistoryIndex(historyIndex - 1); }
  if (memoryDialog.hidden && !$('historyPanel').hidden && event.key === 'ArrowRight') { event.preventDefault(); setHistoryIndex(historyIndex + 1); }
  if (memoryDialog.hidden && !$('historyPanel').hidden && event.key === ' ') { event.preventDefault(); toggleHistoryPlay(); }
  if (memoryDialog.hidden && event.key.toLowerCase() === 'r') resetView();
});

reduceMotionQuery.addEventListener?.('change', event => {
  reduced = event.matches;
  document.documentElement.classList.toggle('reduced-motion', reduced);
  $('motionToggle').setAttribute('aria-pressed', String(reduced));
  sceneController?.setReducedMotion(reduced);
});
sceneController = new EtherScene({
  canvas: $('spaceCanvas'),
  getImageUrl: urlFor,
  onOpen: openMemory,
  onRestore: finishMemoryRestore,
  onProgress: updatePuzzleHint,
  onError: error => { console.error('ETHER scene error', error); showToast('无法完成三维照片效果，请刷新页面重试。', 5500); },
  reducedMotion: reduced,
});
window.addEventListener('beforeunload', () => {
  sceneController?.dispose();
  musicPlayer.dispose();
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
});

seedDust();
if (reduced) document.documentElement.classList.add('reduced-motion');
loadMemories();

