const { CONFIG } = require("./config");
const { readSheetAsObjects } = require("./sheetsHelper");

function isReadyToPost(row) {
  const akun = String(row[CONFIG.AKUN_COLUMN] || "").trim().toUpperCase();
  if (akun !== "SP") return false;

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

async function getUploadedRows(sheets) {
  const { rows } = await readSheetAsObjects(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME);
  return rows.filter((row) => {
    const akun = String(row[CONFIG.AKUN_COLUMN] || "").trim().toUpperCase();
    return akun === "SP" && String(row[CONFIG.POST_ID_COLUMN] || "").trim() !== "";
  });
}

module.exports = { getReadyRows, getUploadedRows, isReadyToPost };
