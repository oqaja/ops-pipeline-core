/**
 * sheetReader.js
 * Port dari SP_SheetReader.gs (Modul 1) - baca sheet "KALENDER KONTEN",
 * balikin row-row SHOE POLICE yang siap diproses SEKARANG.
 */

const { CONFIG } = require("./config");
const { readSheetAsObjects } = require("./sheetsHelper");
const { isSameDateInTimezone, toMinutesOfDay, nowMinutesInTimezone } = require("./dateUtils");

/** Setara spGetReadyRows(). */
async function getReadyRows(sheets) {
  const { rows } = await readSheetAsObjects(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME);
  const now = new Date();
  return rows.filter((row) => isReadyToPost(row, now));
}

/** Setara spIsReadyToPost_. */
function isReadyToPost(row, now) {
  const akun = String(row["AKUN"] || "").trim().toUpperCase();
  if (akun !== "NSP") return false;

  const statusIg = String(row[CONFIG.STATUS_COLUMN] || "").trim().toUpperCase();
  const isApprovedStatus =
    statusIg === CONFIG.READY_STATUS_VALUE.toUpperCase() || statusIg === CONFIG.SCHEDULED_STATUS_VALUE.toUpperCase();
  if (!isApprovedStatus) return false;

  const jenisKonten = String(row["JENIS KONTEN"] || "").trim();
  const isSupported = CONFIG.SUPPORTED_JENIS_KONTEN.some((allowed) => allowed.toLowerCase() === jenisKonten.toLowerCase());
  if (!isSupported) return false;

  if (!isSameDateInTimezone(row["TANGGAL"], now, CONFIG.TIMEZONE)) return false;

  const jamUpMinutes = toMinutesOfDay(row[CONFIG.JAM_COLUMN]);
  if (jamUpMinutes === null) return false;

  const nowMinutes = nowMinutesInTimezone(CONFIG.TIMEZONE);
  if (jamUpMinutes > nowMinutes) return false;

  return true;
}

/** Setara spGetReadyRows tapi tanpa filter tanggal/jam - dipakai pre-check validasi. */
async function getAllRawRows(sheets) {
  const { rows } = await readSheetAsObjects(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME);
  return rows;
}

module.exports = { getReadyRows, getAllRawRows, isReadyToPost };
