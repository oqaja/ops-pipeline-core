const BULAN_ID = {
  jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, jun: 5,
  jul: 6, agu: 7, sep: 8, okt: 9, nov: 10, des: 11,
};

function parseTanggalIndonesia(value) {
  const match = String(value).trim().match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const monthKey = match[2].toLowerCase().substring(0, 3);
  const month = BULAN_ID[monthKey];
  const year = parseInt(match[3], 10);
  if (month === undefined || isNaN(day) || isNaN(year)) return null;
  return new Date(year, month, day);
}

function gabungkanTanggalJam(tanggalCell, jamCell) {
  if (!tanggalCell || !jamCell) return null;

  let tanggalDate = new Date(tanggalCell);
  if (isNaN(tanggalDate.getTime())) {
    tanggalDate = parseTanggalIndonesia(tanggalCell);
  }
  if (!tanggalDate || isNaN(tanggalDate.getTime())) return null;

  const jamStr = jamCell.toString().trim();
  const parts = jamStr.split(".");
  if (parts.length !== 2) return null;

  const jam = parseInt(parts[0], 10);
  const menit = parseInt(parts[1], 10);
  if (isNaN(jam) || isNaN(menit) || jam < 0 || jam > 23 || menit < 0 || menit > 59) return null;

  return new Date(Date.UTC(
    tanggalDate.getFullYear(),
    tanggalDate.getMonth(),
    tanggalDate.getDate(),
    jam - 7,
    menit,
    0
  ));
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
