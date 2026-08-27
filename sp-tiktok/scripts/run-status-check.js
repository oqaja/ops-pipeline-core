const { getAuthClients } = require("../src/lib/googleAuth");
const { cekStatusUploadTiktok } = require("../src/lib/statusCheck");

(async () => {
  console.log("========================================");
  console.log("TikTok Status Check (Shoe Police, via Buffer) - mulai jalan");
  console.log("========================================");
  const clients = await getAuthClients();
  await cekStatusUploadTiktok(clients);
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
