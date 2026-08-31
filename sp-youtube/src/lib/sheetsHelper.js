const { toSheetDateString } = require("./dateUtils");

function formatValueForSheets(value) {
  return value instanceof Date ? toSheetDateString(value) : value;
}

function formatRowForSheets(rowValues) {
  return rowValues.map(formatValueForSheets);
}

async function withRateLimitRetry(fn, label) {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 =
        err.status === 429 ||
        (err.response && err.response.status === 429) ||
        /rateLimitExceeded|Quota exceeded/i.test(err.message || "");
      if (!is429 || attempt === maxAttempts) throw err;
      const waitMs = Math.min(30000, 2000 * Math.pow(1.8, attempt));
      console.log(`  (rate limit) ${label || "Sheets API"} kena limit, percobaan ${attempt}/${maxAttempts}, tunggu ${Math.round(waitMs / 1000)}s...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

const sheetIdCache = new Map();

async function getSheetMeta(sheets, spreadsheetId, sheetName) {
  const cacheKey = `${spreadsheetId}::${sheetName}`;
  if (sheetIdCache.has(cacheKey)) return sheetIdCache.get(cacheKey);

  const res = await withRateLimitRetry(() => sheets.spreadsheets.get({ spreadsheetId }), "getSheetMeta");
  const sheet = res.data.sheets.find((s) => s.properties.title === sheetName);
  const meta = sheet ? { sheetId: sheet.properties.sheetId, exists: true } : { sheetId: null, exists: false };
  sheetIdCache.set(cacheKey, meta);
  return meta;
}

function invalidateSheetMetaCache(spreadsheetId, sheetName) {
  sheetIdCache.delete(`${spreadsheetId}::${sheetName}`);
}

async function readSheetAsObjects(sheets, spreadsheetId, sheetName) {
  const res = await withRateLimitRetry(
    () =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'`,
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "SERIAL_NUMBER",
      }),
    "readSheetAsObjects"
  );

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

const headerMapCache = new Map();

async function getHeaderColumnMap(sheets, spreadsheetId, sheetName) {
  const cacheKey = `${spreadsheetId}::${sheetName}`;
  if (headerMapCache.has(cacheKey)) return headerMapCache.get(cacheKey);

  const res = await withRateLimitRetry(
    () => sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!1:1` }),
    "getHeaderColumnMap"
  );
  const headerRow = (res.data.values && res.data.values[0]) || [];
  const map = {};
  headerRow.forEach((name, idx) => {
    const trimmed = String(name || "").trim();
    if (trimmed) map[trimmed] = idx + 1;
  });
  headerMapCache.set(cacheKey, map);
  return map;
}

function invalidateHeaderMapCache(spreadsheetId, sheetName) {
  headerMapCache.delete(`${spreadsheetId}::${sheetName}`);
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

async function setCellValue(sheets, spreadsheetId, sheetName, rowNumber, colNumber, value) {
  const colLetter = columnNumberToLetter(colNumber);
  await withRateLimitRetry(
    () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!${colLetter}${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[formatValueForSheets(value)]] },
      }),
    "setCellValue"
  );
}

async function setRowValues(sheets, spreadsheetId, sheetName, rowNumber, rowValues) {
  const lastColLetter = columnNumberToLetter(rowValues.length);
  await withRateLimitRetry(
    () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A${rowNumber}:${lastColLetter}${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [formatRowForSheets(rowValues)] },
      }),
    "setRowValues"
  );
}

async function appendRow(sheets, spreadsheetId, sheetName, rowValues) {
  await withRateLimitRetry(
    () =>
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${sheetName}'!A1`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [formatRowForSheets(rowValues)] },
      }),
    "appendRow"
  );
}

