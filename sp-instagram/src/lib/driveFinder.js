/**
 * driveFinder.js
 * Port dari SP_DriveFinder.gs (Modul 2) - cari file di folder "SIAP UPLOAD"
 * berdasarkan JUDUL KONTEN, siapkan link publik langsung untuk Instagram API.
 */

const { CONFIG, getDriveApiKey } = require("./config");
const { checkAudioBitrate } = require("./videoValidator");

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripExtension(fileName) {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1) return fileName;
  return fileName.substring(0, lastDot);
}

/** List semua file di folder SIAP UPLOAD (dengan paging). @private */
async function listFolderFiles(drive) {
  const files = [];
  let pageToken = undefined;
  do {
    const res = await drive.files.list({
      q: `'${CONFIG.DRIVE_FOLDER_ID}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size, owners(emailAddress))",
      pageSize: 1000,
      pageToken,
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

/**
 * Setara spPrepareFileForPublishing_. Coba set sharing "Anyone with link" -
 * kalau gagal (bukan owner), lanjut aja (folder induk sudah public).
 */
async function prepareFileForPublishing(drive, file) {
  try {
    await drive.permissions.create({
      fileId: file.id,
      requestBody: { role: "reader", type: "anyone" },
    });
  } catch (err) {
    // Bukan owner file ini - normal, andalkan sharing folder induk.
  }

  const mimeType = file.mimeType || "";
  const isVideo = mimeType.indexOf("video/") === 0;
  const fileSizeBytes = file.size ? parseInt(file.size, 10) : 0;

  return {
    fileId: file.id,
    fileName: file.name,
    mimeType,
    isVideo,
    fileSizeBytes,
    directUrl: getSafeDriveUrl(file.id),
  };
}

/** Setara spGetSafeDriveUrl_. */
function getSafeDriveUrl(fileId) {
  const apiKey = getDriveApiKey();
  if (!apiKey) {
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`;
}

/** Setara spFindContentFiles(). */
async function findContentFiles(drive, judulKonten) {
  const targetName = String(judulKonten || "").trim().toLowerCase();
  if (!targetName) return [];

  const files = await listFolderFiles(drive);

  let exactMatch = null;
  const numberedMatches = [];
  const numberedPattern = new RegExp(`^${escapeRegex(targetName)}[\\s\\-_]+(\\d+)$`, "i");

  for (const file of files) {
    const nameWithoutExt = stripExtension(file.name).trim();
    const nameLower = nameWithoutExt.toLowerCase();

    if (nameLower === targetName) {
      exactMatch = file;
      continue;
    }

    const match = nameLower.match(numberedPattern);
    if (match) {
      numberedMatches.push({ number: parseInt(match[1], 10), file });
    }
  }

  if (numberedMatches.length >= 2) {
    numberedMatches.sort((a, b) => a.number - b.number);
    const results = [];
    for (const item of numberedMatches) results.push(await prepareFileForPublishing(drive, item.file));
    return results;
  }

  if (exactMatch) return [await prepareFileForPublishing(drive, exactMatch)];
  if (numberedMatches.length === 1) return [await prepareFileForPublishing(drive, numberedMatches[0].file)];

  return [];
}

/** Setara spFindContentFile() (deprecated single-file version, tetap disediakan). */
async function findContentFile(drive, judulKonten) {
  const results = await findContentFiles(drive, judulKonten);
  return results.length > 0 ? results[0] : null;
}

/** Setara spFindCoverFile(). */
async function findCoverFile(drive, judulKonten) {
  const targetName = String(judulKonten || "").trim().toLowerCase();
  if (!targetName) return null;

  const coverName = `${targetName} ${CONFIG.COVER_FILE_SUFFIX.toLowerCase()}`;
  const files = await listFolderFiles(drive);

  for (const file of files) {
    const nameWithoutExt = stripExtension(file.name).trim().toLowerCase();
    if (nameWithoutExt === coverName) {
      const mimeType = file.mimeType || "";
      if (mimeType.indexOf("image/") !== 0) {
        console.log(`  (warning) File cover '${file.name}' ditemukan tapi BUKAN gambar (${mimeType}) - diabaikan.`);
        return null;
      }
      return prepareFileForPublishing(drive, file);
    }
  }

  return null;
}

/** Setara spValidateFile_. */
async function validateFile(fileInfo) {
  const sizeMB = fileInfo.fileSizeBytes / (1024 * 1024);

  if (fileInfo.isVideo) {
    if (!fileInfo.mimeType || fileInfo.mimeType.indexOf("video/") !== 0) {
      return `Tipe file salah untuk '${fileInfo.fileName}': seharusnya video, terdeteksi '${fileInfo.mimeType}'.`;
    }
    if (sizeMB > CONFIG.MAX_VIDEO_SIZE_MB) {
      return `Video '${fileInfo.fileName}' terlalu besar: ${sizeMB.toFixed(1)} MB (batas Instagram Reels API: ${CONFIG.MAX_VIDEO_SIZE_MB} MB).`;
    }

    try {
      const audioBitrate = await checkAudioBitrate(fileInfo);
      if (audioBitrate !== null && audioBitrate > CONFIG.MAX_AUDIO_BITRATE_KBPS) {
        return `Video '${fileInfo.fileName}' audio bitrate-nya ${audioBitrate.toFixed(0)} kbps, melebihi batas Instagram (${CONFIG.MAX_AUDIO_BITRATE_KBPS} kbps). Perlu di-compress dulu sebelum upload ulang.`;
      }
    } catch (err) {
      console.log(`  (info) Gagal cek audio bitrate '${fileInfo.fileName}' (dilewatkan, tidak diblokir): ${err.message}`);
    }
  } else {
    if (!fileInfo.mimeType || fileInfo.mimeType.indexOf("image/") !== 0) {
      return `Tipe file salah untuk '${fileInfo.fileName}': seharusnya foto, terdeteksi '${fileInfo.mimeType}'.`;
    }
    if (sizeMB > CONFIG.MAX_IMAGE_SIZE_MB) {
      return `Foto '${fileInfo.fileName}' terlalu besar: ${sizeMB.toFixed(1)} MB (batas Instagram: ${CONFIG.MAX_IMAGE_SIZE_MB} MB).`;
    }
  }

  return null;
}

/** Setara spValidateFiles_. */
async function validateFiles(fileInfos) {
  for (const fileInfo of fileInfos) {
    const error = await validateFile(fileInfo);
    if (error) return error;
  }
  return null;
}

module.exports = {
  findContentFiles,
  findContentFile,
  findCoverFile,
  validateFile,
  validateFiles,
  getSafeDriveUrl,
};
