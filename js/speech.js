// Speech recognition wrapper.
// Uses Web Speech API (Chrome/Android) when available,
// falls back to manual text entry on iOS/unsupported browsers.

export const Speech = {
  _recognition: null,
  _isSupported: false,

  init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this._isSupported = true;
      this._recognition = new SpeechRecognition();
      this._recognition.lang = 'es-ES';
      this._recognition.continuous = false;
      this._recognition.interimResults = false;
      this._recognition.maxAlternatives = 1;
    }
  },

  isSupported() { return this._isSupported; },

  /**
   * Starts recognition. Returns a Promise<string> with the transcript.
   * Rejects on error or if unsupported.
   */
  recognize() {
    return new Promise((resolve, reject) => {
      if (!this._isSupported) {
        reject(new Error('SpeechRecognition not supported'));
        return;
      }
      // Guard: some browsers fire onend without onresult or onerror
      // (e.g. when the microphone is already claimed by MediaRecorder).
      // Without this, the promise would hang forever.
      let settled = false;
      this._recognition.onresult = e => {
        if (settled) return;
        settled = true;
        const transcript = e.results[0]?.[0]?.transcript || '';
        resolve(transcript);
      };
      this._recognition.onerror = e => {
        if (settled) return;
        settled = true;
        reject(new Error(e.error));
      };
      this._recognition.onend = () => {
        if (settled) return;
        settled = true;
        resolve('');
      };
      this._recognition.start();
    });
  },

  stop() {
    if (this._recognition) try { this._recognition.stop(); } catch {}
  },
};

// ── TranscriptionParser ────────────────────────────────────────────────────
// Parses "Ubicacion [place]" and "Comentario [text]" from a transcript.
export const TranscriptionParser = {
  parse(text) {
    const t = text.toLowerCase().trim();

    const ubicRegex = /ubicaci[oó]n\s+(.+?)(?=\s+comentario\b|$)/i;
    const comRegex  = /comentario\s+(.+)/i;

    const ubicMatch = ubicRegex.exec(text);
    const comMatch  = comRegex.exec(text);

    return {
      ubicacion:  ubicMatch ? ubicMatch[1].trim() : '',
      comentario: comMatch  ? comMatch[1].trim()  : '',
      rawText:    text,
    };
  },
};
