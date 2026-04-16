# Bug Reporter Web

A Progressive Web App (PWA) for reporting home construction defects. Captures
photos/videos, records audio descriptions with speech-to-text, and stores
everything in Google Drive + Google Sheets — no backend required.

Works on both **iOS** and **Android** from the browser.

## Features

- Take photos / record videos directly from the camera
- Record audio descriptions with automatic speech-to-text (Android/Chrome)
- Auto-parses transcripts into "Ubicación" and "Comentario" fields
- Uploads media to a configurable Google Drive folder (with daily subfolders)
- Live upload-progress percentage during long video uploads
- Appends rows to a configurable Google Sheet with `=IMAGE()` previews
- Dropdown column for resolution status
- Installable as a PWA on iOS and Android home screens
- Offline-capable via service worker

## Setup

### 1. Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services.
2. Enable **Google Drive API** and **Google Sheets API**.
3. Create OAuth 2.0 credentials → **Web application**.
4. Add your hosting URL to **Authorized JavaScript origins**, e.g.:
   - `http://localhost:8091` (for local dev)
   - `https://lusolano.github.io` (for GitHub Pages)
5. Copy the **Client ID**.

### 2. Configure the app

Edit `js/auth.js` and replace the placeholder:

```js
export const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
```

### 3. Deploy

Push to GitHub and enable GitHub Pages (Settings → Pages → Source: `main` / root).

### 4. Use it

1. Open the deployed URL on your phone.
2. Sign in with Google.
3. Open Configuration (gear icon) and pick your Google Sheet + Drive folder.
4. From the home screen, take a photo or record a video.
5. Press the mic button and say:
   `"Ubicación cocina comentario hay una grieta en la pared"`
6. Edit the parsed fields if needed and submit.

## Local Development

```bash
python -m http.server 8091
```

Then open <http://localhost:8091>. Note: camera/mic and Google OAuth require
HTTPS, except on `localhost`, which the browser treats as secure.

## Project Structure

```
bugReporterWeb/
├── index.html       SPA shell with all 4 screens
├── manifest.json    PWA manifest
├── sw.js            Service worker (offline cache)
├── icon.svg         App icon
├── css/app.css      All styles
└── js/
    ├── app.js       Main controller, screen navigation
    ├── auth.js      Google Identity Services OAuth
    ├── config.js    localStorage settings
    ├── drive.js     Drive REST API (list, upload, daily folders)
    ├── sheets.js    Sheets REST API (headers, append, validation)
    ├── capture.js   Camera/video file input + MediaRecorder for audio
    └── speech.js    Web Speech API + transcription parser
```
