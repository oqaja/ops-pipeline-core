const CONFIG = {
  KALENDER_SPREADSHEET_ID: "1raiIO1HccW7IxN9bh9BqUJ7DOHDVBN05GKRQ5xrrfeI",
  SHEET_NAME: "KALENDER KONTEN",

  DRIVE_FOLDER_ID: "1PhuAg0sJACUEr8sFbfSZEj45EGnrhF3u",
  DOCS_MASTER_ID: "1xLigBTT0Ite4ItD5MhazsUlyFO2n98GO-xsdXNdgFq8",

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

  // Sama persis dengan channel description di affiliate-automation (channel yang sama).
  DESCRIPTION_TEMPLATE: `Otoritas Tertinggi Tren & Edukasi Sepatu di Indonesia! 👟⚖️ Selamat datang di channel YouTube Shoe Police!

Banyak yang ngaku suka sepatu, tapi berapa banyak yang paham apa yang mereka pakai? Di sini, kami hadir sebagai "pengawas" sekaligus edukator di industri alas kaki. Kami nggak cuma bahas soal apa yang lagi hype, tapi kami bedah kenapa sebuah sepatu layak (atau nggak layak) masuk ke koleksi lo.

Apa yang bakal lo dapetin di sini?
- Sneaker Education: Bedah anatomi, sejarah, dan teknologi di balik sepatu favorit lo.
- Industry Insights: Obrolan mendalam soal tren fashion, brand lokal, hingga pergerakan pasar global.
- Legit Check & Quality Review: Kami jujur soal kualitas. Kalau bagus kami bilang mantap, kalau kurang kami laporin!
- Community Culture: Menangkap esensi dari pergerakan komunitas (Ormas Shoe Police) dan gaya hidup di baliknya.

sepatu kurasi shoepolice 👇🏻
https://linktr.ee/Rekomendasishoepolice

Di Shoe Police, kami percaya sepatu lebih dari sekadar alas kaki—ia adalah identitas.
Follow the Movement:
Instagram: @shoepolice__
Tiktok: @shoepolice__
💬 Join the Community: https://shorturl.at/EycJl
📩 Business Inquiries: igshoepolice@gmail.com`,

  INSIGHTS_SPREADSHEET_ID: "1bv0i1ZdjNg8emGRHZL4zUWt-2n6o68_ug-shuZOIWr8",
  INSIGHTS_SHORTS_SHEET_NAME: "Shorts",
  INSIGHTS_LANDSCAPE_SHEET_NAME: "Landscape Videos",
  SHORTS_MAX_DURATION_SEC: 270,
  INSIGHTS_ACCOUNT_SHEET_NAME: "YouTube Account",
  COMMENTS_SHEET_NAME: "Youtube Sp Comments",
  STATE_SHEET_NAME: "_State",

  MAX_INSIGHTS_BATCH: 50, // video per run buat insight, sama pola "cap per run" kayak IG backfill
};

function getSecret(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable '${name}' belum di-set. Cek GitHub Secrets atau file .env lokal.`);
  }
  return value;
}

module.exports = { CONFIG, getSecret };
