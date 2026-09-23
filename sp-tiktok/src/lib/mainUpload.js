const { CONFIG } = require("./config");
const { getRawGrid, cariIndexKolom, updateCell } = require("./sheetRaw");
const { gabungkanTanggalJam } = require("./dateUtils");
const { cariKontenDiDocsMaster } = require("./docsReader");
const {
  cariFileVideo,
  cariFileFotoCarousel,
  getDriveDirectLink,
} = require("./driveFinder");
const { kirimCreatePostKeBuffer, kirimEditPostKeBuffer, cekStatusPost } = require("./bufferClient");

// Kalau response GraphQL Buffer berisi error NOT_FOUND, anggap post sudah publish
// (record Buffer di-purge) dan naikkan row ke Uploaded. Return true kalau row ditangani.
async function tanganiBufferNotFound(
  result,
  { sheets, nomorBaris, idxStatusTT, idxCatatan }
) {
  const isNotFoundError =
    result &&
    result.errors &&
    result.errors.some(
      (e) => e.extensions && e.extensions.code === "NOT_FOUND"
    );

  if (!isNotFoundError) return false;

  await updateCell(
    sheets,
    CONFIG.SPREADSHEET_ID,
    CONFIG.SHEET_NAME,
    nomorBaris,
    idxStatusTT,
    "Uploaded"
  );
  await updateCell(
    sheets,
    CONFIG.SPREADSHEET_ID,
    CONFIG.SHEET_NAME,
    nomorBaris,
    idxCatatan,
    "Video kemungkinan sudah live (record Buffer sudah tidak ditemukan/purged setelah publish) - POST ID TT masih ID Buffer lama, BUKAN ID TikTok asli. Cek manual di TikTok kalau perlu ID pastinya."
  );
  console.log(
    `  Baris ${nomorBaris}: Buffer record NOT_FOUND (kemungkinan sudah publish), dinaikkan ke Uploaded (ID Buffer lama dipertahankan, bukan ID TikTok asli).`
  );
  return true;
}

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
      console.log(`  DEBUG baris ${nomorBaris}: tanggalCell=${JSON.stringify(tanggalCell)}, jamUpTT=${JSON.stringify(jamUpTT)}`);
      console.log(
        `Baris ${nomorBaris} dilewati: TANGGAL/JAM UP TT tidak valid.`
      );
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
            const url = getDriveDirectLink(file);
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

  let diupdate = 0;
  let dinaikkanKeUploaded = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const judulSheet = row[idxJudul];
    const jenisKontenRaw = row[idxJenisKonten];
    const jenisKonten = jenisKontenRaw
      ? jenisKontenRaw.toString().toLowerCase().trim()
      : "";
    const statusTT = row[idxStatusTT];
    const postIdTT = row[idxPostIdTT];
    const tanggalCell = row[idxTanggal];
    const jamUpTT = row[idxJamUpTT];

    const isVideo = jenisKonten === "video pendek";
    const isCarousel = jenisKonten === "desain";
    const jenisSesuai = isVideo || isCarousel;

    const statusScheduled =
      statusTT && statusTT.toString().toLowerCase().trim() === "scheduled";
    const adaPostId = postIdTT && postIdTT.toString().trim() !== "";

    if (!(jenisSesuai && statusScheduled && adaPostId)) continue;

    const nomorBaris = i + 1;

    let statusCekBuffer;
    try {
      statusCekBuffer = await cekStatusPost(postIdTT);
    } catch (e) {
      console.log(
        `WARNING: gagal cek status Buffer untuk baris ${nomorBaris}: ${e.toString()}`
      );
      statusCekBuffer = null;
    }

    if (
      await tanganiBufferNotFound(statusCekBuffer, {
        sheets,
        nomorBaris,
        idxStatusTT,
        idxCatatan,
      })
    ) {
      dinaikkanKeUploaded++;
      continue;
    }

    const externalLink =
      statusCekBuffer &&
      statusCekBuffer.data &&
      statusCekBuffer.data.post &&
      statusCekBuffer.data.post.externalLink;

    if (externalLink) {
      const matchIdTiktok = externalLink.match(/\/video\/(\d+)/);
      if (!matchIdTiktok) {
        console.log(
          `WARNING baris ${nomorBaris}: externalLink Buffer tidak sesuai pola TikTok, dilewati: ${externalLink}`
        );
      } else {
        const idAsliTiktok = matchIdTiktok[1];

        await updateCell(
          sheets,
          CONFIG.SPREADSHEET_ID,
          CONFIG.SHEET_NAME,
          nomorBaris,
          idxPostIdTT,
          idAsliTiktok
        );
        await updateCell(
          sheets,
          CONFIG.SPREADSHEET_ID,
          CONFIG.SHEET_NAME,
          nomorBaris,
          idxStatusTT,
          "Uploaded"
        );
        await updateCell(
          sheets,
          CONFIG.SPREADSHEET_ID,
          CONFIG.SHEET_NAME,
          nomorBaris,
          idxCatatan,
          `Video live di TikTok: ${externalLink}`
        );

        dinaikkanKeUploaded++;
        console.log(`Baris ${nomorBaris} naik ke status Uploaded.`);
        continue;
      }
    }

    const jadwalUpload = gabungkanTanggalJam(tanggalCell, jamUpTT);
    if (!jadwalUpload) {
      console.log(
        `Baris ${nomorBaris} dilewati (update): TANGGAL/JAM UP TT tidak valid.`
      );
      continue;
    }

    console.log(
      `Proses update TikTok baris ${nomorBaris} [${isVideo ? "video" : "carousel"}]: ${judulSheet}`
    );

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
            const url = getDriveDirectLink(file);
            return `{ image: { url: ${JSON.stringify(url)} } }`;
          })
          .join(",\n");
      }

      const result = await kirimEditPostKeBuffer(
        postIdTT,
        captionUntukTiktok,
        assetsGraphQL,
        dueAtIso
      );

      if (
        await tanganiBufferNotFound(result, {
          sheets,
          nomorBaris,
          idxStatusTT,
          idxCatatan,
        })
      ) {
        dinaikkanKeUploaded++;
        continue;
      }

      const editPostResult = result.data && result.data.editPost;

      if (!editPostResult || editPostResult.message) {
        throw new Error(
          `Buffer menolak update: ${editPostResult ? editPostResult.message : JSON.stringify(result)}`
        );
      }

      await updateCell(
        sheets,
        CONFIG.SPREADSHEET_ID,
        CONFIG.SHEET_NAME,
        nomorBaris,
        idxCatatan,
        `Diupdate di Buffer: ${new Date().toLocaleString("id-ID")}.`
      );

      diupdate++;
      console.log(
        `BERHASIL update baris ${nomorBaris}: ${postIdTT} -> ${dueAtIso}`
      );
    } catch (e) {
      const catatanLama = row[idxCatatan] || "";
      await updateCell(
        sheets,
        CONFIG.SPREADSHEET_ID,
        CONFIG.SHEET_NAME,
        nomorBaris,
        idxCatatan,
        `${catatanLama} | Gagal update Buffer: ${e.toString()}`
      );
      console.log(`GAGAL update TikTok baris ${nomorBaris}: ${e.toString()}`);
    }
  }

  console.log(
    diproses === 0
      ? "Tidak ada row yang siap diproses saat ini."
      : `Selesai proses TikTok (${diproses} row diproses).`
  );
  console.log(
    `Update Buffer: ${diupdate} row di-update dari total row Scheduled yang diperiksa.`
  );
  console.log(
    `Naik ke Uploaded: ${dinaikkanKeUploaded} row (video sudah live di TikTok).`
  );
}

module.exports = { jalankanUploadTiktok };
