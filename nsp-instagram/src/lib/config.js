/**
 * config.js
 * Port 1:1 dari SP_Config.gs. Semua value yang dulu ada di SP_CONFIG
 * tetap sama persis (ID spreadsheet, folder, dsb tidak berubah karena
 * data sumbernya tidak pindah, cuma yang mengeksekusi kode-nya yang pindah).
 *
 * Rahasia (token, API key) TIDAK lagi disimpan lewat PropertiesService,
 * tapi lewat environment variables (diisi dari GitHub Secrets saat
 * workflow jalan). Lihat README.md bagian "GitHub Secrets yang dibutuhkan".
 */

const CONFIG = {
  KALENDER_SPREADSHEET_ID: "1raiIO1HccW7IxN9bh9BqUJ7DOHDVBN05GKRQ5xrrfeI",

  SHEET_NAME: "KALENDER KONTEN",
  AKUN: "NSP", // nilai kolom "AKUN" di KALENDER KONTEN buat akun ini
  STATUS_COLUMN: "STATUS IG",
  READY_STATUS_VALUE: "Acc",
  SCHEDULED_STATUS_VALUE: "Scheduled",
  POSTED_STATUS_VALUE: "Uploaded",
  ERROR_STATUS_VALUE: "Gagal",
  TIMEZONE: "Asia/Jakarta",

  JAM_COLUMN: "JAM UP IG",

  SUPPORTED_JENIS_KONTEN: ["Desain", "Video Pendek"],

  DRIVE_FOLDER_ID: "1PhuAg0sJACUEr8sFbfSZEj45EGnrhF3u",

  DOCS_MASTER_ID: "1xLigBTT0Ite4ItD5MhazsUlyFO2n98GO-xsdXNdgFq8",

  IG_BUSINESS_ACCOUNT_ID: "17841418010404767",

  INSIGHTS_POST_SHEET_NAME: "Instagram Nsp",
  INSIGHTS_ACCOUNT_SHEET_NAME: "Instagram Nsp Account",
  COMMENT_ARCHIVE_SHEET_NAME: "Instagram Nsp Comments",
  STATE_SHEET_NAME: "_State",

  FACEBOOK_PAGE_ID: null,

  IG_API_VERSION: "v26.0",
  FB_API_VERSION: "v26.0",

  FB_STATUS_COLUMN: "STATUS FB",
  FB_JAM_COLUMN: "JAM UP FB",
  FB_POST_ID_COLUMN: "POST ID FB",

  FB_MIN_SCHEDULE_LEAD_MINUTES: 10,

  VIDEO_POLL_INTERVAL_MS: 5000,
  VIDEO_POLL_MAX_ATTEMPTS: 24,

  POST_ID_COLUMN: "POST ID IG",

  COVER_FILE_SUFFIX: "Cover",

  MAX_VIDEO_SIZE_MB: 300,
  MAX_IMAGE_SIZE_MB: 8,
  MAX_AUDIO_BITRATE_KBPS: 128,

  INSIGHTS_SPREADSHEET_ID: "1bv0i1ZdjNg8emGRHZL4zUWt-2n6o68_ug-shuZOIWr8",
  MAX_INSIGHTS_PAGES: 10,

  // Format tampilan tanggal yang SERAGAM di semua sheet insight (IG/NSP/TikTok/YouTube).
  // Nilai tetap disimpan sebagai datetime asli; ini cuma number-format tampilannya.
  // Butuh locale spreadsheet = id_ID supaya "mmm" render "Agu" (bukan "Aug").
  POST_DATE_FORMAT: "dd mmm yyyy hh:mm",
  ACCOUNT_DATE_FORMAT: "dd mmm yyyy",
  SPREADSHEET_LOCALE: "id_ID",

  MEDIA_METRICS: ["reach", "views", "saved", "shares", "total_interactions"],
  ACCOUNT_METRICS: ["reach", "views", "accounts_engaged", "total_interactions"],
};

/**
 * Rahasia diambil dari environment variables (diisi GitHub Actions dari
 * Secrets). Dibuat sebagai fungsi (bukan dibaca sekali di top-level) biar
 * error message-nya jelas kalau ada yang lupa di-set, dan biar gampang
 * ditest lewat unit test / script lokal dengan .env.
 */
function getSecret(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Environment variable '${name}' belum di-set. Cek GitHub Secrets (untuk workflow) ` +
        `atau file .env lokal (untuk testing manual).`
    );
  }
  return value;
}

module.exports = {
  CONFIG,
  getSecret,
  getIgAccessToken: () => getSecret("NSP_IG_ACCESS_TOKEN"),
  getDriveApiKey: () => process.env.GOOGLE_DRIVE_API_KEY || null, // opsional, sama seperti versi Apps Script
};
