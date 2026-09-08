"use strict";
/**
 * Batch O (docs/TASKS.md) — decodes a real AFP page-segment or overlay
 * RESOURCE OBJECT (the external file a DDS `PAGSEG`/`OVERLAY`/`AFPRSC`
 * keyword names but never embeds — see docs/REQUIREMENTS.md §8) into an
 * actual displayable raster image, replacing Batch E's fixed-size labeled
 * placeholder box wherever a real resource file is available.
 *
 * Scope, precisely: this module decodes the IOCA (Image Object Content
 * Architecture) Function Set 10 image format — the overwhelmingly common
 * real-world case for a page segment (a scanned company logo/letterhead,
 * or a generated barcode/QR image like this module's own real verification
 * fixture — see test/fixtures/afp/NOTICE.md). It does NOT attempt PTOCA
 * (text) or GOCA (vector graphics) content, which a real OVERLAY resource
 * can also legally contain instead of/alongside an image — those would
 * need their own, substantially different decoders; a resource containing
 * only those gets an honest "unsupported content type" result rather than
 * a guess. Nor does it attempt IOCA function sets other than FS10 (FS11/
 * FS45 add color/grayscale/tiling support real page segments occasionally
 * use) — again, honestly unsupported rather than misdecoded.
 *
 * Pipeline, matching the real MO:DCA/IOCA structure (verified byte-by-
 * byte against a real Apache-2.0-licensed fixture — see
 * test/fixtures/afp/NOTICE.md — and cross-referenced against IBM's own
 * IOCA Function Set 10 structure table):
 *  1. findResourceImage: scan the resource object's top-level MO:DCA
 *     structured fields for a BPS/EPS (page segment) or BOL/EOL (overlay)
 *     wrapper (falling back to BOG/EOG, an older/simpler object-group
 *     wrapper some tools — including this project's own earlier Batch O
 *     source-hunting — produce instead), find the BIM/EIM (Begin/End
 *     Image) pair inside it, and concatenate every IPD (Image Picture
 *     Data) structured field's own payload in between into one
 *     contiguous IOCA content stream (a single logical image's raster
 *     data routinely spans several physical IPD structured fields, since
 *     each one is capped at MO:DCA's ~32KB structured-field size limit).
 *  2. parseIocaContent: walk that content stream's own internal self-
 *     defining-field structure (0x70 Begin Segment .. 0x94 Image Size ..
 *     0x95 Image Encoding .. 0x96 IDE Size .. 0xFE92 Image Data
 *     (repeated) .. 0x71 End Segment) to pull out width/height/bits-per-
 *     pixel/compression and the concatenated raw image data.
 *  3. decodeRaster: dispatch on the declared compression id — genuinely
 *     uncompressed (COMPRID 0x03, "No compression" per IBM's own IOCA
 *     Function Set 10 table) is a straight bit-unpack; G4 MMR (COMPRID
 *     0x82) goes through the vendored real CCITT decoder
 *     (afpCcittDecoder.js). IBM MMR (COMPRID 0x01) — a proprietary IBM
 *     variant, NOT the same bitstream as standard G4 — is explicitly
 *     unsupported rather than fed through the G4 decoder and silently
 *     misdecoded.
 *  4. encodeGrayscalePng: a real PNG encoder (grayscale, 8 bits/pixel —
 *     simpler and more broadly compatible than a 1-bit/paletted PNG for
 *     negligible size cost at these dimensions) built on Node's own
 *     built-in `zlib`, so no new dependency is needed for this step.
 *
 * IOCA's own documented IDE convention ("IDE value 0 represents an
 * insignificant image point, and 1 represents a significant image point.
 * The controlling environment determines how to interpret each value.")
 * is resolved here as: 1 (significant) -> black ink, 0 -> white
 * background — confirmed against this module's own real verification
 * fixture (test/fixtures/afp/NOTICE.md) to produce a normal-looking
 * black-ink-on-white-background image, not an inverted negative.
 */

