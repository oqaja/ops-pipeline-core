/**
 * mainOrchestrator.js
 * Port dari SP_MainOrchestrator.gs (Modul 6) - gabungkan semua modul jadi
 * 1 alur: sheetReader -> driveFinder -> docsReader -> instagramPublisher -> statusUpdater.
 *
 * LockService.getScriptLock() (anti-tumpang-tindih eksekusi) DIGANTI oleh
 * `concurrency:` group di workflow GitHub Actions (lihat
 * .github/workflows/main-automation.yml) - itu cara yang lebih natural di
 * GitHub Actions daripada bikin lock manual sendiri.
 */

const { CONFIG } = require("./config");
const { getSheetsClient, getDriveClient, getDocsClient } = require("./googleAuth");
const { getReadyRows, getAllRawRows } = require("./sheetReader");
const { findContentFiles, findCoverFile, validateFile, validateFiles } = require("./driveFinder");
const { getCaptionFromDocs, getCollaboratorsFromDocs, clearDocsCache } = require("./docsReader");
const { publishToInstagram } = require("./instagramPublisher");
const { updateRowStatus } = require("./statusUpdater");
const { getHeaderColumnMap, setCellValue } = require("./sheetsHelper");

async function runAutomation() {
  clearDocsCache();

  const sheets = await getSheetsClient();
  const drive = await getDriveClient();
  const docs = await getDocsClient();

  console.log("========================================");
  console.log("Instagram content automation - mulai jalan");
  console.log("========================================");

  try {
    await validatePendingContent(sheets, drive);
  } catch (err) {
    console.log(`Gagal menjalankan pre-check validasi (non-fatal, lanjut proses): ${err.message}`);
  }

  let rows;
  try {
    rows = await getReadyRows(sheets);
  } catch (err) {
    console.log(`GAGAL total di Modul 1 (baca sheet): ${err.message}`);
    return;
  }

  if (rows.length === 0) {
    console.log("Tidak ada row yang siap diproses saat ini.");
    return;
  }

  console.log(`Ditemukan ${rows.length} row siap diproses.`);

  for (const row of rows) {
    await processSingleRow(sheets, drive, docs, row);
  }

  console.log("========================================");
  console.log("Instagram content automation - selesai");
  console.log("========================================");
}

async function processSingleRow(sheets, drive, docs, row) {
  const judul = row["JUDUL KONTEN"];
  const rowNumber = row._rowNumber;

  console.log("");
  console.log(`--- Proses baris ${rowNumber}: '${judul}' ---`);

  const existingPostId = String(row[CONFIG.POST_ID_COLUMN] || "").trim();
  if (existingPostId !== "") {
    console.log(`  (SKIP) Row ini sudah punya POST ID IG (${existingPostId}) - tidak akan publish ulang (mencegah duplikat).`);
    await updateRowStatus(sheets, rowNumber, CONFIG.POSTED_STATUS_VALUE, "Sudah pernah diupload sebelumnya", existingPostId);
    return;
  }

  let fileInfos;
  try {
    fileInfos = await findContentFiles(drive, judul);
  } catch (err) {
    await handleFailure(sheets, rowNumber, `Error saat cari file di Drive: ${err.message}`);
    return;
  }

  if (fileInfos.length === 0) {
    await handleFailure(sheets, rowNumber, `File tidak ditemukan di folder SIAP UPLOAD (nama harus persis: '${judul}')`);
    return;
  }
  console.log(
    fileInfos.length === 1
      ? `File ketemu: ${fileInfos[0].fileName} (${fileInfos[0].isVideo ? "video" : "foto"})`
      : `File ketemu CAROUSEL (${fileInfos.length} item)`
  );

  const validationError = await validateFiles(fileInfos);
  if (validationError) {
    await handleFailure(sheets, rowNumber, `Validasi file gagal: ${validationError}`);
    return;
  }

  let caption;
  try {
    caption = await getCaptionFromDocs(docs, judul);
  } catch (err) {
    await handleFailure(sheets, rowNumber, `Error saat cari caption di Docs Master: ${err.message}`);
    return;
  }

  if (caption === null) {
    console.log("Caption tidak ketemu di Docs Master - lanjut publish TANPA caption.");
    caption = "";
  } else {
    console.log(`Caption ketemu (${caption.length} karakter).`);
  }

  let collaborators = [];
  try {
    collaborators = await getCollaboratorsFromDocs(docs, judul);
    if (collaborators.length > 0) console.log(`Collaborator ditemukan: ${collaborators.join(", ")}`);
  } catch (err) {
    console.log(`Error saat cari collaborator (lanjut tanpa collaborator): ${err.message}`);
  }

  let coverUrl = null;
  try {
    const coverInfo = await findCoverFile(drive, judul);
    if (coverInfo) {
      coverUrl = coverInfo.directUrl;
      console.log(`Cover custom ditemukan: ${coverInfo.fileName}`);
    }
  } catch (err) {
    console.log(`Error saat cari cover (lanjut pakai default IG): ${err.message}`);
  }

  const result = await publishToInstagram(fileInfos, caption, row["JENIS KONTEN"], collaborators, coverUrl);

  if (result.success) {
    console.log(`SUKSES! Post ID: ${result.postId}`);

    let successMessage = "Sukses";
    if (result.droppedCollaborators && result.droppedCollaborators.length > 0) {
      successMessage += ` (collaborator gagal diundang & dilewati: ${result.droppedCollaborators.join(", ")})`;
      console.log(`  (info) Collaborator dilewati: ${result.droppedCollaborators.join(", ")}`);
    }

    await updateRowStatus(sheets, rowNumber, CONFIG.POSTED_STATUS_VALUE, successMessage, result.postId);
  } else {
    await handleFailure(sheets, rowNumber, result.error);
  }
}

