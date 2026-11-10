/**
 * Common voice adapter contract used by the Bliss assistant.
 * Browser HeadTTS, server HeadTTS and emergency browser-native speech all
 * conform to the same result shape.
 */
export class VoiceAdapter {
  constructor(options = {}) {
    this.options = options;
    this.status = "idle";
    this.personaKey = options.personaKey || "adaora";
  }

  async initialize() { throw new Error("initialize() not implemented"); }
  async speak() { throw new Error("speak() not implemented"); }
  stop() { throw new Error("stop() not implemented"); }
  setVoice(personaKey) { this.personaKey = personaKey; }
  getCapabilities() { return { route: "none", supported: false }; }
  getStatus() { return { status: this.status }; }
}

export function voiceResult(route, extra = {}) {
  return {
    ok: true,
    route,
    startedAt: Date.now(),
    ...extra
  };
}

export function splitTextForServer(text, maxLength = 450) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxLength) return [clean];
  const sentences = clean.match(/[^.!?]+[.!?]?/g) || [clean];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const next = (current + " " + sentence).trim();
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = sentence.trim();
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