async function ensureSheetWithHeaders(sheets, spreadsheetId, sheetName, headers) {
  const meta = await getSheetMeta(sheets, spreadsheetId, sheetName);

  if (!meta.exists) {
    await withRateLimitRetry(
      () =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
        }),
      "ensureSheetWithHeaders(addSheet)"
    );
    invalidateSheetMetaCache(spreadsheetId, sheetName);
    invalidateHeaderMapCache(spreadsheetId, sheetName);
    await setRowValues(sheets, spreadsheetId, sheetName, 1, headers);
    return true;
  }

  const res = await withRateLimitRetry(
    () => sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!A1:A1` }),
    "ensureSheetWithHeaders(check)"
  );
  const isEmpty = !res.data.values || res.data.values.length === 0;
  if (isEmpty) {
    await setRowValues(sheets, spreadsheetId, sheetName, 1, headers);
  }
  return false;
}

async function upsertRowByKey(sheets, spreadsheetId, sheetName, keyColumnName, keyValue, rowData) {
  const headerMap = await getHeaderColumnMap(sheets, spreadsheetId, sheetName);
  const keyCol = headerMap[keyColumnName];
  if (!keyCol) throw new Error(`Kolom '${keyColumnName}' tidak ketemu di sheet '${sheetName}'.`);

  const target = String(keyValue).trim();
  const { rows } = await readSheetAsObjects(sheets, spreadsheetId, sheetName);
  const matches = rows.filter((r) => String(r[keyColumnName] || "").trim() === target);

  if (matches.length > 0) {
    const first = matches[0];
    await setRowValues(sheets, spreadsheetId, sheetName, first._rowNumber, rowData);
    // Self-healing: kalau key yang sama muncul di >1 baris (dobel warisan), sisakan yang pertama.
    if (matches.length > 1) {
      await deleteRowsByNumbers(sheets, spreadsheetId, sheetName, matches.slice(1).map((r) => r._rowNumber));
    }
    return first._rowNumber;
  }

  await appendRow(sheets, spreadsheetId, sheetName, rowData);
  const { rows: afterRows } = await readSheetAsObjects(sheets, spreadsheetId, sheetName);
  return afterRows.length + 1;
}

/** Hapus baris berdasarkan nomor baris (1-indexed). Diurut menurun supaya index tidak bergeser. */
async function deleteRowsByNumbers(sheets, spreadsheetId, sheetName, rowNumbers) {
  if (!rowNumbers || rowNumbers.length === 0) return;
  const meta = await getSheetMeta(sheets, spreadsheetId, sheetName);
  if (!meta.exists) return;

  const sorted = [...new Set(rowNumbers)].sort((a, b) => b - a);
  const requests = sorted.map((rowNumber) => ({
    deleteDimension: {
      range: { sheetId: meta.sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber },
    },
  }));

  await withRateLimitRetry(
    () => sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }),
    "deleteRowsByNumbers"
  );
}

/**
 * Buang baris duplikat: untuk tiap value di keyColumnName yang muncul >1x, sisakan
 * SATU baris (yang tiebreakColumnName-nya paling besar/baru; kalau tidak ada tiebreak,
 * baris paling bawah), hapus sisanya. Return jumlah baris yang dihapus.
 */
async function dedupeSheetByKey(sheets, spreadsheetId, sheetName, keyColumnName, tiebreakColumnName) {
  const { rows } = await readSheetAsObjects(sheets, spreadsheetId, sheetName);
  if (rows.length < 2) return 0;

  const groups = new Map();
  for (const row of rows) {
    const key = String(row[keyColumnName] || "").trim();
    if (key === "") continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const toDelete = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    let keep = group[0];
    for (const row of group) {
      const rv = tiebreakColumnName ? Number(row[tiebreakColumnName]) || 0 : row._rowNumber;
      const kv = tiebreakColumnName ? Number(keep[tiebreakColumnName]) || 0 : keep._rowNumber;
      if (rv >= kv) keep = row;
    }
    for (const row of group) if (row._rowNumber !== keep._rowNumber) toDelete.push(row._rowNumber);
  }

  if (toDelete.length === 0) return 0;
  await deleteRowsByNumbers(sheets, spreadsheetId, sheetName, toDelete);
  console.log(`  (dedupe) ${sheetName}: ${toDelete.length} baris duplikat dihapus.`);
  return toDelete.length;
}

/** Terapkan number-format tanggal ke SELURUH kolom (mulai baris 2). Sekali panggil, semua baris seragam. */
async function applyColumnDateFormat(sheets, spreadsheetId, sheetName, colNumber, pattern) {
  if (!colNumber) return;
  const meta = await getSheetMeta(sheets, spreadsheetId, sheetName);
  if (!meta.exists) return;

  const type = /[hH]/.test(pattern) ? "DATE_TIME" : "DATE";
  await withRateLimitRetry(
    () =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: meta.sheetId,
                  startRowIndex: 1,
                  startColumnIndex: colNumber - 1,
                  endColumnIndex: colNumber,
                },
                cell: { userEnteredFormat: { numberFormat: { type, pattern } } },
                fields: "userEnteredFormat.numberFormat",
              },
            },
          ],
        },
      }),
    "applyColumnDateFormat"
  );
}

/**
 * Rapikan kolom tanggal yang terlanjur tersimpan sebagai TEKS (bukan datetime asli):
 * baca tiap sel, parse pakai parseFn, tulis ulang pakai formatFn. Sel yang sudah
 * berupa angka serial dibiarkan. Return jumlah sel yang diperbaiki.
 */
async function normalizeDateColumn(sheets, spreadsheetId, sheetName, colNumber, parseFn, formatFn) {
  if (!colNumber) return 0;
  const colLetter = columnNumberToLetter(colNumber);
  const res = await withRateLimitRetry(
    () =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!${colLetter}2:${colLetter}`,
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "SERIAL_NUMBER",
      }),
    "normalizeDateColumn(read)"
  );
  const values = res.data.values || [];
  if (values.length === 0) return 0;

  const out = [];
  let fixed = 0;
  for (let i = 0; i < values.length; i++) {
    const cell = values[i] && values[i].length ? values[i][0] : "";
    if (typeof cell === "number") { out.push([cell]); continue; }
    if (cell === "" || cell === null || cell === undefined) { out.push([""]); continue; }
    const parsed = parseFn(cell);
    if (parsed && !isNaN(parsed.getTime())) { out.push([formatFn(parsed)]); fixed++; }
    else out.push([cell]);
  }

  if (fixed === 0) return 0;
  await withRateLimitRetry(
    () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!${colLetter}2:${colLetter}${out.length + 1}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: out },
      }),
    "normalizeDateColumn(write)"
  );
  console.log(`  (normalize) ${sheetName} kolom ${colLetter}: ${fixed} sel tanggal-teks dirapikan.`);
  return fixed;
}

