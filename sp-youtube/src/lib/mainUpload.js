const { CONFIG } = require("./config");
const { getReadyRows, getUploadedRows, getPendingManualUploadRows } = require("./sheetReader");
const { cariFileVideo, downloadFileStream } = require("./driveFinder");
const { cariKontenDiDocsMaster } = require("./docsReader");
const { setCellValue, getHeaderColumnMap } = require("./sheetsHelper");
const { combineDateAndTime, toSheetDateString } = require("./dateUtils");
const {
  buildTitle,
  buildDescription,
  determinePrivacyAndSchedule,
  uploadVideo,
  updateVideoSchedule,
  getVideoStatus,
  updateVideoDetails,
  getUploadsPlaylistId,
  findManualUploadByDate,
} = require("./youtubePublisher");

function sheetStatusFor(privacyStatus) {
  return privacyStatus === "public" ? CONFIG.POSTED_STATUS_VALUE : CONFIG.SCHEDULED_STATUS_VALUE;
}

async function processNewUpload(row, headerMap, { sheets, docs, drive, youtube }) {
  const nomorBaris = row._rowNumber;
  const judul = String(row[CONFIG.JUDUL_COLUMN] || "").trim();
  const segmen = String(row[CONFIG.SEGMEN_COLUMN] || "").trim();
  const tanggalCell = row[CONFIG.TANGGAL_COLUMN];
  const jamCell = row[CONFIG.JAM_COLUMN];

  console.log(`Proses upload baris ${nomorBaris}: ${judul}`);

  try {
    const jadwalUpload = combineDateAndTime(tanggalCell, jamCell, CONFIG.TIMEZONE);
    if (!jadwalUpload) {
      throw new Error(`TANGGAL (${tanggalCell}) atau ${CONFIG.JAM_COLUMN} (${jamCell}) tidak valid.`);
    }

    const videoFile = await cariFileVideo(drive, judul);
    if (!videoFile) {
      throw new Error(`File video tidak ditemukan di folder Drive dengan nama: ${judul}`);
    }

    const kontenDitemukan = await cariKontenDiDocsMaster(docs, judul);
    const deskripsiUser = kontenDitemukan && kontenDitemukan.deskripsiYoutube ? kontenDitemukan.deskripsiYoutube.trim() : "";

    const title = buildTitle(judul, segmen);
    const description = buildDescription(deskripsiUser);
    const { privacyStatus, publishAt } = determinePrivacyAndSchedule(jadwalUpload);
    const statusToWrite = sheetStatusFor(privacyStatus);

    const fileStream = await downloadFileStream(drive, videoFile.id);
    const uploaded = await uploadVideo(youtube, { title, description, fileStream, privacyStatus, publishAt });

    await setCellValue(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME, nomorBaris, headerMap[CONFIG.STATUS_COLUMN], statusToWrite);
    await setCellValue(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME, nomorBaris, headerMap[CONFIG.POST_ID_COLUMN], uploaded.id);
    await setCellValue(
      sheets,
      CONFIG.KALENDER_SPREADSHEET_ID,
      CONFIG.SHEET_NAME,
      nomorBaris,
      headerMap[CONFIG.CATATAN_COLUMN],
      `Upload sukses (${privacyStatus}${publishAt ? `, publish ${jadwalUpload.toLocaleString("id-ID")}` : ""}).`
    );

    console.log(`  BERHASIL upload baris ${nomorBaris}: ${uploaded.id} (${privacyStatus})`);
  } catch (e) {
    await setCellValue(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME, nomorBaris, headerMap[CONFIG.STATUS_COLUMN], CONFIG.ERROR_STATUS_VALUE);
    await setCellValue(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME, nomorBaris, headerMap[CONFIG.CATATAN_COLUMN], `Error upload: ${e.toString()}`);
    console.log(`  GAGAL baris ${nomorBaris}: ${e.toString()}`);
  }
}

