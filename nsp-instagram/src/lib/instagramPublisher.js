/**
 * instagramPublisher.js
 * Port dari SP_InstagramPublisher.gs (Modul 4) - publish konten
 * (foto/Reels/Carousel) ke Instagram lewat Graph API.
 * UrlFetchApp -> fetch() bawaan Node 20+. Utilities.sleep -> setTimeout promise.
 */

const { CONFIG, getIgAccessToken } = require("./config");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Setara spCallGraphApi_. */
async function callGraphApi(path, method, params, accessToken) {
  let url = `https://graph.instagram.com/${CONFIG.IG_API_VERSION}/${path}`;
  let response;

  if (method === "get") {
    const query = new URLSearchParams({ ...params, access_token: accessToken }).toString();
    url += (url.indexOf("?") === -1 ? "?" : "&") + query;
    response = await fetch(url, { method: "GET" });
  } else {
    const body = new URLSearchParams({ ...params, access_token: accessToken });
    response = await fetch(url, { method: "POST", body });
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(`Graph API error: ${json.error.message}`);
  }
  return json;
}

/** Setara spDetermineMediaType_. */
function determineMediaType(jenisKonten) {
  const value = String(jenisKonten || "").trim().toLowerCase();

  if (value === "video pendek") return "REELS";
  if (value === "desain") return "IMAGE";

  if (value.indexOf("story") !== -1 || value.indexOf("stories") !== -1) return "STORIES";
  if (value.indexOf("carousel") !== -1) return "CAROUSEL";
  if (value.indexOf("reel") !== -1) return "REELS";

  return "IMAGE";
}

/** Setara spCreateMediaContainer_. */
async function createMediaContainer(mediaUrl, isVideo, mediaType, caption, collaborators, coverUrl, accountId, accessToken) {
  const params = { caption: caption || "" };

  if (mediaType === "REELS") {
    params.media_type = "REELS";
    params.video_url = mediaUrl;
    if (coverUrl) params.cover_url = coverUrl;
  } else if (mediaType === "STORIES") {
    params.media_type = "STORIES";
    if (isVideo) params.video_url = mediaUrl;
    else params.image_url = mediaUrl;
  } else {
    params.image_url = mediaUrl;
  }

  const useCollaborators = collaborators && collaborators.length > 0 && mediaType !== "STORIES";
  if (useCollaborators) params.collaborators = JSON.stringify(collaborators);

  const path = `${accountId}/media`;

  try {
    const result = await callGraphApi(path, "post", params, accessToken);
    return { creationId: result.id, droppedCollaborators: [] };
  } catch (err) {
    const looksLikeCollaboratorIssue = useCollaborators && err.message.indexOf("Invalid user id") !== -1;
    if (!looksLikeCollaboratorIssue) throw err;

    console.log(`  (warning) Gagal undang collaborator (${collaborators.join(", ")}): ${err.message}. Coba lagi TANPA collaborator...`);
    delete params.collaborators;
    const retryResult = await callGraphApi(path, "post", params, accessToken);
    return { creationId: retryResult.id, droppedCollaborators: collaborators };
  }
}

/** Setara spCreateCarouselChildContainer_. */
async function createCarouselChildContainer(fileInfo, accountId, accessToken) {
  const params = { is_carousel_item: true };

  if (fileInfo.isVideo) {
    params.media_type = "VIDEO";
    params.video_url = fileInfo.directUrl;
  } else {
    params.image_url = fileInfo.directUrl;
  }

  const result = await callGraphApi(`${accountId}/media`, "post", params, accessToken);
  const childId = result.id;

  if (fileInfo.isVideo) await waitUntilVideoReady(childId, accessToken);

  return childId;
}

/** Setara spCreateCarouselContainer_. */
async function createCarouselContainer(fileInfos, caption, collaborators, accountId, accessToken) {
  if (fileInfos.length < 2 || fileInfos.length > 10) {
    throw new Error(`Carousel butuh 2-10 file, ditemukan: ${fileInfos.length}`);
  }

  const childIds = [];
  for (let idx = 0; idx < fileInfos.length; idx++) {
    console.log(`  Bikin child container ${idx + 1}/${fileInfos.length}...`);
    childIds.push(await createCarouselChildContainer(fileInfos[idx], accountId, accessToken));
  }

  const params = {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption: caption || "",
  };

  const useCollaborators = collaborators && collaborators.length > 0;
  if (useCollaborators) params.collaborators = JSON.stringify(collaborators);

  const path = `${accountId}/media`;

  try {
    const result = await callGraphApi(path, "post", params, accessToken);
    return { creationId: result.id, droppedCollaborators: [] };
  } catch (err) {
    const looksLikeCollaboratorIssue = useCollaborators && err.message.indexOf("Invalid user id") !== -1;
    if (!looksLikeCollaboratorIssue) throw err;

    console.log(`  (warning) Gagal undang collaborator carousel (${collaborators.join(", ")}): ${err.message}. Coba lagi TANPA collaborator...`);
    delete params.collaborators;
    const retryResult = await callGraphApi(path, "post", params, accessToken);
    return { creationId: retryResult.id, droppedCollaborators: collaborators };
  }
}

