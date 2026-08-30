"use strict";
/**
 * Font Global Identifier (FGID) table for the DDS printer-file `FONT`
 * keyword: FONT(fgid [(*POINTSIZE height [width])]).
 *
 * Terminology note: `FONT`'s parameter is an FGID, a different mechanism
 * from `CDEFNT` ("coded font", e.g. X0N51EHC) or `FNTCHRSET` (a host font
 * character-set + code-page pair, e.g. C0S0CR10/T1V10500) or `FONTNAME`
 * (a TrueType/OpenType font name). This module only resolves `FONT`/FGID.
 * The other three keywords reference host/IFS font objects this tool has
 * no access to and aren't resolved yet — see docs/REQUIREMENTS.md §9 and
 * docs/ROADMAP.md.
 *
 * Every entry below is sourced from IBM's own FGID/typeface documentation
 * (Printer Device Programming, the AFP Font Collection reference, and
 * IBM support pages on font substitution/mapping) — cross-checked during
 * implementation, not guessed. One correction worth flagging explicitly:
 * FGID 416 is "Courier Roman Medium", NOT "Times Roman" — an earlier
 * reference this project drew on had that backwards. Real Times New Roman
 * Medium is FGID 2308.
 *
 * `spacing`:
 *  - "fixed": uniformly spaced (monospace) — Courier and Gothic families.
 *    True even for the *scalable* Courier FGIDs (416/420/424/428): IBM's
 *    own docs describe these as "uniformly spaced" fonts that happen to
 *    support *POINTSIZE, not proportionally spaced ones. Character advance
 *    width is always 1.0 cell regardless of point size.
 *  - "proportional": typographic fonts (Helvetica, Times New Roman)
 *    where character widths vary. Real per-glyph widths need the actual
 *    font resource data (still pending, see docs/REQUIREMENTS.md §9); this
 *    module falls back to a rough Helvetica-shaped placeholder table for
 *    relative widths, same as before — that part is still an
 *    approximation, not verified font metrics.
 */

const FGID_TABLE = {
  // Fixed-pitch line/matrix-printer fonts, keyed by their default FGID for
  // a given pitch (source: IBM support page on scalable/line-printer FONT
  // keyword usage, "Font Pitch / Font Range / Default Font ID" table).
  "11": { name: "Courier 10 (10 pitch)", family: "'Courier New', Courier, monospace", spacing: "fixed", pitch: 10 },
  "245": { name: "Courier 5 (5 pitch)", family: "'Courier New', Courier, monospace", spacing: "fixed", pitch: 5 },
  "87": { name: "Letter Gothic 12 (12 pitch)", family: "'Consolas', 'Lucida Console', monospace", spacing: "fixed", pitch: 12 },
  "204": { name: "Matrix Gothic 13.3 (13.3 pitch)", family: "'Consolas', 'Lucida Console', monospace", spacing: "fixed", pitch: 13.3 },
  "222": { name: "Gothic 15 (15 pitch)", family: "'Consolas', 'Lucida Console', monospace", spacing: "fixed", pitch: 15 },
  "281": { name: "Courier 20 (20 pitch)", family: "'Courier New', Courier, monospace", spacing: "fixed", pitch: 20 },
  // OCR fonts, mapped by IBM's own substitution to Courier when the real
  // OCR font isn't available on the target printer (source: IBM support
  // "Using OCR A and OCR B Fonts For ASCII Printers").
  "19": { name: "OCR A", family: "'OCR A Std', 'Courier New', monospace", spacing: "fixed" },
  "3": { name: "OCR B", family: "'OCR B Std', 'Courier New', monospace", spacing: "fixed" },
  // Scalable Courier family — uniformly spaced (monospace) despite being
  // scalable (source: IBM AFP Font Collection reference / Infoprint parts
  // typeface-to-FGID table).
  "416": { name: "Courier Roman Medium", family: "'Courier New', Courier, monospace", spacing: "fixed" },
  "420": { name: "Courier Roman Bold", family: "'Courier New', Courier, monospace", spacing: "fixed", weight: "bold" },
  "424": { name: "Courier Italic Medium", family: "'Courier New', Courier, monospace", spacing: "fixed", style: "italic" },
  "428": { name: "Courier Italic Bold", family: "'Courier New', Courier, monospace", spacing: "fixed", weight: "bold", style: "italic" },
  // Scalable Helvetica family — proportional (source: same typeface-to-FGID
  // table as above).
  "2304": { name: "Helvetica Roman Medium", family: "Arial, Helvetica, sans-serif", spacing: "proportional" },
  "2305": { name: "Helvetica Roman Bold", family: "Arial, Helvetica, sans-serif", spacing: "proportional", weight: "bold" },
  "2306": { name: "Helvetica Italic Medium", family: "Arial, Helvetica, sans-serif", spacing: "proportional", style: "italic" },
  "2307": { name: "Helvetica Italic Bold", family: "Arial, Helvetica, sans-serif", spacing: "proportional", weight: "bold", style: "italic" },
  // Scalable Times New Roman family — proportional. NOTE: this is FGID
  // 2308, not 416 (see correction note above).
  "2308": { name: "Times New Roman Medium", family: "'Times New Roman', Times, serif", spacing: "proportional" },
  "2309": { name: "Times New Roman Bold", family: "'Times New Roman', Times, serif", spacing: "proportional", weight: "bold" },
  "2310": { name: "Times New Roman Italic Medium", family: "'Times New Roman', Times, serif", spacing: "proportional", style: "italic" },
  "2311": { name: "Times New Roman Italic Bold", family: "'Times New Roman', Times, serif", spacing: "proportional", weight: "bold", style: "italic" },
};

