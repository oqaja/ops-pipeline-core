function gabungkanTanggalJam(tanggalCell, jamCell) {
  if (!tanggalCell || !jamCell) return null;

  const tanggalDate = new Date(tanggalCell);
  if (isNaN(tanggalDate.getTime())) return null;

  const jamStr = jamCell.toString().trim();
  const parts = jamStr.split(".");
  if (parts.length !== 2) return null;

  const jam = parseInt(parts[0], 10);
  const menit = parseInt(parts[1], 10);
  if (isNaN(jam) || isNaN(menit) || jam < 0 || jam > 23 || menit < 0 || menit > 59) return null;

  return new Date(tanggalDate.getFullYear(), tanggalDate.getMonth(), tanggalDate.getDate(), jam, menit, 0);
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
