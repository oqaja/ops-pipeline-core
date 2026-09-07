const { CONFIG, getDriveApiKey } = require("./config");
const { normalizeTitleForMatch } = require("./titleMatch");

async function listFilesInFolder(drive) {
  const files = [];
  let pageToken = null;
  do {
    const res = await drive.files.list({
      q: `'${CONFIG.FOLDER_SIAP_UPLOAD_ID}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      pageSize: 1000,
      pageToken,
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken || null;
  } while (pageToken);
  return files;
}

function stripExtension(name) {
  return name.replace(/\.[^/.]+$/, "");
}

async function cariFileVideo(drive, namaFile) {
  const files = await listFilesInFolder(drive);
  const target = normalizeTitleForMatch(namaFile);
  return files.find((f) => normalizeTitleForMatch(stripExtension(f.name)) === target) || null;
}

async function cariFileFotoCarousel(drive, namaFileDasar) {
  const files = await listFilesInFolder(drive);
  const namaEscaped = normalizeTitleForMatch(namaFileDasar).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp("^" + namaEscaped + "\\s*(\\d+)$");

  const hasil = [];
  for (const f of files) {
    const namaTanpaEkstensi = normalizeTitleForMatch(stripExtension(f.name));
    const match = namaTanpaEkstensi.match(regex);
    if (match) {
      if (f.mimeType.indexOf("image/") !== 0) continue;
      hasil.push({ file: f, nomor: parseInt(match[1], 10) });
    }
  }
  hasil.sort((a, b) => a.nomor - b.nomor);
  return hasil.map((item) => item.file);
}

function getDriveDirectLink(file) {
  const apiKey = getDriveApiKey();
  if (!apiKey) {
    return `https://drive.google.com/uc?export=download&id=${file.id}`;
  }
  return `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${apiKey}`;
}

module.exports = { cariFileVideo, cariFileFotoCarousel, getDriveDirectLink };
