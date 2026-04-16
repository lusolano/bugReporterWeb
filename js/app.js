import { Config } from './config.js';
import { Auth }   from './auth.js';
import { Drive }  from './drive.js';
import { Sheets } from './sheets.js';
import { Capture } from './capture.js';
import { Speech, TranscriptionParser } from './speech.js';
import { Queue, isNetworkError } from './queue.js';

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
function setLoadingText(text) { $('loading-text').textContent = text; }
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
    processQueue().catch(e => console.error('Queue drain after sign-in failed:', e));
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

  // Offline queue: refresh chip whenever items are added or removed, and
  // drain the queue both right now and every time the browser comes back online.
  Queue.onChange(() => updatePendingChip());
  updatePendingChip();
  window.addEventListener('online', () => {
    processQueue().catch(e => console.error('Queue drain on online event failed:', e));
  });
  processQueue().catch(e => console.error('Queue drain on boot failed:', e));
}

// ── Home Screen ───────────────────────────────────────────────────────────────
function updateHomeWarnings() {
  const notSignedIn  = $('home-warn-signin');
  const notConfigured = $('home-warn-config');
  const btns          = $('home-btns');

  const signedIn  = Auth.hasValidToken();
  const configured = Config.isConfigured();

  notSignedIn.style.display   = signedIn  ? 'none' : 'block';
  notConfigured.style.display = (signedIn && !configured) ? 'block' : 'none';
  btns.style.opacity          = (signedIn && configured) ? '1' : '0.4';
  btns.style.pointerEvents    = (signedIn && configured) ? '' : 'none';
}

