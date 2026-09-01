"use strict";
/**
 * docs/TASKS.md Batch C — BARCODE full parameter surface.
 *
 * BARCODE(bar-code-ID [height] [[*HRZ|*VRT] [*HRI|*HRITOP|*NOHRI]
 *         [*AST|*NOAST] [modifier] [unit-width] [symbol-width]
 *         [wide/narrow-ratio] [2D-data]])
 * — verified against IBM's DDS reference for printer files
 *   (https://www.ibm.com/docs/en/i/7.3.0?topic=b-barcode). height, if
 *   present, must be the second parameter; the remaining (up to) 11
 *   parameters may appear in any order.
 *
 * Before this batch, `prtfLayout.js`'s `parseBarcodeGeometry` parsed just
 * enough (bar-code-ID, direction, an HRI on/off boolean, height) to size
 * the placeholder box, and nothing here was editable. This module is the
 * full structured parse/build pair the properties panel uses, plus the
 * fix for the known gap called out in docs/TASKS.md Batch C: HRI is a
 * three-way value (*HRI "below" / *HRITOP "above" / *NOHRI "none"), not a
 * boolean — RLU's own "Specify Bar Code" screen exposes it as
 * 1=Below/2=Above/3=None (docs/KEYWORD-INVENTORY.md §3).
 *
 * Scope note: this batch exposes every parameter RLU's own screen shows
 * (see KEYWORD-INVENTORY §3) — bar-code-ID, height, bar format, HRI
 * position, asterisk-on-CODE3OF9, modifier, narrow bar width,
 * wide:narrow ratio, and a single free-text "additional 2D parameters"
 * field for PDF417/Data Matrix/Maxicode/QR Code's own sub-grammars
 * (modeling each of those individually is out of scope here). The
 * "requested symbol width" ((*SWIDTH n), IBM's syntax but not on RLU's
 * screen) isn't given a dedicated form field for that reason, but is
 * still preserved byte-for-byte via `unrecognizedRaw` below so editing
 * other parameters through this form never silently drops it (or any
 * other token this parser doesn't specifically model) from existing
 * source.
 */

// eslint-disable-next-line no-undef
const { paramTokens, findKeyword } = typeof module !== "undefined" && module.exports ? require("./prtfKeywordHelpers.js") : window.PrtfKeywordHelpers;

/**
 * Tokenizes a BARCODE keyword's inner "(...)" text on whitespace, EXCEPT
 * that a parenthesized group (possibly itself containing nested
 * parenthesized groups and/or whitespace, e.g. "(*QRCODE 4 1
 * *CONVERT(1) *TRIM)") or a quoted 'x' literal is kept together as one
 * token. `prtfKeywordHelpers.js`'s own `paramTokens` splits on bare
 * whitespace only, which is enough for LINE/BOX but would tear a group
 * like "(*WIDTH .02)" into two tokens — needed here since BARCODE's
 * *WIDTH/*RATIO/2D-data parameters are themselves parenthesized
 * sub-expressions.
 */
function groupTokens(inner) {
  const tokens = [];
  let depth = 0;
  let inQuote = false;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inQuote) {
      cur += c;
      if (c === "'") inQuote = false;
      continue;
    }
    if (c === "'") {
      inQuote = true;
      cur += c;
      continue;
    }
    if (c === "(") {
      depth++;
      cur += c;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      cur += c;
      continue;
    }
    if (/\s/.test(c) && depth === 0) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

const TWO_D_PREFIXES = ["(*PDF417", "(*MAXICODE", "(*DATAMATRIX", "(*QRCODE"];

/**
 * Parses a BARCODE keyword into every parameter IBM's DDS reference
 * defines. Unlike `parseBarcodeGeometry` (prtfLayout.js — rendering-only,
 * enough to size/label the placeholder box), this is the full structured
 * form the properties panel reads to prefill and writes back via
 * `buildBarcodeParams`.
 */
