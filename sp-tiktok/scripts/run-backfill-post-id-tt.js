// Backfill sekali jalan: baris STATUS TT = Uploaded yang POST ID TT-nya masih ID Buffer
// diganti dengan ID TikTok asli. Default = SIMULASI (tidak menulis apa pun ke sheet).
// Tulis beneran: APPLY=true npm run backfill-post-id-tt
const { CONFIG } = require("../src/lib/config");
const { getAuthClients } = require("../src/lib/googleAuth");
const { getRawGrid, cariIndexKolom, updateCell } = require("../src/lib/sheetRaw");
const { cekStatusPost } = require("../src/lib/bufferClient");
const { ekstrakIdTiktok, adalahIdBuffer } = require("../src/lib/tiktokLink");

(async () => {
  const apply = String(process.env.APPLY || "").toLowerCase() === "true";
  console.log("========================================");
  console.log(`Backfill POST ID TT - mode: ${apply ? "TULIS (APPLY)" : "SIMULASI (tidak menulis)"}`);
  console.log("========================================");

  const { sheets } = await getAuthClients();
  const data = await getRawGrid(sheets, CONFIG.SPREADSHEET_ID, CONFIG.SHEET_NAME);
  const header = data[0];
  const idxJudul = cariIndexKolom(header, "JUDUL KONTEN");
  const idxStatusTT = cariIndexKolom(header, "STATUS TT");
  const idxPostIdTT = cariIndexKolom(header, "POST ID TT");
  const idxCatatan = cariIndexKolom(header, "CATATAN");

  const bisa = [];
  const tidakBisa = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = (row[idxStatusTT] || "").toString().toLowerCase().trim();
    const postId = (row[idxPostIdTT] || "").toString().trim();
    if (status !== "uploaded" || !adalahIdBuffer(postId)) continue;

    const nomorBaris = i + 1;
    const judul = (row[idxJudul] || "").toString().slice(0, 50);

    // Sumber 1: link di CATATAN ("Published: https://www.tiktok.com/.../video/<id>")
    let idBaru = ekstrakIdTiktok(row[idxCatatan]);
    let sumber = "CATATAN";

    // Sumber 2: tanya Buffer lagi (externalLink)
    if (!idBaru) {
      try {
        const res = await cekStatusPost(postId);
        idBaru = ekstrakIdTiktok(res && res.data && res.data.post && res.data.post.externalLink);
        sumber = "Buffer";
      } catch (e) {
        console.log(`  Baris ${nomorBaris}: gagal tanya Buffer: ${e.toString()}`);
      }
    }

    if (idBaru) bisa.push({ nomorBaris, judul, postId, idBaru, sumber });
    else tidakBisa.push({ nomorBaris, judul, postId });
  }

  console.log(`\nDapat diganti: ${bisa.length} baris`);
  for (const r of bisa) {
    console.log(`  Baris ${r.nomorBaris} | ${r.judul} | ${r.postId} -> ${r.idBaru} (dari ${r.sumber})`);
  }
  console.log(`\nTidak bisa ditentukan otomatis: ${tidakBisa.length} baris`);
  for (const r of tidakBisa) {
    console.log(`  Baris ${r.nomorBaris} | ${r.judul} | ${r.postId}`);
  }

  if (!apply) {
    console.log("\nSIMULASI selesai. Tidak ada yang ditulis. Jalankan ulang dengan APPLY=true untuk menulis.");
    return;
  }

  for (const r of bisa) {
    await updateCell(sheets, CONFIG.SPREADSHEET_ID, CONFIG.SHEET_NAME, r.nomorBaris, idxPostIdTT, r.idBaru);
  }
  console.log(`\nSELESAI: ${bisa.length} baris POST ID TT diganti. CATATAN tidak diubah.`);
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
