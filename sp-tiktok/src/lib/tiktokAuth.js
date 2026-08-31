const sodium = require("libsodium-wrappers");

/**
 * Update 1 GitHub Actions secret di repo ini, pakai GitHub REST API.
 * Butuh PAT dengan permission "Secrets: Read and write", discoped ke
 * repo ini aja. PAT-nya sendiri disimpan sebagai secret terpisah
 * (SECRETS_WRITE_PAT), BUKAN GITHUB_TOKEN bawaan (yang gak punya akses ini).
 */
async function updateGithubSecret(secretName, secretValue) {
  const pat = process.env.SECRETS_WRITE_PAT;
  const repo = process.env.GITHUB_REPOSITORY; // otomatis ada di GitHub Actions, format "owner/repo"

  if (!pat || !repo) {
    console.log(
      "  (warning) SECRETS_WRITE_PAT atau GITHUB_REPOSITORY tidak ada — skip update secret (kemungkinan jalan di lokal, bukan di Actions)."
    );
    return;
  }

  await sodium.ready;

  const keyRes = await fetch(
    `https://api.github.com/repos/${repo}/actions/secrets/public-key`,
    { headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" } }
  );
  if (!keyRes.ok) {
    throw new Error(`Gagal ambil public key repo: ${keyRes.status} ${await keyRes.text()}`);
  }
  const { key, key_id } = await keyRes.json();

  const binKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  const binMessage = sodium.from_string(secretValue);
  const encrypted = sodium.crypto_box_seal(binMessage, binKey);
  const encryptedBase64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

  const putRes = await fetch(
    `https://api.github.com/repos/${repo}/actions/secrets/${secretName}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify({ encrypted_value: encryptedBase64, key_id }),
    }
  );
  if (!putRes.ok) {
    throw new Error(`Gagal update secret ${secretName}: ${putRes.status} ${await putRes.text()}`);
  }
  console.log(`  Secret '${secretName}' berhasil di-update.`);
}

async function getValidTikTokToken() {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN || null;
  // Access token dari Apps Script kadaluarsa cepat (jam-an), jadi kita
  // selalu refresh di awal tiap run — beda dari Apps Script yang cek dulu
  // exp time sebelum refresh (karena runtime GitHub Actions singkat, gak
  // perlu optimasi itu; refresh sekali per run itu murah).
  return refreshTikTokToken();
}

async function refreshTikTokToken() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const refreshToken = process.env.TIKTOK_REFRESH_TOKEN;

  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = await response.json();

  if (!data.access_token) {
    throw new Error("Gagal refresh token TikTok: " + JSON.stringify(data));
  }

  console.log("  Token TikTok berhasil di-refresh.");

  // TikTok kemungkinan rotate refresh token tiap dipakai — simpan balik
  // yang baru ke GitHub Secret, biar run berikutnya gak pakai yang basi.
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await updateGithubSecret("TIKTOK_REFRESH_TOKEN", data.refresh_token);
  }

  return data.access_token;
}

module.exports = { getValidTikTokToken };
