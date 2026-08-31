try { require("dotenv").config(); } catch (e) {}
const { getSheetsClient } = require("../src/lib/googleAuth");
const { archiveRecentComments } = require("../src/lib/commentArchive");

(async () => {
  try {
    const sheets = await getSheetsClient();
    await archiveRecentComments(sheets, 30);
    process.exit(0);
  } catch (err) {
    console.error("FATAL:", err);
    process.exit(1);
  }
})();
