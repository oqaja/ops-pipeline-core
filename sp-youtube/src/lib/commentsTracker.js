const { CONFIG } = require("./config");
const { ensureSheetWithHeaders, upsertRowByKey, readSheetAsObjects } = require("./sheetsHelper");
const { getState, setState } = require("./stateStore");
const { getChannelInfo, listUploadsPage } = require("./youtubeChannel");

const COMMENT_HEADERS = ["Video ID", "Judul Video", "Comment ID", "Nama", "Komentar", "Likes", "Tanggal Komentar", "Balasan?", "Parent Comment ID", "Terakhir Ditarik"];

const VIDEO_CURSOR_KEY = "SP_YT_COMMENTS_VIDEO_CURSOR";

async function fetchCommentsForVideo(youtube, videoId) {
  const results = [];
  let pageToken = null;

  do {
    let res;
    try {
      res = await youtube.commentThreads.list({
        part: ["snippet", "replies"],
        videoId,
        maxResults: 100,
        pageToken: pageToken || undefined,
        textFormat: "plainText",
      });
    } catch (e) {
      // Video dengan komentar dimatikan/dibatasi akan error di sini - lewati saja, bukan fatal.
      console.log(`  (info) Gagal ambil komentar video ${videoId}: ${e.message}`);
      return results;
    }

    for (const thread of res.data.items || []) {
      const top = thread.snippet.topLevelComment.snippet;
      results.push({
        commentId: thread.snippet.topLevelComment.id,
        nama: top.authorDisplayName,
        komentar: top.textDisplay,
        likes: top.likeCount,
        tanggal: top.publishedAt,
        balasan: false,
        parentId: "",
      });

      if (thread.replies) {
        for (const reply of thread.replies.comments) {
          results.push({
            commentId: reply.id,
            nama: reply.snippet.authorDisplayName,
            komentar: reply.snippet.textDisplay,
            likes: reply.snippet.likeCount,
            tanggal: reply.snippet.publishedAt,
            balasan: true,
            parentId: thread.snippet.topLevelComment.id,
          });
        }
      }
    }

    pageToken = res.data.nextPageToken || null;
  } while (pageToken);

  return results;
}

async function runCommentsTracker({ sheets, youtube }) {
  const { uploadsPlaylistId } = await getChannelInfo(youtube);
  await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.COMMENTS_SHEET_NAME, COMMENT_HEADERS);

  const { rows: existingRows } = await readSheetAsObjects(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.COMMENTS_SHEET_NAME);
  const existingCommentIds = new Set(existingRows.map((r) => String(r["Comment ID"] || "").trim()));

  let pageToken = await getState(sheets, VIDEO_CURSOR_KEY);
  console.log(pageToken ? "Melanjutkan dari cursor tersimpan..." : "Mulai dari video terbaru.");

  const videos = [];
  let currentPageToken = pageToken;
  while (videos.length < CONFIG.MAX_INSIGHTS_BATCH) {
    const page = await listUploadsPage(youtube, uploadsPlaylistId, currentPageToken, 50);
    videos.push(...page.items);
    currentPageToken = page.nextPageToken;
    if (!currentPageToken) break;
  }

  if (videos.length === 0) {
    console.log("Tidak ada video ditemukan.");
    return;
  }

  console.log(`${videos.length} video diproses batch ini.`);

  let totalKomentarBaru = 0;

  for (const video of videos) {
    const comments = await fetchCommentsForVideo(youtube, video.videoId);
    const komentarBaru = comments.filter((c) => !existingCommentIds.has(c.commentId));

    for (const c of komentarBaru) {
      await upsertRowByKey(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.COMMENTS_SHEET_NAME, "Comment ID", c.commentId, [
        video.videoId,
        video.title,
        c.commentId,
        c.nama,
        c.komentar,
        c.likes,
        new Date(c.tanggal),
        c.balasan ? "Ya" : "Tidak",
        c.parentId,
        new Date(),
      ]);
      existingCommentIds.add(c.commentId);
      totalKomentarBaru++;
    }

    if (komentarBaru.length > 0) {
      console.log(`  ${video.title}: ${komentarBaru.length} komentar baru.`);
    }
  }

  if (currentPageToken) {
    await setState(sheets, VIDEO_CURSOR_KEY, currentPageToken);
    console.log(`Batch selesai (${totalKomentarBaru} komentar baru dari ${videos.length} video). Lanjut run berikutnya.`);
  } else {
    await setState(sheets, VIDEO_CURSOR_KEY, "");
    console.log(`Batch selesai (${totalKomentarBaru} komentar baru). Sudah sampai video terlama - siklus reset.`);
  }
}

module.exports = { runCommentsTracker };
