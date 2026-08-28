const { CONFIG } = require("./config");
const { callGraphApi } = require("./instagramPublisher");
const { getIgAccessToken } = require("./config");
const { readSheetAsObjects, ensureSheetWithHeaders, upsertRowByKey, sortByColumnDesc, applyDateFormats, getHeaderColumnMap } = require("./sheetsHelper");
const { getState, setState, deleteState } = require("./stateStore");
const { parseFlexibleDate } = require("./dateUtils");

const POST_INSIGHT_HEADERS = [
  "POST ID IG", "SUMBER", "JUDUL KONTEN", "JENIS KONTEN", "TANGGAL UPLOAD",
  "LIKES", "COMMENTS", "REACH", "VIEWS", "SAVED", "SHARES", "TOTAL INTERACTIONS",
  "LINK POST", "TERAKHIR DIUPDATE",
];

const ACCOUNT_INSIGHT_HEADERS = ["TANGGAL", "REACH", "VIEWS", "ACCOUNTS ENGAGED", "TOTAL INTERACTIONS", "FOLLOWERS"];

async function fetchSingleMetric(objectId, metric, extraParams, accessToken) {
  try {
    const params = { metric, ...(extraParams || {}) };
    if (metric !== "reach" && params.period && !params.metric_type) {
      params.metric_type = "total_value";
    }

    const result = await callGraphApi(`${objectId}/insights`, "get", params, accessToken);
    if (!result.data || result.data.length === 0) return null;
    const entry = result.data[0];

    if (entry.total_value && entry.total_value.value !== undefined) return entry.total_value.value;
    if (entry.values && entry.values.length > 0) return entry.values[entry.values.length - 1].value;
    return null;
  } catch (err) {
    console.log(`    (info) Metric '${metric}' tidak tersedia untuk ${objectId}: ${err.message}`);
    return null;
  }
}

async function fetchMediaPage(accountId, pageUrl, accessToken) {
  let json;
  if (pageUrl) {
    const response = await fetch(pageUrl);
    json = await response.json();
    if (json.error) throw new Error(`Graph API error (pagination): ${json.error.message}`);
  } else {
    json = await callGraphApi(
      `${accountId}/media`,
      "get",
      { fields: "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count", limit: 50 },
      accessToken
    );
  }
  return { data: json.data || [], nextUrl: json.paging && json.paging.next ? json.paging.next : null };
}

async function fetchAllMediaCapped(accountId, accessToken, maxPages) {
  let allMedia = [];
  let pageUrl = null;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const page = await fetchMediaPage(accountId, pageUrl, accessToken);
    allMedia = allMedia.concat(page.data);
    pageCount++;
    if (page.nextUrl) pageUrl = page.nextUrl;
    else break;
  }

  return allMedia;
}

async function getSheetContextMap(sheets) {
  const headerMap = await getHeaderColumnMap(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME);
  const postIdCol = headerMap[CONFIG.POST_ID_COLUMN];

  if (!postIdCol) {
    console.log(`  (warning) Kolom '${CONFIG.POST_ID_COLUMN}' belum ada di sheet - konteks dari sheet dilewati.`);
    return {};
  }

  const { rows } = await readSheetAsObjects(sheets, CONFIG.KALENDER_SPREADSHEET_ID, CONFIG.SHEET_NAME);
  const map = {};
  for (const row of rows) {
    const akun = String(row["AKUN"] || "").trim().toUpperCase();
    const postId = String(row[CONFIG.POST_ID_COLUMN] || "").trim();
    if (akun === "SP" && postId !== "") {
      map[postId] = { judulKonten: row["JUDUL KONTEN"], jenisKonten: row["JENIS KONTEN"], tanggal: row["TANGGAL"] };
    }
  }
  return map;
}

function summarizeCaption(caption) {
  if (!caption) return "(tanpa caption)";
  const firstLine = caption.split("\n")[0];
  return firstLine.length > 60 ? firstLine.substring(0, 60) + "..." : firstLine;
}

