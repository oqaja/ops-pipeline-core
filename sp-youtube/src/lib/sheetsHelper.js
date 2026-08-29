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

  const { rows } = await readSheetAsObjects(sheets, spreadsheetId, sheetName);
  const existing = rows.find((r) => String(r[keyColumnName] || "").trim() === String(keyValue));

  if (existing) {
    await setRowValues(sheets, spreadsheetId, sheetName, existing._rowNumber, rowData);
    return existing._rowNumber;
  }

  await appendRow(sheets, spreadsheetId, sheetName, rowData);
  const { rows: afterRows } = await readSheetAsObjects(sheets, spreadsheetId, sheetName);
  return afterRows.length + 1;
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
  sortByColumnDesc,
  columnNumberToLetter,
  withRateLimitRetry,
  getSheetMeta,
};
