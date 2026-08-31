const { CONFIG } = require("./config");
const { ensureSheetWithHeaders, readSheetAsObjects, upsertRowByKey } = require("./sheetsHelper");

const STATE_HEADERS = ["KEY", "VALUE", "UPDATED_AT"];

async function ensureStateSheet(sheets) {
  await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.STATE_SHEET_NAME, STATE_HEADERS);
}

async function getState(sheets, key) {
  await ensureStateSheet(sheets);
  const { rows } = await readSheetAsObjects(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.STATE_SHEET_NAME);
  const found = rows.find((r) => String(r["KEY"] || "").trim() === key);
  if (!found) return null;
  const value = String(found["VALUE"] || "");
  return value === "" ? null : value;
}

async function setState(sheets, key, value) {
  await ensureStateSheet(sheets);
  await upsertRowByKey(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.STATE_SHEET_NAME, "KEY", key, [key, value, new Date()]);
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
