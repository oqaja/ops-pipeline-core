/**
 * titleMatch.js
 * Normalisasi JUDUL KONTEN / nama file untuk pencocokan yang toleran.
 *
 * Dua string dianggap SAMA walau beda:
 *  - huruf besar/kecil            ("Nike Dunk"  == "NIKE DUNK")
 *  - jenis & jumlah spasi         ("nike  dunk" == "nike dunk", termasuk non-breaking space)
 *  - variasi tanda hubung         ("-" "–" "—" dst dianggap "-")
 *  - variasi apostrof / kutip     ("'" "’" "`" dianggap "'")
 *  - tanda kali                   ("×" dianggap " x ")
 *  - tanda baca kalimat di ujung  ("REAL OR FAKE?" == "real or fake")
 *
 * TIDAK mengabaikan kata tambahan / embel-embel di nama file
 * (mis. "judul final v2 (1)" tetap != "judul").
 */

const DASH_RE = /[‐‑‒–—―−]/g; // ‐ ‑ ‒ – — ― −  -> "-"
const SQUOTE_RE = /[‘’‚‛′´`]/g; // ‘ ’ ‚ ‛ ′ ´ ` -> "'"
const DQUOTE_RE = /[“”„″]/g; // “ ” „ ″ -> '"'
const TIMES_RE = /[×✕✖]/g; // × ✕ ✖ -> " x "

/** @param {*} value @returns {string} */
function normalizeTitleForMatch(value) {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .replace(DASH_RE, "-")
    .replace(SQUOTE_RE, "'")
    .replace(DQUOTE_RE, '"')
    .replace(TIMES_RE, " x ")
    .toLowerCase()
    .replace(/\s+/g, " ") // \s di JS sudah termasuk   & spasi unicode lain
    .trim()
    .replace(/[.,;:!?]+$/, "")
    .trim();
}

module.exports = { normalizeTitleForMatch };
