const { CONFIG } = require("./config");
const { getRawGrid, cariIndexKolom, updateCell } = require("./sheetRaw");
const { gabungkanTanggalJam } = require("./dateUtils");
const { cariKontenDiDocsMaster } = require("./docsReader");
const { cariFileVideo, cariFileFotoCarousel, getDriveDirectLink, getResizedImageUrl } = require("./driveFinder");
const { kirimCreatePostKeBuffer } = require("./bufferClient");

async function jalankanUploadTiktok({ sheets, docs, drive }) {
  const data = await getRawGrid(sheets, CONFIG.SPREADSHEET_ID, CONFIG.SHEET_NAME);
  const header = data[0];

  const idxJudul = cariIndexKolom(header, "JUDUL KONTEN");
  const idxJenisKonten = cariIndexKolom(header, "JENIS KONTEN");
  const idxProduction = cariIndexKolom(header, "PRODUCTION");
  const idxStatusTT = cariIndexKolom(header, "STATUS TT");
  const idxPostIdTT = cariIndexKolom(header, "POST ID TT");
  const idxCatatan = cariIndexKolom(header, "CATATAN");
  const idxJamUpTT = cariIndexKolom(header, "JAM UP TT");
  const idxTanggal = cariIndexKolom(header, "TANGGAL");

  let diproses = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const judulSheet = row[idxJudul];
    const jenisKontenRaw = row[idxJenisKonten];
    const jenisKonten = jenisKontenRaw ? jenisKontenRaw.toString().toLowerCase().trim() : "";
    const production = row[idxProduction];
    const statusTT = row[idxStatusTT];
    const tanggalCell = row[idxTanggal];
    const jamUpTT = row[idxJamUpTT];

    const isVideo = jenisKonten === "video pendek";
    const isCarousel = jenisKonten === "desain";
    const jenisSesuai = isVideo || isCarousel;

    const productionSelesai = production && production.toString().trim() === "✅";
    const statusSiap = statusTT && statusTT.toString().toLowerCase().trim() === "acc";

    if (!(jenisSesuai && productionSelesai && statusSiap)) continue;

    const nomorBaris = i + 1;

    const jadwalUpload = gabungkanTanggalJam(tanggalCell, jamUpTT);
    if (!jadwalUpload) {
      console.log(`Baris ${nomorBaris} dilewati: TANGGAL (${tanggalCell}) atau JAM UP TT (${jamUpTT}) tidak valid.`);
      continue;
    }

    console.log(`Proses TikTok (Buffer) baris ${nomorBaris} [${isVideo ? "video" : "carousel"}]: ${judulSheet}`);
    diproses++;

    try {
      const kontenDitemukan = await cariKontenDiDocsMaster(docs, judulSheet);
      const captionUntukTiktok = kontenDitemukan && kontenDitemukan.captionHashtag ? kontenDitemukan.captionHashtag.trim() : "";

      if (!captionUntukTiktok) {
        throw new Error(`Caption kosong/belum diisi di Docs Master untuk judul: ${judulSheet}. Isi captionnya dulu sebelum diproses.`);
      }

      const dueAtIso = jadwalUpload.toISOString();
      let assetsGraphQL = "";

      if (isVideo) {
        const videoFile = await cariFileVideo(drive, judulSheet);
        if (!videoFile) {
          throw new Error(`File video tidak ditemukan di folder SIAP UPLOAD dengan nama: ${judulSheet}`);
        }
        const videoUrl = getDriveDirectLink(videoFile);
        assetsGraphQL = `{ video: { url: ${JSON.stringify(videoUrl)} } }`;
      } else {
        const fotoFiles = await cariFileFotoCarousel(drive, judulSheet);
        if (fotoFiles.length === 0) {
          throw new Error(`Tidak ada file foto carousel ditemukan untuk judul: ${judulSheet} (pola dicari: '${judulSheet} 1', '${judulSheet} 2', dst).`);
        }
        assetsGraphQL = fotoFiles.map((file) => {
          const url = getResizedImageUrl(file);
          return `{ image: { url: ${JSON.stringify(url)} } }`;
        }).join(",\n");
        console.log(`Carousel baris ${nomorBaris}: ${fotoFiles.length} foto ditemukan (di-resize ke maks 1080x1920).`);
      }

      const result
cat > sp-tiktok/src/lib/statusCheck.js << 'EOF'
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
