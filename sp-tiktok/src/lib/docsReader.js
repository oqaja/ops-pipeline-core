const { CONFIG } = require("./config");

function extractTextFromBody(body) {
  if (!body || !body.content) return "";
  let text = "";
  for (const el of body.content) {
    if (el.paragraph && el.paragraph.elements) {
      for (const pe of el.paragraph.elements) {
        if (pe.textRun && pe.textRun.content) text += pe.textRun.content;
      }
    }
  }
  return text;
}

function parseSemuaKontenDalamTab(teks) {
  const baris = teks.replace(/[\r\v]+/g, "\n").split("\n");
  const blocks = [];
  let buffer = {};
  let labelAktif = null;
  let adaBlockAktif = false;

  function simpanBlockJikaAda() {
    if (!adaBlockAktif) return;
    const hasil = { judulKonten: "", deskripsiYoutube: "", captionHashtag: "" };
    if (buffer["judul konten:"]) hasil.judulKonten = buffer["judul konten:"].join("\n").trim();
    if (buffer["deskripsi youtube:"]) hasil.deskripsiYoutube = buffer["deskripsi youtube:"].join("\n").trim();
    if (buffer["caption + hashtag:"]) hasil.captionHashtag = buffer["caption + hashtag:"].join("\n").trim();
    if (hasil.judulKonten) blocks.push(hasil);
  }

  baris.forEach((line) => {
    const bersih = line.trim();
    const bersihLower = bersih.toLowerCase();

    if (bersihLower.indexOf("tanggal upload:") === 0) {
      simpanBlockJikaAda();
      buffer = {};
      adaBlockAktif = true;
      labelAktif = "tanggal upload:";
      return;
    }

    const labelKetemu = CONFIG.LABEL_LIST.filter((l) => bersihLower.indexOf(l) === 0)[0];

    if (labelKetemu) {
      labelAktif = labelKetemu;
      if (!buffer[labelAktif]) buffer[labelAktif] = [];
      const sisaTeks = bersih.substring(labelKetemu.length).trim();
      if (sisaTeks) buffer[labelAktif].push(sisaTeks);
    } else if (labelAktif && adaBlockAktif) {
      if (!buffer[labelAktif]) buffer[labelAktif] = [];
      buffer[labelAktif].push(bersih);
    }
  });

  simpanBlockJikaAda();
  return blocks;
}

function telusuriTabCariJudul(tabs, judulDicari) {
  for (const tab of tabs || []) {
    const body = tab.documentTab && tab.documentTab.body;
    const teks = extractTextFromBody(body);
    const blocks = parseSemuaKontenDalamTab(teks);

    for (const b of blocks) {
      if (b.judulKonten.trim().toLowerCase() === judulDicari.trim().toLowerCase()) {
        return b;
      }
    }

    if (tab.childTabs && tab.childTabs.length > 0) {
      const hasilChild = telusuriTabCariJudul(tab.childTabs, judulDicari);
      if (hasilChild) return hasilChild;
    }
  }
  return null;
}

async function cariKontenDiDocsMaster(docs, judulDicari) {
  const res = await docs.documents.get({
    documentId: CONFIG.DOC_MASTER_ID,
    includeTabsContent: true,
  });
  const semuaTab = res.data.tabs || [];
  return telusuriTabCariJudul(semuaTab, judulDicari);
}

module.exports = { cariKontenDiDocsMaster };
