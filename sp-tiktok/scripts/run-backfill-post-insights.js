const { getAuthClients } = require("../src/lib/googleAuth");
const { backfillAllVideos } = require("../src/lib/postInsights");

(async () => {
  console.log("TikTok Backfill Post Insights - mulai jalan");
  const clients = await getAuthClients();
  await backfillAllVideos(clients);
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
