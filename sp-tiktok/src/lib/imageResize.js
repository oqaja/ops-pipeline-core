const { Readable } = require("stream");
const sharp = require("sharp");
const { CONFIG, getDriveApiKey } = require("./config");

// Batas resmi TikTok Photo Mode (Content Posting API): total pixel count gak boleh
// lebih dari 1920x1080 (urutan landscape/portrait gak masalah, yang dicek cuma total-nya).
const TIKTOK_MAX_PIXELS = 1920 * 1080; // 2.073.600

function bufferKeStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

function buatDriveDirectLink(fileId) {
  const apiKey = getDriveApiKey();
  if (!apiKey) {
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`;
}

/**
 * Siapin URL gambar carousel buat dikirim ke Buffer/TikTok. Kalau resolusi
 * aslinya udah di bawah batas TikTok, pakai link Drive asli (gak ada resize,
 * kualitas gak turun percuma). Kalau kelebihan, resize proporsional supaya
 * total pixel count pas di bawah batas, upload hasilnya sebagai file sementara
 * di folder SIAP UPLOAD yang sama, dan return file id-nya biar bisa dihapus
 * lagi setelah post berhasil dikirim ke Buffer (lihat hapusFileSementara).
 *
 * Return: { url, tempFileId } - tempFileId null kalau gak ada resize (gak perlu
 * dihapus apa-apa).
 */
async function siapkanGambarUntukTiktok(drive, file) {
  const original = await drive.files.get(
    { fileId: file.id, alt: "media" },
    { responseType: "arraybuffer" }
  );
  const bufferAsli = Buffer.from(original.data);

  let metadata;
  try {
    metadata = await sharp(bufferAsli).metadata();
  } catch (e) {
    console.log(
      `  WARNING: gagal baca metadata gambar "${file.name}" (${e.toString()}), pakai link asli apa adanya.`
    );
    return { url: buatDriveDirectLink(file.id), tempFileId: null };
  }

  const { width, height } = metadata;
  const pixelCount = (width || 0) * (height || 0);

  if (!width || !height || pixelCount <= TIKTOK_MAX_PIXELS) {
    return { url: buatDriveDirectLink(file.id), tempFileId: null };
  }

  const scale = Math.sqrt(TIKTOK_MAX_PIXELS / pixelCount);
  const targetWidth = Math.max(1, Math.floor(width * scale));
  const targetHeight = Math.max(1, Math.floor(height * scale));

  console.log(
    `  Resize "${file.name}": ${width}x${height} (${pixelCount} px) -> ${targetWidth}x${targetHeight} (batas TikTok ${TIKTOK_MAX_PIXELS} px).`
  );

  const bufferResized = await sharp(bufferAsli)
    .resize(targetWidth, targetHeight, { fit: "fill" })
    .jpeg({ quality: 92 })
    .toBuffer();

  const uploadRes = await drive.files.create({
    requestBody: {
      name: `${file.name}.tt-resized.jpg`,
      parents: [CONFIG.FOLDER_SIAP_UPLOAD_ID],
    },
    media: {
      mimeType: "image/jpeg",
      body: bufferKeStream(bufferResized),
    },
    fields: "id",
  });

  const tempFileId = uploadRes.data.id;

  try {
    await drive.permissions.create({
      fileId: tempFileId,
      requestBody: { role: "reader", type: "anyone" },
    });
  } catch (e) {
    console.log(
      `  WARNING: gagal set permission publik buat file resize sementara ${tempFileId}: ${e.toString()}`
    );
  }

  return { url: buatDriveDirectLink(tempFileId), tempFileId };
}

// Hapus file resize sementara dari Drive setelah dipakai (dipanggil setelah
// request ke Buffer selesai, sukses atau gagal). Gagal hapus gak boleh bikin
// seluruh proses upload TikTok crash - cuma warning.
async function hapusFileSementara(drive, tempFileId) {
  if (!tempFileId) return;
  try {
    await drive.files.delete({ fileId: tempFileId });
  } catch (e) {
    console.log(
      `  WARNING: gagal hapus file resize sementara ${tempFileId} (biarin aja, gak fatal): ${e.toString()}`
    );
  }
}

module.exports = { siapkanGambarUntukTiktok, hapusFileSementara, TIKTOK_MAX_PIXELS };
