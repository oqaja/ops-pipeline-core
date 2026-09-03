const { CONFIG } = require("./config");
const { getRawGrid, cariIndexKolom, updateCell } = require("./sheetRaw");
const { gabungkanTanggalJam } = require("./dateUtils");
const { cariKontenDiDocsMaster } = require("./docsReader");
const {
  cariFileVideo,
  cariFileFotoCarousel,
  getDriveDirectLink,
  getResizedImageUrl,
} = require("./driveFinder");
const { kirimCreatePostKeBuffer } = require("./bufferClient");

async function jalankanUploadTiktok({ sheets, docs, drive }) {
  const data = await getRawGrid(
    sheets,
    CONFIG.SPREADSHEET_ID,
    CONFIG.SHEET_NAME
  );
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
    const jenisKonten = jenisKontenRaw
      ? jenisKontenRaw.toString().toLowerCase().trim()
      : "";
    const production = row[idxProduction];
    const statusTT = row[idxStatusTT];
    const tanggalCell = row[idxTanggal];
    const jamUpTT = row[idxJamUpTT];

    const isVideo = jenisKonten === "video pendek";
    const isCarousel = jenisKonten === "desain";
    const jenisSesuai = isVideo || isCarousel;

    const productionSelesai =
      production && production.toString().trim() === "✅";
    const statusSiap =
      statusTT && statusTT.toString().toLowerCase().trim() === "acc";

    if (!(jenisSesuai && productionSelesai && statusSiap)) continue;

    const nomorBaris = i + 1;

    const jadwalUpload = gabungkanTanggalJam(tanggalCell, jamUpTT);
    if (!jadwalUpload) {
      const pesan =
        `TANGGAL / JAM UP TT tidak valid ` +
        `(TANGGAL=${JSON.stringify(tanggalCell)}, JAM UP TT=${JSON.stringify(jamUpTT)}). ` +
        `Isi jam pakai format "HH.MM" atau "HH:MM". Baris tidak di-upload sampai diperbaiki.`;
      console.log(`Baris ${nomorBaris} dilewati: ${pesan}`);
      try {
        await updateCell(
          sheets,
          CONFIG.SPREADSHEET_ID,
          CONFIG.SHEET_NAME,
          nomorBaris,
          idxCatatan,
          `Error TikTok: ${pesan}`
        );
      } catch (e) {
        console.log(`  (gagal tulis CATATAN baris ${nomorBaris}: ${e.toString()})`);
      }
      continue;
    }

    console.log(
      `Proses TikTok baris ${nomorBaris} [${isVideo ? "video" : "carousel"}]: ${judulSheet}`
    );
    diproses++;

    try {
      const kontenDitemukan = await cariKontenDiDocsMaster(docs, judulSheet);
      const captionUntukTiktok =
        kontenDitemukan && kontenDitemukan.captionHashtag
          ? kontenDitemukan.captionHashtag.trim()
          : "";

      if (!captionUntukTiktok) {
        throw new Error(
          `Caption kosong di Docs Master untuk judul: ${judulSheet}.`
        );
      }

      const dueAtIso = jadwalUpload.toISOString();
      let assetsGraphQL = "";

      if (isVideo) {
        const videoFile = await cariFileVideo(drive, judulSheet);
        if (!videoFile) {
          throw new Error(
            `File video tidak ditemukan di SIAP UPLOAD: ${judulSheet}`
          );
        }
        const videoUrl = getDriveDirectLink(videoFile);
        assetsGraphQL = `{ video: { url: ${JSON.stringify(videoUrl)} } }`;
      } else {
        const fotoFiles = await cariFileFotoCarousel(drive, judulSheet);
        if (fotoFiles.length === 0) {
          throw new Error(
            `Tidak ada foto carousel ditemukan untuk judul: ${judulSheet}`
          );
        }
        assetsGraphQL = fotoFiles
          .map((file) => {
            const url = getResizedImageUrl(file);
            return `{ image: { url: ${JSON.stringify(url)} } }`;
          })
          .join(",\n");
        console.log(
          `Carousel baris ${nomorBaris}: ${fotoFiles.length} foto ditemukan.`
        );
      }

      const result = await kirimCreatePostKeBuffer(
        captionUntukTiktok,
        judulSheet,
        assetsGraphQL,
        dueAtIso,
        isCarousel
      );
      const createPostResult = result.data && result.data.createPost;

      if (!createPostResult || createPostResult.message) {
        throw new Error(
          `Buffer menolak post: ${createPostResult ? createPostResult.message : JSON.stringify(result)}`
        );
      }

      const bufferPostId = createPostResult.post.id;

      await updateCell(
        sheets,
        CONFIG.SPREADSHEET_ID,
        CONFIG.SHEET_NAME,
        nomorBaris,
        idxStatusTT,
        "Scheduled"
      );
      await updateCell(
        sheets,
        CONFIG.SPREADSHEET_ID,
        CONFIG.SHEET_NAME,
        nomorBaris,
        idxPostIdTT,
        bufferPostId
      );
      await updateCell(
        sheets,
        CONFIG.SPREADSHEET_ID,
        CONFIG.SHEET_NAME,
        nomorBaris,
        idxCatatan,
        `Dijadwalkan di Buffer: ${jadwalUpload.toLocaleString("id-ID")}.`
      );

      console.log(
        `BERHASIL jadwalkan baris ${nomorBaris}: ${bufferPostId} -> ${dueAtIso}`
      );
    } catch (e) {
      await updateCell(
        sheets,
        CONFIG.SPREADSHEET_ID,
        CONFIG.SHEET_NAME,
        nomorBaris,
        idxStatusTT,
        "Gagal"
      );
      await updateCell(
        sheets,
        CONFIG.SPREADSHEET_ID,
        CONFIG.SHEET_NAME,
        nomorBaris,
        idxCatatan,
        `Error TikTok (Buffer): ${e.toString()}`
      );
      console.log(`GAGAL TikTok baris ${nomorBaris}: ${e.toString()}`);
    }
  }

  console.log(
    diproses === 0
      ? "Tidak ada row yang siap diproses saat ini."
      : `Selesai proses TikTok (${diproses} row diproses).`
  );
}

module.exports = { jalankanUploadTiktok };
