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
    const parts = value.trim().split(/[\/\-]/);
    if (parts.length !== 3) return false;
    d = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10) - 1;
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

  const [datePart, timePart = "00:00"] = strValue.split(" ");
  const dateSegments = datePart.split(/[\/\-]/);
  if (dateSegments.length !== 3) return null;

  const day = parseInt(dateSegments[0], 10);
  const month = parseInt(dateSegments[1], 10) - 1;
  const year = parseInt(dateSegments[2], 10);

  const timeSegments = timePart.split(":");
  const hours = parseInt(timeSegments[0], 10) || 0;
  const minutes = parseInt(timeSegments[1], 10) || 0;

  const manualDate = new Date(Date.UTC(year, month, day, hours, minutes));
  return isNaN(manualDate.getTime()) ? null : manualDate;
}

module.exports = {
  isSheetsSerialNumber,
  serialToDate,
  serialToMinutesOfDay,
  isSameDateInTimezone,
  toMinutesOfDay,
  nowMinutesInTimezone,
  parseFlexibleDate,
  getDatePartsInTimezone,
};
