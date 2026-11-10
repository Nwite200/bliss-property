import { VoiceAdapter, voiceResult } from "./voice-adapter.js";
import { BROWSER_TTS, getPersonaVoice } from "./voice-config.js";
import { normalizeForSpeech } from "./pronunciation.js";

/**
 * In-browser HeadTTS/Kokoro adapter.
 * Model loading is intentionally lazy: nothing is downloaded until the first
 * speech request. WebGPU is preferred; WASM is used only when needed.
 */
export class HeadTTSBrowserAdapter extends VoiceAdapter {
  constructor(options = {}) {
    super(options);
    this.client = null;
    this.source = null;
    this.timers = [];
    this.audioContext = null;
    this.currentReject = null;
    this.loading = null;
    this.mode = null;
    this.onStatus = options.onStatus || (() => {});
    this.onAudioStart = options.onAudioStart || (() => {});
    this.onAudioEnd = options.onAudioEnd || (() => {});
    this.onViseme = options.onViseme || (() => {});
    this.onWord = options.onWord || (() => {});
    this.onError = options.onError || (() => {});
  }

  getCapabilities() {
    const nav = typeof navigator !== "undefined" ? navigator : {};
    const webgpu = Boolean(nav.gpu && nav.gpu.requestAdapter);
    const wasm = typeof WebAssembly === "object";
    const moduleWorkers = typeof Worker !== "undefined";
    const memory = Number(nav.deviceMemory || 8);
    const cores = Number(nav.hardwareConcurrency || 4);
    const saveData = Boolean(nav.connection && nav.connection.saveData);
    return {
      route: "browser",
      webgpu,
      wasm,
      moduleWorkers,
      memory,
      cores,
      saveData,
      supported: wasm && moduleWorkers && !saveData,
      recommended: webgpu && memory >= 8 && cores >= 4 && !saveData
    };
  }

