const { getAuthClients } = require("../src/lib/googleAuth");
const { jalankanUploadTiktok } = require("../src/lib/mainUpload");

(async () => {
  console.log("========================================");
  console.log("TikTok Automation (Shoe Police, via Buffer) - mulai jalan");
  console.log("========================================");
  const clients = await getAuthClients();
  await jalankanUploadTiktok(clients);
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
