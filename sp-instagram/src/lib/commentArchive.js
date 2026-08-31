/**
 * commentArchive.js
 * Port dari SP_CommentArchive.gs - arsip/backup semua komentar Instagram SP.
 * Sama seperti insightsTracker, backfill di sini jalan sampai BENERAN
 * SELESAI dalam 1x run (GitHub Actions job punya jatah waktu jauh lebih
 * panjang dari Apps Script) - cursor tetap disimpan (stateStore) buat
 * jaga-jaga run keputus.
 */

const { CONFIG, getIgAccessToken } = require("./config");
const { callGraphApi } = require("./instagramPublisher");
const { ensureSheetWithHeaders, upsertRowByKey } = require("./sheetsHelper");
const { getState, setState, deleteState } = require("./stateStore");

const COMMENT_HEADERS = ["COMMENT ID", "POST ID", "USERNAME", "KOMENTAR", "LIKE COUNT", "TANGGAL KOMENTAR"];
const CURSOR_KEY = "SP_COMMENT_ARCHIVE_CURSOR";

/** Setara spFetchCommentsPage_. */
async function fetchCommentsPage(postId, pageUrl, accessToken) {
  let json;
  if (pageUrl) {
    const response = await fetch(pageUrl);
    json = await response.json();
    if (json.error) throw new Error(`Graph API error (pagination komentar): ${json.error.message}`);
  } else {
    json = await callGraphApi(`${postId}/comments`, "get", { fields: "id,text,username,timestamp,like_count", limit: 50 }, accessToken);
  }
  return { comments: json.data || [], nextUrl: json.paging && json.paging.next ? json.paging.next : null };
}

/** Setara spFetchPostIdsPage_. */
async function fetchPostIdsPage(accountId, pageUrl, accessToken) {
  let json;
  if (pageUrl) {
    const response = await fetch(pageUrl);
    json = await response.json();
    if (json.error) throw new Error(`Graph API error (pagination post): ${json.error.message}`);
  } else {
    json = await callGraphApi(`${accountId}/media`, "get", { fields: "id", limit: 25 }, accessToken);
  }
  return { postIds: (json.data || []).map((m) => m.id), nextUrl: json.paging && json.paging.next ? json.paging.next : null };
}

async function saveComment(sheets, comment, postId) {
  const rowData = [
    comment.id, postId, comment.username || "", comment.text || "",
    comment.like_count || 0, comment.timestamp ? new Date(comment.timestamp) : "",
  ];
  await upsertRowByKey(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.COMMENT_ARCHIVE_SHEET_NAME, "COMMENT ID", comment.id, rowData);
}

/**
 * Setara spArchiveAllComments() - backfill SEMUA komentar dari SEMUA post,
 * mundur sampai post paling lama, auto-resume via cursor di stateStore.
 */
async function archiveAllComments(sheets) {
  const accountId = CONFIG.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = getIgAccessToken();

  await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.COMMENT_ARCHIVE_SHEET_NAME, COMMENT_HEADERS);

  const savedCursorRaw = await getState(sheets, CURSOR_KEY);
  let cursor = savedCursorRaw
    ? JSON.parse(savedCursorRaw)
    : { postsNextUrl: null, pendingPostIds: [], currentPostId: null, commentsPageUrl: null };

  console.log("=== ARSIP KOMENTAR (SP) ===");
  console.log(savedCursorRaw ? "Melanjutkan dari progress run sebelumnya..." : "Mulai dari awal (post terbaru dulu).");

  let totalComments = 0;
  let totalPosts = 0;

  while (true) {
    if (!cursor.currentPostId && cursor.pendingPostIds.length === 0) {
      const postsPage = await fetchPostIdsPage(accountId, cursor.postsNextUrl, accessToken);

      if (postsPage.postIds.length === 0 && !postsPage.nextUrl) {
        await deleteState(sheets, CURSOR_KEY);
        console.log(`=== ARSIP KOMENTAR SELESAI TOTAL - ${totalComments} komentar dari ${totalPosts} post. ===`);
        return;
      }

      cursor.pendingPostIds = postsPage.postIds;
      cursor.postsNextUrl = postsPage.nextUrl;
      if (cursor.pendingPostIds.length === 0) continue;
    }

    if (!cursor.currentPostId) {
      cursor.currentPostId = cursor.pendingPostIds.shift();
      cursor.commentsPageUrl = null;
    }

    let commentsPage;
    try {
      commentsPage = await fetchCommentsPage(cursor.currentPostId, cursor.commentsPageUrl, accessToken);
    } catch (err) {
      console.log(`  (info) Gagal ambil komentar post ${cursor.currentPostId} (dilewatkan): ${err.message}`);
      cursor.currentPostId = null;
      cursor.commentsPageUrl = null;
      await setState(sheets, CURSOR_KEY, JSON.stringify(cursor));
      continue;
    }

    for (const c of commentsPage.comments) {
      await saveComment(sheets, c, cursor.currentPostId);
    }
    totalComments += commentsPage.comments.length;

    if (commentsPage.nextUrl) {
      cursor.commentsPageUrl = commentsPage.nextUrl;
    } else {
      cursor.currentPostId = null;
      cursor.commentsPageUrl = null;
      totalPosts++;
    }

    await setState(sheets, CURSOR_KEY, JSON.stringify(cursor));
  }
}

/**
 * Setara spArchiveRecentComments() - dipanggil harian, cuma cek post dalam
 * N hari terakhir (media Instagram terurut terbaru dulu, jadi begitu ketemu
 * 1 post yang lebih lama dari cutoff, aman langsung berhenti).
 */
async function archiveRecentComments(sheets, daysBack = 30) {
  const accountId = CONFIG.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = getIgAccessToken();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.COMMENT_ARCHIVE_SHEET_NAME, COMMENT_HEADERS);

  console.log(`=== ARSIP KOMENTAR HARIAN (SP) - post ${daysBack} hari terakhir ===`);

  let nextUrl = null;
  let isFirstFetch = true;
  let totalComments = 0;
  let totalPosts = 0;
  let stoppedAtCutoff = false;

  while (!stoppedAtCutoff) {
    let json;
    if (isFirstFetch) {
      json = await callGraphApi(`${accountId}/media`, "get", { fields: "id,timestamp", limit: 25 }, accessToken);
    } else {
      const response = await fetch(nextUrl);
      json = await response.json();
      if (json.error) throw new Error(`Graph API error (pagination post): ${json.error.message}`);
    }
    isFirstFetch = false;

    const mediaList = json.data || [];

    for (const media of mediaList) {
      const postDate = new Date(media.timestamp);
      if (postDate < cutoffDate) {
        stoppedAtCutoff = true;
        break;
      }

      let pageUrl = null;
      do {
        const commentsPage = await fetchCommentsPage(media.id, pageUrl, accessToken);
        for (const c of commentsPage.comments) await saveComment(sheets, c, media.id);
        totalComments += commentsPage.comments.length;
        pageUrl = commentsPage.nextUrl;
      } while (pageUrl);

      totalPosts++;
    }

    if (!stoppedAtCutoff && json.paging && json.paging.next) {
      nextUrl = json.paging.next;
    } else {
      break;
    }
  }

  console.log(`Selesai: ${totalComments} komentar dari ${totalPosts} post (${daysBack} hari terakhir).`);
}

module.exports = { archiveAllComments, archiveRecentComments };
