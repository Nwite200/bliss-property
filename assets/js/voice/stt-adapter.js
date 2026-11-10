/**
 * Provider-independent speech-to-text adapter.
 *
 * Current free provider: the browser SpeechRecognition API (Chrome/Edge).
 * A Whisper-compatible provider can be added later without changing the
 * assistant UI. No microphone is activated until start() is called from a
 * user gesture.
 */
export class SttAdapter {
  constructor(options = {}) {
    this.lang = options.lang || "en-NG";
    this.interimResults = options.interimResults !== false;
    this.continuous = Boolean(options.continuous);
    this.recognition = null;
    this.provider = "browser";
    this.active = false;
    this.onInterim = options.onInterim || (() => {});
    this.onFinal = options.onFinal || (() => {});
    this.onError = options.onError || (() => {});
    this.onStart = options.onStart || (() => {});
    this.onEnd = options.onEnd || (() => {});
  }

  getCapabilities() {
    const Recognition = typeof window !== "undefined"
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;
    return {
      browser: Boolean(Recognition),
      whisperServer: false,
      supported: Boolean(Recognition),
      lang: this.lang
    };
  }

  initialize() {
    if (this.recognition) return true;
    const Recognition = typeof window !== "undefined"
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;
    if (!Recognition) return false;
    const recognition = new Recognition();
    recognition.lang = this.lang;
    recognition.continuous = this.continuous;
    recognition.interimResults = this.interimResults;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      this.active = true;
      this.onStart();
    };
    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript || "";
        if (event.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }
      if (interim) this.onInterim(interim);
      if (finalText.trim()) this.onFinal(finalText.trim());
    };
    recognition.onerror = (event) => {
      this.active = false;
      this.onError(event && event.error ? event.error : "speech_recognition_error");
    };
    recognition.onend = () => {
      this.active = false;
      this.onEnd();
    };
    this.recognition = recognition;
    return true;
  }

  setLanguage(lang) {
    this.lang = lang || "en-NG";
    if (this.recognition) this.recognition.lang = this.lang;
  }

  start() {
    if (!this.initialize()) {
      this.onError("unsupported");
      return false;
    }
    try {
      this.recognition.start();
      return true;
    } catch (error) {
      try { this.recognition.stop(); } catch (e) { /* ignore */ }
      setTimeout(() => {
        try { this.recognition.start(); } catch (e) { this.onError("start_failed"); }
      }, 250);
      return false;
    }
  }

  stop() {
    if (this.recognition) {
      try { this.recognition.stop(); } catch (error) { /* ignore */ }
    }
    this.active = false;
  }
}
