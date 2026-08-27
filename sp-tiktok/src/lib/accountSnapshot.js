const { TIKTOK_INSIGHT_CONFIG } = require("./config");
const { getValidTikTokToken } = require("./tiktokAuth");

async function pullTikTokAccountSnapshot({ sheets }) {
  const accessToken = await getValidTikTokToken();
  if (!accessToken) {
    console.log("Gagal dapat access token buat snapshot akun.");
    return;
  }

  const response = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=display_name,follower_count,following_count,likes_count,video_count",
    { headers: { Authorization: "Bearer " + accessToken } }
  );
  const data = await response.json();

  if (!data.data || !data.data.user) {
    console.log("Gagal ambil data akun: " + JSON.stringify(data));
    return;
  }

  const user = data.data.user;
  const spreadsheetId = TIKTOK_INSIGHT_CONFIG.INSIGHTS_SPREADSHEET_ID;
  const sheetName = TIKTOK_INSIGHT_CONFIG.ACCOUNT_SHEET_NAME;
  const headers = ["Tanggal", "Nama Akun", "Followers", "Following", "Total Likes", "Total Video"];

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === sheetName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  }
  const check = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A1:A1` });
  if (!check.data.values || check.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }

  const newRow = [
    new Date().toISOString(),
    user.display_name || "",
    user.follower_count || 0,
    user.following_count || 0,
    user.likes_count || 0,
    user.video_count || 0,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetName,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [newRow] },
  });

  console.log(`Snapshot TikTok tersimpan: ${user.follower_count} followers`);
}

module.exports = { pullTikTokAccountSnapshot };
