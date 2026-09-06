"use strict";
/**
 * Real TrueType/OpenType (sfnt) binary metrics parser — reads a font's own
 * `head`/`hhea`/`hmtx`/`cmap` tables directly to extract genuine per-glyph
 * advance widths, rather than a curated approximation or a hardcoded table.
 *
 * Why this exists alongside afpFontMetrics.js's Adobe-AFM proportional
 * tables: those cover `FONT`/FGID (Helvetica/Times New Roman substitutes,
 * published PostScript metrics). `FONTNAME` (see afpCodedFontMetrics.js's
 * resolveFontName) references a TrueType/OpenType font by name — a
 * genuinely different, binary font format this module can decode directly
 * when a font file is available, real advance widths and all. This is also
 * why it's a general-purpose sfnt parser rather than a font-specific one:
 * afpCodedFontMetrics.js currently points it at a small set of vendored,
 * permissively-licensed substitute fonts (see test/fixtures/fonts/NOTICE.md
 * for exactly which ones and why), but the SAME parser would work
 * unmodified on a real font pulled from a connected IBM i's IFS the moment
 * that becomes possible (see docs/ROADMAP.md's "real AFP font metrics" item)
 * — nothing about parsing the sfnt binary format itself is specific to
 * which font it's pointed at.
 *
 * Deliberately scoped to what layout/metrics work actually needs:
 * `head` (unitsPerEm), `hhea` (numberOfHMetrics), `hmtx` (the advance
 * widths themselves), and `cmap` (Unicode codepoint -> glyph ID, formats 4
 * and 12 — 4 covers the Basic Multilingual Plane, which is all DDS source
 * can express anyway; 12 is read as a bonus for supplementary-plane
 * lookups but isn't required for anything this tool currently renders).
 * Does NOT parse glyph outlines (`glyf`/`CFF`/`loca`) — advance width is
 * the only thing layout/preview work needs, and outline parsing is a
 * substantially larger undertaking (variable-length TrueType instructions
 * or CFF charstrings) this module has no reason to take on.
 *
 * `ttcf` (TrueType Collection) and CFF-flavored OpenType's own compact
 * glyph-outline format aren't handled — `sfntVersion` is checked and an
 * unsupported one throws a clear error naming which value was seen, rather
 * than silently misreading table offsets. CFF-flavored OpenType (sfnt
 * version 'OTTO') DOES still carry ordinary `head`/`hhea`/`hmtx`/`cmap`
 * tables in the same binary layout as TrueType-flavored fonts — only the
 * glyph-outline format differs — so it's explicitly supported here despite
 * this module never touching outlines.
 */

const SFNT_VERSION_TRUETYPE = 0x00010000;
const SFNT_VERSION_TRUETYPE_MAC = 0x74727565; // 'true' — old Mac TrueType, same table layout
const SFNT_VERSION_OPENTYPE_CFF = 0x4f54544f; // 'OTTO' — CFF-flavored OpenType; head/hhea/hmtx/cmap layout is identical