async function processReschedule(row, headerMap, { sheets, docs, youtube }) {
  const nomorBaris = row._rowNumber;
  const videoId = String(row[CONFIG.POST_ID_COLUMN] || "").trim();
  const judul = String(row[CONFIG.JUDUL_COLUMN] || "").trim();
  const segmen = String(row[CONFIG.SEGMEN_COLUMN] || "").trim();
  const tanggalCell = row[CONFIG.TANGGAL_COLUMN];
  const jamCell = row[CONFIG.JAM_COLUMN];

  const jadwalUpload = combineDateAndTime(tanggalCell, jamCell, CONFIG.TIMEZONE);
  if (!jadwalUpload) return;

  try {
    const currentStatus = await getVideoStatus(youtube, videoId);
    if (!currentStatus) {
      console.log(`  (skip) Video ${videoId} (baris ${nomorBaris}) tidak ditemukan di YouTube - mungkin dihapus manual.`);
      return;
    }

    const { privacyStatus: expectedPrivacy, publishAt: expectedPublishAt } = determinePrivacyAndSchedule(jadwalUpload);
    const expectedSheetStatus = sheetStatusFor(expectedPrivacy);

    const currentPublishAtMs = currentStatus.status.publishAt ? new Date(currentStatus.status.publishAt).getTime() : null;
    const expectedPublishAtMs = expectedPublishAt ? new Date(expectedPublishAt).getTime() : null;
    const needsYoutubeUpdate = currentStatus.status.privacyStatus !== expectedPrivacy || currentPublishAtMs !== expectedPublishAtMs;

    if (needsYoutubeUpdate) {
      console.log(`  Reschedule baris ${nomorBaris} (${videoId}): ${currentStatus.status.privacyStatus} -> ${expectedPrivacy}`);
      await updateVideoSchedule(youtube, videoId, jadwalUpload);
      await setCellValue(
        sheets,
        CONFIG.KALENDER_SPREADSHEET_ID,
        CONFIG.SHEET_NAME,
        nomorBaris,
        headerMap[CONFIG.CATATAN_COLUMN],
        `Reschedule ke ${expectedPrivacy}${expectedPublishAt ? `, publish ${jadwalUpload.toLocaleString("id-ID")}` : ""}.`
      );
    }

    // Video "Video Panjang" di-upload manual via Studio, judul/deskripsi diatur editor sendiri
    // (dan judulnya sengaja beda-beda karena A/B testing) - jangan disamain paksa dengan sheet/Docs.
    const jenisKonten = String(row[CONFIG.JENIS_KONTEN_COLUMN] || "").trim().toLowerCase();
    const isLandscape = jenisKonten === CONFIG.LANDSCAPE_JENIS_KONTEN.toLowerCase();

    if (!isLandscape) {
      const kontenDitemukan = await cariKontenDiDocsMaster(docs, judul);
      const deskripsiUser = kontenDitemukan && kontenDitemukan.deskripsiYoutube ? kontenDitemukan.deskripsiYoutube.trim() : "";
      const expectedTitle = buildTitle(judul, segmen);
      const expectedDescription = buildDescription(deskripsiUser);

      const needsDetailUpdate =
        expectedTitle !== currentStatus.snippet.title || expectedDescription !== currentStatus.snippet.description;

      if (needsDetailUpdate) {
        console.log(`  Update title/description baris ${nomorBaris} (${videoId}) karena berubah di sheet/Docs.`);
        await updateVideoDetails(youtube, videoId, currentStatus.snippet, {
          title: expectedTitle,
          description: expectedDescription,
        });
        await setCellValue(
          sheets,
          CONFIG.KALENDER_SPREADSHEET_ID,
          CONFIG.SHEET_NAME,
          nomorBaris,
          headerMap[CONFIG.CATATAN_COLUMN],
          `Update title/description karena berubah di sheet/Docs.`
        );
      }
    }

    await setCellValue(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME, nomorBaris, headerMap[CONFIG.STATUS_COLUMN], expectedSheetStatus);
  } catch (e) {
    console.log(`  (info) Gagal cek/reschedule baris ${nomorBaris} (${videoId}): ${e.message}`);
  }
}

