const { TIKTOK_INSIGHT_CONFIG } = require("./config");
const { getValidTikTokToken } = require("./tiktokAuth");
const {
  ensureSheetWithHeaders, upsertRowByDate, dedupeSheetByDate, sortByColumnDesc, getHeaderColumnMap, applyColumnDateFormat,
} = require("./sheetsHelper");

const CFG = TIKTOK_INSIGHT_CONFIG;

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
  const headers = ["Tanggal", "Nama Akun", "Followers", "Following", "Total Likes", "Total Video"];

  await ensureSheetWithHeaders(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.ACCOUNT_SHEET_NAME, headers);

  // Bersihkan dobel warisan dulu, lalu tulis SATU baris utk hari ini (update kalau
  // run hari ini sudah pernah jalan) — bukan appendRow yang bikin tanggal numpuk.
  await dedupeSheetByDate(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.ACCOUNT_SHEET_NAME, "Tanggal");
  await upsertRowByDate(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.ACCOUNT_SHEET_NAME, "Tanggal", new Date(), [
    new Date(),
    user.display_name || "",
    user.follower_count || 0,
    user.following_count || 0,
    user.likes_count || 0,
    user.video_count || 0,
  ]);

  const hm = await getHeaderColumnMap(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.ACCOUNT_SHEET_NAME);
  await applyColumnDateFormat(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.ACCOUNT_SHEET_NAME, hm["Tanggal"], CFG.ACCOUNT_DATE_FORMAT);
  await sortByColumnDesc(sheets, CFG.INSIGHTS_SPREADSHEET_ID, CFG.ACCOUNT_SHEET_NAME, "Tanggal");

  console.log(`Snapshot TikTok tersimpan: ${user.follower_count} followers`);
}

module.exports = { pullTikTokAccountSnapshot };
