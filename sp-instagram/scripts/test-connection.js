try { require("dotenv").config(); } catch (e) {}
const { getSheetsClient, getDriveClient, getDocsClient } = require("../src/lib/googleAuth");
const { testInstagramConnection } = require("../src/lib/instagramPublisher");
const { CONFIG } = require("../src/lib/config");

/**
 * Cek semua koneksi SEBELUM jalanin automation beneran:
 * - Service account bisa buka spreadsheet KALENDER KONTEN?
 * - Service account bisa buka Docs Master?
 * - Service account bisa buka folder Drive SIAP UPLOAD?
 * - Token Instagram masih sehat?
 * Jalankan manual: npm run test-connection
 */
(async () => {
  console.log("=== Test koneksi (Instagram SP automation) ===\n");

  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.KALENDER_SPREADSHEET_ID });
    console.log(`[OK] Spreadsheet KALENDER KONTEN terbaca: "${res.data.properties.title}"`);
  } catch (err) {
    console.log(`[GAGAL] Spreadsheet KALENDER KONTEN: ${err.message}`);
    console.log("        -> Pastikan service account sudah di-share sebagai Editor ke spreadsheet ini.");
  }

  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.INSIGHTS_SPREADSHEET_ID });
    console.log(`[OK] Spreadsheet Insights terbaca: "${res.data.properties.title}"`);
  } catch (err) {
    console.log(`[GAGAL] Spreadsheet Insights: ${err.message}`);
    console.log("        -> Pastikan service account sudah di-share sebagai Editor ke spreadsheet ini.");
  }

  try {
    const docs = await getDocsClient();
    const res = await docs.documents.get({ documentId: CONFIG.DOCS_MASTER_ID, includeTabsContent: false });
    console.log(`[OK] Docs Master terbaca: "${res.data.title}"`);
  } catch (err) {
    console.log(`[GAGAL] Docs Master: ${err.message}`);
    console.log("        -> Pastikan service account sudah di-share (minimal Viewer) ke dokumen ini.");
  }

  try {
    const drive = await getDriveClient();
    const res = await drive.files.list({ q: `'${CONFIG.DRIVE_FOLDER_ID}' in parents`, pageSize: 1, fields: "files(id,name)" });
    console.log(`[OK] Folder Drive SIAP UPLOAD terbaca (${res.data.files.length > 0 ? "ada isinya" : "kosong, tapi bisa diakses"}).`);
  } catch (err) {
    console.log(`[GAGAL] Folder Drive SIAP UPLOAD: ${err.message}`);
    console.log("        -> Pastikan service account sudah di-share sebagai Editor ke folder ini.");
  }

  console.log("");
  await testInstagramConnection();
})();
