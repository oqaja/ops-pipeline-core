try { require("dotenv").config(); } catch (e) {}
const { getSheetsClient } = require("../src/lib/googleAuth");
const { runPostInsights } = require("../src/lib/insightsTracker");

(async () => {
  try {
    const sheets = await getSheetsClient();
    await runPostInsights(sheets);
    process.exit(0);
  } catch (err) {
    console.error("FATAL:", err);
    process.exit(1);
  }
})();
