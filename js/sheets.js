import { Auth } from './auth.js';
import { Config } from './config.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function authHeaders() {
  const token = await Auth.getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function apiFetch(url, options = {}) {
  const headers = { ...(await authHeaders()), ...(options.headers || {}) };
  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Sheets API ${resp.status}: ${body}`);
  }
  // 204 No Content
  if (resp.status === 204) return null;
  return resp.json();
}

export const Sheets = {
  /**
   * Ensures the header row exists (row 1).
   * Only writes headers if the sheet is completely empty.
   */
  async ensureHeaders(spreadsheetId, sheetName) {
    const range = encodeURIComponent(`'${sheetName}'!A1:G1`);
    const data  = await apiFetch(`${BASE}/${spreadsheetId}/values/${range}`);
    if (data.values?.length) return;  // headers already present

    const headers = [
      ['Número', 'Fecha Registro', 'Ubicación', 'Comentario', 'Foto', 'Resolución', 'Comentario Resolución'],
    ];
    await apiFetch(
      `${BASE}/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
      { method: 'PUT', body: JSON.stringify({ values: headers }) }
    );

    // Apply dropdown validation on the "Resolución" column (F)
    await this._addResolutionValidation(spreadsheetId, sheetName);
  },

  /**
   * Appends a report row.
   * @param {object} params
   *   spreadsheetId, sheetName,
   *   ubicacion, comentario,
   *   photoFileId  (optional),
   *   videoFileId  (optional)
   */
  async appendReport({ spreadsheetId, sheetName, ubicacion, comentario, photoFileId, videoFileId }) {
    // Auto-number: count existing rows
    const countRange = encodeURIComponent(`'${sheetName}'!A:A`);
    const countData  = await apiFetch(`${BASE}/${spreadsheetId}/values/${countRange}`);
    const rowCount   = countData.values?.length ?? 1;
    const numero     = rowCount;  // row 1 = header, row 2 = #1, etc.

    const now = new Date();
    const fecha = now.toLocaleDateString('es-CR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    // Build the =IMAGE() formula if we have a photo
    let fotoCell = '';
    if (photoFileId) {
      fotoCell = `=IMAGE("https://drive.google.com/uc?export=view&id=${photoFileId}")`;
    } else if (videoFileId) {
      fotoCell = `https://drive.google.com/file/d/${videoFileId}/view`;
    }

    const row = [numero, fecha, ubicacion, comentario, fotoCell, 'Ingresado', ''];

    const range = encodeURIComponent(`'${sheetName}'!A:G`);
    await apiFetch(
      `${BASE}/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
      { method: 'POST', body: JSON.stringify({ values: [row] }) }
    );
  },

  async _addResolutionValidation(spreadsheetId, sheetName) {
    // Find the sheetId for the named tab
    const meta = await apiFetch(`${BASE}/${spreadsheetId}?fields=sheets(properties(sheetId,title))`);
    const sheet = meta.sheets?.find(s => s.properties.title === sheetName);
    if (!sheet) return;
    const sheetId = sheet.properties.sheetId;

    const request = {
      requests: [{
        setDataValidation: {
          range: {
            sheetId,
            startRowIndex: 1,   // skip header
            endRowIndex: 1000,
            startColumnIndex: 5, // column F (0-indexed)
            endColumnIndex: 6,
          },
          rule: {
            condition: {
              type: 'ONE_OF_LIST',
              values: [
                { userEnteredValue: 'Ingresado' },
                { userEnteredValue: 'En revisión' },
                { userEnteredValue: 'Resuelto' },
                { userEnteredValue: 'No aplica' },
              ],
            },
            showCustomUi: true,
            strict: true,
          },
        },
      }],
    };

    await apiFetch(`${BASE}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },
};