async function processSingleMediaInsight(media, contextMap, accessToken, sheets) {
  const postId = media.id;
  const context = contextMap[postId];
  const sumber = context ? "Sistem Otomatis" : "Manual/Lainnya";
  const judul = context ? context.judulKonten : summarizeCaption(media.caption);
  const jenis = context ? context.jenisKonten : media.media_product_type || media.media_type || "";
  const tanggalUpload = media.timestamp;

  console.log(`  Insight: ${judul} [${sumber}]`);

  const metricValues = {};
  for (const metric of CONFIG.MEDIA_METRICS) {
    metricValues[metric] = await fetchSingleMetric(postId, metric, null, accessToken);
  }

  const allMetricsNull = CONFIG.MEDIA_METRICS.every((metric) => metricValues[metric] === null);
  if (allMetricsNull) {
    console.log(`  (skip) Post ${postId} tidak bisa diakses (kemungkinan di-archive/dihapus) - dilewati.`);
    return;
  }

  const now = new Date();

  const rowData = [
    postId, sumber, judul, jenis, parseFlexibleDate(tanggalUpload),
    media.like_count !== undefined ? media.like_count : null,
    media.comments_count !== undefined ? media.comments_count : null,
    metricValues.reach, metricValues.views, metricValues.saved,
    metricValues.shares, metricValues.total_interactions,
    media.permalink || "", now,
  ];

  const writtenRow = await upsertRowByKey(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_POST_SHEET_NAME, "POST ID IG", postId, rowData);

  const insightsHeaderMap = await getHeaderColumnMap(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_POST_SHEET_NAME);
  await applyDateFormats(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_POST_SHEET_NAME, writtenRow, [
    { colNumber: insightsHeaderMap["TANGGAL UPLOAD"], pattern: "dd/mm/yyyy hh:mm" },
    { colNumber: insightsHeaderMap["TERAKHIR DIUPDATE"], pattern: "dd/mm/yyyy hh:mm" },
  ]);
}

async function runPostInsights(sheets) {
  const accountId = CONFIG.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = getIgAccessToken();

  const allMedia = await fetchAllMediaCapped(accountId, accessToken, CONFIG.MAX_INSIGHTS_PAGES);
  console.log(`Total post ditemukan (dibatasi ${CONFIG.MAX_INSIGHTS_PAGES} halaman): ${allMedia.length}`);
  if (allMedia.length === 0) return;

  const contextMap = await getSheetContextMap(sheets);
  await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_POST_SHEET_NAME, POST_INSIGHT_HEADERS);

  for (const media of allMedia) {
    await new Promise((r) => setTimeout(r, 2500));
    await processSingleMediaInsight(media, contextMap, accessToken, sheets);
  }

  await sortByColumnDesc(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_POST_SHEET_NAME, "TANGGAL UPLOAD");
  console.log(`Selesai update insight per-post (${allMedia.length} post).`);
}

async function backfillAllPosts(sheets) {
  const accountId = CONFIG.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = getIgAccessToken();
  const cursorKey = "SP_BACKFILL_CURSOR";

  let nextUrl = await getState(sheets, cursorKey);
  console.log("=== BACKFILL SEMUA POST (SP) ===");
  console.log(nextUrl ? "Melanjutkan dari progress run sebelumnya..." : "Mulai dari awal (post TERBARU dulu, mundur ke yang PALING LAMA).");

  await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_POST_SHEET_NAME, POST_INSIGHT_HEADERS);
  const contextMap = await getSheetContextMap(sheets);

  let totalProcessed = 0;
  let pageCount = 0;
  let isFirstFetch = !nextUrl;

  while (true) {
    let json;
    if (isFirstFetch) {
      json = await callGraphApi(
        `${accountId}/media`,
        "get",
        { fields: "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count", limit: 25 },
        accessToken
      );
    } else {
      const response = await fetch(nextUrl);
      json = await response.json();
      if (json.error) throw new Error(`Graph API error (pagination): ${json.error.message}`);
    }
    isFirstFetch = false;
    pageCount++;

    const mediaList = json.data || [];
    console.log(`Halaman ${pageCount}: ${mediaList.length} post.`);

    for (const media of mediaList) {
      await new Promise((r) => setTimeout(r, 2500));
      await processSingleMediaInsight(media, contextMap, accessToken, sheets);
      totalProcessed++;
    }

    if (json.paging && json.paging.next) {
      nextUrl = json.paging.next;
      await setState(sheets, cursorKey, nextUrl);
    } else {
      await deleteState(sheets, cursorKey);
      break;
    }
  }

  await sortByColumnDesc(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_POST_SHEET_NAME, "TANGGAL UPLOAD");
  console.log(`=== BACKFILL SELESAI TOTAL - ${totalProcessed} post diproses. ===`);
}

