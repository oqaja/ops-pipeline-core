try { require("dotenv").config(); } catch (e) { /* dotenv opsional, cuma buat testing lokal */ }
const { runAutomation } = require("../src/lib/mainOrchestrator");

runAutomation()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