async function handleFailure(sheets, rowNumber, errorMessage) {
  console.log(`GAGAL: ${errorMessage}`);
  await updateRowStatus(sheets, rowNumber, CONFIG.ERROR_STATUS_VALUE, `Gagal - ${errorMessage}`);
}

/** Setara spValidatePendingContent_. */
async function validatePendingContent(sheets, drive) {
  const headerMap = await getHeaderColumnMap(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME);
  const statusCol = headerMap[CONFIG.STATUS_COLUMN];
  if (!statusCol) return;

  const allRows = await getAllRawRows(sheets);
  let scheduledCount = 0;
  let failedCount = 0;

  for (const row of allRows) {
    const akun = String(row["AKUN"] || "").trim().toUpperCase();
    if (akun !== CONFIG.AKUN) continue;

    const statusIg = String(row[CONFIG.STATUS_COLUMN] || "").trim().toUpperCase();
    if (statusIg !== CONFIG.READY_STATUS_VALUE.toUpperCase()) continue;

    const jenisKonten = String(row["JENIS KONTEN"] || "").trim();
    const isSupported = CONFIG.SUPPORTED_JENIS_KONTEN.some((allowed) => allowed.toLowerCase() === jenisKonten.toLowerCase());
    if (!isSupported) continue;

    const judul = row["JUDUL KONTEN"];
    console.log(`  [Pre-check] ${judul}`);

    let fileInfos;
    try {
      fileInfos = await findContentFiles(drive, judul);
    } catch (err) {
      console.log(`    Error cari file (dilewatkan, coba lagi cycle berikutnya): ${err.message}`);
      continue;
    }

    if (fileInfos.length === 0) {
      console.log("    File belum ketemu - mungkin belum diupload editor. Coba lagi cycle berikutnya.");
      continue;
    }

    const validationError = await validateFiles(fileInfos);
    if (validationError) {
      console.log(`    GAGAL validasi: ${validationError}`);
      await updateRowStatus(sheets, row._rowNumber, CONFIG.ERROR_STATUS_VALUE, `Gagal - ${validationError}`);
      failedCount++;
      continue;
    }

    try {
      const coverInfo = await findCoverFile(drive, judul);
      if (coverInfo) {
        const coverError = await validateFile(coverInfo);
        if (coverError) {
          console.log(`    GAGAL validasi cover: ${coverError}`);
          await updateRowStatus(sheets, row._rowNumber, CONFIG.ERROR_STATUS_VALUE, `Gagal (cover) - ${coverError}`);
          failedCount++;
          continue;
        }
      }
    } catch (err) {
      console.log(`    Error cek cover (dilewatkan, tidak menghalangi): ${err.message}`);
    }

    console.log("    Lolos validasi -> ditandai 'Scheduled'.");
    await setCellValue(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME, row._rowNumber, statusCol, CONFIG.SCHEDULED_STATUS_VALUE);
    scheduledCount++;
  }

  if (scheduledCount > 0 || failedCount > 0) {
    console.log(`  [Pre-check] Selesai: ${scheduledCount} row jadi 'Scheduled', ${failedCount} row gagal validasi.`);
  }
}

module.exports = { runAutomation };
