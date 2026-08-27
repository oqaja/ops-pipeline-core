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
};

module.exports.TIKTOK_INSIGHT_CONFIG = TIKTOK_INSIGHT_CONFIG;