// ── Account Screen ────────────────────────────────────────────────────────────
function updateAccountScreen() {
  const user = Config.getUser();
  const live = Auth.hasValidToken();

  // Show the cached identity whenever we have one — it's useful even without
  // a live session ("you were signed in as X, tap to continue"). But the
  // action button must track the live session: Sign Out only makes sense
  // when there is an actual token to revoke.
  if (user.email) {
    $('account-info').style.display = 'block';
    $('account-email').textContent  = user.email;
    $('account-name').textContent   = user.name || '';
  } else {
    $('account-info').style.display = 'none';
  }
  $('btn-signout').style.display = live ? 'block' : 'none';
  $('btn-signin').style.display  = live ? 'none'  : 'block';
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
  if (!Auth.hasValidToken()) { showToast('Inicia sesión primero', 'error'); return; }
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
  if (!Auth.hasValidToken()) { showToast('Inicia sesión primero', 'error'); return; }
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

/**
 * Step 1 — fired synchronously inside the button click handler so the
 * user-gesture chain is preserved and mobile browsers allow the camera picker.
 * Resets report state, then immediately clicks the hidden file input.
 */
function openCameraPicker(type) {
  reportMediaFile = null;
  reportMediaType = type;
  reportUbicacion  = '';
  reportComentario = '';

  const inputId = type === 'photo' ? 'input-photo' : 'input-video';
  const input   = $(inputId);
  if (!input) { showToast('Input no encontrado', 'error'); return; }
  input.value = '';     // reset so selecting the same file fires onchange
  input.click();
}

/**
 * Step 2 — fired when the user picks a file from the camera picker.
 * Sets up the report screen with the media preview and navigates to it.
 */
function onMediaFileSelected(type, file) {
  if (!file) return;
  reportMediaFile = file;
  reportMediaType = type;

  // Reset the report UI now that we're committing to show it
  $('report-transcription-card').style.display = 'none';
  $('report-field-ubicacion').value   = '';
  $('report-field-comentario').value  = '';

  const url   = URL.createObjectURL(file);
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

  showScreen('report');
}

let isRecording = false;

async function toggleRecording() {
  const btn = $('mic-btn');

  if (!isRecording) {
    // Start
    isRecording = true;
    btn.classList.add('recording');
    $('mic-label').textContent = 'Grabando... presione para detener';

    if (Speech.isSupported()) {
      // IMPORTANT: do NOT start MediaRecorder here.
      // MediaRecorder + SpeechRecognition contend for the microphone on
      // Chromium-based browsers (Chrome/Opera Android). Starting MediaRecorder
      // first causes SpeechRecognition to receive no audio — onresult never
      // fires and the transcript comes back empty.
      try {
        const transcript = await Speech.recognize();
        handleTranscript(transcript);
      } catch (e) {
        // Surface real errors so the user knows why nothing was transcribed.
        // Silence "no-speech" (user just didn't say anything) and "aborted".
        if (e.message && e.message !== 'no-speech' && e.message !== 'aborted') {
          showToast('Error de voz: ' + e.message, 'error');
        }
      }
      await stopRecordingFinal();
    } else {
      // No Speech API (iOS Safari) — fall back to MediaRecorder so the user
      // at least gets an audio blob uploaded. Manual entry of the fields is
      // required; a hint is already shown on the report screen.
      try { await Capture.startAudio(); } catch (e) {
        console.warn('Audio recording unavailable:', e.message);
      }
      showToast('Este navegador no soporta reconocimiento de voz. Escriba el comentario manualmente.', 'error');
      await stopRecordingFinal();
    }
  } else {
    // Toggle off — stop speech recognition if it's still running.
    Speech.stop();
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
  console.log('[transcript]', { raw: text, parsed });

  $('report-raw-transcript').textContent = text;
  $('report-transcription-card').style.display = 'block';

  if (parsed.ubicacion)  $('report-field-ubicacion').value  = parsed.ubicacion;
  if (parsed.comentario) $('report-field-comentario').value = parsed.comentario;
}

/**
 * Build an onProgress callback that rewrites the loading-overlay text in
 * place as bytes stream up. Throttled to whole-percent deltas so we don't
 * thrash the DOM on every XHR progress event.
 */
function makeProgressReporter(label) {
  let last = -1;
  return fraction => {
    const pct = Math.min(100, Math.max(0, Math.floor(fraction * 100)));
    if (pct === last) return;
    last = pct;
    setLoadingText(`${label} ${pct}%`);
  };
}

/**
 * Actually perform the uploads. Works for both a fresh submit and a queued
 * retry — queued items restore `mediaBlob` from IndexedDB (a Blob, not a File),
 * so we reconstruct a File here with the saved name so Drive.upload* helpers
 * can derive the extension.
 */
async function performUpload(payload) {
  const { mediaBlob, mediaName, mediaType, audioBlob, audioExt, ubicacion, comentario, cfg } = payload;
  const { spreadsheetId, folderId, sheetName, reportedBy } = cfg;

  showLoading('Preparando carpeta del día...');
  const daily = await Drive.getOrCreateDailyFolder(folderId);

  let photoFileId = null;
  let videoFileId = null;

  const mediaFile = mediaBlob instanceof File
    ? mediaBlob
    : new File([mediaBlob], mediaName, { type: mediaBlob.type || '' });

  if (mediaType === 'photo') {
    showLoading('Subiendo foto... 0%');
    const uploaded = await Drive.uploadImage(mediaFile, daily.id, makeProgressReporter('Subiendo foto...'));
    photoFileId = uploaded.id;
    await Drive.makePublic(photoFileId).catch(() => {});
  } else {
    showLoading('Subiendo video... 0%');
    const uploaded = await Drive.uploadVideo(mediaFile, daily.id, makeProgressReporter('Subiendo video...'));
    videoFileId = uploaded.id;
  }

  if (audioBlob) {
    showLoading('Subiendo audio... 0%');
    await Drive.uploadAudio(audioBlob, audioExt || 'webm', daily.id, makeProgressReporter('Subiendo audio...'));
  }

  showLoading('Guardando en hoja de cálculo...');
  await Sheets.ensureHeaders(spreadsheetId, sheetName);
  await Sheets.appendReport({ spreadsheetId, sheetName, reportedBy, ubicacion, comentario, photoFileId, videoFileId });
}

// Guard against double-taps / double-clicks while the async upload is
// in flight. Without this the user can fire two uploads of the same media
// on a slow connection, producing duplicate files and duplicate sheet rows.
let isSubmitting = false;

async function submitReport() {
  if (isSubmitting) return;

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

  const { name: userName, email: userEmail } = Config.getUser();
  const reportedBy = userName || userEmail || '';

  const audioBlob = Capture.getAudioBlob();
  const audioExt  = audioBlob ? Capture.getAudioExtension() : null;

  // Capture a full snapshot — if this needs to go to the offline queue, we
  // must retain everything needed to retry later even if the user changes
  // config or signs into a different account in between.
  const payload = {
    mediaBlob: reportMediaFile,
    mediaName: reportMediaFile.name || `capture.${reportMediaType === 'photo' ? 'jpg' : 'mp4'}`,
    mediaType: reportMediaType,
    audioBlob,
    audioExt,
    ubicacion, comentario,
    cfg: { spreadsheetId, folderId, sheetName, reportedBy },
  };

  isSubmitting = true;
  const submitBtn = $('report-submit');
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Enviando...';

  showLoading('Enviando reporte...');
  try {
    await performUpload(payload);
    Capture.clearMedia();
    Capture.clearAudio();
    showToast('¡Reporte enviado!', 'success');
    showScreen('home');
  } catch (e) {
    if (isNetworkError(e)) {
      try {
        await Queue.enqueue(payload);
        Capture.clearMedia();
        Capture.clearAudio();
        showToast('Sin conexión. Reporte guardado para reintentar.', 'success');
        showScreen('home');
      } catch (qErr) {
        showToast('Error al guardar localmente: ' + qErr.message, 'error');
        console.error(qErr);
      }
    } else {
      showToast('Error: ' + e.message, 'error');
      console.error(e);
    }
  } finally {
    hideLoading();
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    isSubmitting = false;
  }
}

// ── Offline queue drain ───────────────────────────────────────────────────────
let _processingQueue = false;

async function processQueue() {
  if (_processingQueue) return;
  if (!Auth.hasValidToken() || !Config.isConfigured()) return;
  if (!navigator.onLine) return;

  _processingQueue = true;
  try {
    const items = await Queue.getAll();
    if (!items.length) return;

    let uploaded = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        showLoading(`Enviando pendiente ${i + 1}/${items.length}...`);
        await performUpload(item);
        await Queue.remove(item.id);
        uploaded++;
      } catch (err) {
        if (isNetworkError(err)) break; // back offline — try again later
        // Non-network failure: drop so it doesn't block the queue forever.
        console.error('Queued report failed, dropping:', err);
        await Queue.remove(item.id);
      }
    }
    hideLoading();
    if (uploaded > 0) {
      const remaining = await Queue.count();
      const msg = remaining === 0
        ? 'Reportes pendientes enviados'
        : `${uploaded} enviado(s), ${remaining} pendiente(s)`;
      showToast(msg, remaining === 0 ? 'success' : '');
    }
  } finally {
    _processingQueue = false;
  }
}

async function updatePendingChip() {
  const chip = $('home-pending-chip');
  if (!chip) return;
  const n = await Queue.count().catch(() => 0);
  if (n > 0) {
    chip.style.display = 'inline-flex';
    $('home-pending-chip-text').textContent =
      n === 1 ? '1 reporte pendiente' : `${n} reportes pendientes`;
  } else {
    chip.style.display = 'none';
  }
}

// ── Wire All Events ───────────────────────────────────────────────────────────
function wireEvents() {
  // Home
  $('btn-photo').onclick = () => openCameraPicker('photo');
  $('btn-video').onclick = () => openCameraPicker('video');
  $('home-pending-chip').onclick = () => {
    processQueue().catch(e => console.error('Manual queue drain failed:', e));
  };
  $('input-photo').onchange = e => onMediaFileSelected('photo', e.target.files?.[0]);
  $('input-video').onchange = e => onMediaFileSelected('video', e.target.files?.[0]);
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
