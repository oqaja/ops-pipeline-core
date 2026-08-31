/**
 * sheetReader.js
 * Port dari SP_SheetReader.gs (Modul 1) - baca sheet "KALENDER KONTEN",
 * balikin row-row yang siap diproses SEKARANG.
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

/** Setara spIsReadyToPost_. Debug log hanya untuk row akun ini biar tidak berisik. */
function isReadyToPost(row, now) {
  const akun = String(row["AKUN"] || "").trim().toUpperCase();
  if (akun !== CONFIG.AKUN) return false;

  const reject = (alasan) => {
    console.log(`  [skip ${CONFIG.AKUN}] '${row["JUDUL KONTEN"]}' - ${alasan} (TANGGAL=${JSON.stringify(row["TANGGAL"])}, JAM=${JSON.stringify(row[CONFIG.JAM_COLUMN])}, STATUS=${JSON.stringify(row[CONFIG.STATUS_COLUMN])})`);
    return false;
  };

  // Status & jenis konten yang tidak cocok = row lama / bukan giliran -> skip diam-diam (biar log tidak penuh).
  const statusIg = String(row[CONFIG.STATUS_COLUMN] || "").trim().toUpperCase();
  const isApprovedStatus =
    statusIg === CONFIG.READY_STATUS_VALUE.toUpperCase() || statusIg === CONFIG.SCHEDULED_STATUS_VALUE.toUpperCase();
  if (!isApprovedStatus) return false;

  const jenisKonten = String(row["JENIS KONTEN"] || "").trim();
  const isSupported = CONFIG.SUPPORTED_JENIS_KONTEN.some((allowed) => allowed.toLowerCase() === jenisKonten.toLowerCase());
  if (!isSupported) return false;

  if (!isSameDateInTimezone(row["TANGGAL"], now, CONFIG.TIMEZONE)) return reject("tanggal bukan hari ini / gagal di-parse");

  const jamUpMinutes = toMinutesOfDay(row[CONFIG.JAM_COLUMN]);
  if (jamUpMinutes === null) return reject("jam up kosong / gagal di-parse");

  const nowMinutes = nowMinutesInTimezone(CONFIG.TIMEZONE);
  if (jamUpMinutes > nowMinutes) return reject(`belum waktunya (jam up ${jamUpMinutes}m > sekarang ${nowMinutes}m)`);

  console.log(`  [siap ${CONFIG.AKUN}] '${row["JUDUL KONTEN"]}' - lolos semua cek.`);
  return true;
}

/** Setara spGetReadyRows tapi tanpa filter tanggal/jam - dipakai pre-check validasi. */
async function getAllRawRows(sheets) {
  const { rows } = await readSheetAsObjects(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME);
  return rows;
}

module.exports = { getReadyRows, getAllRawRows, isReadyToPost };
