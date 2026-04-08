// Handles photo/video capture via file input (works on iOS and Android)
// and audio recording via MediaRecorder.

export const Capture = {
  _photoFile: null,
  _videoFile: null,
  _audioBlob: null,
  _audioMimeType: 'audio/webm',
  _recorder: null,
  _chunks: [],

  // ── Photo ──────────────────────────────────────────────────────────────────
  pickPhoto() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { reject(new Error('No file selected')); return; }
        this._photoFile = file;
        this._videoFile = null;
        resolve(file);
      };
      input.click();
    });
  },

  // ── Video ──────────────────────────────────────────────────────────────────
  pickVideo() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.capture = 'environment';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { reject(new Error('No file selected')); return; }
        this._videoFile = file;
        this._photoFile = null;
        resolve(file);
      };
      input.click();
    });
  },

  getMediaFile() { return this._photoFile || this._videoFile || null; },
  getMediaType() {
    if (this._photoFile) return 'photo';
    if (this._videoFile) return 'video';
    return null;
  },
  clearMedia() { this._photoFile = null; this._videoFile = null; },

  // ── Audio Recording ────────────────────────────────────────────────────────
  async startAudio() {
    this._chunks = [];
    this._audioBlob = null;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Pick best supported mime type
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'];
    this._audioMimeType = preferred.find(t => MediaRecorder.isTypeSupported(t)) || 'audio/webm';

    this._recorder = new MediaRecorder(stream, { mimeType: this._audioMimeType });
    this._recorder.ondataavailable = e => { if (e.data?.size) this._chunks.push(e.data); };
    this._recorder.start(200); // collect in 200ms chunks
  },

  stopAudio() {
    return new Promise((resolve) => {
      if (!this._recorder || this._recorder.state === 'inactive') {
        resolve(null);
        return;
      }
      this._recorder.onstop = () => {
        // Stop microphone tracks
        this._recorder.stream.getTracks().forEach(t => t.stop());
        this._audioBlob = new Blob(this._chunks, { type: this._audioMimeType });
        resolve(this._audioBlob);
      };
      this._recorder.stop();
    });
  },

  getAudioBlob()     { return this._audioBlob; },
  getAudioMimeType() { return this._audioMimeType; },
  getAudioExtension() {
    if (this._audioMimeType.includes('ogg'))  return 'ogg';
    if (this._audioMimeType.includes('mp4'))  return 'm4a';
    return 'webm';
  },
  clearAudio() { this._audioBlob = null; this._chunks = []; },

  // ── Object URL helpers ─────────────────────────────────────────────────────
  createPreviewUrl(file) { return URL.createObjectURL(file); },
};
