const SHEETS_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isSheetsSerialNumber(value) {
  return typeof value === "number" && !isNaN(value);
}

function serialToDate(serial) {
  return new Date(SHEETS_EPOCH_UTC_MS + serial * MS_PER_DAY);
}

function combineDateAndTime(tanggalCell, jamCell, timezone = "Asia/Jakarta") {
  if (!tanggalCell || !jamCell) return null;

  let year, month, day;
  if (isSheetsSerialNumber(tanggalCell)) {
    const d = serialToDate(tanggalCell);
    year = d.getUTCFullYear();
    month = d.getUTCMonth();
    day = d.getUTCDate();
  } else {
    const parts = String(tanggalCell).trim().split(/[\/\-]/);
    if (parts.length !== 3) return null;
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10) - 1;
    year = parseInt(parts[2], 10);
  }

  let hour, minute;
  if (isSheetsSerialNumber(jamCell)) {
    const fraction = jamCell - Math.floor(jamCell);
    const totalMinutes = Math.round(fraction * 24 * 60);
    hour = Math.floor(totalMinutes / 60);
    minute = totalMinutes % 60;
  } else {
    const jamStr = String(jamCell).trim().replace(".", ":");
    const parts = jamStr.split(":");
    if (parts.length < 2) return null;
    hour = parseInt(parts[0], 10);
    minute = parseInt(parts[1], 10);
  }

  if ([year, month, day, hour, minute].some((n) => isNaN(n))) return null;

  return new Date(Date.UTC(year, month, day, hour - 7, minute, 0));
}

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

module.exports = {
  isSheetsSerialNumber,
  serialToDate,
  combineDateAndTime,
  parseFlexibleDate,
  toSheetDateString,
};
