import { getAllMemories, saveMemory, removeMemory, clearMemories } from './storage.js';
import { EtherScene } from './scene3d.js';

const $ = id => document.getElementById(id);
const photoInput = $('fileInput');
const memoryDialog = $('memoryDialog');
const confirmDialog = $('confirmDialog');
let sceneController = null;
const reduceMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
    image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取图片，文件可能已损坏。')); };
    image.src = url;
  });
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
  const knownHashes = new Set(memories.map(memory => memory.hash).filter(Boolean));
  let nextOrder = Math.max(-1, ...memories.map(memory => memory.order)) + 1;
  for (const file of files) {
    if (!SUPPORTED.has(file.type)) { issues.push(`${file.name}: 格式不支持`); continue; }
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
      issues.push(`${file.name}: ${error.message === '本机保存失败' ? '本机空间不足或无法保存' : '无法读取图片，请尝试重新导入'}`);
    }
  }
  if (added.length) {
    memories.push(...added);
    if (memories.length === added.length) $('emptyState').classList.add('leaving');
    renderScene(new Set(added.map(item => item.id)));
    showToast(`已放入 ${added.length} 张照片，保存在此设备。`);
  }
  if (issues.length) showToast(issues.slice(0, 2).join('；') + (issues.length > 2 ? `；另有 ${issues.length - 2} 项未导入` : ''), 6000);
  photoInput.value = '';
  photoInput.disabled = false;
  importBusy = false;
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
  updatePuzzleHint(sceneController.puzzleStatus());
  memoryDialog.hidden = false;
  $('experience').classList.add('memory-open');
  $('closeViewer').focus();
  $('liveRegion').textContent = `第 ${index + 1} 张照片已打开`;
}

async function closeMemory() {
  if (!activeId) return;
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

photoInput.addEventListener('change', () => importFiles([...photoInput.files]));
document.querySelectorAll('label[for="fileInput"]').forEach(label => label.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); photoInput.click(); }
}));
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
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
});

seedDust();
if (reduced) document.documentElement.classList.add('reduced-motion');
loadMemories();
