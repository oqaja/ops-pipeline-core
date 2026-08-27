const { getAuthClients } = require("../src/lib/googleAuth");
const { pullTikTokInsights } = require("../src/lib/postInsights");

(async () => {
  console.log("TikTok Post Insights - mulai jalan");
  const clients = await getAuthClients();
  await pullTikTokInsights(clients);
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
