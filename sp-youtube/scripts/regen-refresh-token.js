/**
 * regen-refresh-token.js — jalan LOKAL di laptop, bukan di GitHub Actions.
 *
 * Kenapa perlu: OAuth consent screen project-nya masih "Testing", jadi refresh
 * token YouTube otomatis expired tiap ~7 hari. Publish ke "In production" di-skip
 * karena scope YouTube termasuk restricted (butuh verifikasi Google yang ribet
 * untuk automation internal). Solusinya: generate ulang token manual tiap ~6 hari.
 *
 * Yang dilakukan script ini:
 *   1. Baca YT_CLIENT_ID / YT_CLIENT_SECRET dari sp-youtube/.env
 *   2. Buka authorization URL Google OAuth di browser (scope YouTube Data + Analytics)
 *   3. Nyalain local server kecil buat nangkep redirect callback berisi "code"
 *   4. Tukar "code" jadi refresh token baru lewat token endpoint Google
 *   5. Print refresh token baru + instruksi update secret di GitHub
 *
 * Cara pakai:
 *   node scripts/regen-refresh-token.js
 *   (atau: npm run regen-token)
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { google } = require("googleapis");

// Harus sama persis dengan redirect URI yang terdaftar di OAuth client Google Cloud,
// dan konsisten dengan src/lib/youtubeAuth.js ("http://localhost:8080").
const REDIRECT_PORT = 8080;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

// Scope disamakan dengan operasi yang dipakai runtime:
//   - videos.insert (upload)              -> youtube.upload
//   - videos.update / channels.list mine  -> youtube
//   - commentThreads.list                 -> youtube.force-ssl
//   - youtubeAnalytics.reports.query      -> yt-analytics.readonly
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

// Nama secret di GitHub repo (lihat .github/workflows/sp-yt-*.yml).
const GITHUB_SECRET_NAME = "SP_YT_REFRESH_TOKEN";

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    throw new Error(`File .env tidak ditemukan di: ${envPath}`);
  }
  const out = {};
  for (const rawLine of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function openInBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, (err) => {
    if (err) {
      console.log("  (info) Gagal buka browser otomatis — buka URL di atas manual.");
    }
  });
}

function waitForCode(oauth2Client) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">` +
          (code
            ? `<h2>Berhasil ✅</h2><p>Refresh token baru sudah di-generate. Balik ke terminal.</p>`
            : `<h2>Gagal ❌</h2><pre>${error || "tidak ada authorization code"}</pre>`) +
          `<p>Tab ini boleh ditutup.</p></body>`
      );

      server.close();
      if (code) resolve(code);
      else reject(new Error(`OAuth callback error: ${error || "no code"}`));
    });

    server.on("error", reject);
    server.listen(REDIRECT_PORT, () => {
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent", // paksa keluarin refresh_token baru tiap kali
        scope: SCOPES,
      });
      console.log("\n1. Buka URL ini di browser (harusnya kebuka otomatis):\n");
      console.log("   " + authUrl + "\n");
      console.log(`2. Login pakai akun Google yang punya channel YouTube-nya.`);
      console.log(`3. Approve semua permission. Nunggu redirect ke ${REDIRECT_URI} ...\n`);
      openInBrowser(authUrl);
    });
  });
}

(async () => {
  const envPath = path.resolve(__dirname, "..", ".env");
  const env = loadEnvFile(envPath);

  const clientId = env.YT_CLIENT_ID;
  const clientSecret = env.YT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(`YT_CLIENT_ID / YT_CLIENT_SECRET kosong di ${envPath}`);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const code = await waitForCode(oauth2Client);
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google tidak mengembalikan refresh_token. Coba lagi — pastikan prompt consent muncul, " +
        "atau cabut akses lama di https://myaccount.google.com/permissions lalu ulangi."
    );
  }

  const expiryNote = tokens.expiry_date
    ? ` (access token berlaku s/d ${new Date(tokens.expiry_date).toLocaleString("id-ID")})`
    : "";

  console.log("\n" + "=".repeat(72));
  console.log("REFRESH TOKEN BARU" + expiryNote + ":\n");
  console.log(tokens.refresh_token);
  console.log("\n" + "=".repeat(72));
  console.log(`
Update secret di GitHub — salah satu cara:

  A. Via CLI (butuh gh + akses repo):
     gh secret set ${GITHUB_SECRET_NAME} --repo <owner>/<repo> --body "<token di atas>"

  B. Via web:
     Settings > Secrets and variables > Actions > ${GITHUB_SECRET_NAME} > Update

Catatan:
  - Token dari OAuth app status "Testing" bakal expired lagi dalam ~7 hari.
    Set reminder generate ulang tiap ~6 hari.
  - Update juga YT_REFRESH_TOKEN di ${envPath} kalau dipakai buat run lokal.
`);
})().catch((e) => {
  console.error("\nFATAL ERROR:", e.message || e);
  process.exit(1);
});
