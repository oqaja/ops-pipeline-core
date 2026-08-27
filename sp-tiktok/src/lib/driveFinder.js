const { CONFIG, getDriveApiKey } = require("./config");

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
  const target = namaFile.trim().toLowerCase();
  return files.find((f) => stripExtension(f.name).trim().toLowerCase() === target) || null;
}

async function cariFileFotoCarousel(drive, namaFileDasar) {
  const files = await listFilesInFolder(drive);
  const namaEscaped = namaFileDasar.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp("^" + namaEscaped + "\\s*(\\d+)$", "i");

  const hasil = [];
  for (const f of files) {
    const namaTanpaEkstensi = stripExtension(f.name).trim();
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

function getResizedImageUrl(file) {
  return `https://drive.google.com/thumbnail?id=${file.id}&sz=w1080-h1920`;
}

module.exports = { cariFileVideo, cariFileFotoCarousel, getDriveDirectLink, getResizedImageUrl };
