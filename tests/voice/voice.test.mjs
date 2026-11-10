import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeForSpeech,
  splitForSpeech,
  applyPronunciationDictionary,
  normalizeCurrency,
  PRONUNCIATION_VERSION
} from "../../assets/js/voice/pronunciation.js";
import { PERSONA_VOICES, getPersonaVoice, voiceProfileList } from "../../assets/js/voice/voice-config.js";
import { VoiceSelector } from "../../assets/js/voice/voice-selector.js";
import { SttAdapter } from "../../assets/js/voice/stt-adapter.js";

test("pronunciation dictionary version is explicit", () => {
  assert.match(PRONUNCIATION_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
});

test("Nigerian names and places are respelled for the English model", () => {
  const text = applyPronunciationDictionary("Adaora and Ngozi are in Ikeja, Lagos.");
  assert.match(text, /Ah-doh-rah/);
  assert.match(text, /En-goh-zee/);
  assert.match(text, /Ee-keh-jah/);
});

test("currency and kobo are normalised without changing value", () => {
  assert.equal(normalizeCurrency("₦12,500,000.50"), "12,500,000.50 naira");
  assert.equal(normalizeCurrency("NGN 500000"), "500000 naira");
  assert.equal(normalizeCurrency("₦500k"), "500 thousand naira");
  assert.match(normalizeForSpeech("Pay ₦2,500,000 for C of O"), /2,500,000/);
  assert.match(normalizeForSpeech("Pay ₦2,500,000 for C of O"), /Certificate of Occupancy/);
});

test("long replies split into sentence-safe speech chunks", () => {
  const chunks = splitForSpeech("First sentence. ".repeat(80), 220);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 220));
});

test("all nine personas have distinct HeadTTS voices", () => {
  const voices = Object.values(PERSONA_VOICES).map(profile => profile.voice);
  assert.equal(voices.length, 9);
  assert.equal(new Set(voices).size, 9);
  assert.equal(voiceProfileList().length, 9);
  assert.equal(getPersonaVoice("ngozi").voice, "bf_emma");
});

function browserAdapter(result, capabilities = { supported: true, recommended: true }) {
  return {
    getCapabilities: () => capabilities,
    getStatus: () => ({ status: "ready" }),
    setVoice: () => {},
    stop: () => {},
    speak: async () => result
  };
}
function serverAdapter(result, capabilities = { supported: true }) {
  return {
    getCapabilities: () => capabilities,
    getStatus: () => ({ status: "ready" }),
    setVoice: () => {},
    stop: () => {},
    speak: async () => result
  };
}

test("auto mode prefers browser WebGPU when capable", async () => {
  const selector = new VoiceSelector({
    config: { mode: "auto", browserEnabled: true, serverEnabled: true },
    browserAdapter: browserAdapter({ ok: true, route: "browser" }),
    serverAdapter: serverAdapter({ ok: true, route: "server" }),
    nativeSpeak: async () => {}
  });
  assert.deepEqual(selector.routeOrder(), ["browser", "server", "native"]);
  const result = await selector.speak("Show me properties");
  assert.equal(result.route, "browser");
});

test("browser failure falls back to server inference", async () => {
  let serverCalled = false;
  const selector = new VoiceSelector({
    config: { mode: "auto", browserEnabled: true, serverEnabled: true },
    browserAdapter: {
      ...browserAdapter({ ok: true, route: "browser" }),
      speak: async () => { throw new Error("webgpu failed"); }
    },
    serverAdapter: {
      ...serverAdapter({ ok: true, route: "server" }),
      speak: async () => { serverCalled = true; return { ok: true, route: "server" }; }
    },
    nativeSpeak: async () => {}
  });
  const result = await selector.speak("I need a property");
  assert.equal(serverCalled, true);
  assert.equal(result.route, "server");
});

test("browser and server failure falls back to browser-native speech", async () => {
  let nativeCalled = false;
  const selector = new VoiceSelector({
    config: { mode: "browser", browserEnabled: true, serverEnabled: true },
    browserAdapter: { ...browserAdapter({}), speak: async () => { throw new Error("no webgpu"); } },
    serverAdapter: { ...serverAdapter({}), speak: async () => { throw new Error("no server"); } },
    nativeSpeak: async () => { nativeCalled = true; }
  });
  const result = await selector.speak("Hello");
  assert.equal(nativeCalled, true);
  assert.equal(result.route, "native");
});

test("text mode does not attempt audio", async () => {
  const selector = new VoiceSelector({ config: { mode: "text" }, nativeSpeak: async () => { throw new Error("should not be called"); } });
  const result = await selector.speak("Hello");
  assert.equal(result.route, "text");
  assert.equal(result.spoken, false);
});

test("speech-to-text adapter reports browser capability without auto-starting the microphone", () => {
  globalThis.window = { SpeechRecognition: function SpeechRecognition() {} };
  const adapter = new SttAdapter({ lang: "en-NG" });
  const capabilities = adapter.getCapabilities();
  assert.equal(capabilities.supported, true);
  assert.equal(capabilities.lang, "en-NG");
  assert.equal(adapter.active, false);
  delete globalThis.window;
});

test("stop cancels the selected adapter", async () => {
  let stopped = false;
  const selector = new VoiceSelector({
    config: { mode: "server", serverEnabled: true },
    serverAdapter: {
      ...serverAdapter({ ok: true, route: "server" }),
      stop: () => { stopped = true; },
      speak: async () => { await new Promise(() => {}); }
    }
  });
  const promise = selector.speak("Hello");
  selector.stop();
  assert.equal(stopped, true);
  assert.equal(selector.stopped, true);
  promise.catch(() => {});
});