const AfpCcittDecoder = require("./afpCcittDecoder.js");

// --- Step 1: locate the image content inside the resource object -------

/**
 * Walks the MO:DCA structured-field introducer format (X'5A' + 2-byte
 * length + 3-byte type ID + 1-byte flags + 2-byte reserved + data), same
 * convention this project's own AFP-adjacent code (none yet outside this
 * module) would need — returns `{ offset, sflen, id, dataOffset, dataLength }`
 * for every structured field found. `sflen` is the length field's own raw
 * value (covers everything from the length field itself through the end
 * of the structured field, per the MO:DCA architecture reference — NOT
 * including the introducer byte); a structured field's total on-disk
 * length is therefore `1 + sflen`.
 */
function scanStructuredFields(buffer) {
  const fields = [];
  let i = 0;
  while (i < buffer.length - 6) {
    if (buffer[i] !== 0x5a) {
      i++;
      continue;
    }
    const sflen = buffer.readUInt16BE(i + 1);
    if (sflen < 5) {
      // A structured field always has at least a 3-byte ID + 1-byte flags
      // + 2-byte reserved beyond the length field itself; anything
      // shorter than that isn't a real structured field at this offset.
      i++;
      continue;
    }
    const id = (buffer[i + 3] << 16) | (buffer[i + 4] << 8) | buffer[i + 5];
    const dataOffset = i + 9;
    const dataLength = sflen - 8; // sflen covers id(3)+flags(1)+reserved(2)+data
    fields.push({ offset: i, sflen, id, dataOffset, dataLength: Math.max(0, dataLength) });
    i = i + 1 + sflen;
  }
  return fields;
}

// AFP structured-field object names (BPS's/BOG's own data payload, an
// 8-byte space-padded name) are EBCDIC-encoded (IBM code page 037), not
// ASCII — a real gap this module's own real-fixture testing (see
// test/afpResourceDecoder.test.ts) caught: the FOP fixture's resource
// name decoded as garbage bytes under a plain ASCII interpretation, and
// turned out to be the perfectly readable "S1CODEQR" once decoded as
// EBCDIC. This table is IBM code page 037 (the common Latin-1-adjacent
// EBCDIC variant used throughout AFP/MO:DCA object names), generated from
// Python's own built-in 'cp037' codec for authoritativeness — CP037
// itself has been an IBM-published, unchanging standard since the 1980s.
const EBCDIC_CP037_TO_ASCII = [0,1,2,3,156,9,134,127,151,141,142,11,12,13,14,15,16,17,18,19,157,133,8,135,24,25,146,143,28,29,30,31,128,129,130,131,132,10,23,27,136,137,138,139,140,5,6,7,144,145,22,147,148,149,150,4,152,153,154,155,20,21,158,26,32,160,226,228,224,225,227,229,231,241,162,46,60,40,43,124,38,233,234,235,232,237,238,239,236,223,33,36,42,41,59,172,45,47,194,196,192,193,195,197,199,209,166,44,37,95,62,63,248,201,202,203,200,205,206,207,204,96,58,35,64,39,61,34,216,97,98,99,100,101,102,103,104,105,171,187,240,253,254,177,176,106,107,108,109,110,111,112,113,114,170,186,230,184,198,164,181,126,115,116,117,118,119,120,121,122,161,191,208,221,222,174,94,163,165,183,169,167,182,188,189,190,91,93,175,168,180,215,123,65,66,67,68,69,70,71,72,73,173,244,246,242,243,245,125,74,75,76,77,78,79,80,81,82,185,251,252,249,250,255,92,247,83,84,85,86,87,88,89,90,178,212,214,210,211,213,48,49,50,51,52,53,54,55,56,57,179,219,220,217,218,159];

function decodeEbcdic(buffer, start, length) {
  let s = "";
  for (let i = start; i < start + length; i++) s += String.fromCharCode(EBCDIC_CP037_TO_ASCII[buffer[i]]);
  return s;
}

