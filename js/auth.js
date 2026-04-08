import { Config } from './config.js';

// TODO: Replace with your Google OAuth 2.0 Web Client ID from Google Cloud Console.
// The authorized JavaScript origin must match the URL you serve this app from.
// e.g. http://localhost:8080  or  https://your-domain.com
export const GOOGLE_CLIENT_ID = '467106960874-7koi8k5regaa2dtso0l7opgqru2i2v1g.apps.googleusercontent.com';

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

let _tokenClient = null;
let _accessToken = null;
let _tokenExpiry = 0;

// Callbacks registered by app.js
let _onSignIn = null;
let _onSignOut = null;
let _onError = null;

export const Auth = {
  /** Load the GIS script and initialize the token client. */
  init() {
    return new Promise((resolve, reject) => {
      if (GOOGLE_CLIENT_ID.startsWith('YOUR_')) {
        console.warn('Auth: GOOGLE_CLIENT_ID not configured in js/auth.js');
        resolve();
        return;
      }
      const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
      if (existing && window.google?.accounts?.oauth2) {
        this._initTokenClient();
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => { this._initTokenClient(); resolve(); };
      script.onerror = () => reject(new Error('Failed to load GIS script'));
      document.head.appendChild(script);
    });
  },

  _initTokenClient() {
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: async (response) => {
        if (response.error) {
          console.error('Auth error:', response.error);
          _onError?.(response.error);
          return;
        }
        _accessToken = response.access_token;
        _tokenExpiry = Date.now() + (parseInt(response.expires_in) - 60) * 1000;
        await this._fetchUserInfo();
        _onSignIn?.();
      },
    });
  },

  async _fetchUserInfo() {
    try {
      const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${_accessToken}` },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      Config.setUser(data.email, data.name);
    } catch (e) {
      console.error('fetchUserInfo failed:', e);
    }
  },

  signIn() {
    if (!_tokenClient) {
      _onError?.('Google Sign-In no inicializado. Verifique el Client ID.');
      return;
    }
    // Prompt consent on first sign-in; silent refresh afterwards
    _tokenClient.requestAccessToken({ prompt: Config.isSignedIn() ? '' : 'consent' });
  },

  signOut() {
    if (_accessToken) {
      google.accounts.oauth2.revoke(_accessToken, () => { });
    }
    _accessToken = null;
    _tokenExpiry = 0;
    Config.clearUser();
    _onSignOut?.();
  },

  /**
   * Returns a valid access token, requesting a new one silently if expired.
   * Rejects if the user needs to re-authenticate interactively.
   */
  getAccessToken() {
    if (_accessToken && Date.now() < _tokenExpiry) {
      return Promise.resolve(_accessToken);
    }
    // Silent refresh
    return new Promise((resolve, reject) => {
      if (!_tokenClient) { reject(new Error('Not initialized')); return; }
      const original = _tokenClient.callback;
      _tokenClient.callback = (response) => {
        _tokenClient.callback = original;
        if (response.error) { reject(new Error(response.error)); return; }
        _accessToken = response.access_token;
        _tokenExpiry = Date.now() + (parseInt(response.expires_in) - 60) * 1000;
        resolve(_accessToken);
        original(response);
      };
      _tokenClient.requestAccessToken({ prompt: '' });
    });
  },

  isReady() { return !!_tokenClient; },

  onSignIn(cb) { _onSignIn = cb; },
  onSignOut(cb) { _onSignOut = cb; },
  onError(cb) { _onError = cb; },
};
