const { TIKTOK_INSIGHT_CONFIG } = require("./config");
const { toSheetDateString } = require("./dateUtils");
const { getValidTikTokToken } = require("./tiktokAuth");

async function ensureSheetWithHeader(sheets, spreadsheetId, sheetName, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === sheetName);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  }

  const check = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:A1`,
  });
  if (!check.data.values || check.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [headers] },
    });
  }
}

async function getAllTikTokVideos(accessToken) {
  let videos = [];
  let cursor = 0;
  let hasMore = true;
  const startTime = Date.now();
  const maxRuntimeMs = 4.5 * 60 * 1000;

  while (hasMore) {
    if (Date.now() - startTime > maxRuntimeMs) {
      console.log(`Waktu mepet, stop ambil video di ${videos.length}`);
      break;
    }

    const result = await fetchVideoListWithRetry(accessToken, cursor);
    if (!result) break;

    videos = videos.concat(result.videos);
    hasMore = result.hasMore;
    cursor = result.cursor;

    await new Promise((r) => setTimeout(r, 800));
  }

  return videos;
}

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
      const waitTime = (retries + 1) * 3000;
      await new Promise((r) => setTimeout(r, waitTime));
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

async function pullTikTokInsights({ sheets }) {
  const accessToken = await getValidTikTokToken();
  if (!accessToken) {
    console.log("Gagal dapat access token.");
    return;
  }

  const spreadsheetId = TIKTOK_INSIGHT_CONFIG.INSIGHTS_SPREADSHEET_ID;
  const sheetName = TIKTOK_INSIGHT_CONFIG.VIDEO_SHEET_NAME;
  const headers = ["Judul/Deskripsi", "Tanggal Upload", "Video ID", "Link Video", "Views", "Likes", "Comments", "Shares", "Terakhir Update"];

  await ensureSheetWithHeader(sheets, spreadsheetId, sheetName, headers);

  const videos = await getAllTikTokVideos(accessToken);
  console.log(`Ketemu ${videos.length} video TikTok, mulai tulis ke sheet...`);

  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetName });
  const existingData = existing.data.values || [headers];
  const header = existingData[0];
  const videoIdCol = header.indexOf("Video ID");

  const idToRowIndex = {};
  for (let i = 1; i < existingData.length; i++) {
    idToRowIndex[existingData[i][videoIdCol]] = i;
  }

  const newRows = [];

  videos.forEach((v) => {
    const title = v.title || (v.video_description ? v.video_description.substring(0, 80) : "Video " + v.id);
    const rowData = [
      title,
      v.create_time ? toSheetDateString(new Date(v.create_time * 1000)) : "",
      v.id,
      v.share_url || "",
      v.view_count || 0,
      v.like_count || 0,
      v.comment_count || 0,
      v.share_count || 0,
      toSheetDateString(new Date()),
    ];

    if (idToRowIndex.hasOwnProperty(v.id)) {
      existingData[idToRowIndex[v.id]] = rowData;
    } else {
      newRows.push(rowData);
    }
  });

  const finalData = existingData.slice(1).concat(newRows);

  finalData.sort((a, b) => new Date(b[1]) - new Date(a[1]));

  if (finalData.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A2`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: finalData },
    });
  }

  console.log(`Selesai. Total ${finalData.length} baris di sheet TikTok.`);
}

module.exports = { pullTikTokInsights };
