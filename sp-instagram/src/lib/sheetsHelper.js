const { toSheetDateString } = require("./dateUtils");

function formatValueForSheets(value) {
  return value instanceof Date ? toSheetDateString(value) : value;
}

function formatRowForSheets(rowValues) {
  return rowValues.map(formatValueForSheets);
}

/**
 * sheetsHelper.js
 * Helper generik pengganti method Apps Script (getDataRange().getValues(),
 * getRange().setValue(), sheet.sort(), dst) tapi lewat Google Sheets API v4.
 * Dipakai bareng oleh sheetReader, statusUpdater, insightsTracker, commentArchive.
 */

/** Cache sheetId (gid) per spreadsheet+nama tab, biar gak query metadata berulang-ulang. */
const sheetIdCache = new Map();

async function getSheetMeta(sheets, spreadsheetId, sheetName) {
  const cacheKey = `${spreadsheetId}::${sheetName}`;
  if (sheetIdCache.has(cacheKey)) return sheetIdCache.get(cacheKey);

  const res = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = res.data.sheets.find((s) => s.properties.title === sheetName);
  const meta = sheet ? { sheetId: sheet.properties.sheetId, exists: true } : { sheetId: null, exists: false };
  sheetIdCache.set(cacheKey, meta);
  return meta;
}

function invalidateSheetMetaCache(spreadsheetId, sheetName) {
  sheetIdCache.delete(`${spreadsheetId}::${sheetName}`);
}

/**
 * Baca semua data 1 sheet, balikin { headers, rows } dengan rows berupa
 * array of object (key = nama header), tiap row punya _rowNumber (1-indexed,
 * sama seperti row._rowNumber di versi Apps Script).
 */
async function readSheetAsObjects(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });

  const data = res.data.values || [];
  if (data.length < 1) return { headers: [], rows: [] };

  const headers = data[0].map((h) => String(h || "").trim());
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const rawRow = data[i] || [];
    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      rowObj[headers[j]] = rawRow[j] !== undefined ? rawRow[j] : "";
    }
    rowObj._rowNumber = i + 1;
    rows.push(rowObj);
  }

  return { headers, rows };
}

/** Balikin map { namaHeader: nomorKolom (1-indexed) }. */
async function getHeaderColumnMap(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!1:1`,
  });
  const headerRow = (res.data.values && res.data.values[0]) || [];
  const map = {};
  headerRow.forEach((name, idx) => {
    const trimmed = String(name || "").trim();
    if (trimmed) map[trimmed] = idx + 1;
  });
  return map;
}

function columnNumberToLetter(col) {
  let letter = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

/** Tulis 1 cell (setara sheet.getRange(row, col).setValue(value)). */
async function setCellValue(sheets, spreadsheetId, sheetName, rowNumber, colNumber, value) {
  const colLetter = columnNumberToLetter(colNumber);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!${colLetter}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[formatValueForSheets(value)]] },
  });
}

/** Tulis 1 baris penuh mulai dari kolom A (setara sheet.getRange(row,1,1,n).setValues([...])). */
async function setRowValues(sheets, spreadsheetId, sheetName, rowNumber, rowValues) {
  const lastColLetter = columnNumberToLetter(rowValues.length);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A${rowNumber}:${lastColLetter}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [formatRowForSheets(rowValues)] },
  });
}

/** Tambah baris baru di akhir (setara sheet.appendRow([...])). */
async function appendRow(sheets, spreadsheetId, sheetName, rowValues) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [formatRowForSheets(rowValues)] },
  });
}

/**
 * Cari-atau-buat sheet dengan header tertentu (setara spEnsureSheetWithHeaders_).
 * Balikin true kalau sheet baru dibuat (header baru ditulis).
 */
async function ensureSheetWithHeaders(sheets, spreadsheetId, sheetName, headers) {
  const meta = await getSheetMeta(sheets, spreadsheetId, sheetName);

  if (!meta.exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
    invalidateSheetMetaCache(spreadsheetId, sheetName);
    await setRowValues(sheets, spreadsheetId, sheetName, 1, headers);
    return true;
  }

  // Sheet sudah ada tapi kosong (baru dibuat manual) -> pastikan header ada.
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!A1:A1` });
  const isEmpty = !res.data.values || res.data.values.length === 0;
  if (isEmpty) {
    await setRowValues(sheets, spreadsheetId, sheetName, 1, headers);
  }
  return false;
}

/**
 * Cari baris dengan value tertentu di kolom 'keyColumnName'. Kalau ketemu,
 * update baris itu. Kalau tidak, tambah baris baru. Setara spUpsertRowByKey_.
 * @return {number} nomor baris yang ditulis
 */
async function upsertRowByKey(sheets, spreadsheetId, sheetName, keyColumnName, keyValue, rowData) {
  const headerMap = await getHeaderColumnMap(sheets, spreadsheetId, sheetName);
  const keyCol = headerMap[keyColumnName];
  if (!keyCol) throw new Error(`Kolom '${keyColumnName}' tidak ketemu di sheet '${sheetName}'.`);

  const { rows } = await readSheetAsObjects(sheets, spreadsheetId, sheetName);
  const existing = rows.find((r) => String(r[keyColumnName] || "").trim() === String(keyValue));

  if (existing) {
    await setRowValues(sheets, spreadsheetId, sheetName, existing._rowNumber, rowData);
    return existing._rowNumber;
  }

  await appendRow(sheets, spreadsheetId, sheetName, rowData);
  const { rows: afterRows } = await readSheetAsObjects(sheets, spreadsheetId, sheetName);
  return afterRows.length + 1; // header + rows.length
}

/** Sortir sheet berdasarkan kolom tanggal, descending (setara spSortByDateDesc_). */
async function sortByColumnDesc(sheets, spreadsheetId, sheetName, columnName) {
  const meta = await getSheetMeta(sheets, spreadsheetId, sheetName);
  if (!meta.exists) return;

  const headerMap = await getHeaderColumnMap(sheets, spreadsheetId, sheetName);
  const dateCol = headerMap[columnName];
  if (!dateCol) return;

  const { rows } = await readSheetAsObjects(sheets, spreadsheetId, sheetName);
  if (rows.length < 2) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          sortRange: {
            range: {
              sheetId: meta.sheetId,
              startRowIndex: 1, // skip header
              startColumnIndex: 0,
            },
            sortSpecs: [{ dimensionIndex: dateCol - 1, sortOrder: "DESCENDING" }],
          },
        },
      ],
    },
  });
}

/** Terapkan format tampilan tanggal ke 1 cell (setara setNumberFormat). */
async function applyDateFormat(sheets, spreadsheetId, sheetName, rowNumber, colNumber, pattern) {
  if (!colNumber) return;
  const meta = await getSheetMeta(sheets, spreadsheetId, sheetName);
  if (!meta.exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: meta.sheetId,
              startRowIndex: rowNumber - 1,
              endRowIndex: rowNumber,
              startColumnIndex: colNumber - 1,
              endColumnIndex: colNumber,
            },
            cell: { userEnteredFormat: { numberFormat: { type: "DATE_TIME", pattern } } },
            fields: "userEnteredFormat.numberFormat",
          },
        },
      ],
    },
  });
}

module.exports = {
  readSheetAsObjects,
  getHeaderColumnMap,
  setCellValue,
  setRowValues,
  appendRow,
  ensureSheetWithHeaders,
  upsertRowByKey,
  sortByColumnDesc,
  applyDateFormat,
  columnNumberToLetter,
};
