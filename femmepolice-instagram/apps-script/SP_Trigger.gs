/**
 * SP_Trigger.gs
 * =====================================================
 * VERSI BARU project Apps Script "Instagram sp Automation" - GANTIKAN
 * SEMUA file lama (SP_Config, SP_SheetReader, SP_DriveFinder,
 * SP_VideoValidator, SP_DocsReader, SP_StatusUpdater, SP_MainOrchestrator,
 * SP_InstagramPublisher, SP_InsightsTracker, SP_CommentArchive) dengan
 * FILE INI SAJA.
 *
 * Tugas project ini sekarang CUMA SATU: jadi "pemicu" yang presisi jamnya
 * (time-based trigger Apps Script memang akurat & gratis), yang ngirim
 * 1 sinyal ringan (1x UrlFetch) ke GitHub tiap kali waktunya. Semua
 * kerjaan berat (baca sheet, cari file Drive, publish ke Instagram, dst)
 * sudah pindah total ke repo GitHub (Node.js, dieksekusi oleh GitHub
 * Actions).
 *
 * KENAPA INI MENYELESAIKAN MASALAH KUOTA: dulu tiap siklus 15 menit bisa
 * makan puluhan UrlFetch (Drive API buat cari file, Graph API buat
 * publish+polling, dst) - itu yang bikin kena limit harian. Sekarang tiap
 * siklus cuma 1 UrlFetch (ke GitHub), sisanya nol.
 * =====================================================
 *
 * SETUP (sekali saja):
 * 1. Buka Project Settings (ikon gerigi) > Script Properties, tambah 2 key:
 *    - GITHUB_TOKEN       : Personal Access Token GitHub (lihat README.md
 *                           repo, bagian "Apps Script Trigger Setup")
 *    - GITHUB_REPO        : "namauser/namarepo", misal "oqaja/ops-pipeline-core"
 * 2. Jalankan fungsi spSetupPreciseTrigger() SEKALI dari editor ini.
 */

function spTriggerGithubAutomation() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("GITHUB_TOKEN");
  var repo = props.getProperty("GITHUB_REPO");

  if (!token || !repo) {
    Logger.log("GAGAL: GITHUB_TOKEN dan/atau GITHUB_REPO belum di-set di Script Properties.");
    return;
  }

  var url = "https://api.github.com/repos/" + repo + "/dispatches";

  var options = {
    method: "post",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
    },
    contentType: "application/json",
    payload: JSON.stringify({ event_type: "run-main-automation" }),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();

  if (code === 204) {
    Logger.log("OK - sinyal terkirim ke GitHub Actions (" + repo + ").");
  } else {
    Logger.log("GAGAL kirim sinyal (HTTP " + code + "): " + response.getContentText());
  }
}

/**
 * Jalankan fungsi ini SEKALI SAJA (manual) untuk memasang trigger presisi
 * tiap 15 menit. Ini menggantikan spSetupTrigger() versi lama.
 */
function spSetupPreciseTrigger() {
  spRemovePreciseTrigger();

  ScriptApp.newTrigger("spTriggerGithubAutomation")
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log("Trigger presisi dipasang. Tiap 15 menit akan kirim sinyal ke GitHub Actions.");
}

function spRemovePreciseTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removedCount = 0;
  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "spTriggerGithubAutomation") {
      ScriptApp.deleteTrigger(trigger);
      removedCount++;
    }
  });
  Logger.log("Trigger dihapus: " + removedCount + " trigger.");
}

/** Test manual - jalankan sekali dari editor buat mastiin koneksi ke GitHub sehat. */
function spTestTriggerConnection() {
  spTriggerGithubAutomation();
}
