import { HeadTTSBrowserAdapter } from "./headtts-browser.js";
import { HeadTTSServerAdapter } from "./headtts-server.js";
import { normalizeForSpeech } from "./pronunciation.js";

/**
 * Chooses the best available HeadTTS inference route:
 *   browser (WebGPU) → server → browser (WASM) → browser-native → text
 * The order can be overridden by the signed-in user's voice_mode preference.
 */
export class VoiceSelector {
  constructor(options = {}) {
    this.config = Object.assign({
      mode: "auto",
      browserEnabled: true,
      serverEnabled: false
    }, options.config || {});
    this.personaKey = options.personaKey || "adaora";
    this.nativeSpeak = typeof options.nativeSpeak === "function" ? options.nativeSpeak : null;
    this.onStatus = options.onStatus || (() => {});
    this.onAudioStart = options.onAudioStart || (() => {});
    this.onAudioEnd = options.onAudioEnd || (() => {});
    this.onViseme = options.onViseme || (() => {});
    this.onWord = options.onWord || (() => {});
    this.onError = options.onError || (() => {});
    this.browser = options.browserAdapter || null;
    this.server = options.serverAdapter || null;
    this.stopped = false;
  }

  setConfig(config) {
    this.config = Object.assign({}, this.config, config || {});
  }

  setVoice(personaKey) {
    this.personaKey = String(personaKey || "adaora").toLowerCase();
    if (this.browser) this.browser.setVoice(this.personaKey);
    if (this.server) this.server.setVoice(this.personaKey);
  }

  capabilities() {
    const browser = this.browser ? this.browser.getCapabilities() : { supported: false, recommended: false };
    return {
      browser,
      server: Boolean(this.config.serverEnabled),
      native: typeof window !== "undefined" && typeof (window.SpeechSynthesisUtterance || window.webkitSpeechSynthesisUtterance) !== "undefined",
      text: true
    };
  }

  ensureAdapters() {
    if (!this.browser && this.config.browserEnabled) {
      this.browser = new HeadTTSBrowserAdapter({
        personaKey: this.personaKey,
        onStatus: this.onStatus,
        onAudioStart: this.onAudioStart,
        onAudioEnd: this.onAudioEnd,
        onViseme: this.onViseme,
        onWord: this.onWord,
        onError: this.onError
      });
    }
    if (!this.server && this.config.serverEnabled) {
      this.server = new HeadTTSServerAdapter({
        personaKey: this.personaKey,
        onStatus: this.onStatus,
        onAudioStart: this.onAudioStart,
        onAudioEnd: this.onAudioEnd,
        onViseme: this.onViseme,
        onWord: this.onWord,
        onError: this.onError
      });
    }
  }

  routeOrder() {
    const mode = String(this.config.mode || "auto").toLowerCase();
    const cap = this.capabilities();
    const browserReady = Boolean(this.config.browserEnabled && cap.browser.supported);
    const browserRecommended = Boolean(this.config.browserEnabled && cap.browser.recommended);
    const serverReady = Boolean(this.config.serverEnabled);
    if (mode === "text") return ["text"];
    if (mode === "native") return ["native"];
    if (mode === "server") return ["server", ...(browserReady ? ["browser"] : []), "native"];
    if (mode === "browser") return [...(browserReady ? ["browser"] : []), ...(serverReady ? ["server"] : []), "native"];
    // auto
    if (browserRecommended) return ["browser", ...(serverReady ? ["server"] : []), "native"];
    if (serverReady) return ["server", "native"];
    // Do not auto-download the WASM model on phones/unsupported GPUs. The user
    // can explicitly select browser mode to force the WASM fallback.
    return ["native"];
  }

  getStatus() {
    return {
      personaKey: this.personaKey,
      mode: this.config.mode,
      routes: this.routeOrder(),
      browser: this.browser ? this.browser.getStatus() : null,
      server: this.server ? this.server.getStatus() : null
    };
  }

  stop() {
    this.stopped = true;
    if (this.browser) this.browser.stop();
    if (this.server) this.server.stop();
  }

  async speak(text, options = {}) {
    const clean = normalizeForSpeech(text);
    if (!clean) return { ok: true, route: "text", spoken: false };
    this.stopped = false;
    this.ensureAdapters();
    const routes = this.routeOrder();
    let lastError = null;
    for (const route of routes) {
      if (this.stopped) return { ok: false, route, error: "stopped" };
      try {
        if (route === "browser" && this.browser) {
          this.onStatus({ state: "route", route: "browser", text: "Using in-browser neural voice" });
          return await this.browser.speak(clean);
        }
        if (route === "server" && this.server) {
          this.onStatus({ state: "route", route: "server", text: "Using server neural voice" });
          return await this.server.speak(clean);
        }
        if (route === "native" && this.nativeSpeak) {
          this.onStatus({ state: "route", route: "native", text: "Using browser voice fallback" });
          await this.nativeSpeak(clean);
          return { ok: true, route: "native", spoken: true };
        }
        if (route === "text") {
          this.onStatus({ state: "route", route: "text", text: "Text only" });
          this.onAudioEnd({ route: "text" });
          return { ok: true, route: "text", spoken: false };
        }
      } catch (error) {
        lastError = error;
        if (error && error.code === "ABORTED") return { ok: false, route, error: "stopped" };
        this.onError({ route, error });
      }
    }
    this.onStatus({ state: "text", route: "text", text: "Voice unavailable · text only" });
    this.onAudioEnd({ route: "text", error: lastError ? lastError.message : "no voice route" });
    return { ok: true, route: "text", spoken: false, error: lastError ? lastError.message : null };
  }
}
