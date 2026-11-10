import { VoiceAdapter, voiceResult, splitTextForServer } from "./voice-adapter.js";
import { getPersonaVoice } from "./voice-config.js";
import { normalizeForSpeech } from "./pronunciation.js";

/**
 * Server HeadTTS adapter. It never talks to the inference service directly:
 * the authenticated Cloudflare Worker proxies to the Node service so role,
 * rate and input checks stay in one place.
 */
export class HeadTTSServerAdapter extends VoiceAdapter {
  constructor(options = {}) {
    super(options);
    this.endpoint = options.endpoint || "/api/voice/synthesize";
    this.audioContext = null;
    this.source = null;
    this.abortController = null;
    this.timers = [];
    this.currentReject = null;
    this.onStatus = options.onStatus || (() => {});
    this.onAudioStart = options.onAudioStart || (() => {});
    this.onAudioEnd = options.onAudioEnd || (() => {});
    this.onViseme = options.onViseme || (() => {});
    this.onWord = options.onWord || (() => {});
    this.onError = options.onError || (() => {});
  }

  getCapabilities() {
    return {
      route: "server",
      supported: typeof fetch === "function" && typeof AudioContext !== "undefined",
      endpoint: this.endpoint
    };
  }

  async initialize() {
    if (!this.audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error("Audio playback is unavailable");
      this.audioContext = new Ctx();
    }
    if (this.audioContext.state === "suspended") await this.audioContext.resume().catch(() => {});
    this.status = "ready";
    return true;
  }

  clearTimers() {
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers = [];
  }

  stop() {
    this.clearTimers();
    if (this.abortController) {
      try { this.abortController.abort(); } catch (error) { /* ignore */ }
      this.abortController = null;
    }
    if (this.source) {
      try { this.source.stop(); } catch (error) { /* ignore */ }
      try { this.source.disconnect(); } catch (error) { /* ignore */ }
      this.source = null;
    }
    if (this.currentReject) {
      const reject = this.currentReject;
      this.currentReject = null;
      reject(Object.assign(new Error("Speech stopped"), { code: "ABORTED" }));
    }
    this.onAudioEnd({ route: "server", stopped: true });
  }

  async speak(text) {
    if (!text) return voiceResult("server", { spoken: false });
    this.stop();
    await this.initialize();
    const persona = getPersonaVoice(this.personaKey);
    const chunks = splitTextForServer(normalizeForSpeech(text));
    if (!chunks.length) return voiceResult("server", { spoken: false });
    let played = 0;
    for (const chunk of chunks) {
      await this.synthesizeChunk(chunk, persona);
      played += 1;
    }
    this.status = "ready";
    return voiceResult("server", { voice: persona.voice, chunks: played });
  }

  async synthesizeChunk(text, persona) {
    this.abortController = new AbortController();
    const timeout = setTimeout(() => { try { this.abortController.abort(); } catch (error) {} }, 60000);
    this.onStatus({ state: "generating", route: "server", text: "Generating neural voice…" });
    let response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal: this.abortController.signal,
        body: JSON.stringify({ text, persona_key: this.personaKey, speed: persona.speed })
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Server voice inference failed");
    }
    const data = await response.json();
    if (!data.audio) throw new Error("Server voice returned no audio");
    const bytes = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0));
    const audio = await this.audioContext.decodeAudioData(bytes.buffer.slice(0));
    await this.playAudio(audio, data);
  }

  playAudio(audio, data) {
    return new Promise((resolve, reject) => {
      const ctx = this.audioContext;
      if (!ctx) { reject(new Error("Audio context unavailable")); return; }
      const source = ctx.createBufferSource();
      source.buffer = audio;
      source.connect(ctx.destination);
      this.source = source;
      this.currentReject = reject;
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
        this.onAudioEnd({ route: "server" });
        resolve();
      };
      try {
        this.onAudioStart({ route: "server", duration: audio.duration });
        source.start(ctx.currentTime + 0.03);
      } catch (error) {
        this.currentReject = null;
        reject(error);
      }
    });
  }
}
