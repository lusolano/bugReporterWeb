// Persists settings in localStorage
const K = {
  SPREADSHEET_ID:   'br_sheet_id',
  SPREADSHEET_NAME: 'br_sheet_name',
  SHEET_TAB:        'br_sheet_tab',
  FOLDER_ID:        'br_folder_id',
  FOLDER_NAME:      'br_folder_name',
  USER_EMAIL:       'br_user_email',
  USER_NAME:        'br_user_name',
};

export const Config = {
  _get(key)        { return localStorage.getItem(K[key]) || ''; },
  _set(key, value) { localStorage.setItem(K[key], value || ''); },
  _del(key)        { localStorage.removeItem(K[key]); },

  getSpreadsheet() {
    return { id: this._get('SPREADSHEET_ID'), name: this._get('SPREADSHEET_NAME') };
  },
  setSpreadsheet(id, name) {
    this._set('SPREADSHEET_ID', id);
    this._set('SPREADSHEET_NAME', name);
  },

  getSheetTab()       { return this._get('SHEET_TAB') || 'Hoja 1'; },
  setSheetTab(name)   { this._set('SHEET_TAB', name); },

  getFolder() {
    return { id: this._get('FOLDER_ID'), name: this._get('FOLDER_NAME') };
  },
  setFolder(id, name) {
    this._set('FOLDER_ID', id);
    this._set('FOLDER_NAME', name);
  },

  // The user's email/name are a *display cache only* — populated after a
  // successful sign-in so the account screen and reporter name can be shown
  // without a network round-trip. They are NOT a source of truth for the
  // auth state: on a fresh tab or after the access token expires, the cache
  // can still be populated while no live session exists. Use
  // Auth.hasValidToken() to guard anything that makes an API call.
  getUser() {
    return { email: this._get('USER_EMAIL'), name: this._get('USER_NAME') };
  },
  setUser(email, name) {
    this._set('USER_EMAIL', email);
    this._set('USER_NAME', name || '');
  },
  clearUser() {
    this._del('USER_EMAIL');
    this._del('USER_NAME');
  },

  isConfigured() {
    return !!(this._get('SPREADSHEET_ID') && this._get('FOLDER_ID'));
  },
};
