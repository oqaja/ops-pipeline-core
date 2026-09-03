// ID resource dibaca dari environment variable (GitHub Actions repo Variables /
// file .env lokal), tidak di-hardcode. Lihat .env.example.
const CONFIG = {
  DOC_MASTER_ID: getSecret("DOCS_MASTER_ID"),
  FOLDER_SIAP_UPLOAD_ID: getSecret("DRIVE_FOLDER_ID"),
  SPREADSHEET_ID: getSecret("KALENDER_SPREADSHEET_ID"),
  SHEET_NAME: "KALENDER KONTEN",
  BUFFER_CHANNEL_ID: getSecret("BUFFER_CHANNEL_ID"),
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
  INSIGHTS_SPREADSHEET_ID: getSecret("INSIGHTS_SPREADSHEET_ID"),
  VIDEO_SHEET_NAME: "TikTok",
  ACCOUNT_SHEET_NAME: "TikTok Account",
  STATE_SHEET_NAME: "_State",

  RECENT_PAGES: 3, // refresh harian: 3 halaman x 20 = ~60 video terbaru
  BACKFILL_MAX_PAGES_PER_RUN: 5, // backfill: 5 halaman x 20 = 100 video per batch
  BACKFILL_CURSOR_KEY: "TIKTOK_BACKFILL_CURSOR",
  BACKFILL_DONE_KEY: "TIKTOK_BACKFILL_DONE",

  // Format tampilan tanggal SERAGAM lintas platform. Nilai tetap datetime asli.
  // Butuh locale spreadsheet Indonesia supaya "mmm" render "Agu" bukan "Aug".
  // NB: Google Sheets pakai kode locale legacy "in_ID" (bukan "id_ID") - kode
  // "id_ID" ditolak API dengan "Unsupported locale".
  POST_DATE_FORMAT: "dd mmm yyyy hh:mm",
  ACCOUNT_DATE_FORMAT: "dd mmm yyyy",
  SPREADSHEET_LOCALE: "in_ID",
};

module.exports.TIKTOK_INSIGHT_CONFIG = TIKTOK_INSIGHT_CONFIG;
