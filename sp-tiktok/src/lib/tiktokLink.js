// Ambil ID konten TikTok dari link publik hasil Buffer (externalLink).
// Video  : https://www.tiktok.com/@akun/video/7695738327365995782
// Carousel/foto: https://www.tiktok.com/@akun/photo/7695738327365995782
function ekstrakIdTiktok(link) {
  if (!link) return null;
  const m = String(link).match(/\/(?:video|photo)\/(\d+)/);
  return m ? m[1] : null;
}

// ID post Buffer = 24 karakter hex (contoh: 6a86b107af16d26abddd8ad4).
// ID TikTok asli = angka panjang, jadi keduanya gampang dibedakan.
function adalahIdBuffer(nilai) {
  return /^[0-9a-f]{24}$/i.test(String(nilai || "").trim());
}

module.exports = { ekstrakIdTiktok, adalahIdBuffer };