/** Reads a 4-byte tag (e.g. "head") at `offset` as an ASCII string. */
function readTag(view, offset) {
  let s = "";
  for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

/**
 * Parses the sfnt table directory into { tag: { offset, length } }.
 * Table directory layout (OpenType spec, "Table Directory"): a fixed
 * 12-byte header (version, numTables, searchRange, entrySelector,
 * rangeShift) followed by numTables 16-byte records (tag, checksum,
 * offset, length) — checksum is read but intentionally unused, since
 * verifying it buys nothing for a font this tool only reads metrics from
 * (a corrupt checksum wouldn't stop the actual metrics tables from being
 * readable, and a corrupt font is already something getAdvanceWidth's
 * caller can't do anything about beyond what a parse failure already
 * signals).
 */
function parseTableDirectory(view) {
  const sfntVersion = view.getUint32(0);
  if (
    sfntVersion !== SFNT_VERSION_TRUETYPE &&
    sfntVersion !== SFNT_VERSION_TRUETYPE_MAC &&
    sfntVersion !== SFNT_VERSION_OPENTYPE_CFF
  ) {
    throw new Error(
      "afpTrueTypeMetrics: unsupported sfnt version 0x" +
        sfntVersion.toString(16) +
        " (TrueType collections (ttcf) aren't handled by this parser)"
    );
  }
  const numTables = view.getUint16(4);
  const tables = {};
  let pos = 12;
  for (let i = 0; i < numTables; i++) {
    const tag = readTag(view, pos);
    const offset = view.getUint32(pos + 8);
    const length = view.getUint32(pos + 12);
    tables[tag] = { offset, length };
    pos += 16;
  }
  return tables;
}

/**
 * `head` table — only unitsPerEm is needed here (offset 18, per the
 * OpenType spec's "head" table layout: version/fontRevision/
 * checkSumAdjustment/magicNumber/flags precede it, each a fixed size).
 */
function parseHead(view, table) {
  return { unitsPerEm: view.getUint16(table.offset + 18) };
}

/**
 * `hhea` table — only numberOfHMetrics is needed here (offset 34, the
 * last field in the table, per the OpenType spec's "hhea" layout).
 */
function parseHhea(view, table) {
  return { numberOfHMetrics: view.getUint16(table.offset + 34) };
}

/**
 * `hmtx` table — numberOfHMetrics `longHorMetric` records (advanceWidth
 * uint16 + leftSideBearing int16, 4 bytes each), per the OpenType spec's
 * "hmtx" table. Glyph IDs beyond numberOfHMetrics-1 reuse the LAST
 * advanceWidth entry (this is the documented mechanism monospace fonts use
 * to avoid repeating the same width thousands of times, and is exactly why
 * Cousine's own hmtx — see test/fixtures/fonts/NOTICE.md — reports the same
 * advance for every character; not a coincidence, the documented spec
 * behavior for a uniformly-spaced font).
 */
function parseHmtx(view, table, numberOfHMetrics) {
  const advanceWidths = new Array(numberOfHMetrics);
  for (let i = 0; i < numberOfHMetrics; i++) {
    advanceWidths[i] = view.getUint16(table.offset + i * 4);
  }
  return advanceWidths;
}

/**
 * Parses ONE cmap subtable — format 4 (segment mapping, BMP-only) or
 * format 12 (segmented coverage, full Unicode) — into a Map<codepoint,
 * glyphId>. These are the two subtable formats actually in wide modern use
 * for platform 3 (Windows)/encoding 1 (BMP) or encoding 10 (full Unicode),
 * and platform 0 (Unicode) equivalents; every other format (0, 2, 6, 13,
 * 14) is legacy/specialized enough that none of this tool's three vendored
 * fixture fonts (or any modern TrueType/OpenType font in practice) uses
 * them for their primary Unicode subtable.
 */
function parseCmapSubtable(view, subtableOffset) {
  const format = view.getUint16(subtableOffset);
  const map = new Map();
  if (format === 4) {
    const segCountX2 = view.getUint16(subtableOffset + 6);
    const segCount = segCountX2 / 2;
    const endCodeOffset = subtableOffset + 14;
    const startCodeOffset = endCodeOffset + segCountX2 + 2; // +2 skips reservedPad
    const idDeltaOffset = startCodeOffset + segCountX2;
    const idRangeOffsetOffset = idDeltaOffset + segCountX2;
    for (let seg = 0; seg < segCount; seg++) {
      const endCode = view.getUint16(endCodeOffset + seg * 2);
      const startCode = view.getUint16(startCodeOffset + seg * 2);
      const idDelta = view.getInt16(idDeltaOffset + seg * 2);
      const idRangeOffsetPos = idRangeOffsetOffset + seg * 2;
      const idRangeOffset = view.getUint16(idRangeOffsetPos);
      if (startCode === 0xffff && endCode === 0xffff) continue; // terminator segment
      for (let code = startCode; code <= endCode && code !== 0xffff; code++) {
        let glyphId;
        if (idRangeOffset === 0) {
          glyphId = (code + idDelta) & 0xffff;
        } else {
          const glyphIndexAddress = idRangeOffsetPos + idRangeOffset + 2 * (code - startCode);
          glyphId = view.getUint16(glyphIndexAddress);
          if (glyphId !== 0) glyphId = (glyphId + idDelta) & 0xffff;
        }
        if (glyphId !== 0) map.set(code, glyphId);
      }
    }
  } else if (format === 12) {
    const numGroups = view.getUint32(subtableOffset + 12);
    let pos = subtableOffset + 16;
    for (let g = 0; g < numGroups; g++) {
      const startCharCode = view.getUint32(pos);
      const endCharCode = view.getUint32(pos + 4);
      const startGlyphId = view.getUint32(pos + 8);
      for (let code = startCharCode; code <= endCharCode; code++) {
        map.set(code, startGlyphId + (code - startCharCode));
      }
      pos += 12;
    }
  }
  // Formats other than 4/12 (see doc comment) are left unparsed — an empty
  // map here just means getAdvanceWidth falls through to its documented
  // "glyph not found" behavior for every codepoint, same as any other
  // unmapped character.
  return map;
}

/**
 * Picks the best cmap subtable to use, preferring (in order): Windows/
 * full-Unicode (platform 3, encoding 10, format 12) for complete coverage,
 * then Windows/BMP (platform 3, encoding 1, format 4) — the overwhelmingly
 * common case for fonts whose entire practical use is Latin-script DDS
 * text — then platform 0 (Unicode, any encoding) as a last resort for
 * fonts that only ship a Mac-style Unicode subtable.
 */
function parseCmap(view, table) {
  const numSubtables = view.getUint16(table.offset + 2);
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < numSubtables; i++) {
    const recOffset = table.offset + 4 + i * 8;
    const platformID = view.getUint16(recOffset);
    const encodingID = view.getUint16(recOffset + 2);
    const subtableOffset = table.offset + view.getUint32(recOffset + 4);
    const format = view.getUint16(subtableOffset);
    let score = -1;
    if (platformID === 3 && encodingID === 10 && format === 12) score = 3;
    else if (platformID === 3 && encodingID === 1 && format === 4) score = 2;
    else if (platformID === 0 && (format === 4 || format === 12)) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = subtableOffset;
    }
  }
  if (best === null) return new Map();
  return parseCmapSubtable(view, best);
}

