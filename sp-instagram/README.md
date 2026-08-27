# IG SP Automation (migrasi dari Apps Script ke Node.js / GitHub Actions)

Ini hasil migrasi automation Instagram Shoe Police (SP) — sebelumnya 11 file
Apps Script (`SP_Config.gs`, `SP_SheetReader.gs`, dst) di project "Instagram
sp Automation" — jadi Node.js yang jalan di GitHub Actions. Logikanya
di-port 1:1, cuma cara aksesnya ke Google Sheets/Docs/Drive yang berubah
(dari implisit "milik akun Apps Script" jadi Service Account eksplisit).

Arsitektur: **hybrid**. Apps Script TIDAK dihapus total — disederhanakan
jadi 1 file kecil (`apps-script/SP_Trigger.gs`) yang cuma mengirim sinyal
ke GitHub tiap 15 menit (presisi, hampir tanpa kuota). GitHub Actions yang
menerima sinyal itu baru menjalankan seluruh logic berat. Insight harian &
arsip komentar (yang tidak butuh presisi menit) langsung pakai cron
GitHub Actions.

---

## Bagian 1 — Bikin Google Cloud Service Account (dari nol)

Service account itu "akun robot" yang dipakai GitHub Actions buat baca/tulis
Sheets, Docs, dan Drive — menggantikan peran akun `igshoepolice@gmail.com`
yang dulu otomatis "nempel" ke Apps Script.

1. Buka https://console.cloud.google.com/ (login pakai akun Google apa saja,
   boleh oqnt27@gmail.com atau igshoepolice@gmail.com).
2. Bikin project baru: klik dropdown project di kiri atas > **New Project**.
   Nama bebas, misal `ig-sp-automation`. Tunggu sampai selesai dibuat, lalu
   pastikan project ini yang aktif (cek dropdown di kiri atas).
3. Enable 3 API yang dibutuhkan. Buka masing-masing link ini (project yang
   aktif harus project yang baru dibuat), klik **Enable**:
   - https://console.cloud.google.com/apis/library/sheets.googleapis.com
   - https://console.cloud.google.com/apis/library/docs.googleapis.com
   - https://console.cloud.google.com/apis/library/drive.googleapis.com
4. Bikin Service Account: buka
   https://console.cloud.google.com/iam-admin/serviceaccounts, klik
   **Create Service Account**. Nama bebas (misal `ig-sp-automation-bot`).
   Skip bagian "Grant this service account access to project" (tidak
   perlu), klik **Done**.
5. Bikin JSON key: klik service account yang baru dibuat > tab **Keys** >
   **Add Key** > **Create new key** > pilih **JSON** > **Create**. File
   JSON otomatis ke-download — **simpan baik-baik, ini kunci rahasia**.
6. Catat **email** service account-nya (bentuknya seperti
   `ig-sp-automation-bot@ig-sp-automation-123456.iam.gserviceaccount.com`,
   kelihatan di halaman Keys tadi atau di daftar service account).

## Bagian 2 — Share 4 resource ke Service Account

Buka tiap resource di bawah ini, klik **Share** (spreadsheet/Docs) atau
**Share** (folder Drive), lalu tambahkan **email service account** dari
langkah 6 di atas, dengan akses **Editor**:

| Resource | Link |
|---|---|
| Spreadsheet KALENDER KONTEN | `https://docs.google.com/spreadsheets/d/1raiIO1HccW7IxN9bh9BqUJ7DOHDVBN05GKRQ5xrrfeI` |
| Docs Master | `https://docs.google.com/document/d/1xLigBTT0Ite4ItD5MhazsUlyFO2n98GO-xsdXNdgFq8` |
| Folder Drive SIAP UPLOAD | `https://drive.google.com/drive/folders/1PhuAg0sJACUEr8sFbfSZEj45EGnrhF3u` |
| Spreadsheet Shoe Police - Content Insights | `https://docs.google.com/spreadsheets/d/1bv0i1ZdjNg8emGRHZL4zUWt-2n6o68_ug-shuZOIWr8` |

Kalau lupa share salah satu, gejalanya nanti error "The caller does not
have permission" — tinggal balik ke sini dan share resource yang kelewat.

## Bagian 3 — Push repo ini ke GitHub

```bash
cd ig-sp-automation
git init
git add .
git commit -m "Initial migration from Apps Script"
gh repo create ig-sp-automation --private --source=. --push
# (atau bikin repo manual di github.com, lalu git remote add origin ... && git push)
```

## Bagian 4 — Isi GitHub Secrets

Di repo GitHub > **Settings** > **Secrets and variables** > **Actions** >
**New repository secret**, tambahkan 3 secret ini:

- **`GOOGLE_SERVICE_ACCOUNT_KEY`** — buka file JSON key dari Bagian 1
  langkah 5, copy **SELURUH ISI FILE**, paste sebagai value secret ini
  (boleh multi-baris, GitHub Secrets mendukung itu).
- **`SP_IG_ACCESS_TOKEN`** — access token Instagram yang SAMA seperti yang
  dulu ada di Script Properties Apps Script (key `SP_IG_ACCESS_TOKEN`).
  Buka project Apps Script lama > Project Settings > Script Properties buat
  lihat value-nya kalau lupa.
- **`GOOGLE_DRIVE_API_KEY`** (opsional tapi disarankan) — API key yang sama
  seperti yang dulu ada di Script Properties Apps Script. Kalau belum
  pernah bikin, buka https://console.cloud.google.com/apis/credentials
  (di project Cloud yang sama dari Bagian 1) > **Create Credentials** >
  **API Key**.

## Bagian 5 — Test dulu sebelum aktifin jadwal

