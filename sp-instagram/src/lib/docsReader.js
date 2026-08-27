/**
 * docsReader.js
 * Port dari SP_DocsReader.gs (Modul 3) - jelajah semua tab & sub-tab di
 * Docs Master, cari blok "Judul Konten:" yang cocok, extract "Caption +
 * Hashtag:" dan "Collaborator:".
 *
 * DocumentApp.getBody().getText() (Apps Script) diganti dengan parser
 * manual atas structuralElements yang dibalikin Docs API v1
 * (documents.get dengan includeTabsContent=true).
 */

const { CONFIG } = require("./config");

const DOC_LABELS = [
  "Tanggal Upload:",
  "Judul Konten:",
  "Thumbnail/Cover:",
  "Deskripsi Youtube:",
  "Caption + Hashtag:",
  "Collaborator:",
  "Isi Konten:",
];

const EMPTY_PLACEHOLDER_VALUES = ["-", "--", "n/a", "na", "none", "tidak ada", "kosong", "tanpa"];

/**
 * Ubah body dokumen (structuralElements) jadi plain text, meniru
 * DocumentApp body.getText() - gabungkan tiap paragraph jadi 1 baris,
 * termasuk teks di dalam tabel (kalau ada).
 * @private
 */
function extractPlainText(body) {
  if (!body || !body.content) return "";
  const lines = [];
  walkStructuralElements(body.content, lines);
  return lines.join("");
}

function walkStructuralElements(elements, lines) {
  for (const el of elements) {
    if (el.paragraph) {
      let lineText = "";
      for (const pe of el.paragraph.elements || []) {
        if (pe.textRun && pe.textRun.content) lineText += pe.textRun.content;
      }
      lines.push(lineText);
    } else if (el.table) {
      for (const row of el.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          walkStructuralElements(cell.content || [], lines);
        }
      }
    } else if (el.tableOfContents) {
      walkStructuralElements(el.tableOfContents.content || [], lines);
    }
  }
}

/** Ratakan struktur tab + sub-tab (nested) jadi 1 array flat. Setara spFlattenTabs_. */
function flattenTabs(tabs) {
  let result = [];
  for (const tab of tabs || []) {
    result.push(tab);
    if (tab.childTabs && tab.childTabs.length > 0) {
      result = result.concat(flattenTabs(tab.childTabs));
    }
  }
  return result;
}

function lineStartsWithLabel(line, label) {
  return line.toLowerCase().indexOf(label.toLowerCase()) === 0;
}

function getLabelValue(line, label) {
  return line.substring(label.length);
}

function isAnyLabelLine(line) {
  return DOC_LABELS.some((label) => lineStartsWithLabel(line, label));
}

/** Setara spFindMatchingBlockIndex_. */
function findMatchingBlockIndex(lines, targetJudul) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (lineStartsWithLabel(line, "Judul Konten:")) {
      const judulValue = getLabelValue(line, "Judul Konten:").trim().toLowerCase();
      if (judulValue === targetJudul) return i;
    }
  }
  return -1;
}

/** Setara spFindSingleLineFieldValue_. */
function findSingleLineFieldValue(lines, startIndex, label) {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (lineStartsWithLabel(line, label)) return getLabelValue(line, label).trim();
    if (i > startIndex && lineStartsWithLabel(line, "Judul Konten:")) return null;
  }
  return null;
}

/** Setara spExtractCaptionFromIndex_. */
function extractCaptionFromIndex(lines, startIndex) {
  let captionStartIndex = -1;
  let firstLineRemainder = "";

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (lineStartsWithLabel(line, "Caption + Hashtag:")) {
      captionStartIndex = i;
      firstLineRemainder = getLabelValue(line, "Caption + Hashtag:").trim();
      break;
    }
  }

  if (captionStartIndex === -1) return null;

  const captionLines = [];
  if (firstLineRemainder) captionLines.push(firstLineRemainder);

  for (let j = captionStartIndex + 1; j < lines.length; j++) {
    const nextLine = lines[j].trim();
    if (isAnyLabelLine(nextLine)) break;
    captionLines.push(lines[j]);
  }

  return captionLines.join("\n").trim();
}

/** Setara spParseCollaboratorUsernames_. */
function parseCollaboratorUsernames(rawValue) {
  let usernames = rawValue
    .split(",")
    .map((u) => u.trim().replace(/^@/, ""))
    .filter((u) => u.length > 0 && !EMPTY_PLACEHOLDER_VALUES.includes(u.toLowerCase()));

  if (usernames.length > 3) {
    console.log(`  (warning) Collaborator lebih dari 3 (${usernames.length}), dipotong ke 3 pertama (batas Instagram).`);
    usernames = usernames.slice(0, 3);
  }
  return usernames;
}

// Cache isi Docs Master selama 1 proses (satu kali jalan orchestrator biasanya
// panggil getCaptionFromDocs + getCollaboratorsFromDocs untuk row yang sama -
// gak perlu fetch dokumen yang beratnya bisa banyak tab itu dua kali).
let cachedTabsPromise = null;

/** Ambil semua tab Docs Master sebagai array of { lines: string[] }. @private */
async function getDocTabsAsLines(docs) {
  if (cachedTabsPromise) return cachedTabsPromise;

  cachedTabsPromise = (async () => {
    const res = await docs.documents.get({
      documentId: CONFIG.DOCS_MASTER_ID,
      includeTabsContent: true,
    });

    const allTabs = flattenTabs(res.data.tabs || []);
    return allTabs.map((tab) => {
      const body = tab.documentTab ? tab.documentTab.body : null;
      const text = extractPlainText(body);
      return { lines: text.split("\n") };
    });
  })();

  return cachedTabsPromise;
}

/** Reset cache (dipanggil di awal tiap entrypoint script, biar gak nyangkut lintas-run kalau env di-reuse). */
function clearDocsCache() {
  cachedTabsPromise = null;
}

/** Setara spGetCaptionFromDocs(). */
async function getCaptionFromDocs(docs, judulKonten) {
  const targetJudul = String(judulKonten || "").trim().toLowerCase();
  if (!targetJudul) return null;

  const tabs = await getDocTabsAsLines(docs);

  for (const { lines } of tabs) {
    const blockIndex = findMatchingBlockIndex(lines, targetJudul);
    if (blockIndex === -1) continue;
    const caption = extractCaptionFromIndex(lines, blockIndex);
    if (caption !== null) return caption;
  }

  return null;
}

/** Setara spGetCollaboratorsFromDocs(). */
async function getCollaboratorsFromDocs(docs, judulKonten) {
  const targetJudul = String(judulKonten || "").trim().toLowerCase();
  if (!targetJudul) return [];

  const tabs = await getDocTabsAsLines(docs);

  for (const { lines } of tabs) {
    const blockIndex = findMatchingBlockIndex(lines, targetJudul);
    if (blockIndex === -1) continue;

    const rawValue = findSingleLineFieldValue(lines, blockIndex, "Collaborator:");
    if (rawValue === null || rawValue.trim() === "") return [];
    return parseCollaboratorUsernames(rawValue);
  }

  return [];
}

module.exports = { getCaptionFromDocs, getCollaboratorsFromDocs, clearDocsCache };
