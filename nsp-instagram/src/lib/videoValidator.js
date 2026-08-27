/**
 * videoValidator.js
 * Port dari SP_VideoValidator.gs - baca isi file video (bukan cuma metadata)
 * buat cek AUDIO BITRATE, lewat HTTP Range request (bukan download utuh).
 * Logikanya PERSIS sama seperti versi Apps Script, cuma UrlFetchApp diganti
 * fetch() bawaan Node 20+, dan array byte signed Java diganti Buffer/Uint8Array.
 */

const MAX_MOOV_FETCH_BYTES = 10 * 1024 * 1024; // 10MB

function readUint32BE(bytes, offset) {
  return (bytes[offset] << 24 >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function bytesToAscii(bytes, offset, length) {
  let chars = "";
  for (let i = 0; i < length; i++) chars += String.fromCharCode(bytes[offset + i]);
  return chars;
}

function enumerateBoxes(bytes, rangeStart, rangeEnd) {
  const boxes = [];
  let offset = rangeStart;

  while (offset + 8 <= rangeEnd) {
    const size = readUint32BE(bytes, offset);
    const type = bytesToAscii(bytes, offset + 4, 4);

    if (size === 0) {
      boxes.push({ type, contentStart: offset + 8, contentEnd: rangeEnd });
      break;
    }
    if (size === 1) break; // 64-bit extended size, tidak di-handle (sama seperti versi Apps Script)
    if (size < 8 || offset + size > rangeEnd) break;

    boxes.push({ type, contentStart: offset + 8, contentEnd: offset + size });
    offset += size;
  }

  return boxes;
}

function findBox(boxes, type) {
  return boxes.find((b) => b.type === type) || null;
}

function parseMdhd(bytes, mdhd) {
  const version = bytes[mdhd.contentStart];
  const base = mdhd.contentStart + 4;

  if (version === 1) {
    const timescale = readUint32BE(bytes, base + 16);
    const durationHigh = readUint32BE(bytes, base + 20);
    const durationLow = readUint32BE(bytes, base + 24);
    const duration = durationHigh * 4294967296 + durationLow;
    return { timescale, duration };
  }
  const timescale = readUint32BE(bytes, base + 8);
  const duration = readUint32BE(bytes, base + 12);
  return { timescale, duration };
}

function sumStszSizes(bytes, stsz) {
  const base = stsz.contentStart + 4;
  const sampleSize = readUint32BE(bytes, base);
  const sampleCount = readUint32BE(bytes, base + 4);

  if (sampleSize !== 0) return sampleSize * sampleCount;

  const tableStart = base + 8;
  const tableEnd = tableStart + sampleCount * 4;
  if (tableEnd > stsz.contentEnd) return null;

  let total = 0;
  for (let i = 0; i < sampleCount; i++) total += readUint32BE(bytes, tableStart + i * 4);
  return total;
}

function extractAudioBitrateFromBytes(bytes) {
  const topBoxes = enumerateBoxes(bytes, 0, bytes.length);
  const moov = findBox(topBoxes, "moov");
  if (!moov) return null;

  const moovChildren = enumerateBoxes(bytes, moov.contentStart, moov.contentEnd);

  for (const trak of moovChildren.filter((b) => b.type === "trak")) {
    const trakChildren = enumerateBoxes(bytes, trak.contentStart, trak.contentEnd);
    const mdia = findBox(trakChildren, "mdia");
    if (!mdia) continue;

    const mdiaChildren = enumerateBoxes(bytes, mdia.contentStart, mdia.contentEnd);
    const hdlr = findBox(mdiaChildren, "hdlr");
    if (!hdlr) continue;

    const handlerType = bytesToAscii(bytes, hdlr.contentStart + 8, 4);
    if (handlerType !== "soun") continue;

    const mdhd = findBox(mdiaChildren, "mdhd");
    const minf = findBox(mdiaChildren, "minf");
    if (!mdhd || !minf) return null;

    const durationInfo = parseMdhd(bytes, mdhd);

    const minfChildren = enumerateBoxes(bytes, minf.contentStart, minf.contentEnd);
    const stbl = findBox(minfChildren, "stbl");
    if (!stbl) return null;

    const stblChildren = enumerateBoxes(bytes, stbl.contentStart, stbl.contentEnd);
    const stsz = findBox(stblChildren, "stsz");
    if (!stsz) return null;

    const totalBytes = sumStszSizes(bytes, stsz);
    if (totalBytes === null) return null;

    const durationSeconds = durationInfo.duration / durationInfo.timescale;
    if (durationSeconds <= 0) return null;

    return (totalBytes * 8) / durationSeconds / 1000;
  }

  return null;
}

/** Setara spFetchByteRange_. @return {Uint8Array|null} */
async function fetchByteRange(url, startByte, endByte) {
  try {
    const response = await fetch(url, { headers: { Range: `bytes=${startByte}-${endByte}` } });

    console.log(
      `    [Range fetch] diminta bytes=${startByte}-${endByte} | response code: ${response.status} | ` +
        `Content-Length: ${response.headers.get("content-length") || "?"} | ` +
        `Content-Range: ${response.headers.get("content-range") || "(tidak ada)"}`
    );

    if (response.status !== 206) {
      console.log("    [Range fetch] BUKAN 206 Partial Content - Range kemungkinan tidak didukung server ini.");
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (err) {
    console.log(`    [Range fetch] Error: ${err.message}`);
    return null;
  }
}

/** Setara spLocateMoovBox_. */
async function locateMoovBox(url, fileSize) {
  let offset = 0;
  const maxIterations = 20;

  for (let i = 0; i < maxIterations; i++) {
    if (offset + 8 > fileSize) return null;

    const headerBytes = await fetchByteRange(url, offset, offset + 7);
    if (!headerBytes || headerBytes.length < 8) return null;

    const size = readUint32BE(headerBytes, 0);
    const type = bytesToAscii(headerBytes, 4, 4);

    console.log(`    [Box walk] offset=${offset} type='${type}' size=${size}`);

    if (type === "moov") return { start: offset, size };
    if (size === 0 || size === 1 || size < 8) return null;
    offset += size;
  }

  return null;
}

/** Setara spCheckAudioBitrate_. @return {number|null} bitrate kbps */
async function checkAudioBitrate(fileInfo) {
  const url = fileInfo.directUrl;
  const sizeBytes = fileInfo.fileSizeBytes;

  console.log(`  [Audio check] File size: ${sizeBytes} byte, URL: ${url}`);
  console.log("  [Audio check] Cari lokasi box 'moov'...");

  const moovLocation = await locateMoovBox(url, sizeBytes);
  if (!moovLocation) {
    console.log("  [Audio check] Box 'moov' tidak ketemu lewat box-walking.");
    return null;
  }

  console.log(`  [Audio check] 'moov' ketemu di offset ${moovLocation.start}, ukuran ${moovLocation.size} byte.`);

  if (moovLocation.size > MAX_MOOV_FETCH_BYTES) {
    console.log(`  [Audio check] 'moov' terlalu besar (${moovLocation.size} byte) - dilewatkan demi keamanan.`);
    return null;
  }

  const moovBytes = await fetchByteRange(url, moovLocation.start, moovLocation.start + moovLocation.size - 1);
  if (!moovBytes) {
    console.log("  [Audio check] Gagal fetch isi 'moov'.");
    return null;
  }

  console.log(`  [Audio check] Dapat ${moovBytes.length} byte, coba parse...`);
  const result = extractAudioBitrateFromBytes(moovBytes);
  console.log(
    `  [Audio check] Hasil parse: ${result === null ? "gagal (struktur di dalam moov tidak lengkap/dikenali)" : result.toFixed(1) + " kbps"}`
  );

  return result;
}

module.exports = { checkAudioBitrate };
