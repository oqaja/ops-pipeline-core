const { getGoogleAuthClients } = require("../src/lib/googleAuth");
const { getYoutubeClient } = require("../src/lib/youtubeAuth");
const { runAffiliateInsight } = require("../src/lib/affiliateInsight");

(async () => {
  const akun = String(process.env.AFFILIATE_AKUN || "SP").toUpperCase();
  console.log("========================================");
  console.log(`Affiliate Insight - akun ${akun} - mulai jalan`);
  console.log("========================================");
  if (!process.env.YT_REFRESH_TOKEN) {
    console.log(`Secret ${akun}_YT_REFRESH_TOKEN belum di-set di repo ini - akun ${akun} di-skip.`);
    return;
  }
  const { sheets } = await getGoogleAuthClients();
  const { youtube, youtubeAnalytics } = await getYoutubeClient();
  await runAffiliateInsight({ sheets, youtube, youtubeAnalytics });
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