// Structured-field type IDs this module recognizes, by their 3-byte
// numeric value (class<<16 | type<<8 | category) — named here rather than
// computed inline so the scan logic below reads like the real MO:DCA
// structured-field names rather than a wall of hex literals.
const SF = {
  BPS: 0xd3a85f, // Begin Page Segment
  EPS: 0xd3a95f, // End Page Segment
  BOL: 0xd3a8df, // Begin Overlay ("BMO" in some references) — per IANA's registered AFP magic numbers (iana.org/assignments/media-types/application/vnd.afpc.modca-overlay)
  EOL: 0xd3a9df, // End Overlay ("EMO")
  BOG: 0xd3a8c7, // Begin Object Environment Group (older/simpler wrapper — see this module's own header comment) — cross-checked against afplib's own SFName.java constants
  EOG: 0xd3a9c7, // End Object Environment Group
  BIM: 0xd3a8fb, // Begin Image
  EIM: 0xd3a9fb, // End Image
  IPD: 0xd3eefb, // Image Picture Data
};

/**
 * Finds the first page-segment/overlay-style resource wrapper in
 * `buffer` and, inside it, the first BIM..EIM image, concatenating every
 * IPD structured field's own data payload found in between (see this
 * module's own header comment for why more than one IPD is the normal
 * case, not an edge case). Returns `{ name, imageBytes }` — `name` comes
 * from the wrapper's own structured-field data when present (both BPS and
 * BOL carry the resource's object name as their entire data payload, an
 * 8-byte space-padded EBCDIC name per MO:DCA convention), falling back to
 * an empty string for a bare image with no outer BPS/BOL wrapper at all
 * (some tools — including this project's own earlier Batch O source-
 * hunting — produce a raw image wrapped only in BOG/EOG, "Begin/End
 * Object Environment Group", with no separate name field at all).
 *
 * Deliberately does NOT treat a nested BOG/EOG *inside* a BPS/BOL as
 * another naming opportunity — a real page segment's own BIM..EIM image
 * content is itself commonly wrapped in its own BOG/EOG pair (grouping
 * that image's own Object Area Descriptor/Position parameters), which
 * carries no name at all and is NOT the same structured field as the
 * bare top-level BOG/EOG fallback case above. Conflating the two was a
 * real bug caught by this module's own real-fixture test (see
 * test/afpResourceDecoder.test.ts): the FOP fixture's real resource name
 * ("S1CODEQR", once EBCDIC-decoded — see decodeEbcdic above) was silently
 * overwritten by the inner BOG's own empty data payload before this fix.
 *
 * Returns `undefined` if no BIM..EIM image content is found at all — a
 * resource containing only PTOCA/GOCA content (see this module's own
 * header comment on scope) legitimately has no BIM to find, and that's
 * reported as "no image found" rather than a decode failure.
 */
function findBimEimImage(fields, buffer, startIndex, endIndex) {
  let bimIndex = -1;
  for (let i = startIndex; i < endIndex; i++) {
    if (fields[i].id === SF.BIM && bimIndex === -1) {
      bimIndex = i;
    } else if (fields[i].id === SF.EIM && bimIndex !== -1) {
      const chunks = [];
      for (let j = bimIndex + 1; j < i; j++) {
        if (fields[j].id === SF.IPD) chunks.push(buffer.subarray(fields[j].dataOffset, fields[j].dataOffset + fields[j].dataLength));
      }
      return Buffer.concat(chunks);
    }
  }
  return undefined;
}