  async initialize() {
    if (this.client) return this.client;
    if (this.loading) return this.loading;
    const capabilities = this.getCapabilities();
    if (!capabilities.supported) throw new Error("HeadTTS browser inference is not supported in this browser");
    this.loading = (async () => {
      const module = await import(BROWSER_TTS.moduleURL);
      const endpoints = capabilities.webgpu ? ["webgpu", "wasm"] : ["wasm"];
      this.mode = capabilities.webgpu ? "webgpu" : "wasm";
      this.client = new module.HeadTTS({
        endpoints,
        transformersModule: BROWSER_TTS.transformersModule,
        model: BROWSER_TTS.model,
        dtypeWebgpu: BROWSER_TTS.dtypeWebgpu,
        dtypeWasm: BROWSER_TTS.dtypeWasm,
        languages: [BROWSER_TTS.language],
        dictionaryURL: BROWSER_TTS.dictionaryURL,
        voiceURL: BROWSER_TTS.voiceURL,
        voices: [],
        defaultVoice: getPersonaVoice(this.personaKey).voice,
        defaultLanguage: BROWSER_TTS.language,
        defaultAudioEncoding: BROWSER_TTS.audioEncoding,
        audioEncoding: BROWSER_TTS.audioEncoding,
        trace: 0
      }, (error) => this.onError(error));
      const onProgress = (event) => {
        const detail = event && event.detail ? event.detail : {};
        if (detail.status === "progress" && detail.progress !== undefined) {
          this.onStatus({ state: "loading", progress: Math.round(Number(detail.progress) || 0), text: "Loading neural voice…" });
        } else {
          this.onStatus({ state: "loading", text: "Loading neural voice…" });
        }
      };
      try {
        await this.client.connect(null, onProgress);
      } catch (error) {
        if (!capabilities.webgpu) throw error;
        this.mode = "wasm";
        this.client.settings.endpoints = ["wasm"];
        await this.client.connect({ endpoints: ["wasm"] }, onProgress);
      }
      this.audioContext = this.client.settings.audioCtx;
      this.status = "ready";
      this.onStatus({ state: "ready", route: "browser", mode: this.mode, text: this.mode === "webgpu" ? "Neural voice ready (WebGPU)" : "Neural voice ready (WASM)" });
      return this.client;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  setVoice(personaKey) {
    super.setVoice(personaKey);
    if (this.client) {
      const profile = getPersonaVoice(personaKey);
      this.client.setup({ voice: profile.voice, language: BROWSER_TTS.language, speed: profile.speed, audioEncoding: BROWSER_TTS.audioEncoding });
    }
  }

  clearTimers() {
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers = [];
  }

  stop() {
    this.clearTimers();
    if (this.source) {
      try { this.source.stop(); } catch (error) { /* already stopped */ }
      try { this.source.disconnect(); } catch (error) { /* ignore */ }
      this.source = null;
    }
    if (this.currentReject) {
      const reject = this.currentReject;
      this.currentReject = null;
      reject(Object.assign(new Error("Speech stopped"), { code: "ABORTED" }));
    }
    this.status = this.client ? "ready" : "idle";
    this.onAudioEnd({ route: "browser", stopped: true });
  }

  async speak(text) {
    if (!text) return voiceResult("browser", { spoken: false });
    this.stop();
    await this.initialize();
    const persona = getPersonaVoice(this.personaKey);
    this.client.setup({
      voice: persona.voice,
      language: BROWSER_TTS.language,
      speed: persona.speed,
      audioEncoding: BROWSER_TTS.audioEncoding
    });
    this.onStatus({ state: "generating", route: "browser", text: "Generating neural voice…" });
    const messages = await this.client.synthesize({ input: normalizeForSpeech(text) });
    if (!Array.isArray(messages)) throw new Error("HeadTTS returned no audio messages");
    const audioMessages = messages.filter(message => message && message.type === "audio" && message.data && message.data.audio);
    if (!audioMessages.length) throw new Error("HeadTTS returned no playable audio");
    for (const message of audioMessages) {
      await this.playMessage(message.data);
    }
    this.status = "ready";
    return voiceResult("browser", { voice: persona.voice, mode: this.mode, messages: audioMessages.length });
  }

  playMessage(data) {
    return new Promise((resolve, reject) => {
      const ctx = this.audioContext || (this.client && this.client.settings.audioCtx);
      if (!ctx) { reject(new Error("Audio context unavailable")); return; }
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const source = ctx.createBufferSource();
      source.buffer = data.audio;
      source.connect(ctx.destination);
      this.source = source;
      this.currentReject = reject;
      const started = ctx.currentTime + 0.03;
      const visemes = Array.isArray(data.visemes) ? data.visemes : [];
      const vtimes = Array.isArray(data.vtimes) ? data.vtimes : [];
      const vdurations = Array.isArray(data.vdurations) ? data.vdurations : [];
      const words = Array.isArray(data.words) ? data.words : [];
      const wtimes = Array.isArray(data.wtimes) ? data.wtimes : [];
      for (let i = 0; i < visemes.length; i++) {
        const delay = Math.max(0, Number(vtimes[i] || 0));
        this.timers.push(setTimeout(() => this.onViseme({ viseme: visemes[i], at: delay, duration: Number(vdurations[i] || 90) }), delay));
      }
      for (let i = 0; i < words.length; i++) {
        const delay = Math.max(0, Number(wtimes[i] || 0));
        this.timers.push(setTimeout(() => this.onWord({ word: words[i], at: delay }), delay));
      }
      source.onended = () => {
        this.clearTimers();
        this.source = null;
        this.currentReject = null;
        this.onAudioEnd({ route: "browser" });
        resolve();
      };
      try {
        this.onAudioStart({ route: "browser", mode: this.mode, duration: data.audio.duration });
        source.start(started);
      } catch (error) {
        this.currentReject = null;
        reject(error);
      }
    });
  }
}