/** Pastikan locale spreadsheet = locale target (default id_ID), supaya "mmm" render "Agu" bukan "Aug". Idempoten. */
async function ensureSpreadsheetLocale(sheets, spreadsheetId, locale = "id_ID") {
  try {
    const res = await withRateLimitRetry(
      () => sheets.spreadsheets.get({ spreadsheetId, fields: "properties.locale" }),
      "ensureSpreadsheetLocale(get)"
    );
    const current = res.data.properties && res.data.properties.locale;
    if (current === locale) return;
    await withRateLimitRetry(
      () =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ updateSpreadsheetProperties: { properties: { locale }, fields: "locale" } }] },
        }),
      "ensureSpreadsheetLocale(set)"
    );
    console.log(`  (info) Locale spreadsheet di-set dari '${current || "?"}' ke '${locale}'.`);
  } catch (err) {
    console.log(`  (info) Gagal set locale spreadsheet: ${err.message}`);
  }
}


async function sortByColumnDesc(sheets, spreadsheetId, sheetName, columnName) {
  const meta = await getSheetMeta(sheets, spreadsheetId, sheetName);
  if (!meta.exists) return;

  const headerMap = await getHeaderColumnMap(sheets, spreadsheetId, sheetName);
  const dateCol = headerMap[columnName];
  if (!dateCol) return;

  const { rows } = await readSheetAsObjects(sheets, spreadsheetId, sheetName);
  if (rows.length < 2) return;

  await withRateLimitRetry(
    () =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              sortRange: {
                range: { sheetId: meta.sheetId, startRowIndex: 1, startColumnIndex: 0 },
                sortSpecs: [{ dimensionIndex: dateCol - 1, sortOrder: "DESCENDING" }],
              },
            },
          ],
        },
      }),
    "sortByColumnDesc"
  );
}

module.exports = {
  readSheetAsObjects,
  getHeaderColumnMap,
  setCellValue,
  setRowValues,
  appendRow,
  ensureSheetWithHeaders,
  upsertRowByKey,
  deleteRowsByNumbers,
  dedupeSheetByKey,
  sortByColumnDesc,
  applyColumnDateFormat,
  normalizeDateColumn,
  ensureSpreadsheetLocale,
  columnNumberToLetter,
  withRateLimitRetry,
  getSheetMeta,
};
