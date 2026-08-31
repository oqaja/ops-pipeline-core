const { getAuthClients } = require("../src/lib/googleAuth");
const { pullTikTokAccountSnapshot } = require("../src/lib/accountSnapshot");

(async () => {
  console.log("TikTok Account Snapshot - mulai jalan");
  const clients = await getAuthClients();
  await pullTikTokAccountSnapshot(clients);
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
