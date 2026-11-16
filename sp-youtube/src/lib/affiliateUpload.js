// Upload konten affiliate (tab "UPLOAD AFFILIATE NOV" di DASHBOARD KULTURAMA V1) ke channel YouTube SP.
//
// Beda dengan mainUpload.js (KALENDER KONTEN):
// - File diambil langsung pakai DRIVE FILE ID (bukan cari nama di satu folder), support Shared Drive.
// - Tiap run cuma upload sedikit (MAX_UPLOADS_PER_RUN) + ada batas harian (MAX_UPLOADS_PER_DAY),
//   supaya kuota YouTube gak kehabisan buat upload konten reguler SP.
// - Kena limit/kuota YouTube => run berhenti, baris TETAP "Belum" (antri), run berikutnya lanjut.
//   Status "Gagal" cuma buat error beneran (file gak ada, file rusak, dll).
// - Kolom status per akun: "STATUS <AKUN>" & "VIDEO ID <AKUN>" (default AKUN = SP).

const { CONFIG } = require("./config");
const { readSheetAsObjects, getHeaderColumnMap, setCellValue } = require("./sheetsHelper");
const { combineDateAndTime, toSheetDateString } = require("./dateUtils");
const { uploadVideo, updateVideoSchedule } = require("./youtubePublisher");

function intEnv(name, fallback) {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const AKUN = String(process.env.AFFILIATE_AKUN || "SP").trim().toUpperCase();

const AFF = {
  SPREADSHEET_ID: process.env.AFFILIATE_SPREADSHEET_ID || CONFIG.KALENDER_SPREADSHEET_ID,
  SHEET_NAME: process.env.AFFILIATE_SHEET_NAME || "UPLOAD AFFILIATE NOV",
  AKUN,

  MAX_UPLOADS_PER_RUN: intEnv("AFFILIATE_MAX_UPLOADS_PER_RUN", 1),
  MAX_UPLOADS_PER_DAY: intEnv("AFFILIATE_MAX_UPLOADS_PER_DAY", 8),
  AHEAD_DAYS: intEnv("AFFILIATE_AHEAD_DAYS", 3), // cuma upload baris yang jadwalnya <= N hari ke depan
  MIN_LEAD_MINUTES: 30, // jadwal tayang minimal 30 menit dari sekarang (biar YouTube sempat proses)

  COL_TANGGAL: "TANGGAL",
  COL_JAM: "JAM (WIB)",
  COL_JUDUL: "JUDUL",
  COL_BRAND: "BRAND",
  COL_FILE_ID: "DRIVE FILE ID",
  COL_CATATAN: "CATATAN",
  COL_STATUS: `STATUS ${AKUN}`,
  COL_VIDEO_ID: `VIDEO ID ${AKUN}`,

  ST_BELUM: "Belum",
  ST_SCHEDULED: "Scheduled",
  ST_TAYANG: "Tayang",
  ST_GAGAL: "Gagal",
  ST_SKIP: "Skip",
};

const LIMIT_REASONS = new Set([
  "quotaExceeded",
  "uploadLimitExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
]);

/** True kalau error-nya karena kuota/limit YouTube (=> antri, bukan Gagal). */
function isLimitError(e) {
  const reasons = [];
  const errs = (e && e.errors) || (e && e.response && e.response.data && e.response.data.error && e.response.data.error.errors) || [];
  for (const x of errs) if (x && x.reason) reasons.push(x.reason);
  if (reasons.some((r) => LIMIT_REASONS.has(r))) return true;
  return /quota exceeded|exceeded the number of videos|uploadLimitExceeded|quotaExceeded|rate limit/i.test(String((e && e.message) || e));
}

/** True kalau error-nya soal login/token (refresh token expired dll) => harus berhenti total. */
function isAuthError(e) {
  return /invalid_grant|invalid_client|unauthorized_client|Login Required|invalid credentials/i.test(String((e && e.message) || e));
}

function nowWibString() {
  return toSheetDateString(new Date(), CONFIG.TIMEZONE).slice(0, 16);
}

function todayWibKey() {
  return toSheetDateString(new Date(), CONFIG.TIMEZONE).slice(0, 10);
}

function formatJadwal(date) {
  return toSheetDateString(date, CONFIG.TIMEZONE).slice(0, 16);
}

function buildTitle(judul) {
  const suffix = " #Shorts";
  let base = String(judul || "").trim();
  const max = CONFIG.MAX_TITLE_LENGTH - suffix.length;
  if (base.length > max) base = base.substring(0, max).trim();
  return base + suffix;
}

function buildDescription(judul, brand) {
  const tags = ["#Shorts", "#ShoePolice"];
  const brandTag = String(brand || "").replace(/[^A-Za-z0-9]/g, "");
  if (brandTag) tags.unshift(`#${brandTag}`);
  const head = `${String(judul || "").trim()}\n\n${tags.join(" ")}`;
  const template = CONFIG.DESCRIPTION_TEMPLATE || "";
  const full = template ? `${head}\n\n${template}` : head;
  return full.substring(0, CONFIG.MAX_DESCRIPTION_LENGTH);
}

/** Download file Drive pakai ID (support Shared Drive). */
async function getDriveFileStream(drive, fileId) {
  const meta = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, size, trashed",
    supportsAllDrives: true,
  });
  if (meta.data.trashed) throw new Error(`File Drive ${fileId} ada di Trash.`);
  if (!String(meta.data.mimeType || "").startsWith("video/")) {
    throw new Error(`File Drive ${fileId} bukan video (${meta.data.mimeType}).`);
  }
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  return { stream: res.data, name: meta.data.name, size: Number(meta.data.size || 0) };
}