function parseBarcodeParams(kw) {
  const inner = String((kw && kw.params) || "")
    .replace(/^\(/, "")
    .replace(/\)$/, "");
  const tokens = groupTokens(inner);

  const barCodeId = (tokens.shift() || "").replace(/^\*/, "");

  let heightMode = "none";
  let heightLines;
  let heightValue;
  if (tokens.length > 0) {
    const h = tokens[0];
    if (/^\d+$/.test(h) && Number(h) >= 1 && Number(h) <= 9) {
      heightMode = "lines";
      heightLines = Number(h);
      tokens.shift();
    } else if (h.startsWith("(")) {
      const innerH = h.slice(1, -1).trim();
      // IBM's DDS reference always writes the unit token as the literal
      // "*UOM" (referring to CRTPRTF's own UOM parameter — see toInches),
      // but this accepts any "*WORD" unit token here rather than matching
      // "*UOM" specifically, matching the leniency the pre-Batch-C parser
      // in prtfLayout.js already had (it only ever read the numeric value
      // and ignored the unit token entirely).
      const m = innerH.match(/^([\d.]+)\s+\*\w+$/i);
      if (m) {
        heightMode = "uom";
        heightValue = Number(m[1]);
        tokens.shift();
      }
      // Doesn't match the "(height *UOM)" shape — leave it in the token
      // list; it's a *WIDTH/*RATIO/2D-data group with no height given.
    }
  }

  let direction = "horizontal"; // *HRZ is the documented default
  let hriPosition = "below"; // *HRI is the documented default
  let asterisk = false; // *NOAST is the documented default
  let modifier = "";
  let narrowBarWidth;
  let ratio;
  let extra2D = "";
  const unrecognizedRaw = [];

  tokens.forEach((t) => {
    const upper = t.toUpperCase();
    if (upper === "*HRZ") direction = "horizontal";
    else if (upper === "*VRT") direction = "vertical";
    else if (upper === "*HRI") hriPosition = "below";
    else if (upper === "*HRITOP") hriPosition = "above";
    else if (upper === "*NOHRI") hriPosition = "none";
    else if (upper === "*AST") asterisk = true;
    else if (upper === "*NOAST") asterisk = false;
    else if (/^X'[0-9A-Fa-f]{2}'$/.test(t)) modifier = t.slice(2, 4).toUpperCase();
    else if (upper.startsWith("(*WIDTH")) {
      const m = t.match(/\(\*WIDTH\s+([\d.]+)\)/i);
      if (m) narrowBarWidth = Number(m[1]);
      else unrecognizedRaw.push(t);
    } else if (upper.startsWith("(*RATIO")) {
      const m = t.match(/\(\*RATIO\s+([\d.]+)\)/i);
      if (m) ratio = Number(m[1]);
      else unrecognizedRaw.push(t);
    } else if (TWO_D_PREFIXES.some((p) => upper.startsWith(p))) {
      extra2D = t;
    } else {
      // *SWIDTH, or anything this parser doesn't specifically model —
      // preserved verbatim so it round-trips even though it's not
      // surfaced as its own form field (see module header).
      unrecognizedRaw.push(t);
    }
  });

  return {
    barCodeId,
    heightMode,
    heightLines,
    heightValue,
    direction,
    hriPosition,
    asterisk,
    modifier,
    narrowBarWidth,
    ratio,
    extra2D,
    unrecognizedRaw,
  };
}

/** Inverse of parseBarcodeParams: structured params -> a "(...)" DDS param string ready to hand to setFieldKeyword. */
function buildBarcodeParams(f) {
  const parts = [(f.barCodeId || "").toUpperCase()];

  if (f.heightMode === "lines" && f.heightLines) parts.push(String(f.heightLines));
  else if (f.heightMode === "uom" && f.heightValue != null && f.heightValue !== "") parts.push("(" + f.heightValue + " *UOM)");

  parts.push(f.direction === "vertical" ? "*VRT" : "*HRZ");
  parts.push(f.hriPosition === "above" ? "*HRITOP" : f.hriPosition === "none" ? "*NOHRI" : "*HRI");
  parts.push(f.asterisk ? "*AST" : "*NOAST");

  if (f.modifier) parts.push("X'" + String(f.modifier).toUpperCase() + "'");
  if (f.narrowBarWidth != null && f.narrowBarWidth !== "") parts.push("(*WIDTH " + f.narrowBarWidth + ")");
  if (f.ratio != null && f.ratio !== "") parts.push("(*RATIO " + f.ratio + ")");
  if (f.extra2D) parts.push(f.extra2D.trim().startsWith("(") ? f.extra2D.trim() : "(" + f.extra2D.trim() + ")");
  if (f.unrecognizedRaw && f.unrecognizedRaw.length) parts.push(...f.unrecognizedRaw);

  return "(" + parts.join(" ") + ")";
}

/**
 * Client-side range hints (live-editor only, matching the style already
 * used for Batch A/F/N's other validation hints — CRTPRTF remains the
 * real enforcement point). Ranges verified against IBM's DDS reference:
 * modifier is a hex byte that can't be FF; narrow bar width 0.007-0.208
 * (always inches, per IBM doc, regardless of CRTPRTF's UOM setting);
 * ratio 2.00-3.00 (same, always unit-less/inches); height in UOM mode is
 * the one parameter that DOES follow CRTPRTF's UOM setting — 0.10-10.00
 * in or 0.25-25.40 cm.
 */