function findResourceImage(buffer) {
  const fields = scanStructuredFields(buffer);

  // First pass: a real, named resource-object wrapper (BPS/EPS for a page
  // segment, BOL/EOL for an overlay) — search for its own BIM..EIM pair
  // strictly within its own boundaries, so an inner BOG/EOG's lack of a
  // name (see this function's own doc comment) never gets a chance to be
  // mistaken for the outer resource's name.
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const isPageSegment = f.id === SF.BPS;
    const isOverlay = f.id === SF.BOL;
    if (!isPageSegment && !isOverlay) continue;
    const closeId = isPageSegment ? SF.EPS : SF.EOL;
    let closeIndex = fields.length;
    for (let j = i + 1; j < fields.length; j++) {
      if (fields[j].id === closeId) {
        closeIndex = j;
        break;
      }
    }
    const imageBytes = findBimEimImage(fields, buffer, i + 1, closeIndex);
    if (imageBytes) {
      const name = decodeEbcdic(buffer, f.dataOffset, f.dataLength).trim();
      return { name, imageBytes };
    }
  }

  // Fall back to a bare BIM..EIM pair with no outer BPS/BOL wrapper at
  // all — see this function's own doc comment for why (afplib's own
  // bim.afp test fixture, encountered while researching this batch, is
  // exactly this shape).
  const bareImageBytes = findBimEimImage(fields, buffer, 0, fields.length);
  if (bareImageBytes) return { name: "", imageBytes: bareImageBytes };

  return undefined;
}

// --- Step 2: parse the IOCA self-defining-field content stream ----------

// Image Encoding Parameter COMPRID values, per IBM's own IOCA Function
// Set 10 structure table.
const COMPRID_NONE = 0x03; // "No compression" — despite the low-looking number, this is the uncompressed case, not IBM's own MMR variant
const COMPRID_IBM_MMR = 0x01; // proprietary IBM variant — NOT the same bitstream as standard G4, unsupported here
const COMPRID_G4_MMR = 0x82; // ITU-T T.6 Group 4 — handled via the vendored afpCcittDecoder.js

/**
 * Parses the IOCA Function Set 10 self-defining-field stream (see this
 * module's own header comment for the field sequence) into
 * `{ width, height, bitsPerIde, compressionId, imageData }`. Throws with
 * a specific message naming which self-defining field ID wasn't
 * recognized, rather than silently misreading subsequent offsets — an
 * unrecognized ID this early in the stream means either a different IOCA
 * function set (FS11/FS45 — out of scope, see header) or genuinely
 * corrupt/truncated data, and either way guessing forward would produce
 * garbage dimensions/pixels with no way for a caller to tell.
 */
function parseIocaContent(bytes) {
  let pos = 0;
  let width;
  let height;
  let bitsPerIde = 1; // IOCA's own documented default when the IDE Size Parameter (0x96) is omitted
  let compressionId = COMPRID_NONE; // documented default when the Image Encoding Parameter (0x95) is omitted
  const imageChunks = [];
  while (pos < bytes.length - 1) {
    const id = bytes[pos];
    if (id === 0xfe && bytes[pos + 1] === 0x92) {
      const length = bytes.readUInt16BE(pos + 2);
      imageChunks.push(bytes.subarray(pos + 4, pos + 4 + length));
      pos += 4 + length;
    } else if (id === 0x94) {
      const length = bytes[pos + 1];
      const p = pos + 2;
      // Image Size Parameter: Unitbase(1), HRESOL(2), VRESOL(2), HSIZE(2), VSIZE(2)
      width = bytes.readUInt16BE(p + 5);
      height = bytes.readUInt16BE(p + 7);
      pos += 2 + length;
    } else if (id === 0x95) {
      const length = bytes[pos + 1];
      compressionId = bytes[pos + 2];
      pos += 2 + length;
    } else if (id === 0x96) {
      const length = bytes[pos + 1];
      bitsPerIde = bytes[pos + 2];
      pos += 2 + length;
    } else if (id === 0x70 || id === 0x91 || id === 0x93 || id === 0x71 || id === 0x97 || id === 0x99 || id === 0x9a) {
      // Begin Segment / Begin Image Content / End Image Content / End
      // Segment / Image LUT-ID / Tile Size / Image Subsampling — none of
      // these affect this module's own decoding decisions for FS10, so
      // their payloads are skipped rather than parsed.
      const length = bytes[pos + 1];
      pos += 2 + length;
    } else {
      throw new Error("afpResourceDecoder: unrecognized IOCA self-defining field 0x" + id.toString(16) + " at content offset " + pos + " (a different IOCA function set, or truncated/corrupt data)");
    }
  }
  if (width === undefined || height === undefined) {
    throw new Error("afpResourceDecoder: no Image Size Parameter (0x94) found — can't determine image dimensions");
  }
  return { width, height, bitsPerIde, compressionId, imageData: Buffer.concat(imageChunks) };
}

