/**
 * Approved pronunciation layer for mixed Nigerian-English and international
 * English. The Kokoro model is English-only, so the layer respells selected
 * Nigerian names/places and expands business abbreviations without changing
 * the meaning of a sentence.
 *
 * Keep this dictionary reviewable. Add new entries only with an approved
 * pronunciation sample.
 */
export const PRONUNCIATION_VERSION = "2026-11-10.1";

const WORD_PRONUNCIATIONS = {
  // Personas and common Nigerian names
  "adaora": "Ah-doh-rah",
  "solomon": "Soh-loh-mon",
  "chiamaka": "Chee-ah-mah-kah",
  "emeka": "Eh-meh-kah",
  "amara": "Ah-mah-rah",
  "david": "Day-vid",
  "ngozi": "En-goh-zee",
  "daniel": "Dan-yel",
  "ifeoma": "Ee-feh-oh-mah",
  "nwosu": "Nn-woh-soo",
  "dike": "Dee-keh",
  "nwite": "Nn-wee-teh",
  "obakhavba": "Oh-bah-kah-vbah",
  "ihama": "Ee-hah-mah",
  // Nigerian places
  "ikeja": "Ee-keh-jah",
  "ajah": "Ah-jah",
  "lekki": "Leh-kee",
  "garki": "Gar-kee",
  "asaba": "Ah-sah-bah",
  "abuja": "Ah-boo-jah",
  "lagos": "Lay-gos",
  "nigeria": "Nye-jee-ree-ah",
  "naira": "Nye-rah",
  // Property and financial terms
  "c of o": "Certificate of Occupancy",
  "bvn": "B V N",
  "nin": "N I N",
  "otp": "O T P",
  "kyc": "K Y C",
  "alatpay": "Ah-lat pay",
  "wema": "Weh-mah",
  "alat": "Ah-lat",
  "duplex": "doo-plex",
  "bungalow": "bun-gah-low",
  "instalment": "in-stall-ment",
  "installment": "in-stall-ment",
  "commission": "com-mish-un",
  "realtor": "reel-tor",
  "mortgage": "mor-gage",
  "escrow": "ess-crow",
  "naira": "Nye-rah",
  // Nigerian Pidgin conversational markers (English phonetics; native-speaker
  // listening approval is still required before production sign-off)
  "abeg": "ah-beg",
  "wetin": "weh-tin",
  "dey": "day",
  "wan": "wahn",
  "una": "oo-nah",
  "sabi": "sah-bee",
  "wahala": "wah-hah-lah",
  "shey": "shay",
  "oga": "oh-gah",
  "abi": "ah-bee",
  "na": "nah",
  "don": "don",
  "fit": "fit"
};

const ABBREVIATIONS = {
  "MD": "Managing Director",
  "BM": "Branch Manager",
  "TL": "Team Lead",
  "PM": "Project Manager",
  "GSM": "G S M",
  "CEO": "C E O",
  "CRM": "C R M",
  "API": "A P I",
  "FAQ": "F A Q",
  "HQ": "headquarters",
  "No.": "number",
  "vs.": "versus",
  "approx.": "approximately",
  "e.g.": "for example",
  "i.e.": "that is"
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function expandAbbreviations(text) {
  let out = String(text || "");
  for (const [from, to] of Object.entries(ABBREVIATIONS)) {
    out = out.replace(new RegExp(`(^|[\\s(])${escapeRegExp(from)}(?=$|[\\s.,;:!?)])`, "g"), `$1${to}`);
  }
  return out;
}

export function normalizeCurrency(text) {
  let out = String(text || "");
  // ₦1,250,000.50 and ₦500k
  out = out.replace(/₦\s?([\d,]+(?:\.\d{1,2})?)\s?k\b/gi, (_, amount) => `${amount} thousand naira`);
  out = out.replace(/₦\s?([\d,]+(?:\.\d{1,2})?)/g, (_, amount) => `${amount} naira`);
  out = out.replace(/\bNGN\s?([\d,]+(?:\.\d{1,2})?)/gi, (_, amount) => `${amount} naira`);
  out = out.replace(/\b(\d[\d,]*)\s?kobo\b/gi, "$1 kobo");
  return out;
}

export function applyPronunciationDictionary(text) {
  let out = String(text || "");
  const entries = Object.entries(WORD_PRONUNCIATIONS)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [word, spoken] of entries) {
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi");
    out = out.replace(pattern, spoken);
  }
  return out;
}

export function normalizeForSpeech(text) {
  let out = String(text || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  out = normalizeCurrency(out);
  out = expandAbbreviations(out);
  out = applyPronunciationDictionary(out);
  return out.slice(0, 1200);
}

export function splitForSpeech(text, maxLength = 450) {
  const clean = normalizeForSpeech(text);
  if (!clean) return [];
  if (clean.length <= maxLength) return [clean];
  const sentences = clean.match(/[^.!?]+[.!?]?/g) || [clean];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const next = (current + " " + sentence).trim();
    if (next.length > maxLength && current) {
      chunks.push(current.trim());
      current = sentence.trim();
    } else {
      current = next;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