Sebelum sambungin ke Apps Script/jadwal otomatis, test manual dulu:

1. Di tab **Actions** repo, pilih workflow **"IG SP - Main Automation"** >
   **Run workflow** (tombol di kanan) > jalankan manual sekali. Cek log-nya
   — harus sama persis behaviour-nya kayak dulu jalanin `spRunAutomation()`
   manual di Apps Script editor.
2. Kalau mau lebih detail cek koneksi satu-satu (Sheets/Docs/Drive/Instagram
   API), jalankan lokal (butuh Node.js 20+ terinstall di laptop):
   ```bash
   npm install
   cp .env.example .env
   # isi .env dengan value yang sama seperti secrets di atas
   npm run test-connection
   ```

## Bagian 6 — Setup Apps Script sebagai trigger presisi

1. Buka project Apps Script lama ("Instagram sp Automation" di
   script.google.com).
2. **Hapus semua trigger lama** dulu: menu jam (Triggers) di sisi kiri,
   hapus semua trigger yang ada (spRunAutomation, spRunPostInsights, dst).
3. **Hapus isi semua file lama** (SP_Config.gs, SP_SheetReader.gs, dst,
   semuanya) — atau lebih aman, biarkan dulu tapi jangan dipakai (nanti
   dihapus kalau migrasi sudah terbukti stabil beberapa hari).
4. Tambah file baru, isi dengan isi `apps-script/SP_Trigger.gs` dari repo
   ini.
5. Bikin **GitHub Personal Access Token**: buka
   https://github.com/settings/tokens?type=beta (fine-grained token) >
   **Generate new token** > pilih repo `ig-sp-automation` di "Repository
   access" > di "Permissions", cari **Contents** set ke **Read and write**
   (ini otomatis kasih akses ke endpoint dispatches). Generate, copy
   token-nya (cuma muncul sekali).
6. Di Apps Script, buka Project Settings > Script Properties, tambah 2 key:
   - `GITHUB_TOKEN` = token dari langkah 5
   - `GITHUB_REPO` = `namauser/ig-sp-automation` (ganti `namauser` sesuai
     akun GitHub kamu)
7. Jalankan `spTestTriggerConnection()` manual dari editor — cek Log,
   harus muncul "OK - sinyal terkirim ke GitHub Actions". Cek juga tab
   Actions di GitHub, harus muncul 1 run baru dari workflow Main Automation.
8. Kalau sudah OK, jalankan `spSetupPreciseTrigger()` SEKALI — ini
   masang trigger tiap 15 menit yang bakal jalan terus otomatis.

## Bagian 7 — Backfill data lama (opsional, sekali jalan)

Kalau sebelumnya ada progress backfill insight/komentar yang belum kelar
di sistem Apps Script lama, lanjutkan di sini: tab **Actions** > workflow
**"IG SP - Manual Backfill"** > **Run workflow** > pilih `post-insights`
atau `comments`. Beda dari Apps Script (yang harus di-re-trigger tiap
~10 menit karena batas 6 menit/eksekusi), di GitHub Actions ini akan jalan
terus dalam 1x run sampai BENERAN selesai (progress tetap disimpan di tab
`_State` pada spreadsheet Insights, jadi aman kalau run kepotong/gagal —
tinggal jalankan ulang, otomatis lanjut dari titik terakhir).

---

## Struktur project

```
src/lib/
  config.js            - konstanta (setara SP_Config.gs)
  googleAuth.js         - auth service account ke Sheets/Docs/Drive
  sheetsHelper.js        - helper generik Sheets API
  stateStore.js          - pengganti PropertiesService (cursor backfill)
  dateUtils.js            - parsing tanggal/jam (pengganti util Date Apps Script)
  sheetReader.js          - Modul 1 (SP_SheetReader.gs)
  driveFinder.js          - Modul 2 (SP_DriveFinder.gs)
  videoValidator.js       - cek audio bitrate MP4 (SP_VideoValidator.gs)
  docsReader.js           - Modul 3 (SP_DocsReader.gs)
  statusUpdater.js        - Modul 5 (SP_StatusUpdater.gs)
  instagramPublisher.js   - Modul 4 (SP_InstagramPublisher.gs)
  mainOrchestrator.js     - Modul 6 (SP_MainOrchestrator.gs)
  insightsTracker.js      - Modul 7 (SP_InsightsTracker.gs)
  commentArchive.js       - SP_CommentArchive.gs
scripts/                  - entrypoint yang dipanggil tiap workflow
.github/workflows/        - definisi jadwal GitHub Actions
apps-script/SP_Trigger.gs - isi BARU project Apps Script (pengganti 11 file lama)
```

## Yang beda dari versi Apps Script (dan kenapa)

- **Auth**: implisit (akun pemilik script) -> Service Account eksplisit,
  karena GitHub Actions tidak "login" sebagai siapa-siapa.
- **PropertiesService (cursor backfill)** -> tab `_State` di spreadsheet
  Insights, karena GitHub Actions runner sekali pakai (tidak ada tempat
  penyimpanan lokal yang persisten).
- **LockService** (anti-tumpang-tindih) -> `concurrency:` group di
  workflow YAML, cara yang lebih natural di GitHub Actions.
- **Batas 6 menit/eksekusi Apps Script** (yang bikin backfill harus
  di-re-trigger berkali-kali tiap ~10 menit) -> tidak ada lagi; backfill
  jalan sampai selesai dalam 1x run job (jatah sampai beberapa jam).
- **Trigger tiap 15 menit**: tetap di Apps Script (presisi + gratis),
  tapi isinya cuma 1 sinyal ringan ke GitHub — kerja berat pindah semua
  ke Node.js. Ini yang menyelesaikan masalah kuota UrlFetch harian.
