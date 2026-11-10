/**
 * Persona → HeadTTS/Kokoro voice configuration.
 * HeadTTS currently supports English (`en-us`) only. The pronunciation layer
 * handles Nigerian names, places, currency and business terms.
 */
export const HEADTTS_PROVIDER = "headtts";
export const HEADTTS_LANGUAGE = "en-us";
export const HEADTTS_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";
export const HEADTTS_LICENSE = "MIT (HeadTTS), Apache-2.0 (Kokoro / transformers.js)";

export const PERSONA_VOICES = {
  adaora:   { voice: "af_heart",  speed: 0.98, gender: "female" },
  solomon:  { voice: "am_fenrir", speed: 0.97, gender: "male" },
  chiamaka: { voice: "af_bella",  speed: 1.00, gender: "female" },
  emeka:    { voice: "am_michael",speed: 0.96, gender: "male" },
  amara:    { voice: "af_nicole", speed: 0.98, gender: "female" },
  david:    { voice: "am_puck",   speed: 1.01, gender: "male" },
  ngozi:    { voice: "bf_emma",   speed: 0.97, gender: "female" },
  daniel:   { voice: "bm_george", speed: 0.95, gender: "male" },
  ifeoma:   { voice: "af_aoede",  speed: 0.97, gender: "female" }
};

export const ALLOWED_VOICES = Object.values(PERSONA_VOICES).map(item => item.voice);

export const BROWSER_TTS = {
  moduleURL: "/assets/vendor/headtts/headtts.mjs",
  dictionaryURL: "/assets/vendor/headtts/dictionaries/",
  voiceURL: "/assets/voice/voices",
  transformersModule: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0/dist/transformers.min.js",
  model: HEADTTS_MODEL,
  dtypeWebgpu: "q8",
  dtypeWasm: "q8",
  language: HEADTTS_LANGUAGE,
  audioEncoding: "wav"
};

export function getPersonaVoice(personaKey) {
  return PERSONA_VOICES[String(personaKey || "").toLowerCase()] || PERSONA_VOICES.adaora;
}

export function voiceProfileList() {
  return Object.keys(PERSONA_VOICES).map(persona_key => ({
    persona_key,
    provider: HEADTTS_PROVIDER,
    voice_id: PERSONA_VOICES[persona_key].voice,
    language: HEADTTS_LANGUAGE,
    speed: PERSONA_VOICES[persona_key].speed,
    approved: true
  }));
}
