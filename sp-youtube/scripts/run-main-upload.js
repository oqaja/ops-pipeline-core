const { getGoogleAuthClients } = require("../src/lib/googleAuth");
const { getYoutubeClient } = require("../src/lib/youtubeAuth");
const { runMainUpload } = require("../src/lib/mainUpload");

(async () => {
  console.log("========================================");
  console.log("SP YouTube - Main Upload - mulai jalan");
  console.log("========================================");
  const { sheets, docs, drive } = await getGoogleAuthClients();
  const { youtube } = await getYoutubeClient();
  await runMainUpload({ sheets, docs, drive, youtube });
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
