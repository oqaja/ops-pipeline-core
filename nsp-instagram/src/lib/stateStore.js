/**
 * stateStore.js
 * Pengganti PropertiesService.getScriptProperties() dari Apps Script.
 *
 * PropertiesService bisa dipakai karena Apps Script punya "server" yang
 * hidup terus. GitHub Actions runner itu sekali pakai lalu dibuang -
 * jadi progress cursor (backfill insight, backfill komentar) HARUS
 * disimpan di tempat yang persisten LUAR runner. Di sini kita pakai tab
 * kecil "_State" di spreadsheet Insights (spreadsheet yang sama yang
 * sudah dipakai sistem ini, jadi service account yang sama sudah punya
 * akses, tidak perlu setup tambahan apapun).
 */

const { CONFIG } = require("./config");
const { ensureSheetWithHeaders, readSheetAsObjects, upsertRowByKey } = require("./sheetsHelper");

const STATE_HEADERS = ["KEY", "VALUE", "UPDATED_AT"];

async function ensureStateSheet(sheets) {
  await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.STATE_SHEET_NAME, STATE_HEADERS);
}

/** Setara PropertiesService.getProperty(key). @return {string|null} */
async function getState(sheets, key) {
  await ensureStateSheet(sheets);
  const { rows } = await readSheetAsObjects(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.STATE_SHEET_NAME);
  const found = rows.find((r) => String(r["KEY"] || "").trim() === key);
  if (!found) return null;
  const value = String(found["VALUE"] || "");
  return value === "" ? null : value;
}

/** Setara PropertiesService.setProperty(key, value). */
async function setState(sheets, key, value) {
  await ensureStateSheet(sheets);
  await upsertRowByKey(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.STATE_SHEET_NAME, "KEY", key, [
    key,
    value,
    new Date().toISOString(),
  ]);
}

/** Setara PropertiesService.deleteProperty(key). */
async function deleteState(sheets, key) {
  await setState(sheets, key, "");
}

/**
 * Lapor status backfill ke GitHub Actions (step output `done`) supaya workflow bisa
 * memutuskan lanjut batch berikutnya atau berhenti. Aman dipanggil di lokal (no-op).
 */
function reportBackfillDone(done) {
  const value = done ? "true" : "false";
  const outFile = process.env.GITHUB_OUTPUT;
  if (outFile) {
    try {
      require("fs").appendFileSync(outFile, `done=${value}\n`);
    } catch (err) {
      console.log(`(info) gagal tulis GITHUB_OUTPUT: ${err.message}`);
    }
  }
  console.log(`BACKFILL_STATUS done=${value}`);
}

module.exports = { getState, setState, deleteState, reportBackfillDone };
