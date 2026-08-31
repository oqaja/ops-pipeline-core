async function getRawGrid(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetName });
  return res.data.values || [];
}

function cariIndexKolom(header, namaKolom) {
  const idx = header.indexOf(namaKolom);
  if (idx === -1) {
    throw new Error(`Kolom '${namaKolom}' tidak ditemukan di header spreadsheet. Cek apakah nama kolom berubah/typo di baris 1.`);
  }
  return idx;
}

function colToLetter(colIndex) {
  let letter = "";
  let n = colIndex + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

async function updateCell(sheets, spreadsheetId, sheetName, rowNumber, colIndex, value) {
  const range = `${sheetName}!${colToLetter(colIndex)}${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [[value]] },
  });
}

module.exports = { getRawGrid, cariIndexKolom, updateCell };