// --- Step 3: decode the raster ------------------------------------------

/**
 * Decodes `parsed.imageData` (from parseIocaContent) into a plain
 * Uint8Array of `width * height` entries, each 0 or 1 (1 = "significant"/
 * ink, per IOCA's own documented IDE convention — see this module's own
 * header comment for the black-ink-on-white-background polarity this was
 * verified to produce). Throws a specific, honest error — naming the
 * exact unsupported value — for anything outside this module's stated
 * scope (bitsPerIde !== 1, or a compression id that isn't "no
 * compression" or G4 MMR) rather than guessing.
 */
function decodeRaster(parsed) {
  const { width, height, bitsPerIde, compressionId, imageData } = parsed;
  if (bitsPerIde !== 1) {
    throw new Error("afpResourceDecoder: " + bitsPerIde + " bits/IDE isn't supported (only 1-bit/IDE bi-level images are — see this module's own header comment on scope)");
  }
  const rowBytes = Math.ceil(width / 8);
  const pixels = new Uint8Array(width * height);

  function unpackRow(rowBuf, y) {
    for (let x = 0; x < width; x++) {
      const byte = rowBuf[x >> 3];
      const bit = (byte >> (7 - (x & 7))) & 1;
      pixels[y * width + x] = bit;
    }
  }

  if (compressionId === COMPRID_NONE) {
    for (let y = 0; y < height; y++) {
      unpackRow(imageData.subarray(y * rowBytes, y * rowBytes + rowBytes), y);
    }
  } else if (compressionId === COMPRID_G4_MMR) {
    let readPos = 0;
    const source = { next() { return readPos < imageData.length ? imageData[readPos++] : -1; } };
    const decoder = new AfpCcittDecoder.CCITTFaxDecoder(source, {
      K: -1, // pure Group 4, 2-D encoding only — see afpCcittDecoder.js's own constructor doc
      Columns: width,
      Rows: height,
      BlackIs1: true, // empirically verified (test/afpCcittDecoder.test.ts) to make decoder output 1 == "significant" match this module's own polarity
      EndOfBlock: false, // IOCA's raster data has a known, fixed row count — it doesn't rely on an EOFB end-of-block marker the way an open-ended fax transmission would
    });
    const rowBuf = Buffer.alloc(rowBytes);
    for (let y = 0; y < height; y++) {
      for (let b = 0; b < rowBytes; b++) rowBuf[b] = decoder.readNextChar() & 0xff;
      unpackRow(rowBuf, y);
    }
  } else {
    const name = compressionId === COMPRID_IBM_MMR ? "IBM MMR (proprietary, not the same bitstream as standard G4)" : "0x" + compressionId.toString(16);
    throw new Error("afpResourceDecoder: compression id " + name + " isn't supported (only uncompressed and G4/MMR are — see this module's own header comment on scope)");
  }
  return pixels;
}

// --- Step 4: encode a PNG (grayscale, 8 bits/pixel) ---------------------

// Standard CRC-32 (ISO 3309 / ITU-T V.42), needed for PNG chunk trailers.
// Node's built-in `zlib` module doesn't expose a CRC-32 function (only
// full zlib/gzip/deflate streams), so this is implemented directly here —
// a small, well-known, unchanging algorithm, not something worth adding a
// dependency for.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

