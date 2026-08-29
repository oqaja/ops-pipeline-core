const { getGoogleAuthClients } = require("../src/lib/googleAuth");
const { getYoutubeClient } = require("../src/lib/youtubeAuth");
const { runAccountSnapshot } = require("../src/lib/insightsTracker");

(async () => {
  console.log("SP YouTube - Account Snapshot - mulai jalan");
  const { sheets } = await getGoogleAuthClients();
  const { youtube } = await getYoutubeClient();
  await runAccountSnapshot({ sheets, youtube });
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