/** "TANGGAL" baris jadi "YYYY-MM-DD" di CONFIG.TIMEZONE, buat dicocokkan dengan tanggal upload YouTube. */
function tanggalOnlyString(tanggalCell) {
  const tengahMalam = combineDateAndTime(tanggalCell, "00:00", CONFIG.TIMEZONE);
  if (!tengahMalam) return null;
  return toSheetDateString(tengahMalam, CONFIG.TIMEZONE).slice(0, 10);
}

async function processManualUploadMatch(row, headerMap, uploadsPlaylistId, { sheets, youtube }) {
  const nomorBaris = row._rowNumber;
  const targetDateStr = tanggalOnlyString(row[CONFIG.TANGGAL_COLUMN]);

  if (!targetDateStr) {
    console.log(`  Baris ${nomorBaris}: TANGGAL (${row[CONFIG.TANGGAL_COLUMN]}) tidak valid, skip matching.`);
    return;
  }

  try {
    const candidates = await findManualUploadByDate(youtube, uploadsPlaylistId, targetDateStr, CONFIG.TIMEZONE);

    if (candidates.length === 1) {
      const videoId = candidates[0].videoId;
      await setCellValue(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME, nomorBaris, headerMap[CONFIG.POST_ID_COLUMN], videoId);
      await setCellValue(
        sheets,
        CONFIG.KALENDER_SPREADSHEET_ID,
        CONFIG.SHEET_NAME,
        nomorBaris,
        headerMap[CONFIG.CATATAN_COLUMN],
        `Video landscape ketemu & di-link otomatis: ${videoId}`
      );
      console.log(`  Baris ${nomorBaris}: matched ke video ${videoId}`);
    } else if (candidates.length === 0) {
      console.log(`  Baris ${nomorBaris}: belum ketemu upload manual untuk tanggal ${targetDateStr}, coba lagi run berikutnya.`);
    } else {
      await setCellValue(
        sheets,
        CONFIG.KALENDER_SPREADSHEET_ID,
        CONFIG.SHEET_NAME,
        nomorBaris,
        headerMap[CONFIG.CATATAN_COLUMN],
        `WARNING: ketemu ${candidates.length} video di tanggal yang sama, gak bisa matching otomatis - isi POST ID YT manual.`
      );
      console.log(`  Baris ${nomorBaris}: AMBIGU, ${candidates.length} kandidat ditemukan, di-skip.`);
    }
  } catch (e) {
    console.log(`  Baris ${nomorBaris}: gagal matching - ${e.message}`);
  }
}

async function runMainUpload({ sheets, docs, drive, youtube }) {
  const headerMap = await getHeaderColumnMap(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME);

  const readyRows = await getReadyRows(sheets);
  console.log(`${readyRows.length} row siap di-upload.`);
  for (const row of readyRows) {
    await processNewUpload(row, headerMap, { sheets, docs, drive, youtube });
  }

  const pendingManual = await getPendingManualUploadRows(sheets);
  if (pendingManual.length > 0) {
    console.log(`${pendingManual.length} row landscape nunggu manual upload - coba matching...`);
    const uploadsPlaylistId = await getUploadsPlaylistId(youtube);
    for (const row of pendingManual) {
      await processManualUploadMatch(row, headerMap, uploadsPlaylistId, { sheets, youtube });
    }
  }

  const uploadedRows = await getUploadedRows(sheets);
  console.log(`${uploadedRows.length} row sudah pernah upload - cek apakah ada reschedule.`);
  for (const row of uploadedRows) {
    await processReschedule(row, headerMap, { sheets, docs, youtube });
  }

  console.log("Selesai proses Main Upload.");
}

module.exports = { runMainUpload };
