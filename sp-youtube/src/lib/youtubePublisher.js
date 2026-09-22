const { CONFIG } = require("./config");
const { getChannelInfo } = require("./youtubeChannel");

/** Judul di-UPPERCASE-kan by default, KECUALI SEGMEN = "Cutting" (lowercase) + suffix #Shorts. */
function buildTitle(judulKonten, segmen) {
  const isCutting = String(segmen || "").trim().toLowerCase() === "cutting";
  let title = isCutting ? judulKonten.trim().toLowerCase() : judulKonten.trim().toUpperCase();
  const suffix = " #Shorts";
  const maxBaseLength = CONFIG.MAX_TITLE_LENGTH - suffix.length;
  if (title.length > maxBaseLength) {
    title = title.substring(0, maxBaseLength).trim();
  }
  return title + suffix;
}

/** Gabung deskripsi dari Docs Master + template baku, potong dari BAGIAN DESKRIPSI USER kalau kelebihan 5000 karakter. */
function buildDescription(deskripsiUser) {
  const template = CONFIG.DESCRIPTION_TEMPLATE;
  const separator = "\n\n";
  const maxUserLength = CONFIG.MAX_DESCRIPTION_LENGTH - template.length - separator.length;

  let desc = (deskripsiUser || "").trim();
  if (maxUserLength > 0 && desc.length > maxUserLength) {
    desc = desc.substring(0, maxUserLength).trim();
  } else if (maxUserLength <= 0) {
    desc = "";
  }

  const full = desc ? `${desc}${separator}${template}` : template;
  return full.length > CONFIG.MAX_DESCRIPTION_LENGTH ? full.substring(0, CONFIG.MAX_DESCRIPTION_LENGTH) : full;
}

function determinePrivacyAndSchedule(jadwalUpload) {
  const now = new Date();
  if (jadwalUpload > now) {
    return { privacyStatus: "private", publishAt: jadwalUpload.toISOString() };
  }
  return { privacyStatus: "public", publishAt: null };
}

async function uploadVideo(youtube, { title, description, fileStream, privacyStatus, publishAt }) {
  const requestBody = {
    snippet: { title, description },
    status: { privacyStatus, selfDeclaredMadeForKids: false },
  };
  if (publishAt) {
    requestBody.status.publishAt = publishAt;
  }

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody,
    media: { body: fileStream },
  });

  return res.data;
}

async function updateVideoSchedule(youtube, videoId, jadwalUpload) {
  const { privacyStatus, publishAt } = determinePrivacyAndSchedule(jadwalUpload);

  const requestBody = {
    id: videoId,
    status: { privacyStatus, selfDeclaredMadeForKids: false },
  };
  if (publishAt) {
    requestBody.status.publishAt = publishAt;
  }

  await youtube.videos.update({ part: ["status"], requestBody });
  return { privacyStatus, publishAt };
}

async function getVideoStatus(youtube, videoId) {
  const res = await youtube.videos.list({ part: ["snippet", "status"], id: [videoId] });
  const video = res.data.items && res.data.items[0];
  return video ? { status: video.status, snippet: video.snippet } : null;
}

/** YouTube API replace SELURUH snippet kalau part snippet diminta, jadi wajib pakai currentSnippet biar categoryId/tags/dll gak ke-reset. */
async function updateVideoDetails(youtube, videoId, currentSnippet, { title, description }) {
  const requestBody = {
    id: videoId,
    snippet: { ...currentSnippet, title, description },
  };
  await youtube.videos.update({ part: ["snippet"], requestBody });
}

async function getUploadsPlaylistId(youtube) {
  const { uploadsPlaylistId } = await getChannelInfo(youtube);
  return uploadsPlaylistId;
}

/**
 * Cari video landscape yang di-upload MANUAL (lewat YouTube Studio) di tanggal `targetDateStr`
 * ("YYYY-MM-DD" di timezone `timezone`). Cuma cek halaman PERTAMA uploads playlist (maxResults 50)
 * karena upload terbaru selalu di depan. Balikin array kandidat (0/1/banyak) - caller yang mutusin.
 *
 * playlistItems.list punya field status.privacyStatus, tapi itu bukan sumber otoritatif buat privacy
 * video (bisa gak konsisten/absen di response). Jadi kandidat yang cocok tanggalnya di-verifikasi ulang
 * privacy-nya lewat videos.list sebelum di-filter unlisted/private.
 */
async function findManualUploadByDate(youtube, uploadsPlaylistId, targetDateStr, timezone) {
  const res = await youtube.playlistItems.list({
    part: ["snippet"],
    playlistId: uploadsPlaylistId,
    maxResults: 50,
  });

  const items = res.data.items || [];
  const dateMatches = items.filter((item) => {
    const publishedAt = item.snippet && item.snippet.publishedAt;
    if (!publishedAt) return false;
    const uploadDateStr = new Date(publishedAt).toLocaleDateString("en-CA", { timeZone: timezone });
    return uploadDateStr === targetDateStr;
  });

  if (dateMatches.length === 0) return [];

  const videoIds = dateMatches.map((item) => item.snippet.resourceId.videoId);
  const statusRes = await youtube.videos.list({ part: ["status"], id: videoIds });
  const privacyById = {};
  for (const v of statusRes.data.items || []) {
    privacyById[v.id] = v.status && v.status.privacyStatus;
  }

  return dateMatches
    .map((item) => ({
      videoId: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      publishedAt: item.snippet.publishedAt,
      privacyStatus: privacyById[item.snippet.resourceId.videoId],
    }))
    .filter((v) => v.privacyStatus === "unlisted" || v.privacyStatus === "private");
}

module.exports = {
  buildTitle,
  buildDescription,
  determinePrivacyAndSchedule,
  uploadVideo,
  updateVideoSchedule,
  getVideoStatus,
  updateVideoDetails,
  getUploadsPlaylistId,
  findManualUploadByDate,
};