async function writeCell(sheets, headerMap, rowNumber, colName, value) {
  const col = headerMap[colName];
  if (!col) throw new Error(`Kolom '${colName}' tidak ada di tab '${AFF.SHEET_NAME}'.`);
  await setCellValue(sheets, AFF.SPREADSHEET_ID, AFF.SHEET_NAME, rowNumber, col, value);
}

async function writeNoteIfChanged(sheets, headerMap, row, note) {
  const text = `[${AKUN}] ${note}`;
  if (String(row[AFF.COL_CATATAN] || "").trim() === text) return;
  await writeCell(sheets, headerMap, row._rowNumber, AFF.COL_CATATAN, text);
  row[AFF.COL_CATATAN] = text;
}

function jadwalOf(row) {
  return combineDateAndTime(row[AFF.COL_TANGGAL], row[AFF.COL_JAM], CONFIG.TIMEZONE);
}

/** 1) Sinkron status video yang sudah di-upload: Scheduled -> Tayang, + reschedule kalau jam di sheet diubah. */
async function syncScheduledRows(rows, headerMap, { sheets, youtube }) {
  const scheduled = rows.filter(
    (r) => String(r[AFF.COL_STATUS] || "").trim() === AFF.ST_SCHEDULED && String(r[AFF.COL_VIDEO_ID] || "").trim()
  );
  if (scheduled.length === 0) return;

  const byId = new Map(scheduled.map((r) => [String(r[AFF.COL_VIDEO_ID]).trim(), r]));
  const ids = [...byId.keys()];
  const now = Date.now();

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await youtube.videos.list({ part: ["status"], id: chunk });
    const found = new Map((res.data.items || []).map((v) => [v.id, v.status]));

    for (const id of chunk) {
      const row = byId.get(id);
      const status = found.get(id);
      if (!status) {
        await writeNoteIfChanged(sheets, headerMap, row, `Video ${id} tidak ditemukan di YouTube (dihapus manual?).`);
        continue;
      }
      if (status.privacyStatus === "public") {
        await writeCell(sheets, headerMap, row._rowNumber, AFF.COL_STATUS, AFF.ST_TAYANG);
        continue;
      }

      const expected = jadwalOf(row);
      if (!expected) continue;
      const currentMs = status.publishAt ? new Date(status.publishAt).getTime() : null;
      const diffMs = currentMs === null ? Infinity : Math.abs(currentMs - expected.getTime());
      if (diffMs <= 60 * 1000) continue; // jadwal masih sama

      if (expected.getTime() > now + AFF.MIN_LEAD_MINUTES * 60 * 1000) {
        await updateVideoSchedule(youtube, id, expected);
        await writeNoteIfChanged(sheets, headerMap, row, `Reschedule ${nowWibString()} -> tayang ${formatJadwal(expected)} WIB.`);
        console.log(`  Reschedule baris ${row._rowNumber} (${id}) -> ${expected.toISOString()}`);
      } else {
        await writeNoteIfChanged(sheets, headerMap, row, `Jam di sheet sudah lewat/terlalu mepet, jadwal YouTube gak diubah. Cek manual.`);
      }
    }
  }
}

