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
      // continuous=true: keep listening through pauses. The user's speech
      // pattern ("Ubicación... cuarto, comentario: ...") has long pauses
      // between keywords that would otherwise cut recognition short.
      // The user manually stops with the mic button.
      this._recognition.continuous = true;
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
      let settled = false;
      // In continuous mode, onresult fires multiple times with e.results
      // accumulating. We build the final transcript from ALL final results
      // and only resolve once recognition ends (user tapped stop or
      // recognition timed out).
      let finalTranscript = '';
      this._recognition.onresult = e => {
        let out = '';
        for (let i = 0; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            out += (out ? ' ' : '') + (e.results[i][0]?.transcript || '');
          }
        }
        finalTranscript = out;
      };
      this._recognition.onerror = e => {
        if (settled) return;
        settled = true;
        // no-speech / aborted are recoverable — return what we have.
        if (e.error === 'no-speech' || e.error === 'aborted') {
          resolve(finalTranscript);
        } else {
          reject(new Error(e.error));
        }
      };
      this._recognition.onend = () => {
        if (settled) return;
        settled = true;
        resolve(finalTranscript);
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
    if (!text) return { ubicacion: '', comentario: '', rawText: '' };

    // Normalize punctuation before matching. Chrome's Spanish recognizer
    // often inserts commas / colons / periods / ellipsis around keywords,
    // e.g. "Ubicación: cuarto, comentario: error en iluminación." — the
    // strict \s+ regex wouldn't otherwise match. Replace separators with
    // spaces, then collapse whitespace.
    const normalized = text
      .replace(/[.,;:¿?¡!…"'()\[\]{}\-—–]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const ubicRegex = /ubicaci[oó]n\s+(.+?)(?=\s+comentario\b|$)/i;
    const comRegex  = /comentario\s+(.+)/i;

    const ubicMatch = ubicRegex.exec(normalized);
    const comMatch  = comRegex.exec(normalized);

    return {
      ubicacion:  ubicMatch ? ubicMatch[1].trim() : '',
      comentario: comMatch  ? comMatch[1].trim()  : '',
      rawText:    text,
    };
  },
};
