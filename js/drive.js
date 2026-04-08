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

  // ── Upload (two-step: create metadata, then PATCH content) ───────────────
  // NOTE: We can't use FormData + uploadType=multipart because FormData sets
  // Content-Type to multipart/form-data, but Drive requires multipart/related.
  // Two-step is simpler and works reliably in all browsers.
  async uploadFile(file, fileName, parentFolderId) {
    const token = await Auth.getAccessToken();

    // Step 1: Create file metadata (returns the file ID).
    const createResp = await fetch(`${BASE}/files?fields=id,name`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: fileName, parents: [parentFolderId] }),
    });
    if (!createResp.ok) {
      const body = await createResp.text().catch(() => '');
      throw new Error(`Create file failed (${createResp.status}): ${body}`);
    }
    const created = await createResp.json();  // {id, name}

    // Step 2: Upload the raw file contents into that file ID.
    const uploadResp = await fetch(`${UPLOAD}/files/${created.id}?uploadType=media&fields=id,name,webViewLink`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    if (!uploadResp.ok) {
      const body = await uploadResp.text().catch(() => '');
      throw new Error(`Upload content failed (${uploadResp.status}): ${body}`);
    }
    return uploadResp.json();  // {id, name, webViewLink}
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
