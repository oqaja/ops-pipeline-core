const { getGoogleAuthClients } = require("../src/lib/googleAuth");
const { getYoutubeClient } = require("../src/lib/youtubeAuth");
const { runAffiliateUpload } = require("../src/lib/affiliateUpload");

(async () => {
  console.log("========================================");
  console.log("SP YouTube - Affiliate Upload - mulai jalan");
  console.log("========================================");
  const { sheets, drive } = await getGoogleAuthClients();
  const { youtube } = await getYoutubeClient();
  await runAffiliateUpload({ sheets, drive, youtube });
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
