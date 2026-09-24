/**
 * tiktokInsightMatcher.js
 * Cari ID TikTok asli dari sheet insight TikTok (datanya ditarik langsung dari API TikTok,
 * tidak bergantung ke Buffer) dengan mencocokkan "Tanggal Upload" ke jadwal upload di kalender.
 */
const { TIKTOK_INSIGHT_CONFIG } = require("./config");
const { getRawGrid, cariIndexKolom } = require("./sheetRaw");
const { parseTanggalInsightTikTok } = require("./dateUtils");

/** Baca grid sheet insight TikTok. Dipanggil sekali per run, hasilnya dioper ke cariVideoIdByWaktu. */
async function bacaGridInsightTiktok(sheets) {
  return getRawGrid(sheets, TIKTOK_INSIGHT_CONFIG.INSIGHTS_SPREADSHEET_ID, TIKTOK_INSIGHT_CONFIG.VIDEO_SHEET_NAME);
}

function cariVideoIdByWaktu(gridInsight, dueAtDate, toleransiMenit) {
  const data = gridInsight;
  if (data.length < 2) return [];

  const header = data[0];
  const idxTanggal = cariIndexKolom(header, "Tanggal Upload");
  const idxVideoId = cariIndexKolom(header, "Video ID");

  const toleransiMs = toleransiMenit * 60 * 1000;
  const matches = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const tanggalRaw = row[idxTanggal];
    const videoId = row[idxVideoId];
    if (!tanggalRaw || !videoId) continue;

    const tanggalParsed = parseTanggalInsightTikTok(tanggalRaw);
    if (!tanggalParsed) continue;

    const selisihMs = Math.abs(tanggalParsed.getTime() - dueAtDate.getTime());
    if (selisihMs <= toleransiMs) {
      matches.push({ videoId: String(videoId).trim(), tanggalUpload: tanggalParsed });
    }
  }

  return matches;
}

module.exports = { bacaGridInsightTiktok, cariVideoIdByWaktu };