/**
 * Parses a TrueType/OpenType font binary (`buffer`: a Node Buffer or any
 * Uint8Array/ArrayBuffer-backed typed array — both DataView-constructible,
 * so this runs unmodified in Node (extension host, tests) or a browser
 * webview) into its real metrics.
 *
 * Returns:
 *  - `unitsPerEm`: the font's own em-square size (commonly 1000 for
 *    PostScript-flavored/CFF OpenType fonts, 2048 for many TrueType fonts —
 *    NOT a fixed constant; this is exactly why parsing `head` for real
 *    rather than assuming a value matters).
 *  - `getAdvanceWidth(ch)`: real advance width, in font design units (i.e.
 *    still relative to `unitsPerEm` — divide by `unitsPerEm` for an em-
 *    relative value, the same normalization afpFontMetrics.js's
 *    PROPORTIONAL_AVG_WIDTH-based approach uses), for the first Unicode
 *    codepoint of the given single-character string. Returns `undefined`
 *    for a codepoint this font's cmap doesn't map to any glyph (rather
 *    than guessing a fallback width — see afpCodedFontMetrics.js's caller
 *    for how it chooses a fallback, the same "be honest, don't invent
 *    data" pattern the rest of this project's font-metrics code follows).
 */
function parseFont(buffer) {
  const view =
    buffer instanceof DataView
      ? buffer
      : new DataView(buffer.buffer || buffer, buffer.byteOffset || 0, buffer.byteLength !== undefined ? buffer.byteLength : buffer.length);
  const tables = parseTableDirectory(view);
  if (!tables.head || !tables.hhea || !tables.hmtx || !tables.cmap) {
    throw new Error("afpTrueTypeMetrics: font is missing a required table (head/hhea/hmtx/cmap)");
  }
  const { unitsPerEm } = parseHead(view, tables.head);
  const { numberOfHMetrics } = parseHhea(view, tables.hhea);
  const advanceWidths = parseHmtx(view, tables.hmtx, numberOfHMetrics);
  const cmap = parseCmap(view, tables.cmap);

  function getAdvanceWidthForGlyph(glyphId) {
    // Per the hmtx spec (see parseHmtx's own doc comment): glyph IDs at or
    // beyond numberOfHMetrics reuse the table's last entry.
    if (glyphId < advanceWidths.length) return advanceWidths[glyphId];
    return advanceWidths[advanceWidths.length - 1];
  }

  function getAdvanceWidth(ch) {
    const codepoint = typeof ch === "number" ? ch : String(ch).codePointAt(0);
    const glyphId = cmap.get(codepoint);
    if (glyphId === undefined) return undefined;
    return getAdvanceWidthForGlyph(glyphId);
  }

  return { unitsPerEm, getAdvanceWidth };
}

const mod = { parseFont };
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.AfpTrueTypeMetrics = mod;