const DEFAULT_FGID = "11"; // IBM's own font-substitution logic falls back toward Courier 10 pitch when a requested FGID can't be matched on the target device; used here as this tool's default too.

/** Rough Helvetica-shaped relative-width table (units: 1/1000 em) for proportional-font placeholder rendering. Not real font metrics — see module doc comment. */
const PROPORTIONAL_PLACEHOLDER_WIDTHS = {
  default: 556,
  " ": 278,
  i: 222, l: 222, j: 222, "'": 191, ".": 278, ",": 278, ":": 278, ";": 278,
  I: 278, f: 278, t: 278, r: 333, "1": 556,
  m: 833, w: 722, M: 833, W: 944,
};

function lookup(fgid) {
  const key = String(fgid || "").trim();
  return FGID_TABLE[key] || FGID_TABLE[DEFAULT_FGID];
}

function isFixed(fgid) {
  return lookup(fgid).spacing === "fixed";
}

/**
 * Returns the advance width of `ch` under `fgid`, in "character cell"
 * units where 1.0 == the width of one monospace cell at the record's CPI
 * (or the point-size-derived CPI for a scalable fixed font — see
 * pointSizeToCpi). For fixed-spacing FGIDs this is always exactly 1.0.
 * For proportional FGIDs it's the placeholder table value normalized
 * against the table's own average glyph width, so text still roughly
 * fills the same space a monospace estimate would while individual
 * characters visually vary — see module doc comment for the caveat.
 */
function getAdvanceWidth(fgid, ch) {
  if (isFixed(fgid)) return 1.0;
  const w = PROPORTIONAL_PLACEHOLDER_WIDTHS[ch] ?? PROPORTIONAL_PLACEHOLDER_WIDTHS.default;
  return w / PROPORTIONAL_PLACEHOLDER_WIDTHS.default;
}

function isPlaceholder(fgid) {
  return !isFixed(fgid);
}

function getFontInfo(fgid) {
  return lookup(fgid);
}

/**
 * For a scalable, fixed-spacing (monospace) font sized via *POINTSIZE,
 * converts the point size to an equivalent CPI, using IBM's documented
 * reference point (a 12-point uniformly spaced font corresponds to 10
 * CPI): CPI = 120 / pointSize. Source: IBM support "Defining unknown
 * fonts to the client".
 */
function pointSizeToCpi(pointSize) {
  if (!pointSize || pointSize <= 0) return 10;
  return 120 / pointSize;
}

const mod = { getAdvanceWidth, isPlaceholder, getFontInfo, pointSizeToCpi, DEFAULT_FGID };
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.AfpFontMetrics = mod;
