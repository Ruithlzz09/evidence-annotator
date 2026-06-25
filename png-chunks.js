// png-chunks.js
// Pure-JS PNG iTXt chunk read/write. No deps beyond pako (loaded globally via <script>).
//
// Format reference: PNG spec section 11.3.3.5 (iTXt chunk).
// Layout of iTXt data:
//   keyword \0 compression_flag compression_method language_tag \0 translated_keyword \0 text
//
// We always write: compression_flag=1, compression_method=0 (zlib), empty lang, empty translated.
// We always read: support both compressed (flag=1) and uncompressed (flag=0).

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const OUR_KEYWORD = 'ann.editor';

// ── CRC32 (PNG uses standard zlib CRC32) ───────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function verifySignature(bytes) {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Not a valid PNG file (signature mismatch)');
    }
  }
}

function readUint32BE(view, offset) {
  return view.getUint32(offset, false);
}

function findNull(bytes, start, limit) {
  for (let i = start; i < limit; i++) {
    if (bytes[i] === 0) return i;
  }
  return -1;
}

// ── Public: read annotation JSON from a PNG ────────────────────────────────

/**
 * Read our annotation document from a PNG.
 * @param {ArrayBuffer} arrayBuffer - the raw PNG bytes
 * @returns {object | null} - parsed JSON document, or null if absent/invalid
 */
function readAnnotationsFromPng(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  verifySignature(bytes);

  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(view, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (type === 'iTXt') {
      const parsed = parseITxtChunk(bytes.subarray(dataStart, dataEnd));
      if (parsed && parsed.keyword === OUR_KEYWORD) {
        try {
          return JSON.parse(parsed.text);
        } catch (e) {
          console.warn('iTXt chunk found but JSON is invalid:', e);
          return null;
        }
      }
    }

    if (type === 'IEND') break;
    offset = dataEnd + 4; // skip CRC
  }
  return null;
}

function parseITxtChunk(data) {
  // keyword (Latin-1, null-terminated)
  const keywordEnd = findNull(data, 0, data.length);
  if (keywordEnd < 0) return null;
  const keyword = new TextDecoder('latin1').decode(data.subarray(0, keywordEnd));

  let i = keywordEnd + 1;
  if (i + 2 > data.length) return null;
  const compressionFlag = data[i++];
  const compressionMethod = data[i++];

  // language tag (ASCII, null-terminated)
  const langEnd = findNull(data, i, data.length);
  if (langEnd < 0) return null;
  // (we ignore the language tag content)
  i = langEnd + 1;

  // translated keyword (UTF-8, null-terminated)
  const transEnd = findNull(data, i, data.length);
  if (transEnd < 0) return null;
  i = transEnd + 1;

  // text (UTF-8, possibly compressed)
  const textBytes = data.subarray(i);
  let text;
  try {
    if (compressionFlag === 1) {
      if (compressionMethod !== 0) {
        console.warn('Unknown iTXt compression method:', compressionMethod);
        return null;
      }
      // pako is loaded globally via <script>
      const decompressed = pako.inflate(textBytes);
      text = new TextDecoder('utf-8').decode(decompressed);
    } else {
      text = new TextDecoder('utf-8').decode(textBytes);
    }
  } catch (e) {
    console.warn('Failed to decode iTXt text:', e);
    return null;
  }

  return { keyword, text };
}

// ── Public: write a PNG with annotations embedded ──────────────────────────

/**
 * Build a new PNG: same image data, but with our iTXt chunk replaced/inserted.
 * Strips any pre-existing iTXt chunks with our keyword; inserts a fresh one
 * just before the IEND chunk.
 *
 * @param {ArrayBuffer} arrayBuffer - the original PNG bytes
 * @param {object} document - the annotation document to serialize
 * @returns {Uint8Array} - the new PNG bytes
 */
function writeAnnotationsToPng(arrayBuffer, document) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  verifySignature(bytes);

  const newChunks = [];
  newChunks.push(bytes.subarray(0, 8)); // signature

  let offset = 8;
  let insertedBeforeIEND = false;

  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(view, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const chunkEnd = offset + 12 + length; // length(4) + type(4) + data(length) + crc(4)

    let skip = false;
    if (type === 'iTXt') {
      const parsed = parseITxtChunk(bytes.subarray(offset + 8, offset + 8 + length));
      if (parsed && parsed.keyword === OUR_KEYWORD) {
        skip = true; // drop the old one; we'll insert fresh
      }
    }

    if (type === 'IEND') {
      newChunks.push(buildITxtChunk(OUR_KEYWORD, JSON.stringify(document)));
      newChunks.push(bytes.subarray(offset, chunkEnd));
      insertedBeforeIEND = true;
      break;
    }

    if (!skip) {
      newChunks.push(bytes.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
  }

  if (!insertedBeforeIEND) {
    throw new Error('PNG had no IEND chunk — file is malformed');
  }

  const total = newChunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const c of newChunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return result;
}

function buildITxtChunk(keyword, text) {
  const compressed = pako.deflate(new TextEncoder().encode(text));
  const keywordBytes = new TextEncoder().encode(keyword); // keyword is ASCII for our use

  // chunk data: keyword \0 compFlag compMethod \0(lang) \0(transKey) compressedText
  const dataLen = keywordBytes.length + 1 + 1 + 1 + 1 + 1 + compressed.length;
  const data = new Uint8Array(dataLen);
  let p = 0;
  data.set(keywordBytes, p); p += keywordBytes.length;
  data[p++] = 0;  // null after keyword
  data[p++] = 1;  // compression flag (compressed)
  data[p++] = 0;  // compression method (zlib)
  data[p++] = 0;  // empty language tag → just its terminating null
  data[p++] = 0;  // empty translated keyword → just its terminating null
  data.set(compressed, p);

  // chunk: length(4) + type(4) + data + crc(4)
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, data.length, false);
  chunk[4] = 'i'.charCodeAt(0);
  chunk[5] = 'T'.charCodeAt(0);
  chunk[6] = 'X'.charCodeAt(0);
  chunk[7] = 't'.charCodeAt(0);
  chunk.set(data, 8);

  // CRC covers type + data (not length, not the CRC field itself)
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  cv.setUint32(8 + data.length, crc, false);

  return chunk;
}
