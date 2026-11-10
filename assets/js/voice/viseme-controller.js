/**
 * Approximate viseme → mouth animation controller.
 * The portraits are photographs, so this animates a small, subtle mouth overlay
 * and the existing speaking state. It is not claimed to be photorealistic
 * lip-sync.
 */
const VISEME_SHAPE = {
  sil: 0.04,
  PP: 0.10,
  FF: 0.18,
  TH: 0.28,
  DD: 0.32,
  kk: 0.36,
  CH: 0.38,
  SS: 0.26,
  nn: 0.30,
  RR: 0.42,
  aa: 0.95,
  E: 0.62,
  I: 0.48,
  O: 0.82,
  U: 0.72
};

export class VisemeController {
  constructor(options = {}) {
    this.node = options.node || null;
    this.onWord = typeof options.onWord === "function" ? options.onWord : null;
    this.resetTimer = null;
  }

  attach(node) {
    this.node = node;
    if (!node) return;
    if (!node.querySelector(".dh-mouth-sync")) {
      const mouth = document.createElement("span");
      mouth.className = "dh-mouth-sync";
      mouth.setAttribute("aria-hidden", "true");
      node.appendChild(mouth);
    }
  }

  start() {
    this.stop();
    if (!this.node) return;
    this.node.classList.add("is-speaking");
    this.apply("sil", 80);
  }

  apply(viseme, duration) {
    if (!this.node) return;
    const shape = VISEME_SHAPE[viseme] !== undefined ? VISEME_SHAPE[viseme] : 0.28;
    const width = viseme === "O" || viseme === "U" ? 1.18 : viseme === "E" || viseme === "I" ? 1.08 : 0.96;
    this.node.style.setProperty("--dh-viseme-open", String(shape));
    this.node.style.setProperty("--dh-viseme-width", String(width));
    this.node.classList.add("is-viseme");
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      if (!this.node) return;
      this.node.style.setProperty("--dh-viseme-open", "0.04");
      this.node.style.setProperty("--dh-viseme-width", "0.96");
    }, Math.max(30, Number(duration) || 90));
  }

  word(word) {
    if (this.onWord) this.onWord(word);
  }

  stop() {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = null;
    if (!this.node) return;
    this.node.classList.remove("is-speaking");
    this.node.classList.remove("is-viseme");
    this.node.style.setProperty("--dh-viseme-open", "0.04");
    this.node.style.setProperty("--dh-viseme-width", "0.96");
  }
}
