const { CONFIG } = require("./config");
const {
  ensureSheetWithHeaders, upsertRowByKey, appendRow, sortByColumnDesc, getHeaderColumnMap,
  readSheetAsObjects, deleteRowsByNumbers, dedupeSheetByKey, applyColumnDateFormat,
  normalizeDateColumn, ensureSpreadsheetLocale,
} = require("./sheetsHelper");
const { getState, setState, deleteState, reportBackfillDone } = require("./stateStore");
const { parseFlexibleDate, toSheetDateString } = require("./dateUtils");
const { getChannelInfo, listUploadsPage, getChannelStatistics, getVideoDetails } = require("./youtubeChannel");

const VIDEO_INSIGHT_HEADERS = [
  "Judul Video", "Tanggal Upload", "Video ID", "Link Video", "Durasi (detik)",
  "Views", "Watch Time (menit)", "Avg View Duration (detik)", "Avg % Viewed",
  "Subscribers Gained", "Likes", "Comments", "Saved to Playlist", "Terakhir Update",
];

const ACCOUNT_INSIGHT_HEADERS = ["Tanggal", "Nama Channel", "Subscribers", "Total Views", "Total Video"];

const DATE_COLS = ["Tanggal Upload", "Terakhir Update"];
const VIDEO_SHEETS = [CONFIG.INSIGHTS_SHORTS_SHEET_NAME, CONFIG.INSIGHTS_LANDSCAPE_SHEET_NAME];

function formatDateForAnalytics(date) {
  return date.toISOString().slice(0, 10);
}

/** Ambil metrik utk BEBERAPA video sekaligus (sampai 200 id per call) - jauh lebih hemat kuota dibanding 1 call per video. */
async function fetchMetricsForVideos(youtubeAnalytics, videoIds) {
  if (videoIds.length === 0) return {};

  const res = await youtubeAnalytics.reports.query({
    ids: "channel==MINE",
    startDate: "2005-01-01",
    endDate: formatDateForAnalytics(new Date()),
    metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments,videosAddedToPlaylists",
    dimensions: "video",
    filters: `video==${videoIds.join(",")}`,
    maxResults: 200,
  });

  const rows = res.data.rows || [];
  const headers = (res.data.columnHeaders || []).map((h) => h.name);
  const videoIdx = headers.indexOf("video");

  const idx = (name) => headers.indexOf(name);
  const map = {};
  for (const row of rows) {
    const vid = row[videoIdx];
    map[vid] = {
      views: row[idx("views")],
      estimatedMinutesWatched: row[idx("estimatedMinutesWatched")],
      averageViewDuration: row[idx("averageViewDuration")],
      averageViewPercentage: row[idx("averageViewPercentage")],
      subscribersGained: row[idx("subscribersGained")],
      likes: row[idx("likes")],
      comments: row[idx("comments")],
      videosAddedToPlaylists: row[idx("videosAddedToPlaylists")],
    };
  }
  return map;
}

function buildVideoLink(videoId, isShorts) {
  return isShorts ? `https://youtube.com/shorts/${videoId}` : `https://youtube.com/watch?v=${videoId}`;
}

async function ensureVideoSheets(sheets) {
  for (const name of VIDEO_SHEETS) {
    await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, name, VIDEO_INSIGHT_HEADERS);
  }
}

/**
 * Kalau ada Video ID yang muncul di KEDUA sheet (Shorts & Landscape) - biasanya karena
 * klasifikasi durasi berubah antar-run - sisakan baris yang "Terakhir Update"-nya paling
 * baru, hapus yang di sheet satunya. Dibaca sekali per sheet (hemat kuota).
 */
async function resolveCrossSheetDuplicates(sheets) {
  const [a, b] = VIDEO_SHEETS;
  const rowsA = (await readSheetAsObjects(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, a)).rows;
  const rowsB = (await readSheetAsObjects(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, b)).rows;
  const mapB = new Map(rowsB.map((r) => [String(r["Video ID"] || "").trim(), r]));

  const delA = [];
  const delB = [];
  for (const rowA of rowsA) {
    const id = String(rowA["Video ID"] || "").trim();
    if (!id || !mapB.has(id)) continue;
    const rowB = mapB.get(id);
    if ((Number(rowA["Terakhir Update"]) || 0) >= (Number(rowB["Terakhir Update"]) || 0)) delB.push(rowB._rowNumber);
    else delA.push(rowA._rowNumber);
  }

  if (delA.length) await deleteRowsByNumbers(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, a, delA);
  if (delB.length) await deleteRowsByNumbers(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, b, delB);
  if (delA.length || delB.length) console.log(`  (cross-dedupe) ${a}: -${delA.length}, ${b}: -${delB.length}`);
}

