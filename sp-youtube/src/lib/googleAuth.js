const { google } = require("googleapis");

function getServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("Environment variable 'GOOGLE_SERVICE_ACCOUNT_KEY' belum di-set.");
  }
  return JSON.parse(raw);
}

async function getGoogleAuthClients() {
  const credentials = getServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
  const client = await auth.getClient();
  return {
    sheets: google.sheets({ version: "v4", auth: client }),
    docs: google.docs({ version: "v1", auth: client }),
    drive: google.drive({ version: "v3", auth: client }),
  };
}

module.exports = { getGoogleAuthClients };
