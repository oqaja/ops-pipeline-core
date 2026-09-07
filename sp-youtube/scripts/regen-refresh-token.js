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
 *   5. Update YT_REFRESH_TOKEN di sp-youtube/.env lokal (baris lain gak disentuh)
 *   6. Jalanin `gh secret set` buat update secret SP_YT_REFRESH_TOKEN di GitHub
 *   7. Print ringkasan status + fallback manual kalau ada langkah yang gagal
 *
 * Cara pakai:
 *   node scripts/regen-refresh-token.js
 *   (atau: npm run regen-token)
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile, execFileSync } = require("child_process");
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
const GITHUB_REPO = "oqaja/ops-pipeline-core";

// Nama env var refresh token di sp-youtube/.env.
const ENV_REFRESH_KEY = "YT_REFRESH_TOKEN";

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

/**
 * Update satu key di file .env — replace nilainya kalau barisnya ada, atau
 * append di akhir file kalau belum ada. Baris lain TIDAK disentuh sama sekali
 * (komentar, whitespace, urutan, quoting semua dipertahankan apa adanya).
 * Throw kalau file gak ketemu atau gagal ditulis.
 */
function upsertEnvVar(envPath, key, value) {
  if (!fs.existsSync(envPath)) {
    throw new Error(`File .env tidak ditemukan di: ${envPath}`);
  }
  const original = fs.readFileSync(envPath, "utf8");
  const lines = original.split("\n");
  const keyRe = new RegExp(`^\\s*${key}\\s*=`);

  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (keyRe.test(lines[i])) {
      lines[i] = `${key}=${value}`;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    // Sisipin sebelum trailing newline kalau ada, biar gak nambah baris kosong.
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.splice(lines.length - 1, 0, `${key}=${value}`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(envPath, lines.join("\n"));
  return replaced ? "replaced" : "appended";
}

/**
 * Set GitHub Actions secret lewat `gh` CLI. Pakai execFileSync (bukan shell)
 * biar token gak kena parsing shell. Throw kalau gh gagal / gak ke-install.
 */
function setGithubSecret(name, repo, token) {
  execFileSync("gh", ["secret", "set", name, "--repo", repo, "--body", token], {
    stdio: ["ignore", "pipe", "pipe"],
  });
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

  const refreshToken = tokens.refresh_token;
  const expiryNote = tokens.expiry_date
    ? ` (access token berlaku s/d ${new Date(tokens.expiry_date).toLocaleString("id-ID")})`
    : "";

  // Print token DULU sebelum apa-apa — apa pun yang gagal setelah ini, token
  // tetep kelihatan di terminal dan gak ilang.
  console.log("\n" + "=".repeat(72));
  console.log("REFRESH TOKEN BARU" + expiryNote + ":\n");
  console.log(refreshToken);
  console.log("\n" + "=".repeat(72) + "\n");

  // --- 1. Update .env lokal ---
  let envOk = false;
  let envErr = null;
  try {
    const how = upsertEnvVar(envPath, ENV_REFRESH_KEY, refreshToken);
    envOk = true;
    console.log(
      how === "replaced"
        ? `[.env]  ${ENV_REFRESH_KEY} di ${envPath} di-replace dengan token baru.`
        : `[.env]  ${ENV_REFRESH_KEY} belum ada — ditambahkan di akhir ${envPath}.`
    );
  } catch (e) {
    envErr = e;
    console.error(`[.env]  GAGAL update ${envPath}:`);
    console.error(`        ${e.message || e}`);
    console.error(`        -> Update manual: set baris  ${ENV_REFRESH_KEY}=<token di atas>`);
  }

  // --- 2. Update GitHub secret via gh CLI ---
  let secretOk = false;
  let secretErr = null;
  try {
    setGithubSecret(GITHUB_SECRET_NAME, GITHUB_REPO, refreshToken);
    secretOk = true;
    console.log(`[gh]    Secret ${GITHUB_SECRET_NAME} di ${GITHUB_REPO} berhasil di-set.`);
  } catch (e) {
    secretErr = e;
    const detail =
      (e.stderr && e.stderr.toString().trim()) ||
      (e.code === "ENOENT" ? "gh CLI tidak ke-install / tidak ada di PATH" : e.message || String(e));
    console.error(`[gh]    GAGAL set secret via gh CLI:`);
    console.error(`        ${detail}`);
    console.error(`        Kemungkinan: gh belum ke-install, atau belum login (\`gh auth login\`).`);
    console.error(`        -> Jalanin manual:`);
    console.error(
      `           gh secret set ${GITHUB_SECRET_NAME} --repo ${GITHUB_REPO} --body '<token di atas>'`
    );
    console.error(`        atau lewat web: Settings > Secrets and variables > Actions > ${GITHUB_SECRET_NAME}`);
  }

  // --- Ringkasan ---
  console.log("\n" + "=".repeat(72));
  console.log("RINGKASAN:");
  console.log(`  ${envOk ? "✅" : "❌"} .env ${envOk ? "ke-update" : "GAGAL — update manual (token di atas)"}`);
  console.log(
    `  ${secretOk ? "✅" : "❌"} Secret GitHub ${secretOk ? "ke-update" : "GAGAL — jalanin command gh manual di atas"}`
  );
  console.log("\nCatatan: token OAuth app status \"Testing\" expired lagi dalam ~7 hari —");
  console.log("set reminder generate ulang tiap ~6 hari (`npm run regen-token`).");
  console.log("=".repeat(72) + "\n");

  if (!envOk || !secretOk) process.exit(1);
})().catch((e) => {
  console.error("\nFATAL ERROR:", e.message || e);
  process.exit(1);
});
