try { require("dotenv").config(); } catch (e) {}
const { getSheetsClient } = require("../src/lib/googleAuth");
const { archiveAllComments } = require("../src/lib/commentArchive");

(async () => {
  try {
    const sheets = await getSheetsClient();
    await archiveAllComments(sheets);
    process.exit(0);
  } catch (err) {
    console.error("FATAL:", err);
    process.exit(1);
  }
})();