/** Proses sekumpulan video: ambil durasi + metrik, tulis ke sheet yang benar. */
async function processVideos(videos, { sheets, youtube, youtubeAnalytics }) {
  const videoIds = videos.map((v) => v.videoId);
  const detailsMap = await getVideoDetails(youtube, videoIds);
  const metricsMap = await fetchMetricsForVideos(youtubeAnalytics, videoIds);
  const now = new Date();
  let shorts = 0;
  let landscape = 0;
  let skipped = 0;

  for (const video of videos) {
    const details = detailsMap[video.videoId];
    if (!details || details.durationSeconds === undefined || details.durationSeconds === null) {
      // Durasi tidak terbaca -> jangan tebak (bisa salah sheet). Lewati; run berikutnya coba lagi.
      console.log(`  (skip) ${video.videoId} - durasi tidak terbaca.`);
      skipped++;
      continue;
    }

    const m = metricsMap[video.videoId] || {};
    const isShorts = details.durationSeconds <= CONFIG.SHORTS_MAX_DURATION_SEC;
    const targetSheet = isShorts ? CONFIG.INSIGHTS_SHORTS_SHEET_NAME : CONFIG.INSIGHTS_LANDSCAPE_SHEET_NAME;

    const rowData = [
      video.title,
      video.publishedAt ? new Date(video.publishedAt) : "",
      video.videoId,
      buildVideoLink(video.videoId, isShorts),
      details.durationSeconds,
      m.views !== undefined ? m.views : null,
      m.estimatedMinutesWatched !== undefined ? m.estimatedMinutesWatched : null,
      m.averageViewDuration !== undefined ? m.averageViewDuration : null,
      m.averageViewPercentage !== undefined ? m.averageViewPercentage : null,
      m.subscribersGained !== undefined ? m.subscribersGained : null,
      m.likes !== undefined ? m.likes : null,
      m.comments !== undefined ? m.comments : null,
      m.videosAddedToPlaylists !== undefined ? m.videosAddedToPlaylists : null,
      now,
    ];

    await upsertRowByKey(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, targetSheet, "Video ID", video.videoId, rowData);
    if (isShorts) shorts++;
    else landscape++;
  }

  return { shorts, landscape, skipped };
}

/** Dedupe + format tanggal seragam + sort terbaru-di-atas untuk satu sheet video. */
async function finalizeVideoSheet(sheets, sheetName, { normalize = false } = {}) {
  await dedupeSheetByKey(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, sheetName, "Video ID", "Terakhir Update");
  const headerMap = await getHeaderColumnMap(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, sheetName);
  for (const col of DATE_COLS) {
    if (normalize) {
      await normalizeDateColumn(
        sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, sheetName, headerMap[col],
        parseFlexibleDate, (d) => toSheetDateString(d)
      );
    }
    await applyColumnDateFormat(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, sheetName, headerMap[col], CONFIG.POST_DATE_FORMAT);
  }
  await sortByColumnDesc(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, sheetName, "Tanggal Upload");
}

/**
 * Refresh insight video TERBARU (MAX_INSIGHTS_BATCH video paling baru). Selalu mulai
 * dari video terbaru - tidak pakai cursor yang muter. Untuk mengisi seluruh histori,
 * pakai backfillAllVideos.
 */
async function runPostInsights({ sheets, youtube, youtubeAnalytics }) {
  const { uploadsPlaylistId } = await getChannelInfo(youtube);
  await ensureVideoSheets(sheets);
  await ensureSpreadsheetLocale(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.SPREADSHEET_LOCALE);

  const videos = [];
  let pageToken = null;
  while (videos.length < CONFIG.MAX_INSIGHTS_BATCH) {
    const page = await listUploadsPage(youtube, uploadsPlaylistId, pageToken || undefined, 50);
    videos.push(...page.items);
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }

  if (videos.length === 0) {
    console.log("Tidak ada video ditemukan.");
    return;
  }

  const batch = videos.slice(0, CONFIG.MAX_INSIGHTS_BATCH);
  const { shorts, landscape, skipped } = await processVideos(batch, { sheets, youtube, youtubeAnalytics });
  console.log(`Refresh selesai: ${shorts} Shorts, ${landscape} Landscape, ${skipped} ditunda.`);

  await resolveCrossSheetDuplicates(sheets);
  for (const name of VIDEO_SHEETS) await finalizeVideoSheet(sheets, name);
}

