import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "..", "..", "assets", "voice", "voices");
const voices = ["af_heart", "am_fenrir", "af_bella", "am_michael", "af_nicole", "am_puck", "bf_emma", "bm_george", "af_aoede"];
mkdirSync(OUT, { recursive: true });
for (const voice of voices) {
  const path = join(OUT, `${voice}.bin`);
  if (existsSync(path)) {
    console.log(`exists ${voice}`);
    continue;
  }
  const url = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${voice}.bin`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${voice}: HTTP ${response.status}`);
  writeFileSync(path, new Uint8Array(await response.arrayBuffer()));
  console.log(`downloaded ${voice}`);
}
