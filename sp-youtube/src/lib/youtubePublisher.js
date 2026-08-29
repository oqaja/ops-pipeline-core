const { CONFIG } = require("./config");

/** Judul di-UPPERCASE-kan (beda dari affiliate yang lowercase) + suffix #Shorts. */
function buildTitle(judulKonten) {
  let title = judulKonten.trim().toUpperCase();
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
  const res = await youtube.videos.list({ part: ["status"], id: [videoId] });
  const video = res.data.items && res.data.items[0];
  return video ? video.status : null;
}

module.exports = {
  buildTitle,
  buildDescription,
  determinePrivacyAndSchedule,
  uploadVideo,
  updateVideoSchedule,
  getVideoStatus,
};
