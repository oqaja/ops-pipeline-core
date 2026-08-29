const { google } = require("googleapis");
const sodium = require("libsodium-wrappers");

async function updateGithubSecret(secretName, secretValue) {
  const pat = process.env.SECRETS_WRITE_PAT;
  const repo = process.env.GITHUB_REPOSITORY;

  if (!pat || !repo) {
    console.log("  (warning) SECRETS_WRITE_PAT/GITHUB_REPOSITORY tidak ada — skip update secret (kemungkinan jalan lokal).");
    return;
  }

  await sodium.ready;

  const keyRes = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/public-key`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
  });
  if (!keyRes.ok) throw new Error(`Gagal ambil public key repo: ${keyRes.status} ${await keyRes.text()}`);
  const { key, key_id } = await keyRes.json();

  const binKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  const binMessage = sodium.from_string(secretValue);
  const encrypted = sodium.crypto_box_seal(binMessage, binKey);
  const encryptedBase64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

  const putRes = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/${secretName}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ encrypted_value: encryptedBase64, key_id }),
  });
  if (!putRes.ok) throw new Error(`Gagal update secret ${secretName}: ${putRes.status} ${await putRes.text()}`);
  console.log(`  Secret '${secretName}' berhasil di-update.`);
}

async function getYoutubeClient() {
  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_REFRESH_TOKEN;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, "http://localhost:8080");
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();
  console.log("  Token YouTube berhasil di-refresh.");

  if (credentials.refresh_token && credentials.refresh_token !== refreshToken) {
    await updateGithubSecret("YT_REFRESH_TOKEN", credentials.refresh_token);
  }

  oauth2Client.setCredentials(credentials);
  return {
    youtube: google.youtube({ version: "v3", auth: oauth2Client }),
    youtubeAnalytics: google.youtubeAnalytics({ version: "v2", auth: oauth2Client }),
  };
}

module.exports = { getYoutubeClient };