async function fetchFollowersCount(accountId, accessToken) {
  try {
    const result = await callGraphApi(accountId, "get", { fields: "followers_count" }, accessToken);
    return result.followers_count !== undefined ? result.followers_count : null;
  } catch (err) {
    console.log(`  (info) Gagal ambil followers_count: ${err.message}`);
    return null;
  }
}

async function runAccountInsights(sheets) {
  await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, ACCOUNT_INSIGHT_HEADERS);

  const accountId = CONFIG.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = getIgAccessToken();
  const values = {};

  for (const metric of CONFIG.ACCOUNT_METRICS) {
    values[metric] = await fetchSingleMetric(accountId, metric, { period: "day" }, accessToken);
  }

  const followersCount = await fetchFollowersCount(accountId, accessToken);
  const today = new Date();

  const { appendRow } = require("./sheetsHelper");
  await appendRow(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, [
    today, values.reach, values.views, values.accounts_engaged, values.total_interactions, followersCount,
  ]);

  const { readSheetAsObjects: readRows } = require("./sheetsHelper");
  const { rows } = await readRows(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME);
  const lastRow = rows.length + 1;
  const accountHeaderMap = await getHeaderColumnMap(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME);
  await applyDateFormats(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, lastRow, [
    { colNumber: accountHeaderMap["TANGGAL"], pattern: "dd/mm/yyyy" },
  ]);

  await sortByColumnDesc(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, "TANGGAL");

  console.log(`Insight akun hari ini ditambahkan. Followers: ${followersCount !== null ? followersCount : "(gagal diambil)"}`);
}

async function backfillAccountInsights(sheets, daysBack = 30) {
  const accountId = CONFIG.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = getIgAccessToken();
  const now = new Date();
  const untilUnix = Math.floor(now.getTime() / 1000);
  const sinceDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const sinceUnix = Math.floor(sinceDate.getTime() / 1000);

  console.log(`=== BACKFILL insight akun: ${daysBack} hari ke belakang ===`);

  const dateMap = {};

  try {
    const result = await callGraphApi(
      `${accountId}/insights`,
      "get",
      { metric: "reach", period: "day", metric_type: "time_series", since: sinceUnix, until: untilUnix },
      accessToken
    );

    if (result.data && result.data.length > 0) {
      const values = result.data[0].values || [];
      for (const point of values) {
        if (!point.end_time) continue;
        const pointDate = new Date(point.end_time);
        const dateKey = pointDate.toISOString().slice(0, 10);
        dateMap[dateKey] = dateMap[dateKey] || {};
        dateMap[dateKey].reach = point.value;
      }
      console.log(`  Metric 'reach': ${values.length} titik data ditemukan.`);
    }
  } catch (err) {
    console.log(`  (info) Gagal tarik histori 'reach': ${err.message}`);
  }

  const dateKeys = Object.keys(dateMap).sort();
  if (dateKeys.length === 0) {
    console.log("Tidak ada data historis yang berhasil ditarik sama sekali.");
    return;
  }

  await ensureSheetWithHeaders(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, ACCOUNT_INSIGHT_HEADERS);

  let addedCount = 0;
  let updatedCount = 0;

  for (const dateKey of dateKeys) {
    const values = dateMap[dateKey];
    const dateObj = new Date(`${dateKey}T00:00:00Z`);

    const rowData = [
      dateObj,
      values.reach !== undefined ? values.reach : null,
      null, null, null,
      null,
    ];

    const { rows: existingRows } = await readSheetAsObjects(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME);
    const existing = existingRows.find((r) => {
      const cellDate = parseFlexibleDate(r["TANGGAL"]);
      return cellDate && cellDate.toISOString().slice(0, 10) === dateKey;
    });

    if (existing) {
      const { setRowValues } = require("./sheetsHelper");
      await setRowValues(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, existing._rowNumber, rowData);
      updatedCount++;
    } else {
      const { appendRow } = require("./sheetsHelper");
      await appendRow(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, rowData);
      addedCount++;
    }
  }

  await sortByColumnDesc(sheets, CONFIG.INSIGHTS_SPREADSHEET_ID, CONFIG.INSIGHTS_ACCOUNT_SHEET_NAME, "TANGGAL");
  console.log(`=== BACKFILL selesai: ${addedCount} baris baru, ${updatedCount} baris diperbarui ===`);
}

module.exports = { runPostInsights, backfillAllPosts, runAccountInsights, backfillAccountInsights };
