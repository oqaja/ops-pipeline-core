const { getGoogleAuthClients } = require("../src/lib/googleAuth");
const { getYoutubeClient } = require("../src/lib/youtubeAuth");
const { runCommentsTracker } = require("../src/lib/commentsTracker");

(async () => {
  console.log("SP YouTube - Comments Tracker - mulai jalan");
  const { sheets } = await getGoogleAuthClients();
  const { youtube } = await getYoutubeClient();
  await runCommentsTracker({ sheets, youtube });
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