function validateBarcodeParams(f, uom) {
  const hints = [];
  if (f.modifier) {
    if (!/^[0-9A-Fa-f]{2}$/.test(f.modifier)) hints.push("Modifier should be a 2-digit hex value (00-FE).");
    else if (f.modifier.toUpperCase() === "FF") hints.push("Modifier cannot be hex FF.");
  }
  if (f.narrowBarWidth != null && f.narrowBarWidth !== "") {
    const n = Number(f.narrowBarWidth);
    if (!Number.isFinite(n) || n < 0.007 || n > 0.208) hints.push("Narrow bar width should be between 0.007 and 0.208 (inches).");
  }
  if (f.ratio != null && f.ratio !== "") {
    const n = Number(f.ratio);
    if (!Number.isFinite(n) || n < 2.0 || n > 3.0) hints.push("Wide:narrow ratio should be between 2.00 and 3.00.");
  }
  if (f.heightMode === "uom" && f.heightValue != null && f.heightValue !== "") {
    const n = Number(f.heightValue);
    const isCm = uom === "cm";
    const min = isCm ? 0.25 : 0.1;
    const max = isCm ? 25.4 : 10.0;
    if (!Number.isFinite(n) || n < min || n > max) hints.push(`Height should be between ${min} and ${max} ${isCm ? "cm" : "in"} for the configured unit of measure.`);
  }
  if (f.heightMode === "lines" && f.heightLines != null && (f.heightLines < 1 || f.heightLines > 9)) {
    hints.push("Height in lines should be between 1 and 9.");
  }
  return hints;
}

/**
 * docs/TASKS.md Batch N — BARCODE mutual-exclusion validation.
 *
 * IBM's DDS reference for the BARCODE keyword states verbatim: "Do not
 * specify BARCODE in the same field with the CHRSIZ, CHRID, CVTDTA, DATE,
 * EDTCDE, EDTWRD, FONT, HIGHLIGHT, PAGNBR, TIME, or UNDERLINE keywords."
 * (https://www.ibm.com/docs/en/i/7.3.0?topic=b-barcode). This is the
 * verified, full list — README.md's own "Known limitations" section names
 * only FONT/EDTCDE/EDTWRD/DATE/TIME/PAGNBR/etc as a starting point (per
 * this batch's own instructions to confirm against IBM's reference before
 * implementing), and is missing CHRSIZ, CHRID, CVTDTA, HIGHLIGHT, and
 * UNDERLINE.
 *
 * DATE/TIME/PAGNBR are conventionally constant-only in this tool's own
 * Batch A panel (see BATCH_A_CONSTANT_ONLY_KEYWORDS in webviewClient.js),
 * but DDS's own grammar doesn't forbid them on a named field, and IBM's
 * exclusion list explicitly calls them out for BARCODE specifically —
 * which only makes sense if the combination is otherwise reachable (e.g.
 * hand-edited raw DDS source, or a future UI change). Checked here
 * regardless of which panel this tool's own UI currently lets you set them
 * from, since this operates on whatever's actually in the parsed model.
 */
const BARCODE_EXCLUDED_KEYWORDS = ["CHRSIZ", "CHRID", "CVTDTA", "DATE", "EDTCDE", "EDTWRD", "FONT", "HIGHLIGHT", "PAGNBR", "TIME", "UNDERLINE"];

/**
 * Live-editor hint only (same spirit as validateBarcodeParams above and
 * every other validation function in this project) — CRTPRTF remains the
 * actual enforcement point; nothing here blocks an edit. Returns one hint
 * string per BARCODE_EXCLUDED_KEYWORDS entry found alongside BARCODE on
 * the same field/constant, or [] if BARCODE isn't present at all (nothing
 * to check against) or no excluded keyword is present.
 */
function validateBarcodeExclusions(keywords) {
  if (!findKeyword(keywords, "BARCODE")) return [];
  return BARCODE_EXCLUDED_KEYWORDS.filter((name) => findKeyword(keywords, name)).map(
    (name) => name + " can't be combined with BARCODE on the same field — CRTPRTF will reject this combination."
  );
}

const mod = { groupTokens, paramTokens, parseBarcodeParams, buildBarcodeParams, validateBarcodeParams, validateBarcodeExclusions };
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfBarcodeParams = mod;
