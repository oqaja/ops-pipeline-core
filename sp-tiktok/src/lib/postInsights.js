const { TIKTOK_INSIGHT_CONFIG } = require("./config");
const { toSheetDateString } = require("./dateUtils");
const { getValidTikTokToken } = require("./tiktokAuth");
const {
  ensureSheetWithHeaders, upsertRowByKey, sortByColumnDesc, getHeaderColumnMap,
  dedupeSheetByKey, applyColumnDateFormat, normalizeDateColumn, ensureSpreadsheetLocale,
} = require("./sheetsHelper");
const { getState, setState, deleteState, reportBackfillDone } = require("./stateStore");

const CFG = TIKTOK_INSIGHT_CONFIG;
const VIDEO_HEADERS = [
  "Judul/Deskripsi", "Tanggal Upload", "Video ID", "Link Video",
  "Views", "Likes", "Comments", "Shares", "Terakhir Update",
];
const DATE_COLS = ["Tanggal Upload", "Terakhir Update"];

async function fetchVideoListWithRetry(accessToken, cursor, retries = 0) {
  const maxRetries = 4;

  const response = await fetch(
    "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + accessToken,
      },
      body: JSON.stringify({ max_count: 20, cursor }),
    }
  );

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    console.log(`Respons bukan JSON (status ${response.status}): ${rawText.slice(0, 200)}`);
    if (retries < maxRetries) {
      await new Promise((r) => setTimeout(r, (retries + 1) * 3000));
      return fetchVideoListWithRetry(accessToken, cursor, retries + 1);
    }
    return null;
  }

  if (data.data && data.data.videos) {
    return { videos: data.data.videos, hasMore: data.data.has_more, cursor: data.data.cursor };
  }

  if (data.error && data.error.code === "rate_limit_exceeded" && retries < maxRetries) {
    const waitTime = (retries + 1) * 3000;
    console.log(`Kena rate limit, tunggu ${waitTime}ms sebelum coba lagi...`);
    await new Promise((r) => setTimeout(r, waitTime));
    return fetchVideoListWithRetry(accessToken, cursor, retries + 1);
  }

  console.log("Gagal ambil video: " + JSON.stringify(data));
  return null;
}

/** Ambil beberapa halaman video mulai dari startCursor. Balikin { videos, cursor, hasMore }. */
async function fetchVideoPages(accessToken, { startCursor = 0, maxPages }) {
  let videos = [];
  let cursor = startCursor;
  let hasMore = true;
  let pages = 0;
  const startTime = Date.now();
  const maxRuntimeMs = 4.5 * 60 * 1000;

  while (hasMore && pages < maxPages) {
    if (Date.now() - startTime > maxRuntimeMs) {
      console.log(`Waktu mepet, stop ambil video di ${videos.length}.`);
      break;
    }
    const result = await fetchVideoListWithRetry(accessToken, cursor);
    if (!result) break;
    videos = videos.concat(result.videos);
    hasMore = result.hasMore;
    cursor = result.cursor;
    pages++;
    await new Promise((r) => setTimeout(r, 800));
  }

  return { videos, cursor, hasMore };
}

function videoToRow(v) {
  const title = v.title || (v.video_description ? v.video_description.substring(0, 80) : "Video " + v.id);
  return [
    title,
    v.create_time ? new Date(v.create_time * 1000) : "",
    v.id,
    v.share_url || "",
    v.view_count || 0,
    v.like_count || 0,
    v.comment_count || 0,
    v.share_count || 0,
    new Date(),
  ];
}

