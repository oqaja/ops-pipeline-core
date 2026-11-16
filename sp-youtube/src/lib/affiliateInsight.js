// Tarik performa video affiliate (tab "UPLOAD AFFILIATE NOV") per akun, tulis ke kolom insight di tab yang sama.
// Dipakai buat milih konten terbaik untuk di-upload ulang bulan berikutnya.
//
// - Views/Likes/Komen: dari YouTube Data API (videos.list statistics) -> hampir real-time.
// - Avg View % & Subs: dari YouTube Analytics API -> biasanya telat 1-2 hari.
// - Hanya baca data (gak pakai kuota upload). Akun ditentukan env AFFILIATE_AKUN (SP/DFM/FAP/MT).

const { CONFIG } = require("./config");
const { readSheetAsObjects, getHeaderColumnMap } = require("./sheetsHelper");
const { combineDateAndTime, toSheetDateString } = require("./dateUtils");

const AKUN = String(process.env.AFFILIATE_AKUN || "SP").trim().toUpperCase();

const INS = {
  SPREADSHEET_ID: process.env.AFFILIATE_SPREADSHEET_ID || CONFIG.KALENDER_SPREADSHEET_ID,
  SHEET_NAME: process.env.AFFILIATE_SHEET_NAME || "UPLOAD AFFILIATE NOV",
  AKUN,
  COL_TANGGAL: "TANGGAL",
  COL_JAM: "JAM (WIB)",
  COL_STATUS: `STATUS ${AKUN}`,
  COL_VIDEO_ID: `VIDEO ID ${AKUN}`,
  COL_VIEWS: `VIEWS ${AKUN}`,
  COL_LIKES: `LIKES ${AKUN}`,
  COL_KOMEN: `KOMEN ${AKUN}`,
  COL_AVG_PCT: `AVG VIEW % ${AKUN}`,
  COL_SUBS: `SUBS ${AKUN}`,
  COL_UPDATED: "INSIGHT UPDATED",
};

function columnLetter(col) {
  let letter = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

async function fetchStatistics(youtube, ids) {
  const map = {};
  for (let i = 0; i < ids.length; i += 50) {
    const res = await youtube.videos.list({ part: ["statistics"], id: ids.slice(i, i + 50) });
    for (const v of res.data.items || []) {
      const s = v.statistics || {};
      map[v.id] = {
        views: Number(s.viewCount || 0),
        likes: Number(s.likeCount || 0),
        comments: Number(s.commentCount || 0),
      };
    }
  }
  return map;
}

async function fetchAnalytics(youtubeAnalytics, ids) {
  const map = {};
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const res = await youtubeAnalytics.reports.query({
      ids: "channel==MINE",
      startDate: "2026-01-01",
      endDate: new Date().toISOString().slice(0, 10),
      metrics: "averageViewPercentage,subscribersGained",
      dimensions: "video",
      filters: `video==${chunk.join(",")}`,
      maxResults: 200,
    });
    const headers = (res.data.columnHeaders || []).map((h) => h.name);
    const iv = headers.indexOf("video");
    const ip = headers.indexOf("averageViewPercentage");
    const is = headers.indexOf("subscribersGained");
    for (const row of res.data.rows || []) {
      map[row[iv]] = { avgPct: Number(row[ip] || 0), subs: Number(row[is] || 0) };
    }
  }
  return map;
}

async function runAffiliateInsight({ sheets, youtube, youtubeAnalytics }) {
  console.log(`Insight affiliate | Tab: ${INS.SHEET_NAME} | Akun: ${AKUN}`);
  const headerMap = await getHeaderColumnMap(sheets, INS.SPREADSHEET_ID, INS.SHEET_NAME);
  const needed = [INS.COL_VIDEO_ID, INS.COL_VIEWS, INS.COL_LIKES, INS.COL_KOMEN, INS.COL_AVG_PCT, INS.COL_SUBS, INS.COL_UPDATED];
  for (const col of needed) {
    if (!headerMap[col]) throw new Error(`Kolom '${col}' tidak ditemukan di tab '${INS.SHEET_NAME}'.`);
  }

  const { rows } = await readSheetAsObjects(sheets, INS.SPREADSHEET_ID, INS.SHEET_NAME);
  const now = Date.now();
  const targets = rows.filter((r) => {
    const id = String(r[INS.COL_VIDEO_ID] || "").trim();
    if (!id) return false;
    const status = String(r[INS.COL_STATUS] || "").trim();
    if (status === "Tayang") return true;
    const jadwal = combineDateAndTime(r[INS.COL_TANGGAL], r[INS.COL_JAM], CONFIG.TIMEZONE);
    return jadwal && jadwal.getTime() <= now; // sudah lewat jam tayang
  });
  console.log(`${targets.length} video ${AKUN} sudah tayang - tarik insight.`);
  if (targets.length === 0) return;

  const ids = [...new Set(targets.map((r) => String(r[INS.COL_VIDEO_ID]).trim()))];
  const stats = await fetchStatistics(youtube, ids);
  let analytics = {};
  try {
    analytics = await fetchAnalytics(youtubeAnalytics, ids);
  } catch (e) {
    console.log(`  (info) YouTube Analytics gagal, Avg View %/Subs gak di-update run ini: ${e.message}`);
  }

  const updated = toSheetDateString(new Date(), CONFIG.TIMEZONE).slice(0, 16);
  const data = [];
  for (const row of targets) {
    const id = String(row[INS.COL_VIDEO_ID]).trim();
    const s = stats[id];
    if (!s) continue; // video gak ketemu (dihapus/private)
    const a = analytics[id];
    const r = row._rowNumber;
    const put = (col, value) =>
      data.push({ range: `'${INS.SHEET_NAME}'!${columnLetter(headerMap[col])}${r}`, values: [[value]] });

    put(INS.COL_VIEWS, s.views);
    put(INS.COL_LIKES, s.likes);
    put(INS.COL_KOMEN, s.comments);
    if (a) {
      put(INS.COL_AVG_PCT, Math.round(a.avgPct * 100) / 100);
      put(INS.COL_SUBS, a.subs);
    }
    put(INS.COL_UPDATED, updated);
  }

  for (let i = 0; i < data.length; i += 500) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: INS.SPREADSHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data: data.slice(i, i + 500) },
    });
  }
  console.log(`Insight ${AKUN} ditulis untuk ${targets.length} video.`);
}

module.exports = { runAffiliateInsight };
