"use strict";
/**
 * AFP coded-font advance-width table, used by the engine/webview to lay out
 * AFPDS record text at (approximately) real proportional widths instead of
 * assuming a fixed character cell.
 *
 * STATUS: PLACEHOLDER. Real accuracy requires IBM's font character
 * set/code page resource description data (or a live IBM i to pull it
 * from) — see docs/REQUIREMENTS.md §9, which is still open. Until that
 * data is supplied, every coded font here maps to one of two stand-ins:
 *
 *  - MONOSPACE: used for known monospace/Courier-style coded fonts, and as
 *    the default for any unrecognized FONT id. Width = 1 char cell, driven
 *    by CPI. This is exact for SCS and for genuinely monospace AFP fonts.
 *  - PROPORTIONAL_PLACEHOLDER: a rough Helvetica-like relative-width table
 *    (units: 1/1000 em) used for known proportional coded fonts, so the
 *    preview at least *looks* proportionally spaced rather than uniformly
 *    spaced. Do not treat these numbers as accurate for print production.
 */

const PROPORTIONAL_PLACEHOLDER_WIDTHS = {
  default: 556,
  " ": 278,
  i: 222, l: 222, j: 222, "'": 191, ".": 278, ",": 278, ":": 278, ";": 278,
  I: 278, f: 278, t: 278, r: 333, "1": 556,
  m: 833, w: 722, M: 833, W: 944,
};

// Known coded-font identifiers mapped to a metric family. Extend this as
// real font resource data becomes available (§9 of the requirements doc).
const CODED_FONT_FAMILY = {
  "11": "MONOSPACE", // Courier, common default
  "0011": "MONOSPACE",
  "12": "MONOSPACE",
  "0012": "MONOSPACE",
  "10": "PROPORTIONAL_PLACEHOLDER", // e.g. Times/Helvetica-family coded fonts
  "0010": "PROPORTIONAL_PLACEHOLDER",
  "41": "PROPORTIONAL_PLACEHOLDER",
  "0041": "PROPORTIONAL_PLACEHOLDER",
};

function familyFor(fontId) {
  if (!fontId) return "MONOSPACE";
  return CODED_FONT_FAMILY[String(fontId).trim()] || "MONOSPACE";
}

/**
 * Returns the advance width of `ch` under `fontId`, in "character cell"
 * units where 1.0 == the width of one monospace cell at the record's CPI.
 * For MONOSPACE fonts this is always 1.0 (exact). For
 * PROPORTIONAL_PLACEHOLDER fonts it's the placeholder table value
 * normalized against the table's own average glyph width (556/1000),
 * so text still roughly fills the same space a monospace estimate would,
 * while individual characters visually vary in width.
 */
function getAdvanceWidth(fontId, ch) {
  const family = familyFor(fontId);
  if (family === "MONOSPACE") return 1.0;
  const w = PROPORTIONAL_PLACEHOLDER_WIDTHS[ch] ?? PROPORTIONAL_PLACEHOLDER_WIDTHS.default;
  return w / PROPORTIONAL_PLACEHOLDER_WIDTHS.default;
}

function isPlaceholder(fontId) {
  return familyFor(fontId) === "PROPORTIONAL_PLACEHOLDER";
}

const mod = { getAdvanceWidth, isPlaceholder, familyFor };
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.AfpFontMetrics = mod;