/** 2) Upload baris "Belum" yang jadwalnya paling dekat. */
async function uploadPendingRows(rows, headerMap, { sheets, drive, youtube }) {
  const now = Date.now();
  const minTime = now + AFF.MIN_LEAD_MINUTES * 60 * 1000;
  const maxTime = now + AFF.AHEAD_DAYS * 24 * 60 * 60 * 1000;
  const todayKey = todayWibKey();

  const uploadedToday = rows.filter((r) =>
    String(r[AFF.COL_CATATAN] || "").startsWith(`[${AKUN}] Upload sukses ${todayKey}`)
  ).length;
  let quotaLeft = Math.max(0, AFF.MAX_UPLOADS_PER_DAY - uploadedToday);
  console.log(`Upload ${AKUN} hari ini: ${uploadedToday}/${AFF.MAX_UPLOADS_PER_DAY}.`);

  const pending = [];
  for (const row of rows) {
    const status = String(row[AFF.COL_STATUS] || "").trim();
    if (status !== AFF.ST_BELUM && status !== "") continue;
    if (!String(row[AFF.COL_JUDUL] || "").trim()) continue;
    if (String(row[AFF.COL_VIDEO_ID] || "").trim()) continue; // udah punya video, jangan dobel

    const jadwal = jadwalOf(row);
    if (!jadwal) {
      await writeNoteIfChanged(sheets, headerMap, row, `TANGGAL/JAM tidak valid.`);
      continue;
    }
    if (jadwal.getTime() < minTime) {
      // Jadwal lewat: JANGAN langsung publish public (bisa numpuk). Biarin user geser jadwalnya.
      await writeNoteIfChanged(sheets, headerMap, row, `Jadwal ${formatJadwal(jadwal)} WIB sudah lewat - geser TANGGAL/JAM kalau mau tetap diupload.`);
      continue;
    }
    if (jadwal.getTime() > maxTime) continue; // belum waktunya, nanti aja
    pending.push({ row, jadwal });
  }
  pending.sort((a, b) => a.jadwal - b.jadwal);
  console.log(`${pending.length} baris siap upload (window ${AFF.AHEAD_DAYS} hari).`);

  let done = 0;
  for (const { row, jadwal } of pending) {
    if (done >= AFF.MAX_UPLOADS_PER_RUN) break;
    if (quotaLeft <= 0) {
      console.log(`Batas harian ${AFF.MAX_UPLOADS_PER_DAY} upload tercapai, lanjut besok.`);
      break;
    }

    const judul = String(row[AFF.COL_JUDUL]).trim();
    const fileId = String(row[AFF.COL_FILE_ID] || "").trim();
    console.log(`Upload baris ${row._rowNumber}: ${judul} (tayang ${jadwal.toISOString()})`);

    try {
      if (!fileId) throw new Error("DRIVE FILE ID kosong.");
      const file = await getDriveFileStream(drive, fileId);
      const uploaded = await uploadVideo(youtube, {
        title: buildTitle(judul),
        description: buildDescription(judul, row[AFF.COL_BRAND]),
        fileStream: file.stream,
        privacyStatus: "private",
        publishAt: jadwal.toISOString(),
      });

      await writeCell(sheets, headerMap, row._rowNumber, AFF.COL_VIDEO_ID, uploaded.id);
      await writeCell(sheets, headerMap, row._rowNumber, AFF.COL_STATUS, AFF.ST_SCHEDULED);
      await writeCell(
        sheets,
        headerMap,
        row._rowNumber,
        AFF.COL_CATATAN,
        `[${AKUN}] Upload sukses ${nowWibString()} -> tayang ${formatJadwal(jadwal)} WIB.`
      );
      console.log(`  BERHASIL: ${uploaded.id}`);
      done++;
      quotaLeft--;
    } catch (e) {
      if (isAuthError(e)) throw e; // token bermasalah: stop total biar workflow merah & ketahuan
      if (isLimitError(e)) {
        await writeNoteIfChanged(sheets, headerMap, row, `Antri: kena limit/kuota YouTube (${nowWibString()}). Otomatis dicoba lagi.`);
        console.log(`  Kena limit YouTube, berhenti dulu: ${e.message}`);
        break;
      }
      await writeCell(sheets, headerMap, row._rowNumber, AFF.COL_STATUS, AFF.ST_GAGAL);
      await writeCell(sheets, headerMap, row._rowNumber, AFF.COL_CATATAN, `[${AKUN}] Error upload ${nowWibString()}: ${String(e.message || e).slice(0, 300)}`);
      console.log(`  GAGAL baris ${row._rowNumber}: ${e.message}`);
    }
  }
  console.log(`${done} video di-upload di run ini.`);
}

async function runAffiliateUpload({ sheets, drive, youtube }) {
  console.log(`Tab: ${AFF.SHEET_NAME} | Akun: ${AKUN}`);
  const headerMap = await getHeaderColumnMap(sheets, AFF.SPREADSHEET_ID, AFF.SHEET_NAME);
  for (const col of [AFF.COL_TANGGAL, AFF.COL_JAM, AFF.COL_JUDUL, AFF.COL_FILE_ID, AFF.COL_STATUS, AFF.COL_VIDEO_ID, AFF.COL_CATATAN]) {
    if (!headerMap[col]) throw new Error(`Kolom '${col}' tidak ditemukan di tab '${AFF.SHEET_NAME}'.`);
  }

  const { rows } = await readSheetAsObjects(sheets, AFF.SPREADSHEET_ID, AFF.SHEET_NAME);
  await syncScheduledRows(rows, headerMap, { sheets, youtube });
  await uploadPendingRows(rows, headerMap, { sheets, drive, youtube });
  console.log("Selesai proses Affiliate Upload.");
}

module.exports = { runAffiliateUpload, isLimitError, isAuthError, buildTitle, buildDescription };
