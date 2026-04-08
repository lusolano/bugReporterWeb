import { Auth } from './auth.js';

const BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

async function authHeaders() {
  const token = await Auth.getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

async function apiFetch(url, options = {}) {
  const headers = { ...(await authHeaders()), ...(options.headers || {}) };
  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Drive API ${resp.status}: ${body}`);
  }
  return resp.json();
}

export const Drive = {
  // ── Spreadsheet picker ────────────────────────────────────────────────────
  async listSpreadsheets() {
    const params = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name)',
      pageSize: '50',
    });
    const data = await apiFetch(`${BASE}/files?${params}`);
    return data.files || [];   // [{id, name}]
  },

  // ── Folder picker ─────────────────────────────────────────────────────────
  async listFolders(parentId = 'root') {
    const params = new URLSearchParams({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      orderBy: 'name',
      fields: 'files(id,name)',
      pageSize: '100',
    });
    const data = await apiFetch(`${BASE}/files?${params}`);
    return data.files || [];   // [{id, name}]
  },

  // ── Daily subfolder ───────────────────────────────────────────────────────
  async getOrCreateDailyFolder(parentFolderId) {
    const today = new Date();
    const name  = today.getFullYear().toString()
      + String(today.getMonth() + 1).padStart(2, '0')
      + String(today.getDate()).padStart(2, '0');

    // Check if it already exists
    const params = new URLSearchParams({
      q: `'${parentFolderId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
    });
    const data = await apiFetch(`${BASE}/files?${params}`);
    if (data.files?.length) return { id: data.files[0].id, name };

    // Create it
    const token  = await Auth.getAccessToken();
    const resp   = await fetch(`${BASE}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      }),
    });
    if (!resp.ok) throw new Error(`Create daily folder failed: ${resp.status}`);
    const created = await resp.json();
    return { id: created.id, name };
  },

  // ── Upload (multipart) ────────────────────────────────────────────────────
  async uploadFile(file, fileName, parentFolderId) {
    const token = await Auth.getAccessToken();
    const metadata = JSON.stringify({ name: fileName, parents: [parentFolderId] });

    const form = new FormData();
    form.append('metadata', new Blob([metadata], { type: 'application/json' }));
    form.append('file', file);

    const resp = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Upload failed (${resp.status}): ${body}`);
    }
    return resp.json();  // {id, name, webViewLink}
  },

  uploadImage(file, parentFolderId) {
    const ext = file.name.split('.').pop() || 'jpg';
    const name = `foto_${Date.now()}.${ext}`;
    return this.uploadFile(file, name, parentFolderId);
  },

  uploadVideo(file, parentFolderId) {
    const ext = file.name.split('.').pop() || 'mp4';
    const name = `video_${Date.now()}.${ext}`;
    return this.uploadFile(file, name, parentFolderId);
  },

  uploadAudio(blob, ext, parentFolderId) {
    const file = new File([blob], `audio_${Date.now()}.${ext}`, { type: blob.type });
    return this.uploadFile(file, file.name, parentFolderId);
  },

  // ── Make a file publicly readable so =IMAGE() works in Sheets ─────────────
  async makePublic(fileId) {
    const token = await Auth.getAccessToken();
    await fetch(`${BASE}/files/${fileId}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
  },
};