/**
 * Encodes `pixels` (a Uint8Array of `width * height` 0/1 entries, same
 * shape decodeRaster returns) as a real PNG file: grayscale, 8 bits/
 * pixel (1 -> ink -> gray value 0; 0 -> background -> gray value 255 —
 * see this module's own header comment on why this polarity, not the
 * other way around). Grayscale-8 rather than 1-bit/paletted for
 * simplicity (no palette chunk, no bit-packing-within-a-byte-respecting-
 * filter-bytes complexity) — the size cost is negligible at the
 * dimensions a page segment/overlay image realistically has, and every
 * `<img>`-capable renderer (including a VS Code webview) reads grayscale-8
 * PNG natively with no special handling.
 */
function encodeGrayscalePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type 0 = grayscale
  ihdr[10] = 0; // compression method (only 0 is defined)
  ihdr[11] = 0; // filter method (only 0 is defined)
  ihdr[12] = 0; // interlace method (0 = none)

  // Raw scanline data: one filter-type byte (0 = None) per row, then one
  // grayscale byte per pixel.
  const raw = Buffer.alloc(height * (1 + width));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width);
    raw[rowStart] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      raw[rowStart + 1 + x] = pixels[y * width + x] ? 0 : 255;
    }
  }
  // eslint-disable-next-line global-require
  const zlib = require("zlib");
  const idatData = zlib.deflateSync(raw);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", idatData), pngChunk("IEND", Buffer.alloc(0))]);
}

// --- Top-level convenience -----------------------------------------------

/**
 * Combines every step above: finds the image content in a resource
 * object's raw bytes, parses its IOCA descriptor, decodes the raster, and
 * encodes it as a PNG data URI ready to drop straight into an `<img
 * src="...">`. Returns `{ name, width, height, dataUri }` on success, or
 * `{ error }` (a specific, human-readable reason — never a generic
 * failure) when the resource can't be decoded — e.g. no image content
 * found at all (a text/graphics-only overlay), or an unsupported IOCA
 * function set/compression/bit depth. Never throws — a caller (e.g. the
 * properties panel's own "preview a local resource file" action) can
 * always show `error` directly as an explanatory message rather than
 * needing its own try/catch around this.
 */
function decodeAfpResourceToPngDataUri(buffer) {
  try {
    const found = findResourceImage(buffer);
    if (!found) {
      return { error: "No image (BIM/EIM) content found in this resource — it may be a text- or graphics-only overlay (PTOCA/GOCA), which this tool doesn't decode (see afpResourceDecoder.js's own header comment)." };
    }
    const parsed = parseIocaContent(found.imageBytes);
    const pixels = decodeRaster(parsed);
    const png = encodeGrayscalePng(parsed.width, parsed.height, pixels);
    return {
      name: found.name,
      width: parsed.width,
      height: parsed.height,
      dataUri: "data:image/png;base64," + png.toString("base64"),
    };
  } catch (e) {
    return { error: e.message };
  }
}

const mod = {
  scanStructuredFields,
  findResourceImage,
  parseIocaContent,
  decodeRaster,
  encodeGrayscalePng,
  decodeAfpResourceToPngDataUri,
};
// Node-only, deliberately — this module uses Node's own Buffer/zlib
// throughout (decodeAfpResourceToPngDataUri's PNG encoding step, plus
// every buffer-reading step above), and decoding an actual resource FILE
// only ever happens extension-host-side (where real filesystem access to
// a local/attached resource file exists) — never inside the sandboxed
// webview. Unlike most of this project's other src/*.js modules, this
// one and afpCcittDecoder.js are NOT inlined into the webview's client-
// side bundle (src/buildWebviewTemplate.js's own WEBVIEW_MODULE_FILES
// list) for exactly that reason.
module.exports = mod;
