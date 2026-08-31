const { CONFIG } = require("./config");
const { getRawGrid, cariIndexKolom, updateCell } = require("./sheetRaw");
const { cekStatusPost } = require("./bufferClient");

async function cekStatusUploadTiktok({ sheets }) {
  const data = await getRawGrid(sheets, CONFIG.SPREADSHEET_ID, CONFIG.SHEET_NAME);
  const header = data[0];

  const idxStatusTT = cariIndexKolom(header, "STATUS TT");
  const idxPostIdTT = cariIndexKolom(header, "POST ID TT");
  const idxCatatan = cariIndexKolom(header, "CATATAN");

  let dicek = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const statusTT = row[idxStatusTT];
    const bufferPostId = row[idxPostIdTT];

    const perluDicek = statusTT && statusTT.toString().toLowerCase().trim() === "scheduled" && bufferPostId;
    if (!perluDicek) continue;

    const nomorBaris = i + 1;
    dicek++;

    try {
      const result = await cekStatusPost(bufferPostId);
      const post = result.data && result.data.post;

      if (!post) {
        console.log(`Post tidak ditemukan di Buffer buat baris ${nomorBaris}`);
        continue;
      }

      if (post.status === "sent") {
        await updateCell(sheets, CONFIG.SPREADSHEET_ID, CONFIG.SHEET_NAME, nomorBaris, idxStatusTT, "Uploaded");
        await updateCell(sheets, CONFIG.SPREADSHEET_ID, CONFIG.SHEET_NAME, nomorBaris, idxCatatan, `Published: ${post.externalLink}`);
        console.log(`BERHASIL publish baris ${nomorBaris}: ${post.externalLink}`);
      } else if (post.error && post.error.message) {
        await updateCell(sheets, CONFIG.SPREADSHEET_ID, CONFIG.SHEET_NAME, nomorBaris, idxStatusTT, "Gagal");
        await updateCell(sheets, CONFIG.SPREADSHEET_ID, CONFIG.SHEET_NAME, nomorBaris, idxCatatan, `Gagal publish di Buffer: ${post.error.message}`);
        console.log(`GAGAL publish baris ${nomorBaris}: ${post.error.message}`);
      }
    } catch (e) {
      console.log(`Error cek status baris ${nomorBaris}: ${e.toString()}`);
    }
  }

  console.log(dicek === 0 ? "Tidak ada post 'Scheduled' yang perlu dicek." : `Selesai cek status TikTok (Buffer), ${dicek} post dicek.`);
}

module.exports = { cekStatusUploadTiktok };
