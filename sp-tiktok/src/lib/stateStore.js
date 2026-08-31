/**
 * stateStore.js
 * Progress cursor + flag (backfill) disimpan di tab kecil "_State" di spreadsheet
 * Insights - persisten di luar runner GitHub Actions yang sekali-pakai.
 * Pola sama dengan sp-instagram/src/lib/stateStore.js.
 */

const { TIKTOK_INSIGHT_CONFIG } = require("./config");
const { ensureSheetWithHeaders, readSheetAsObjects, upsertRowByKey } = require("./sheetsHelper");

const STATE_HEADERS = ["KEY", "VALUE", "UPDATED_AT"];
const SS_ID = TIKTOK_INSIGHT_CONFIG.INSIGHTS_SPREADSHEET_ID;
const STATE_SHEET = TIKTOK_INSIGHT_CONFIG.STATE_SHEET_NAME;

async function ensureStateSheet(sheets) {
  await ensureSheetWithHeaders(sheets, SS_ID, STATE_SHEET, STATE_HEADERS);
}

async function getState(sheets, key) {
  await ensureStateSheet(sheets);
  const { rows } = await readSheetAsObjects(sheets, SS_ID, STATE_SHEET);
  const found = rows.find((r) => String(r["KEY"] || "").trim() === key);
  if (!found) return null;
  const value = String(found["VALUE"] || "");
  return value === "" ? null : value;
}

async function setState(sheets, key, value) {
  await ensureStateSheet(sheets);
  await upsertRowByKey(sheets, SS_ID, STATE_SHEET, "KEY", key, [key, value, new Date().toISOString()]);
}

async function deleteState(sheets, key) {
  await setState(sheets, key, "");
}

/** Lapor status backfill ke GitHub Actions (step output `done`). No-op saat lokal. */
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