function parseDateCell(v) {
  if (v instanceof Date) return v;
  const d = new Date(String(v).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

async function writeVideos(sheets, videos) {
  for (const v of videos) {
    if (!v || !v.id) continue;
    await upsertRowByKey(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.VIDEO_SHEET_NAME, "Video ID", v.id, videoToRow(v));
  }
}

/** Dedupe + format tanggal seragam + sort terbaru-di-atas. */
async function finalizeSheet(sheets, { normalize = false } = {}) {
  await dedupeSheetByKey(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.VIDEO_SHEET_NAME, "Video ID", "Terakhir Update");
  const hm = await getHeaderColumnMap(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.VIDEO_SHEET_NAME);
  for (const col of DATE_COLS) {
    if (normalize) {
      await normalizeDateColumn(
        sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.VIDEO_SHEET_NAME, hm[col],
        parseDateCell, (d) => toSheetDateString(d)
      );
    }
    await applyColumnDateFormat(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.VIDEO_SHEET_NAME, hm[col], CFG.POST_DATE_FORMAT);
  }
  await sortByColumnDesc(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.VIDEO_SHEET_NAME, "Tanggal Upload");
}

/** Refresh insight video TERBARU (RECENT_PAGES halaman pertama). Untuk histori penuh pakai backfillAllVideos. */
async function pullTikTokInsights({ sheets }) {
  const accessToken = await getValidTikTokToken();
  if (!accessToken) {
    console.log("Gagal dapat access token.");
    return;
  }

  await ensureSheetWithHeaders(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.VIDEO_SHEET_NAME, VIDEO_HEADERS);
  await ensureSpreadsheetLocale(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.SPREADSHEET_LOCALE);

  const { videos } = await fetchVideoPages(accessToken, { startCursor: 0, maxPages: CFG.RECENT_PAGES });
  console.log(`Ketemu ${videos.length} video terbaru, tulis ke sheet...`);
  await writeVideos(sheets, videos);
  await finalizeSheet(sheets);
  console.log("Refresh TikTok selesai.");
}

/**
 * Backfill SEMUA video, batch demi batch (BACKFILL_MAX_PAGES_PER_RUN halaman per run),
 * cursor + flag DONE di tab _State. Begitu has_more = false -> set DONE, rantai backfill
 * berhenti sendiri.
 */
async function backfillAllVideos({ sheets }) {
  const alreadyDone = await getState(sheets, CFG.BACKFILL_DONE_KEY);
  if (alreadyDone === "true") {
    console.log("Backfill TikTok sudah selesai total sebelumnya - tidak ada yang dikerjakan.");
    console.log(`(Kalau mau ulang dari awal, hapus baris '${CFG.BACKFILL_DONE_KEY}' di tab _State.)`);
    reportBackfillDone(true);
    return;
  }

  const accessToken = await getValidTikTokToken();
  if (!accessToken) {
    console.log("Gagal dapat access token.");
    reportBackfillDone(false);
    return;
  }

  await ensureSheetWithHeaders(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.VIDEO_SHEET_NAME, VIDEO_HEADERS);
  await ensureSpreadsheetLocale(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.SPREADSHEET_LOCALE);

  const savedCursor = await getState(sheets, CFG.BACKFILL_CURSOR_KEY);
  const startCursor = savedCursor ? Number(savedCursor) : 0;
  if (!savedCursor) await finalizeSheet(sheets, { normalize: true });
  console.log(savedCursor ? `Lanjut backfill dari cursor ${startCursor}...` : "Mulai backfill dari video terbaru, mundur ke terlama.");

  const { videos, cursor, hasMore } = await fetchVideoPages(accessToken, {
    startCursor,
    maxPages: CFG.BACKFILL_MAX_PAGES_PER_RUN,
  });
  console.log(`Batch ini: ${videos.length} video.`);
  await writeVideos(sheets, videos);
  await finalizeSheet(sheets);

  if (hasMore) {
    await setState(sheets, CFG.BACKFILL_CURSOR_KEY, String(cursor));
    console.log("=== Batch selesai - belum tuntas, lanjut otomatis di run berikutnya ===");
    reportBackfillDone(false);
  } else {
    await deleteState(sheets, CFG.BACKFILL_CURSOR_KEY);
    await setState(sheets, CFG.BACKFILL_DONE_KEY, "true");
    console.log("=== BACKFILL TIKTOK SELESAI TOTAL ===");
    reportBackfillDone(true);
  }
}

module.exports = { pullTikTokInsights, backfillAllVideos };