/** Setara spWaitUntilVideoReady_. */
async function waitUntilVideoReady(creationId, accessToken) {
  for (let attempt = 1; attempt <= CONFIG.VIDEO_POLL_MAX_ATTEMPTS; attempt++) {
    const result = await callGraphApi(creationId, "get", { fields: "status_code,status" }, accessToken);
    const status = result.status_code;

    console.log(`  (cek status video, percobaan ${attempt}): ${status}${result.status ? " | detail: " + result.status : ""}`);

    if (status === "FINISHED") return true;
    if (status === "ERROR") {
      const detail = result.status ? result.status : "(Instagram tidak kasih detail tambahan)";
      throw new Error(`Video gagal diproses Instagram (status ERROR). Detail: ${detail}`);
    }

    await sleep(CONFIG.VIDEO_POLL_INTERVAL_MS);
  }

  throw new Error("Timeout menunggu video selesai diproses Instagram.");
}

/** Setara spVerifyPublishSucceededDespiteError_. */
async function verifyPublishSucceededDespiteError(creationId, accountId, accessToken) {
  try {
    await sleep(3000);

    const containerStatus = await callGraphApi(creationId, "get", { fields: "status_code" }, accessToken);
    if (containerStatus.status_code !== "PUBLISHED") return null;

    const recent = await callGraphApi(`${accountId}/media`, "get", { fields: "id,timestamp", limit: 1 }, accessToken);
    if (recent.data && recent.data.length > 0) return recent.data[0].id;
    return null;
  } catch (err) {
    console.log(`    (info) Gagal verifikasi ulang: ${err.message}`);
    return null;
  }
}

/** Setara spPublishContainer_. */
async function publishContainer(creationId, accountId, accessToken) {
  const path = `${accountId}/media_publish`;
  try {
    const result = await callGraphApi(path, "post", { creation_id: creationId }, accessToken);
    return result.id;
  } catch (err) {
    console.log(`  (warning) Publish gagal dengan error: ${err.message} - cek apakah sebenarnya berhasil...`);
    const verifiedPostId = await verifyPublishSucceededDespiteError(creationId, accountId, accessToken);
    if (verifiedPostId) {
      console.log(`  (info) Ternyata BERHASIL publish walau API sempat error (post ID: ${verifiedPostId}).`);
      return verifiedPostId;
    }
    throw err;
  }
}

/** Setara spPublishToInstagram(). */
async function publishToInstagram(fileInfos, caption, jenisKonten, collaborators, coverUrl) {
  collaborators = collaborators || [];

  try {
    if (!fileInfos || fileInfos.length === 0) throw new Error("Tidak ada file untuk dipublish.");

    const accountId = CONFIG.IG_BUSINESS_ACCOUNT_ID;
    const accessToken = getIgAccessToken();

    if (fileInfos.length > 1) {
      console.log(`  Terdeteksi ${fileInfos.length} file -> mode CAROUSEL`);
      const carousel = await createCarouselContainer(fileInfos, caption, collaborators, accountId, accessToken);
      console.log(`  Carousel container dibuat: ${carousel.creationId}`);

      await waitUntilVideoReady(carousel.creationId, accessToken);

      const carouselPostId = await publishContainer(carousel.creationId, accountId, accessToken);
      console.log(`  Published! Post ID: ${carouselPostId}`);

      return { success: true, postId: carouselPostId, error: null, droppedCollaborators: carousel.droppedCollaborators };
    }

    const fileInfo = fileInfos[0];
    let mediaType = determineMediaType(jenisKonten);

    if (mediaType === "IMAGE" && fileInfo.isVideo) {
      console.log(`  (info) File adalah video tapi JENIS KONTEN ('${jenisKonten}') tidak menyebut Reels/Story secara jelas. Otomatis pakai REELS.`);
      mediaType = "REELS";
    }

    console.log(`  Media type terdeteksi: ${mediaType}`);

    const media = await createMediaContainer(
      fileInfo.directUrl,
      fileInfo.isVideo,
      mediaType,
      caption,
      collaborators,
      mediaType === "REELS" ? coverUrl : null,
      accountId,
      accessToken
    );
    console.log(`  Container dibuat: ${media.creationId}`);

    if (fileInfo.isVideo) await waitUntilVideoReady(media.creationId, accessToken);

    const postId = await publishContainer(media.creationId, accountId, accessToken);
    console.log(`  Published! Post ID: ${postId}`);

    return { success: true, postId, error: null, droppedCollaborators: media.droppedCollaborators };
  } catch (err) {
    return { success: false, postId: null, error: err.message, droppedCollaborators: [] };
  }
}

/** Setara spTestInstagramConnection(). */
async function testInstagramConnection() {
  console.log("=== Test koneksi Instagram (SP) ===");
  try {
    const accessToken = getIgAccessToken();
    const result = await callGraphApi(CONFIG.IG_BUSINESS_ACCOUNT_ID, "get", { fields: "id,username" }, accessToken);
    console.log(`BERHASIL - API sehat. Akun: @${result.username} (ID: ${result.id})`);
  } catch (err) {
    console.log(`GAGAL - ${err.message}`);
  }
}

module.exports = {
  callGraphApi,
  determineMediaType,
  publishToInstagram,
  testInstagramConnection,
};
