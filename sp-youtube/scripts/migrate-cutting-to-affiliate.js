try { require("dotenv").config(); } catch (e) {}

const DRY_RUN = true; // GANTI ke false setelah preview OK

const { getGoogleAuthClients } = require("../src/lib/googleAuth");
const { cariKontenDiDocsMaster } = require("../src/lib/docsReader");
const { readSheetAsObjects, getHeaderColumnMap, appendRow } = require("../src/lib/sheetsHelper");

const KALENDER_SPREADSHEET_ID = "1raiIO1HccW7IxN9bh9BqUJ7DOHDVBN05GKRQ5xrrfeI";
const SUMBER_TAB = "KALENDER KONTEN";
const TUJUAN_TAB = "KALENDER AFFILIATE";
const CHANNELS = ["MT", "DFM", "FaP"];

function buildRow(headerMap, values) {
  const maxCol = Math.max(...Object.values(headerMap));
  const row = new Array(maxCol).fill("");
  for (const [colName, value] of Object.entries(values)) {
    if (headerMap[colName]) {
      row[headerMap[colName] - 1] = value;
    }
  }
  return row;
}

(async () => {
  console.log("========================================");
  console.log(`Migrasi konten Cutting -> KALENDER AFFILIATE - mulai ${DRY_RUN ? "(DRY RUN)" : "(EKSEKUSI BENERAN)"}`);
  console.log("========================================");

  const { sheets, docs } = await getGoogleAuthClients();

  const { headers: headerSumber, rows: rowsSumber } = await readSheetAsObjects(sheets, KALENDER_SPREADSHEET_ID, SUMBER_TAB);
  if (!headerSumber.includes("SEGMEN") || !headerSumber.includes("JUDUL KONTEN")) {
    console.error("FATAL: kolom SEGMEN atau JUDUL KONTEN tidak ditemukan di KALENDER KONTEN.");
    process.exit(1);
  }

  const kontenCutting = rowsSumber.filter(
    (row) => String(row["SEGMEN"] || "").trim().toLowerCase() === "cutting" && String(row["JUDUL KONTEN"] || "").trim()
  );

  console.log(`Ditemukan ${kontenCutting.length} baris dengan SEGMEN "Cutting".`);
  if (kontenCutting.length === 0) {
    console.log("Tidak ada yang perlu dimigrasi. Selesai.");
    return;
  }

  const headerTujuan = await getHeaderColumnMap(sheets, KALENDER_SPREADSHEET_ID, TUJUAN_TAB);
  console.log(`Kolom KALENDER AFFILIATE terbaca: ${Object.keys(headerTujuan).join(", ")}`);

  let totalBarisDitulis = 0;
  let gagalAmbilCaption = 0;

  for (const row of kontenCutting) {
    const judul = String(row["JUDUL KONTEN"]).trim();
    console.log(`Proses: "${judul}"`);

    let caption = "";
    try {
      const kontenDitemukan = await cariKontenDiDocsMaster(docs, judul);
      caption = kontenDitemukan && kontenDitemukan.deskripsiYoutube ? kontenDitemukan.deskripsiYoutube.trim() : "";
      if (!caption) {
        console.log(`  (warning) Deskripsi YouTube kosong/tidak ditemukan di Docs Master untuk judul ini.`);
        gagalAmbilCaption++;
      } else {
        console.log(`  Caption ketemu (${caption.length} karakter).`);
      }
    } catch (e) {
      console.log(`  (warning) Gagal ambil dari Docs Master: ${e.message}`);
      gagalAmbilCaption++;
    }

    for (const akun of CHANNELS) {
      const rowValues = buildRow(headerTujuan, {
        "AKUN": akun,
        "JUDUL VIDEO": judul,
        "JUDUL KONTEN": judul,
        "CAPTION": caption,
        "PRODUCTION": "✅",
      });

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Akan ditulis buat ${akun}: ${JSON.stringify(rowValues)}`);
      } else {
        await appendRow(sheets, KALENDER_SPREADSHEET_ID, TUJUAN_TAB, rowValues);
      }
      totalBarisDitulis++;
    }

    console.log(`  -> 3 baris ${DRY_RUN ? "AKAN ditulis" : "ditulis"} (MT, DFM, FaP).`);
  }

  console.log("");
  console.log("=== RINGKASAN ===");
  console.log(`Total judul Cutting diproses: ${kontenCutting.length}`);
  console.log(`Total baris ${DRY_RUN ? "AKAN ditulis (DRY RUN)" : "berhasil ditulis"} ke KALENDER AFFILIATE: ${totalBarisDitulis}`);
  console.log(`Judul dengan caption gagal/kosong: ${gagalAmbilCaption} (cek manual di Docs Master kalau ada)`);
  if (DRY_RUN) {
    console.log("");
    console.log(">>> Ini masih DRY RUN, belum ada baris yang beneran ditulis.");
    console.log(">>> Kalau hasil di atas sudah sesuai, ubah DRY_RUN jadi false lalu jalankan ulang.");
  } else {
    console.log("Selesai. Isi TANGGAL, JAM UP YT, dan STATUS YT secara manual di sheet.");
  }
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
