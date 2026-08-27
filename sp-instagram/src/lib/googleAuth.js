/**
 * googleAuth.js
 * Ganti pengganti auth implisit Apps Script (SpreadsheetApp.openById(),
 * DocumentApp.openById(), DriveApp.getFolderById() otomatis punya izin
 * karena scriptnya "milik" akun Google tsb).
 *
 * Di Node.js / GitHub Actions, kita pakai SERVICE ACCOUNT: sebuah "akun
 * robot" Google Cloud yang JSON key-nya disimpan sebagai GitHub Secret
 * (GOOGLE_SERVICE_ACCOUNT_KEY, isinya seluruh isi file JSON dalam 1 baris).
 * Service account itu HARUS di-share (Editor) ke tiap spreadsheet/dokumen/
 * folder yang mau diakses — lihat README.md.
 */

const { google } = require("googleapis");

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/drive",
];

let cachedAuth = null;

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "Environment variable 'GOOGLE_SERVICE_ACCOUNT_KEY' belum di-set. " +
        "Isinya harus seluruh isi file JSON service account (lihat README.md)."
    );
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY tidak bisa di-parse sebagai JSON. " +
        "Pastikan value secret-nya adalah isi PERSIS file JSON key (bukan path file)."
    );
  }
}

/**
 * @return {import('googleapis').Auth.GoogleAuth}
 */
function getAuth() {
  if (!cachedAuth) {
    const credentials = loadCredentials();
    cachedAuth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  }
  return cachedAuth;
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function getDocsClient() {
  const auth = getAuth();
  return google.docs({ version: "v1", auth });
}

async function getDriveClient() {
  const auth = getAuth();
  return google.drive({ version: "v3", auth });
}

module.exports = { getAuth, getSheetsClient, getDocsClient, getDriveClient };
