const CONFIG = {
  DOC_MASTER_ID: "1xLigBTT0Ite4ItD5MhazsUlyFO2n98GO-xsdXNdgFq8",
  FOLDER_SIAP_UPLOAD_ID: "1PhuAg0sJACUEr8sFbfSZEj45EGnrhF3u",
  SPREADSHEET_ID: "1raiIO1HccW7IxN9bh9BqUJ7DOHDVBN05GKRQ5xrrfeI",
  SHEET_NAME: "KALENDER KONTEN",
  BUFFER_CHANNEL_ID: "6a86ac80ccaf649a67df85ae",
  LABEL_LIST: [
    "tanggal upload:",
    "judul konten:",
    "thumbnail/cover:",
    "segmen:",
    "deskripsi youtube:",
    "caption + hashtag:",
    "isi konten:",
  ],
};

function getSecret(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable '${name}' belum di-set. Cek GitHub Secrets atau file .env lokal.`);
  }
  return value;
}

module.exports = {
  CONFIG,
  getSecret,
  getBufferApiKey: () => getSecret("BUFFER_API_KEY"),
  getDriveApiKey: () => process.env.GOOGLE_DRIVE_API_KEY || null,
};

const TIKTOK_INSIGHT_CONFIG = {
  INSIGHTS_SPREADSHEET_ID: "1bv0i1ZdjNg8emGRHZL4zUWt-2n6o68_ug-shuZOIWr8",
  VIDEO_SHEET_NAME: "TikTok",
  ACCOUNT_SHEET_NAME: "TikTok Account",
  STATE_SHEET_NAME: "_State",

  RECENT_PAGES: 3, // refresh harian: 3 halaman x 20 = ~60 video terbaru
  BACKFILL_MAX_PAGES_PER_RUN: 5, // backfill: 5 halaman x 20 = 100 video per batch
  BACKFILL_CURSOR_KEY: "TIKTOK_BACKFILL_CURSOR",
  BACKFILL_DONE_KEY: "TIKTOK_BACKFILL_DONE",

  // Format tampilan tanggal SERAGAM lintas platform. Nilai tetap datetime asli.
  // Butuh locale spreadsheet = id_ID supaya "mmm" render "Agu".
  POST_DATE_FORMAT: "dd mmm yyyy hh:mm",
  ACCOUNT_DATE_FORMAT: "dd mmm yyyy",
  SPREADSHEET_LOCALE: "id_ID",
};

module.exports.TIKTOK_INSIGHT_CONFIG = TIKTOK_INSIGHT_CONFIG;
