const { CONFIG } = require("./config");
const { readSheetAsObjects } = require("./sheetsHelper");
const { combineDateAndTime } = require("./dateUtils");

function isReadyToPost(row) {
  const jenisKonten = String(row[CONFIG.JENIS_KONTEN_COLUMN] || "").trim();
  if (jenisKonten.toLowerCase() !== CONFIG.SUPPORTED_JENIS_KONTEN.toLowerCase()) return false;

  const production = String(row[CONFIG.PRODUCTION_COLUMN] || "").trim();
  if (production !== CONFIG.PRODUCTION_DONE_VALUE) return false;

  const statusYt = String(row[CONFIG.STATUS_COLUMN] || "").trim().toUpperCase();
  if (statusYt !== CONFIG.READY_STATUS_VALUE.toUpperCase()) return false;

  const judul = String(row[CONFIG.JUDUL_COLUMN] || "").trim();
  if (!judul) return false;

  const postId = String(row[CONFIG.POST_ID_COLUMN] || "").trim();
  if (postId !== "") return false; // sudah pernah upload, biar processReschedule yang urus

  return true;
}

async function getReadyRows(sheets) {
  const { rows } = await readSheetAsObjects(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME);
  return rows.filter(isReadyToPost);
}

/**
 * Baris "TANGGAL"-nya masih dalam window RESCHEDULE_CHECK_DAYS (dihitung dari hari ini
 * ke belakang) - TIDAK ADA batas atas, baris dengan TANGGAL di masa depan selalu lolos.
 * Kalau TANGGAL gagal di-parse, tetap lolos (lebih aman kecek gak perlu daripada kelewat).
 * Set env RESCHEDULE_CHECK_ALL=true buat bypass filter ini sepenuhnya (misal re-check histori manual).
 */
function isWithinRescheduleWindow(row) {
  if (String(process.env.RESCHEDULE_CHECK_ALL || "").trim().toLowerCase() === "true") return true;

  const tanggalCell = row[CONFIG.TANGGAL_COLUMN];
  const tanggalDate = combineDateAndTime(tanggalCell, "00:00", CONFIG.TIMEZONE);
  if (!tanggalDate) return true;

  const cutoffMs = Date.now() - CONFIG.RESCHEDULE_CHECK_DAYS * 24 * 60 * 60 * 1000;
  return tanggalDate.getTime() >= cutoffMs;
}

async function getUploadedRows(sheets) {
  const { rows } = await readSheetAsObjects(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME);
  const withPostId = rows.filter((row) => String(row[CONFIG.POST_ID_COLUMN] || "").trim() !== "");
  const withinWindow = withPostId.filter(isWithinRescheduleWindow);
  return { rows: withinWindow, totalWithPostId: withPostId.length };
}

/** Baris "Video Panjang" yang udah di-Acc tapi belum ke-link ke video YouTube (upload manual di Studio, nunggu di-matching). */
function isPendingManualUpload(row) {
  const jenisKonten = String(row[CONFIG.JENIS_KONTEN_COLUMN] || "").trim().toLowerCase();
  if (jenisKonten !== CONFIG.LANDSCAPE_JENIS_KONTEN.toLowerCase()) return false;

  const statusYt = String(row[CONFIG.STATUS_COLUMN] || "").trim().toUpperCase();
  if (statusYt !== CONFIG.READY_STATUS_VALUE.toUpperCase()) return false;

  const postId = String(row[CONFIG.POST_ID_COLUMN] || "").trim();
  if (postId !== "") return false;

  return true;
}

async function getPendingManualUploadRows(sheets) {
  const { rows } = await readSheetAsObjects(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME);
  return rows.filter(isPendingManualUpload);
}

module.exports = {
  getReadyRows,
  getUploadedRows,
  isReadyToPost,
  getPendingManualUploadRows,
  isPendingManualUpload,
};
