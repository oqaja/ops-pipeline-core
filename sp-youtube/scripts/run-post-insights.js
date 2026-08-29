const { getGoogleAuthClients } = require("../src/lib/googleAuth");
const { getYoutubeClient } = require("../src/lib/youtubeAuth");
const { runPostInsights } = require("../src/lib/insightsTracker");

(async () => {
  console.log("SP YouTube - Post Insights - mulai jalan");
  const { sheets } = await getGoogleAuthClients();
  const { youtube, youtubeAnalytics } = await getYoutubeClient();
  await runPostInsights({ sheets, youtube, youtubeAnalytics });
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
