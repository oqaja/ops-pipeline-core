/**
 * dateUtils.js
 * Sheets API (dengan dateTimeRenderOption=SERIAL_NUMBER, yang dipakai
 * sheetsHelper.readSheetAsObjects) mengembalikan cell tanggal/jam sebagai
 * ANGKA SERIAL (hari sejak 1899-12-30), bukan objek Date seperti di Apps
 * Script. Helper di sini menggantikan behavior Object.prototype.toString
 * === "[object Date]" checks dari kode Apps Script asli.
 */

const SHEETS_EPOCH_UTC_MS = Date.UTC(1899, 11, 30); // 30 Des 1899, sesuai epoch Google Sheets
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Nama bulan (Indonesia + Inggris, 3 huruf pertama) -> index 0-11. Kolom TANGGAL di
// "KALENDER KONTEN" sering berupa teks seperti "31-Agu-2026" atau "31 Agu 2026", bukan
// tanggal asli - tanpa ini parseInt("Agu") = NaN dan row NSP/SP tidak pernah kedeteksi.
const BULAN_INDEX = {
  jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6,
  agu: 7, aug: 7, agt: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11,
};

/** Ubah token bulan (angka "1".."12" atau nama "Agu"/"Sep"/"Aug") jadi index 0-11. NaN kalau gagal. */
function parseMonthToken(token) {
  const s = String(token == null ? "" : token).trim().toLowerCase();
  if (s === "") return NaN;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n >= 1 && n <= 12 ? n - 1 : NaN;
  }
  const key = s.slice(0, 3);
  return Object.prototype.hasOwnProperty.call(BULAN_INDEX, key) ? BULAN_INDEX[key] : NaN;
}

function isSheetsSerialNumber(value) {
  return typeof value === "number" && !isNaN(value);
}

/** Ubah serial number Sheets jadi objek Date (UTC-based, lihat catatan di bawah). */
function serialToDate(serial) {
  return new Date(SHEETS_EPOCH_UTC_MS + serial * MS_PER_DAY);
}

/** Ambil "menit sejak tengah malam" dari serial number (bagian pecahan hari). */
function serialToMinutesOfDay(serial) {
  const fraction = serial - Math.floor(serial);
  return Math.round(fraction * 24 * 60);
}

/**
 * Bandingkan tanggal di sheet (serial number ATAU string "dd/mm/yyyy")
 * dengan tanggal hari ini, di timezone tertentu. Setara spIsSameDate_.
 * @param {number|string} value
 * @param {Date} now
 * @param {string} timezone - misal "Asia/Jakarta"
 */
function isSameDateInTimezone(value, now, timezone) {
  let y, m, d;

  if (isSheetsSerialNumber(value)) {
    const date = serialToDate(value);
    y = date.getUTCFullYear();
    m = date.getUTCMonth();
    d = date.getUTCDate();
  } else if (typeof value === "string" && value.trim() !== "") {
    // Terima "dd/mm/yyyy", "dd-mm-yyyy", "dd-Agu-yyyy", "dd Agu yyyy" (+ opsional " HH:mm" di belakang).
    const parts = value.trim().split(/[\/\-\s]+/).filter(Boolean);
    if (parts.length < 3) return false;
    d = parseInt(parts[0], 10);
    m = parseMonthToken(parts[1]);
    y = parseInt(parts[2], 10);
    if (isNaN(d) || isNaN(m) || isNaN(y)) return false;
  } else {
    return false;
  }

  const nowParts = getDatePartsInTimezone(now, timezone);
  return y === nowParts.year && m === nowParts.month && d === nowParts.day;
}

/** Ambil { year, month(0-indexed), day, hour, minute } "now" pada suatu timezone. */
function getDatePartsInTimezone(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = {};
  formatter.formatToParts(date).forEach((p) => {
    if (p.type !== "literal") parts[p.type] = parseInt(p.value, 10);
  });
  return {
    year: parts.year,
    month: parts.month - 1,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
  };
}

/** Setara spToMinutesOfDay_: ubah cell JAM UP (serial number atau string "19:00") jadi menit. */
function toMinutesOfDay(value) {
  if (isSheetsSerialNumber(value)) {
    return serialToMinutesOfDay(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const cleaned = value.trim().replace(".", ":");
    const parts = cleaned.split(":");
    if (parts.length >= 2) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      if (!isNaN(hours) && !isNaN(minutes)) return hours * 60 + minutes;
    }
  }
  return null;
}

/** Menit sekarang (0-1439) pada suatu timezone. */
function nowMinutesInTimezone(timezone) {
  const parts = getDatePartsInTimezone(new Date(), timezone);
  return parts.hour * 60 + parts.minute;
}

/**
 * Parse tanggal dari berbagai bentuk (serial Sheets, ISO 8601 dari Instagram,
 * atau string "dd/MM/yyyy[ HH:mm]") jadi objek Date JS asli. Setara spParseUploadDate_.
 */
function parseFlexibleDate(value) {
  if (value === null || value === undefined || value === "") return null;

  if (isSheetsSerialNumber(value)) return serialToDate(value);

  const strValue = String(value).trim();

  if (strValue.indexOf("T") !== -1 && /^\d{4}-\d{2}-\d{2}/.test(strValue)) {
    const isoDate = new Date(strValue);
    return isNaN(isoDate.getTime()) ? null : isoDate;
  }

  // Pisahkan bagian jam ("HH:mm" / "HH.mm") di akhir string kalau ada.
  let hours = 0;
  let minutes = 0;
  let datePart = strValue;
  const timeMatch = strValue.match(/(\d{1,2})[:.](\d{2})(?::\d{2})?\s*$/);
  if (timeMatch) {
    hours = parseInt(timeMatch[1], 10) || 0;
    minutes = parseInt(timeMatch[2], 10) || 0;
    datePart = strValue.slice(0, timeMatch.index).trim();
  }

  const dateSegments = datePart.split(/[\/\-\s]+/).filter(Boolean);
  if (dateSegments.length < 3) return null;

  // "2026-08-31" (tahun di depan) vs "31-Agu-2026" / "31/08/2026" (hari di depan).
  const yearFirst = /^\d{4}$/.test(dateSegments[0]);
  const day = parseInt(yearFirst ? dateSegments[2] : dateSegments[0], 10);
  const month = parseMonthToken(dateSegments[1]);
  const year = parseInt(yearFirst ? dateSegments[0] : dateSegments[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

  const manualDate = new Date(Date.UTC(year, month, day, hours, minutes));
  return isNaN(manualDate.getTime()) ? null : manualDate;
}

module.exports = {
  isSheetsSerialNumber,
  serialToDate,
  serialToMinutesOfDay,
  parseMonthToken,
  isSameDateInTimezone,
  toMinutesOfDay,
  nowMinutesInTimezone,
  parseFlexibleDate,
  getDatePartsInTimezone,
};

/** Format Date jadi "YYYY-MM-DD HH:mm:ss" di timezone Asia/Jakarta (WIB), biar Sheets kenali sebagai tanggal beneran (bukan teks ISO). */
function toSheetDateString(date, timezone = "Asia/Jakarta") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
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
