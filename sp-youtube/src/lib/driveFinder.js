const { CONFIG } = require("./config");

async function listFilesInFolder(drive) {
  const files = [];
  let pageToken = null;
  do {
    const res = await drive.files.list({
      q: `'${CONFIG.DRIVE_FOLDER_ID}' in parents and trashed = false`,
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

async function downloadFileStream(drive, fileId) {
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  return res.data;
}

module.exports = { cariFileVideo, downloadFileStream, listFilesInFolder };