/**
 * Backfill SEMUA video, batch demi batch (BACKFILL_MAX_PAGES_PER_RUN halaman per run),
 * cursor + flag DONE di tab _State. Begitu halaman uploads habis -> set DONE, dan
 * (lewat run script + workflow) rantai backfill berhenti sendiri.
 */
async function backfillAllVideos({ sheets, youtube, youtubeAnalytics }) {
  const alreadyDone = await getState(sheets, CONFIG.BACKFILL_DONE_KEY);
  if (alreadyDone === "true") {
    console.log("Backfill YouTube sudah selesai total sebelumnya - tidak ada yang dikerjakan.");
    console.log(`(Kalau mau ulang dari awal, hapus baris '${CONFIG.BACKFILL_DONE_KEY}' di tab _State.)`);
    reportBackfillDone(true);
    return;
  }

  const { uploadsPlaylistId } = await getChannelInfo(youtube);
  await ensureVideoSheets(sheets);
  await ensureSpreadsheetLocale(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.SPREADSHEET_LOCALE);

  let pageToken = await getState(sheets, CONFIG.BACKFILL_CURSOR_KEY);
  if (!pageToken) {
    // Sekali di awal siklus: bersihkan dobel + rapikan tanggal-teks warisan.
    for (const name of VIDEO_SHEETS) await finalizeVideoSheet(sheets, name, { normalize: true });
  }
  console.log(pageToken ? "Lanjut backfill dari cursor tersimpan..." : "Mulai backfill dari video terbaru, mundur ke terlama.");

  let totalShorts = 0;
  let totalLandscape = 0;
  let totalSkipped = 0;
  let pages = 0;
  let habisTotal = false;

  while (pages < CONFIG.BACKFILL_MAX_PAGES_PER_RUN) {
    const page = await listUploadsPage(youtube, uploadsPlaylistId, pageToken || undefined, 50);
    pages++;

    if (page.items.length > 0) {
      const r = await processVideos(page.items, { sheets, youtube, youtubeAnalytics });
      totalShorts += r.shorts;
      totalLandscape += r.landscape;
      totalSkipped += r.skipped;
    }

    if (page.nextPageToken) {
      pageToken = page.nextPageToken;
      await setState(sheets, CONFIG.BACKFILL_CURSOR_KEY, pageToken);
    } else {
      habisTotal = true;
      break;
    }
  }

  await resolveCrossSheetDuplicates(sheets);
  for (const name of VIDEO_SHEETS) await finalizeVideoSheet(sheets, name);
  console.log(`Batch backfill: ${totalShorts} Shorts, ${totalLandscape} Landscape, ${totalSkipped} ditunda.`);

  if (habisTotal) {
    await deleteState(sheets, CONFIG.BACKFILL_CURSOR_KEY);
    await setState(sheets, CONFIG.BACKFILL_DONE_KEY, "true");
    console.log("=== BACKFILL YOUTUBE SELESAI TOTAL ===");
    reportBackfillDone(true);
  } else {
    console.log("=== Batch selesai - belum tuntas, lanjut otomatis di run berikutnya ===");
    reportBackfillDone(false);
  }
}

async function runAccountSnapshot({ sheets, youtube }) {
  await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, ACCOUNT_INSIGHT_HEADERS);

  const stats = await getChannelStatistics(youtube);
  await appendRow(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, [
    new Date(),
    stats.title,
    stats.subscriberCount,
    stats.viewCount,
    stats.videoCount,
  ]);

  const headerMap = await getHeaderColumnMap(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME);
  await applyColumnDateFormat(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, headerMap["Tanggal"], CONFIG.ACCOUNT_DATE_FORMAT);
  await sortByColumnDesc(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, "Tanggal");
  console.log(`Snapshot akun tersimpan: ${stats.subscriberCount} subscribers, ${stats.viewCount} total views.`);
}

module.exports = { runPostInsights, backfillAllVideos, runAccountSnapshot };
