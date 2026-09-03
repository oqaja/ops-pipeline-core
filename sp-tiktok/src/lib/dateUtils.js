// Parser TANGGAL + JAM dari KALENDER KONTEN.
//
// getRawGrid() baca sheet dengan valueRenderOption default (FORMATTED_VALUE),
// jadi sel datang sebagai STRING tampilan sesuai format/locale sheet - bisa
// macam-macam: "2026-09-03", "03/09/2026", "3 Sep 2026", "03-Agu-2026", dst,
// dan jam bisa "14.00" atau "14:00". Parser ini sengaja dibikin toleran (setara
// combineDateAndTime di sp-youtube) supaya baris yang valid di platform lain
// tidak diam-diam ke-skip di TikTok.

const BULAN_ID = {
  jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5,
  jul: 6, agu: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11,
};

const SHEETS_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isSheetsSerial(value) {
  return typeof value === "number" && isFinite(value);
}

/** Serial number Google Sheets -> { year, month(0-11), day } (bagian tanggalnya saja). */
function serialToDateParts(serial) {
  const d = new Date(SHEETS_EPOCH_UTC_MS + Math.floor(serial) * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/** Parse berbagai format tanggal jadi { year, month(0-11), day }, atau null. */
function parseTanggal(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return { year: value.getFullYear(), month: value.getMonth(), day: value.getDate() };
  }
  if (isSheetsSerial(value)) return serialToDateParts(value);

  const str = String(value == null ? "" : value).trim();
  if (!str) return null;

  // ISO: 2026-09-03 atau 2026-09-03T10:00:00
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { year: +m[1], month: +m[2] - 1, day: +m[3] };

  // Ada nama bulan: "3 Sep 2026", "03-Agu-2026", "3/Sep/2026" (Indonesia & Inggris)
  m = str.match(/^(\d{1,2})[\s\-/]+([A-Za-z]{3,})[\s\-/]+(\d{4})$/);
  if (m) {
    const month = BULAN_ID[m[2].toLowerCase().slice(0, 3)];
    if (month === undefined) return null;
    return { year: +m[3], month, day: +m[1] };
  }

  // Numerik urutan Indonesia: DD/MM/YYYY atau DD-MM-YYYY
  m = str.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (m) return { year: +m[3], month: +m[2] - 1, day: +m[1] };

  // Fallback: biar Date yang nebak (mis. "Sep 3, 2026")
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  }
  return null;
}

/** Parse jam jadi { hour, minute }, atau null. Terima "14.00", "14:00", "9:5", serial fraction. */
function parseJam(value) {
  if (isSheetsSerial(value)) {
    const frac = value - Math.floor(value);
    const totalMinutes = Math.round(frac * 24 * 60);
    return { hour: Math.floor(totalMinutes / 60) % 24, minute: totalMinutes % 60 };
  }

  const str = String(value == null ? "" : value).trim().replace(/\./g, ":");
  const parts = str.split(":");
  if (parts.length < 2) return null;

  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

/**
 * Gabung TANGGAL + JAM (WIB / UTC+7) jadi satu Date UTC, atau null kalau salah
 * satu tidak bisa diparse.
 */
function gabungkanTanggalJam(tanggalCell, jamCell) {
  if (tanggalCell == null || tanggalCell === "" || jamCell == null || jamCell === "") {
    return null;
  }

  const tgl = parseTanggal(tanggalCell);
  if (!tgl) return null;

  const jam = parseJam(jamCell);
  if (!jam) return null;

  if ([tgl.year, tgl.month, tgl.day, jam.hour, jam.minute].some((n) => isNaN(n))) return null;
  if (tgl.month < 0 || tgl.month > 11 || tgl.day < 1 || tgl.day > 31) return null;
  if (tgl.year < 2000 || tgl.year > 2100) return null;

  return new Date(Date.UTC(tgl.year, tgl.month, tgl.day, jam.hour - 7, jam.minute, 0));
}

module.exports = { gabungkanTanggalJam };

/** Format Date jadi "YYYY-MM-DD HH:mm:ss" di timezone Asia/Jakarta (WIB). */
function toSheetDateString(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

module.exports.toSheetDateString = toSheetDateString;
