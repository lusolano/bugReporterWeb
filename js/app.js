import { Config } from './config.js';
import { Auth }   from './auth.js';
import { Drive }  from './drive.js';
import { Sheets } from './sheets.js';
import { Capture } from './capture.js';
import { Speech, TranscriptionParser } from './speech.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function show(id)  { $(id).classList.add('active'); }
function hide(id)  { $(id).classList.remove('active'); }

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`)?.classList.add('active');
}

function showLoading(text = 'Cargando...') {
  $('loading-text').textContent = text;
  $('loading-overlay').classList.add('open');
}
function hideLoading() { $('loading-overlay').classList.remove('open'); }

function showToast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `${type}`;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function openDialog(id)  { $(id).classList.add('open'); }
function closeDialog(id) { $(id).classList.remove('open'); }

// ── Config screen state ───────────────────────────────────────────────────────
const folderNav = [];   // stack of {id, name}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  Speech.init();

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Auth callbacks
  Auth.onSignIn(() => {
    updateAccountScreen();
    updateHomeWarnings();
    showToast('Sesión iniciada', 'success');
  });
  Auth.onSignOut(() => {
    updateAccountScreen();
    updateHomeWarnings();
    showToast('Sesión cerrada');
  });
  Auth.onError(err => showToast(`Error de autenticación: ${err}`, 'error'));

  await Auth.init().catch(() => {});

  wireEvents();
  updateAccountScreen();
  updateConfigScreen();
  updateHomeWarnings();
  showScreen('home');
}

// ── Home Screen ───────────────────────────────────────────────────────────────
function updateHomeWarnings() {
  const notSignedIn  = $('home-warn-signin');
  const notConfigured = $('home-warn-config');
  const btns          = $('home-btns');

  const signedIn  = Config.isSignedIn();
  const configured = Config.isConfigured();

  notSignedIn.style.display   = signedIn  ? 'none' : 'block';
  notConfigured.style.display = (signedIn && !configured) ? 'block' : 'none';
  btns.style.opacity          = (signedIn && configured) ? '1' : '0.4';
  btns.style.pointerEvents    = (signedIn && configured) ? '' : 'none';
}

// ── Account Screen ────────────────────────────────────────────────────────────
function updateAccountScreen() {
  const user = Config.getUser();
  if (user.email) {
    $('account-info').style.display = 'block';
    $('account-email').textContent  = user.email;
    $('account-name').textContent   = user.name || '';
    $('btn-signout').style.display  = 'block';
    $('btn-signin').style.display   = 'none';
  } else {
    $('account-info').style.display = 'none';
    $('btn-signout').style.display  = 'none';
    $('btn-signin').style.display   = 'block';
  }
}

// ── Config Screen ─────────────────────────────────────────────────────────────
function updateConfigScreen() {
  const sheet  = Config.getSpreadsheet();
  const folder = Config.getFolder();
  const tab    = Config.getSheetTab();

  $('cfg-sheet-name').value  = sheet.name  || '';
  $('cfg-sheet-id').value    = sheet.id    || '';
  $('cfg-tab-name').value    = tab;
  $('cfg-folder-name').value = folder.name || '';
  $('cfg-folder-id').value   = folder.id   || '';
}

// ── Sheet Picker ──────────────────────────────────────────────────────────────
async function openSheetPicker() {
  if (!Config.isSignedIn()) { showToast('Inicia sesión primero', 'error'); return; }
  showLoading('Cargando hojas...');
  try {
    const files = await Drive.listSpreadsheets();
    const list  = $('sheet-picker-list');
    list.innerHTML = '';
    if (!files.length) {
      list.innerHTML = '<p style="color:#666;font-size:13px;padding:8px">No se encontraron hojas de cálculo.</p>';
    }
    files.forEach(f => {
      const item = document.createElement('div');
      item.className = 'dialog-item';
      item.innerHTML = `<span class="item-icon">📄</span><span class="item-name">${f.name}</span>`;
      item.onclick = () => {
        Config.setSpreadsheet(f.id, f.name);
        updateConfigScreen();
        closeDialog('sheet-picker-dialog');
        showToast(`Hoja "${f.name}" seleccionada`, 'success');
      };
      list.appendChild(item);
    });
    openDialog('sheet-picker-dialog');
  } catch (e) {
    showToast('Error al cargar hojas: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

// ── Folder Picker ─────────────────────────────────────────────────────────────
async function openFolderPicker() {
  if (!Config.isSignedIn()) { showToast('Inicia sesión primero', 'error'); return; }
  folderNav.length = 0;
  await loadFolderLevel('root', 'Mi Drive');
  openDialog('folder-picker-dialog');
}

async function loadFolderLevel(folderId, folderName) {
  showLoading('Cargando carpetas...');
  try {
    const folders = await Drive.listFolders(folderId);
    renderFolderBreadcrumb();
    renderFolderList(folders, folderId, folderName);
  } catch (e) {
    showToast('Error al cargar carpetas: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderFolderBreadcrumb() {
  const bc = $('folder-breadcrumb');
  bc.innerHTML = '';

  const rootBtn = document.createElement('button');
  rootBtn.textContent = 'Mi Drive';
  rootBtn.onclick = async () => {
    folderNav.length = 0;
    await loadFolderLevel('root', 'Mi Drive');
  };
  bc.appendChild(rootBtn);

  folderNav.forEach((item, idx) => {
    const sep = document.createElement('span');
    sep.textContent = ' › ';
    bc.appendChild(sep);

    const btn = document.createElement('button');
    btn.textContent = item.name;
    btn.onclick = async () => {
      folderNav.splice(idx + 1);
      await loadFolderLevel(item.id, item.name);
    };
    bc.appendChild(btn);
  });
}

function renderFolderList(folders, currentId, currentName) {
  const list = $('folder-picker-list');
  list.innerHTML = '';

  if (!folders.length) {
    list.innerHTML = '<p style="color:#666;font-size:13px;padding:8px">No hay subcarpetas aquí.</p>';
  }

  folders.forEach(f => {
    const item = document.createElement('div');
    item.className = 'dialog-item';
    item.innerHTML = `<span class="item-icon">📁</span><span class="item-name">${f.name}</span><span class="item-arrow">›</span>`;
    item.onclick = async () => {
      folderNav.push({ id: f.id, name: f.name });
      await loadFolderLevel(f.id, f.name);
    };
    list.appendChild(item);
  });

  // Update "Seleccionar esta carpeta" button
  const okBtn   = $('folder-picker-ok');
  const current = folderNav.length ? folderNav[folderNav.length - 1] : { id: 'root', name: 'Mi Drive' };
  okBtn.textContent = `Seleccionar "${current.name}"`;
  okBtn.onclick = () => {
    Config.setFolder(current.id, current.name);
    updateConfigScreen();
    closeDialog('folder-picker-dialog');
    showToast(`Carpeta "${current.name}" seleccionada`, 'success');
  };
}

// ── Report Screen ─────────────────────────────────────────────────────────────
let reportMediaFile = null;
let reportMediaType = null;
let reportUbicacion = '';
let reportComentario = '';

function startReport(type) {
  reportMediaFile = null;
  reportMediaType = type;
  reportUbicacion  = '';
  reportComentario = '';
  $('report-transcription-card').style.display = 'none';
  $('report-field-ubicacion').value   = '';
  $('report-field-comentario').value  = '';
  $('report-media-preview').innerHTML = '';
  $('report-media-label').textContent = '';
  $('report-step1-status').textContent = '';

  showScreen('report');
  captureMedia(type);
}

async function captureMedia(type) {
  try {
    let file;
    if (type === 'photo') {
      file = await Capture.pickPhoto();
    } else {
      file = await Capture.pickVideo();
    }
    reportMediaFile = file;

    const url   = Capture.createPreviewUrl(file);
    const label = type === 'photo' ? '✅ Foto capturada' : '✅ Video capturado';
    $('report-media-label').innerHTML = `<strong style="color:#2E7D32">${label}</strong>`;

    const preview = $('report-media-preview');
    preview.innerHTML = '';
    if (type === 'photo') {
      const img = document.createElement('img');
      img.src = url;
      preview.appendChild(img);
    } else {
      const vid = document.createElement('video');
      vid.src = url;
      vid.controls = true;
      vid.playsInline = true;
      preview.appendChild(vid);
    }
  } catch (e) {
    if (e.message !== 'No file selected') {
      showToast('No se capturó ningún archivo', 'error');
    }
    showScreen('home');
  }
}

let isRecording = false;

async function toggleRecording() {
  const btn = $('mic-btn');

  if (!isRecording) {
    // Start
    isRecording = true;
    btn.classList.add('recording');
    $('mic-label').textContent = 'Grabando... presione para detener';

    // Start audio recording in background
    try { await Capture.startAudio(); } catch (e) {
      console.warn('Audio recording unavailable:', e.message);
    }

    // Start speech recognition (Android/Chrome)
    if (Speech.isSupported()) {
      try {
        const transcript = await Speech.recognize();
        handleTranscript(transcript);
      } catch {
        // Recognition ended; audio may still be recording
      }
      await stopRecordingFinal();
    }
    // On iOS or unsupported: user must stop manually
  } else {
    await stopRecordingFinal();
  }
}

async function stopRecordingFinal() {
  isRecording = false;
  const btn = $('mic-btn');
  btn.classList.remove('recording');
  $('mic-label').textContent = 'Presione para grabar';

  await Capture.stopAudio().catch(() => null);
}

function handleTranscript(text) {
  if (!text) return;
  const parsed = TranscriptionParser.parse(text);

  $('report-raw-transcript').textContent = text;
  $('report-transcription-card').style.display = 'block';

  if (parsed.ubicacion)  $('report-field-ubicacion').value  = parsed.ubicacion;
  if (parsed.comentario) $('report-field-comentario').value = parsed.comentario;
}

async function submitReport() {
  const ubicacion   = $('report-field-ubicacion').value.trim();
  const comentario  = $('report-field-comentario').value.trim();

  if (!reportMediaFile) {
    showToast('Capture una foto o video primero', 'error');
    return;
  }
  if (!ubicacion) {
    showToast('Ingrese la ubicación', 'error');
    return;
  }

  const { id: spreadsheetId } = Config.getSpreadsheet();
  const { id: folderId }      = Config.getFolder();
  const sheetName             = Config.getSheetTab();

  if (!spreadsheetId || !folderId) {
    showToast('Configure la hoja y carpeta primero', 'error');
    return;
  }

  showLoading('Enviando reporte...');
  try {
    // 1. Get/create today's subfolder
    showLoading('Preparando carpeta del día...');
    const daily = await Drive.getOrCreateDailyFolder(folderId);

    // 2. Upload media
    showLoading('Subiendo archivo...');
    let photoFileId = null;
    let videoFileId = null;

    if (reportMediaType === 'photo') {
      const uploaded = await Drive.uploadImage(reportMediaFile, daily.id);
      photoFileId = uploaded.id;
      await Drive.makePublic(photoFileId).catch(() => {});
    } else {
      const uploaded = await Drive.uploadVideo(reportMediaFile, daily.id);
      videoFileId = uploaded.id;
    }

    // 3. Upload audio if available
    const audioBlob = Capture.getAudioBlob();
    if (audioBlob) {
      showLoading('Subiendo audio...');
      const ext = Capture.getAudioExtension();
      await Drive.uploadAudio(audioBlob, ext, daily.id);
    }

    // 4. Ensure headers, then append row
    showLoading('Guardando en hoja de cálculo...');
    const { name: userName, email: userEmail } = Config.getUser();
    const reportedBy = userName || userEmail || '';
    await Sheets.ensureHeaders(spreadsheetId, sheetName);
    await Sheets.appendReport({ spreadsheetId, sheetName, reportedBy, ubicacion, comentario, photoFileId, videoFileId });

    // 5. Done
    Capture.clearMedia();
    Capture.clearAudio();
    hideLoading();
    showToast('¡Reporte enviado!', 'success');
    showScreen('home');
  } catch (e) {
    hideLoading();
    showToast('Error: ' + e.message, 'error');
    console.error(e);
  }
}

// ── Wire All Events ───────────────────────────────────────────────────────────
function wireEvents() {
  // Home
  $('btn-photo').onclick = () => startReport('photo');
  $('btn-video').onclick = () => startReport('video');
  $('home-btn-settings').onclick = () => { updateAccountScreen(); showScreen('account'); };
  $('home-btn-config').onclick   = () => { updateConfigScreen(); showScreen('config'); };

  // Account
  $('account-back').onclick  = () => showScreen('home');
  $('btn-signin').onclick    = () => Auth.signIn();
  $('btn-signout').onclick   = () => Auth.signOut();

  // Config
  $('config-back').onclick          = () => { updateHomeWarnings(); showScreen('home'); };
  $('btn-pick-sheet').onclick       = openSheetPicker;
  $('btn-pick-folder').onclick      = openFolderPicker;
  $('cfg-tab-name').oninput         = e => Config.setSheetTab(e.target.value.trim() || 'Hoja 1');

  // Sheet picker dialog
  $('sheet-picker-cancel').onclick  = () => closeDialog('sheet-picker-dialog');

  // Folder picker dialog
  $('folder-picker-cancel').onclick = () => closeDialog('folder-picker-dialog');

  // Report
  $('report-back').onclick      = () => { Capture.clearMedia(); Capture.clearAudio(); showScreen('home'); };
  $('mic-btn').onclick           = toggleRecording;
  $('report-submit').onclick     = submitReport;

  // Show/hide manual hint based on speech support
  const hint = $('speech-unsupported-hint');
  if (hint) hint.style.display = Speech.isSupported() ? 'none' : 'block';
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    await init();
  } catch (e) {
    console.error('init failed:', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
