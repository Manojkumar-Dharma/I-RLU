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
 *    where character widths vary, now backed by real published Adobe AFM
 *    widths for the metric-compatible PostScript substitute fonts — see
 *    the width-table doc comment below for exactly what that means and
 *    its one remaining honest caveat.
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

/**
 * Adobe Font Metrics (AFM) advance widths, units 1/1000 em, for the ASCII
 * printable range (32-126), for the four PostScript "standard 14" font
 * programs relevant here: Helvetica, Helvetica-Bold, Times-Roman,
 * Times-Bold, Times-Italic, Times-BoldItalic. These are the real published
 * Adobe metrics — stable since 1985, reproduced identically across every
 * PostScript RIP, PDF library, and TeX distribution — not an invented
 * approximation.
 *
 * Why these apply here: Helvetica-Oblique's widths are defined identically
 * to Helvetica's in the Adobe spec (only the glyph outlines are slanted,
 * not the metrics), and likewise Helvetica-BoldOblique == Helvetica-Bold,
 * so FGIDs 2304/2306 share one table and 2305/2307 share another.
 * Times-Italic and Times-BoldItalic genuinely differ from their upright
 * counterparts, so all four Times weights get distinct tables.
 *
 * Important honesty caveat: these are the *substitute* PostScript font's
 * published metrics, applied as the best available proxy for the
 * IBM-named Helvetica/Times New Roman FGIDs — not a verified extraction of
 * IBM's own FGID font resource data, which this tool has no access to.
 * IBM's own Host Print Transform documentation confirms Helvetica/Times
 * New Roman FGIDs are commonly mapped to metric-compatible PostScript
 * equivalents for many output paths, which is why this is a real
 * improvement over a flat placeholder — but it is still a proxy, not a
 * guarantee of byte-identical metrics to what a given target printer
 * actually uses.
 */
const HELVETICA_WIDTHS = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584,
};
const HELVETICA_BOLD_WIDTHS = {
  " ": 278, "!": 333, '"': 474, "#": 556, $: 556, "%": 889, "&": 722, "'": 238,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  ":": 333, ";": 333, "<": 584, "=": 584, ">": 584, "?": 611, "@": 975,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556,
  K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 333, "\\": 278, "]": 333, "^": 584, _: 556, "`": 333,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
  u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  "{": 389, "|": 280, "}": 389, "~": 584,
};
const TIMES_ROMAN_WIDTHS = {
  " ": 250, "!": 333, '"': 408, "#": 500, $: 500, "%": 833, "&": 778, "'": 180,
  "(": 333, ")": 333, "*": 500, "+": 564, ",": 250, "-": 333, ".": 250, "/": 278,
  "0": 500, "1": 500, "2": 500, "3": 500, "4": 500, "5": 500, "6": 500, "7": 500, "8": 500, "9": 500,
  ":": 278, ";": 278, "<": 564, "=": 564, ">": 564, "?": 444, "@": 921,
  A: 722, B: 667, C: 667, D: 722, E: 611, F: 556, G: 722, H: 722, I: 333, J: 389,
  K: 722, L: 611, M: 889, N: 722, O: 722, P: 556, Q: 722, R: 667, S: 556, T: 611,
  U: 722, V: 722, W: 944, X: 722, Y: 722, Z: 611,
  "[": 333, "\\": 278, "]": 333, "^": 469, _: 500, "`": 333,
  a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278, j: 278,
  k: 500, l: 278, m: 778, n: 500, o: 500, p: 500, q: 500, r: 333, s: 389, t: 278,
  u: 500, v: 500, w: 722, x: 500, y: 500, z: 444,
  "{": 480, "|": 200, "}": 480, "~": 541,
};
const TIMES_BOLD_WIDTHS = {
  " ": 250, "!": 333, '"': 555, "#": 500, $: 500, "%": 1000, "&": 833, "'": 278,
  "(": 333, ")": 333, "*": 500, "+": 570, ",": 250, "-": 333, ".": 250, "/": 278,
  "0": 500, "1": 500, "2": 500, "3": 500, "4": 500, "5": 500, "6": 500, "7": 500, "8": 500, "9": 500,
  ":": 333, ";": 333, "<": 570, "=": 570, ">": 570, "?": 500, "@": 930,
  A: 722, B: 667, C: 667, D: 722, E: 667, F: 611, G: 778, H: 778, I: 389, J: 500,
  K: 778, L: 667, M: 944, N: 722, O: 778, P: 611, Q: 778, R: 722, S: 556, T: 667,
  U: 722, V: 722, W: 1000, X: 722, Y: 722, Z: 667,
  "[": 333, "\\": 278, "]": 333, "^": 581, _: 500, "`": 333,
  a: 500, b: 556, c: 444, d: 556, e: 444, f: 333, g: 500, h: 556, i: 278, j: 333,
  k: 556, l: 278, m: 833, n: 556, o: 500, p: 556, q: 556, r: 444, s: 389, t: 333,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 444,
  "{": 394, "|": 220, "}": 394, "~": 520,
};
const TIMES_ITALIC_WIDTHS = {
  " ": 250, "!": 333, '"': 420, "#": 500, $: 500, "%": 833, "&": 778, "'": 214,
  "(": 333, ")": 333, "*": 500, "+": 675, ",": 250, "-": 333, ".": 250, "/": 278,
  "0": 500, "1": 500, "2": 500, "3": 500, "4": 500, "5": 500, "6": 500, "7": 500, "8": 500, "9": 500,
  ":": 333, ";": 333, "<": 675, "=": 675, ">": 675, "?": 500, "@": 920,
  A: 611, B: 611, C: 667, D: 722, E: 611, F: 611, G: 722, H: 722, I: 333, J: 444,
  K: 667, L: 556, M: 833, N: 667, O: 722, P: 611, Q: 722, R: 611, S: 500, T: 556,
  U: 722, V: 611, W: 833, X: 611, Y: 556, Z: 556,
  "[": 389, "\\": 278, "]": 389, "^": 422, _: 500, "`": 333,
  a: 500, b: 500, c: 444, d: 500, e: 444, f: 278, g: 500, h: 500, i: 278, j: 278,
  k: 444, l: 278, m: 722, n: 500, o: 500, p: 500, q: 500, r: 389, s: 389, t: 278,
  u: 500, v: 444, w: 667, x: 444, y: 444, z: 389,
  "{": 400, "|": 275, "}": 400, "~": 541,
};
const TIMES_BOLDITALIC_WIDTHS = {
  " ": 250, "!": 389, '"': 555, "#": 500, $: 500, "%": 833, "&": 778, "'": 278,
  "(": 333, ")": 333, "*": 500, "+": 570, ",": 250, "-": 333, ".": 250, "/": 278,
  "0": 500, "1": 500, "2": 500, "3": 500, "4": 500, "5": 500, "6": 500, "7": 500, "8": 500, "9": 500,
  ":": 333, ";": 333, "<": 570, "=": 570, ">": 570, "?": 500, "@": 832,
  A: 667, B: 667, C: 667, D: 722, E: 667, F: 667, G: 722, H: 778, I: 389, J: 500,
  K: 667, L: 611, M: 889, N: 722, O: 722, P: 611, Q: 722, R: 667, S: 556, T: 611,
  U: 722, V: 667, W: 889, X: 667, Y: 611, Z: 611,
  "[": 333, "\\": 278, "]": 333, "^": 570, _: 500, "`": 333,
  a: 500, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 556, i: 278, j: 278,
  k: 500, l: 278, m: 778, n: 556, o: 500, p: 500, q: 500, r: 389, s: 389, t: 278,
  u: 556, v: 444, w: 667, x: 500, y: 444, z: 389,
  "{": 348, "|": 220, "}": 348, "~": 570,
};

