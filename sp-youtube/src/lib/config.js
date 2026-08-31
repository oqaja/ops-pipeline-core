// ID resource + template deskripsi dibaca dari environment variable (GitHub Actions
// repo Variables / file .env lokal), tidak di-hardcode. Lihat .env.example.
const CONFIG = {
  KALENDER_SPREADSHEET_ID: getSecret("KALENDER_SPREADSHEET_ID"),
  SHEET_NAME: "KALENDER KONTEN",

  DRIVE_FOLDER_ID: getSecret("DRIVE_FOLDER_ID"),
  DOCS_MASTER_ID: getSecret("DOCS_MASTER_ID"),

  STATUS_COLUMN: "STATUS YT",
  READY_STATUS_VALUE: "Acc",
  SCHEDULED_STATUS_VALUE: "Scheduled",
  POSTED_STATUS_VALUE: "Uploaded",
  ERROR_STATUS_VALUE: "Gagal",
  PRODUCTION_COLUMN: "PRODUCTION",
  PRODUCTION_DONE_VALUE: "✅",

  JAM_COLUMN: "JAM UP YT",
  TANGGAL_COLUMN: "TANGGAL",
  JUDUL_COLUMN: "JUDUL KONTEN",
  POST_ID_COLUMN: "POST ID YT",
  CATATAN_COLUMN: "CATATAN",
  AKUN_COLUMN: "AKUN",
  JENIS_KONTEN_COLUMN: "JENIS KONTEN",
  SUPPORTED_JENIS_KONTEN: "Video Pendek",

  TIMEZONE: "Asia/Jakarta",

  MAX_TITLE_LENGTH: 100,
  MAX_DESCRIPTION_LENGTH: 5000,

  // Template deskripsi channel (dipakai buat tiap video). Diisi dari repo Variable
  // CHANNEL_DESCRIPTION_TEMPLATE - sama persis dengan yang dipakai content-scheduler-svc.
  DESCRIPTION_TEMPLATE: getSecret("CHANNEL_DESCRIPTION_TEMPLATE"),

  INSIGHTS_SPREADSHEET_ID: getSecret("INSIGHTS_SPREADSHEET_ID"),
  INSIGHTS_SHORTS_SHEET_NAME: "Shorts",
  INSIGHTS_LANDSCAPE_SHEET_NAME: "Landscape Videos",
  SHORTS_MAX_DURATION_SEC: 270,
  INSIGHTS_ACCOUNT_SHEET_NAME: "YouTube Account",
  COMMENTS_SHEET_NAME: "Youtube Sp Comments",
  STATE_SHEET_NAME: "_State",

  MAX_INSIGHTS_BATCH: 50, // video per run buat refresh insight terbaru
  BACKFILL_MAX_PAGES_PER_RUN: 2, // 2 x 50 = 100 video per batch backfill (aman dari rate limit Sheets)
  BACKFILL_CURSOR_KEY: "SP_YT_BACKFILL_CURSOR",
  BACKFILL_DONE_KEY: "SP_YT_BACKFILL_DONE",

  // Format tampilan tanggal SERAGAM lintas platform. Nilai tetap datetime asli.
  // Butuh locale spreadsheet = id_ID supaya "mmm" render "Agu".
  POST_DATE_FORMAT: "dd mmm yyyy hh:mm",
  ACCOUNT_DATE_FORMAT: "dd mmm yyyy",
  SPREADSHEET_LOCALE: "id_ID",
};

function getSecret(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable '${name}' belum di-set. Cek GitHub Secrets atau file .env lokal.`);
  }
  return value;
}

module.exports = { CONFIG, getSecret };
