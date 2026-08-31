try { require("dotenv").config(); } catch (e) {}
const { getSheetsClient } = require("../src/lib/googleAuth");
const { backfillAllPosts, backfillAccountInsights } = require("../src/lib/insightsTracker");

// Jalankan sekali lewat: gh workflow run sp-ig-backfill.yml (rantai batch berhenti sendiri saat DONE)
// atau lokal: node scripts/run-backfill-post-insights.js [daysBackForAccount]
(async () => {
  try {
    const sheets = await getSheetsClient();
    await backfillAllPosts(sheets);

    const daysBack = parseInt(process.argv[2] || "30", 10);
    await backfillAccountInsights(sheets, daysBack);

    process.exit(0);
  } catch (err) {
    console.error("FATAL:", err);
    process.exit(1);
  }
})();
