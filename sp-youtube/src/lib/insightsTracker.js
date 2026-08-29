const { CONFIG } = require("./config");
const { ensureSheetWithHeaders, upsertRowByKey, appendRow, sortByColumnDesc } = require("./sheetsHelper");
const { getState, setState } = require("./stateStore");
const { getChannelInfo, listUploadsPage, getChannelStatistics, getVideoDetails } = require("./youtubeChannel");

const VIDEO_INSIGHT_HEADERS = [
  "Judul Video", "Tanggal Upload", "Video ID", "Link Video", "Durasi (detik)",
  "Views", "Watch Time (menit)", "Avg View Duration (detik)", "Avg % Viewed",
  "Subscribers Gained", "Likes", "Comments", "Saved to Playlist", "Terakhir Update",
];

const ACCOUNT_INSIGHT_HEADERS = ["Tanggal", "Nama Channel", "Subscribers", "Total Views", "Total Video"];

const CURSOR_KEY = "SP_YT_INSIGHTS_CURSOR";

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

/** Update insight video, batasi MAX_INSIGHTS_BATCH video per run, cursor persist -> muter terus nge-refresh semua video secara siklus. Split otomatis ke sheet Shorts/Landscape Videos berdasarkan durasi. */
async function runPostInsights({ sheets, youtube, youtubeAnalytics }) {
  const { uploadsPlaylistId } = await getChannelInfo(youtube);
  await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_SHORTS_SHEET_NAME, VIDEO_INSIGHT_HEADERS);
  await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_LANDSCAPE_SHEET_NAME, VIDEO_INSIGHT_HEADERS);

  let pageToken = await getState(sheets, CURSOR_KEY);
  console.log(pageToken ? "Melanjutkan dari cursor tersimpan..." : "Mulai dari video terbaru.");

  const videos = [];
  let currentPageToken = pageToken;
  while (videos.length < CONFIG.MAX_INSIGHTS_BATCH) {
    const page = await listUploadsPage(youtube, uploadsPlaylistId, currentPageToken, 50);
    videos.push(...page.items);
    currentPageToken = page.nextPageToken;
    if (!currentPageToken) break;
  }

  if (videos.length === 0) {
    console.log("Tidak ada video ditemukan.");
    return;
  }

  console.log(`${videos.length} video diambil batch ini.`);

  const videoIds = videos.map((v) => v.videoId);
  const detailsMap = await getVideoDetails(youtube, videoIds);
  const metricsMap = await fetchMetricsForVideos(youtubeAnalytics, videoIds);

  const now = new Date();
  let shortsCount = 0;
  let landscapeCount = 0;

  for (const video of videos) {
    const details = detailsMap[video.videoId] || { durationSeconds: 0 };
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
    if (isShorts) shortsCount++;
    else landscapeCount++;
  }

  if (currentPageToken) {
    await setState(sheets, CURSOR_KEY, currentPageToken);
    console.log(`Batch selesai (${shortsCount} Shorts, ${landscapeCount} Landscape). Masih ada video lain, lanjut run berikutnya.`);
  } else {
    await setState(sheets, CURSOR_KEY, "");
    console.log(`Batch selesai (${shortsCount} Shorts, ${landscapeCount} Landscape). Sudah sampai video terlama - siklus reset.`);
  }

  await sortByColumnDesc(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_SHORTS_SHEET_NAME, "Tanggal Upload");
  await sortByColumnDesc(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_LANDSCAPE_SHEET_NAME, "Tanggal Upload");
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

  await sortByColumnDesc(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, "Tanggal");
  console.log(`Snapshot akun tersimpan: ${stats.subscriberCount} subscribers, ${stats.viewCount} total views.`);
}

module.exports = { runPostInsights, runAccountSnapshot };