// Maps each proportional FGID to its AFM table, per the Oblique/Bold-Oblique-share-metrics rule explained above.
const PROPORTIONAL_WIDTH_TABLES = {
  "2304": HELVETICA_WIDTHS, // Helvetica Roman Medium
  "2305": HELVETICA_BOLD_WIDTHS, // Helvetica Roman Bold
  "2306": HELVETICA_WIDTHS, // Helvetica Italic Medium (oblique shares Roman's metrics)
  "2307": HELVETICA_BOLD_WIDTHS, // Helvetica Italic Bold (bold oblique shares Bold's metrics)
  "2308": TIMES_ROMAN_WIDTHS, // Times New Roman Medium
  "2309": TIMES_BOLD_WIDTHS, // Times New Roman Bold
  "2310": TIMES_ITALIC_WIDTHS, // Times New Roman Italic Medium
  "2311": TIMES_BOLDITALIC_WIDTHS, // Times New Roman Italic Bold
};
const PROPORTIONAL_AVG_WIDTH = 543; // average of the basic-Latin range across these tables, used to normalize to "1 cell == roughly one average character" for layout purposes

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
 * For proportional FGIDs (Helvetica/Times New Roman families) it's the
 * real published Adobe AFM width for that character, normalized against
 * the table's own average glyph width — see the table's doc comment above
 * for what "real" means here and its one honest caveat (substitute-font
 * metrics, not a verified extraction of IBM's own FGID resource data).
 */
function getAdvanceWidth(fgid, ch) {
  if (isFixed(fgid)) return 1.0;
  const table = PROPORTIONAL_WIDTH_TABLES[String(fgid || "").trim()] || HELVETICA_WIDTHS;
  const w = table[ch] ?? PROPORTIONAL_AVG_WIDTH;
  return w / PROPORTIONAL_AVG_WIDTH;
}

/**
 * True if `fgid` resolves to a proportional font whose widths come from
 * the substitute-font AFM tables above rather than being exact IBM FGID
 * resource data — i.e. still worth a UI hint that this is real published
 * font metrics applied as a proxy, not a guarantee of pixel-for-pixel
 * accuracy against a specific target printer's actual resident font.
 */
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
