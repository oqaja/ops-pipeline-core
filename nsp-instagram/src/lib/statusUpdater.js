/**
 * statusUpdater.js
 * Port dari SP_StatusUpdater.gs (Modul 5) - tulis balik hasil publish ke sheet.
 */

const { CONFIG } = require("./config");
const { getHeaderColumnMap, setCellValue } = require("./sheetsHelper");

/** Setara spUpdateRowStatus(). */
async function updateRowStatus(sheets, rowNumber, status, message, postId) {
  const headerMap = await getHeaderColumnMap(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME);

  const statusCol = headerMap[CONFIG.STATUS_COLUMN];
  if (statusCol) {
    await setCellValue(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME, rowNumber, statusCol, status);
  } else {
    console.log(`  (warning) Kolom '${CONFIG.STATUS_COLUMN}' tidak ketemu di header sheet.`);
  }

  const catatanCol = headerMap["CATATAN"];
  if (catatanCol) {
    await appendToCatatan(sheets, rowNumber, catatanCol, message);
  } else {
    console.log("  (warning) Kolom 'CATATAN' tidak ketemu di header sheet.");
  }

  if (postId) {
    const postIdCol = headerMap[CONFIG.POST_ID_COLUMN];
    if (postIdCol) {
      await setCellValue(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME, rowNumber, postIdCol, postId);
    } else {
      console.log(`  (warning) Kolom '${CONFIG.POST_ID_COLUMN}' tidak ketemu di header sheet - post ID cuma tercatat di CATATAN.`);
    }
  }
}

/** Setara spAppendToCatatan_. */
async function appendToCatatan(sheets, rowNumber, catatanCol, message) {
  const existingValue = await readCellByColumnNumber(sheets, rowNumber, catatanCol);

  const newLine = `IG: ${message}`;
  const otherLines = existingValue
    ? existingValue.split("\n").filter((line) => line.trim().indexOf("IG:") !== 0)
    : [];

  const allLines = [...otherLines, newLine];
  await setCellValue(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME, rowNumber, catatanCol, allLines.join("\n"));
}

async function readCellByColumnNumber(sheets, rowNumber, colNumber) {
  const { columnNumberToLetter } = require("./sheetsHelper");
  const colLetter = columnNumberToLetter(colNumber);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.KALENDER_SPREADSHEET_ID,
    range: `'${CONFIG.SHEET_NAME}'!${colLetter}${rowNumber}`,
  });
  const value = res.data.values && res.data.values[0] && res.data.values[0][0];
  return String(value || "").trim();
}

module.exports = { updateRowStatus };
