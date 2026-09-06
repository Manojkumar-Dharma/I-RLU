"use strict";
/**
 * Resolves a parsed PRTF record format, plus a set of "active" conditioning
 * indicators, into a concrete page layout: page dimensions, positioned
 * cells (fields/constants), and drawn lines/boxes. This is the model the
 * webview renders and the same thing STRRLU's design screen was showing
 * you, minus the green-screen.
 *
 * v1 scope: explicit line/position field placement (DDS "Location" columns
 * 39-44), sequential placement via SKIPB/SKIPA/SPACEB/SPACEA when
 * line/position are omitted, indicator conditioning, geometry for the
 * `LINE` and `BOX` keywords (record-level, AFPDS-only, specified in
 * physical units and converted here to the same character grid fields use
 * via CPI/LPI — see resolveCpiLpi below), a labeled placeholder for
 * `BARCODE` (field-level, IPDS/AFPDS-only — real symbol rendering is out
 * of scope, see parseBarcodeGeometry), and `FONT`/FGID resolution (see
 * afpFontMetrics.js for the verified FGID table and its limits). Note that
 * a field's *grid position* (line/column) always follows the record's own
 * CPI/LPI regardless of a per-field FONT override — only the rendered
 * font family/weight/style/size follow the resolved FONT; true per-field
 * pitch-driven repositioning is not modeled, since DDS's own "Location"
 * columns are themselves already in terms of the record's nominal grid.
 *
 * Split out of the old monolithic prtfEngine.js (docs/TASKS.md review
 * comment #5) — this file owns geometry/cursor placement/resolveLayout;
 * REF/REFFLD resolution lives in prtfReferenceField.js, and the Batch F/G/B
 * keyword validators live in prtfKeywordValidation.js. prtfEngine.js itself
 * now just re-exports from all three (plus prtfKeywordHelpers.js) so its
 * public shape (the `PrtfEngine`/`mod` object every caller already uses)
 * doesn't change.
 */

// eslint-disable-next-line no-undef
const AfpFontMetrics = typeof module !== "undefined" && module.exports ? require("./afpFontMetrics.js") : window.AfpFontMetrics;
// eslint-disable-next-line no-undef
const { findKeyword, findAllKeywords, findActiveKeyword, findAllActiveKeywords, numericParam, paramTokens, isFieldRef, toNumber, toInches } =
  typeof module !== "undefined" && module.exports ? require("./prtfKeywordHelpers.js") : window.PrtfKeywordHelpers;
// eslint-disable-next-line no-undef
const { resolveReferenceTarget } =
  typeof module !== "undefined" && module.exports ? require("./prtfReferenceField.js") : window.PrtfReferenceField;
// eslint-disable-next-line no-undef
const { validateFieldKeywords } =
  typeof module !== "undefined" && module.exports ? require("./prtfKeywordValidation.js") : window.PrtfKeywordValidation;
// eslint-disable-next-line no-undef
const { parseBarcodeParams } =
  typeof module !== "undefined" && module.exports ? require("./prtfBarcodeParams.js") : window.PrtfBarcodeParams;
// eslint-disable-next-line no-undef
const { parseOverlay, parsePagseg, parseAfprsc } =
  typeof module !== "undefined" && module.exports ? require("./prtfPageGroupKeywords.js") : window.PrtfPageGroupKeywords;
// eslint-disable-next-line no-undef
// Batch L (continued) — CDEFNT/FNTCHRSET/FONTNAME resolution, alongside
// this file's own FONT/FGID resolution below (see resolveFont/
// resolveFontDisplay).
const AfpCodedFontMetrics =
  typeof module !== "undefined" && module.exports ? require("./afpCodedFontMetrics.js") : window.AfpCodedFontMetrics;

/**
 * Resolves CPI (characters per inch) and LPI (lines per inch) for a
 * record, used to convert LINE/BOX/BARCODE geometry — specified in
 * whatever physical unit CRTPRTF's UOM parameter selects (see toInches
 * above) — into the same character-grid coordinates fields use. Defaults
 * (10 CPI, 6 LPI) match traditional SCS/line-printer defaults; real AFPDS
 * jobs may differ per font, so this is a rendering approximation, not a
 * production measurement.
 */
function resolveCpiLpi(record, fileLevel, indicatorState) {
  const cpiKw = findActiveKeyword(record.keywords, "CPI", indicatorState) || findActiveKeyword(fileLevel.keywords, "CPI", indicatorState);
  const lpiKw = findActiveKeyword(record.keywords, "LPI", indicatorState) || findActiveKeyword(fileLevel.keywords, "LPI", indicatorState);
  return { cpi: numericParam(cpiKw, 10), lpi: numericParam(lpiKw, 6) };
}

/**
 * FONT(fgid [(*POINTSIZE height [width])]) — e.g. FONT(2305 (*POINTSIZE
 * 18)) or plain FONT(11). Verified against IBM's DDS reference example
 * ("Example: Specifying a font"). Handles the nested-parens *POINTSIZE
 * form, which the generic paramTokens() helper (used for LINE/BOX/BARCODE)
 * doesn't attempt.
 */
function parseFontKeyword(kw) {
  const inner = String(kw.params || "").replace(/^\(/, "").replace(/\)$/, "").trim();
  const fgidMatch = inner.match(/^(\S+)/);
  const fgid = fgidMatch ? fgidMatch[1] : undefined;
  const approximate = isFieldRef(fgid);
  let pointSize;
  const psMatch = inner.match(/\(\s*\*POINTSIZE\s+([\d.]+)(?:\s+([\d.]+))?\s*\)/i);
  if (psMatch) {
    pointSize = { height: Number(psMatch[1]), width: psMatch[2] ? Number(psMatch[2]) : undefined };
  }
  return { fgid: approximate ? AfpFontMetrics.DEFAULT_FGID : fgid, pointSize, approximate };
}

/**
 * Resolves the effective font-selection keyword for a field/constant
 * entry. FONT/CDEFNT/FNTCHRSET/FONTNAME are alternative ways to select a
 * font — a real DDS source normally uses exactly one at any given level —
 * so unlike this function's pre-Batch-L-continued form (which only ever
 * looked for FONT), this checks all four AT EACH LEVEL (field, then
 * record, then file) before falling through to the next level, so
 * "nearest specification wins" applies across whichever of the four
 * keywords is actually present, not just to FONT's own isolated cascade.
 * IBM's DDS reference doesn't document a combining/precedence rule for
 * more than one of these appearing on the SAME level (an atypical case) —
 * the fixed order checked within a level (FONT, then CDEFNT, then
 * FNTCHRSET, then FONTNAME) is this tool's own consistent tie-break, not
 * an IBM-documented rule, for that atypical case specifically.
 *
 * Returns a `mode`-tagged object; see resolveFontDisplay below for how
 * each mode becomes the final renderable font identity.
 */
function resolveFont(entry, record, fileLevel, indicatorState) {
  for (const level of [entry, record, fileLevel]) {
    const fontKw = findActiveKeyword(level.keywords, "FONT", indicatorState);
    if (fontKw) return Object.assign({ mode: "fgid" }, parseFontKeyword(fontKw));

    const cdefntKw = findActiveKeyword(level.keywords, "CDEFNT", indicatorState);
    if (cdefntKw) {
      const inner = String(cdefntKw.params || "").replace(/^\(/, "").replace(/\)$/, "").trim();
      const value = inner.split(/\s+/)[0] || "";
      return { mode: "cdefnt", value, approximate: isFieldRef(value) };
    }

    const fntchrsetKw = findActiveKeyword(level.keywords, "FNTCHRSET", indicatorState);
    if (fntchrsetKw) {
      const toks = paramTokens(fntchrsetKw);
      return { mode: "fntchrset", fontCharacterSet: toks[0] || "", codePage: toks[1] || "", approximate: isFieldRef(toks[0]) };
    }

    const fontnameKw = findActiveKeyword(level.keywords, "FONTNAME", indicatorState);
    if (fontnameKw) {
      // FONTNAME's value is DDS-quoted (see prtfWebviewLogic.js's
      // parseFontSpecKeyword/buildFontSpecParamsFromValues for the fix to
      // the pre-existing bug this used to trip on) — strip the quote pair
      // here the same way, since this function reads the raw keyword
      // params directly rather than going through that shared helper.
      const inner = String(fontnameKw.params || "").replace(/^\(/, "").replace(/\)$/, "").trim();
      const firstToken = (inner.match(/^'((?:[^']|'')*)'|^(\S+)/) || [])[0] || "";
      let value = firstToken;
      if (value.length >= 2 && value[0] === "'" && value[value.length - 1] === "'") {
        value = value.slice(1, -1).replace(/''/g, "'");
      }
      return { mode: "fontname", value, approximate: isFieldRef(value) };
    }
  }
  return { mode: "fgid", fgid: AfpFontMetrics.DEFAULT_FGID, pointSize: undefined, approximate: false };
}

/**
 * Converts resolveFont's mode-tagged result into the final renderable font
 * identity resolveLayout's `cells[].font` carries. A program-to-system
 * field reference (&NAME, any mode) can't be resolved without a live
 * compile/run — same "flagged approximate, fall back to the tool's own
 * default" treatment every other P-field case in this codebase already
 * gets (see e.g. parseFontKeyword's own approximate handling) — so that
 * check happens once here, ahead of the per-mode branches, rather than
 * being duplicated in each of afpCodedFontMetrics.js's three resolver
 * functions.
 */
function resolveFontDisplay(font) {
  if (font.approximate) {
    const fontInfo = AfpFontMetrics.getFontInfo(AfpFontMetrics.DEFAULT_FGID);
    return {
      fgid: AfpFontMetrics.DEFAULT_FGID,
      name: fontInfo.name,
      family: fontInfo.family,
      spacing: fontInfo.spacing,
      weight: fontInfo.weight,
      style: fontInfo.style,
      pointSize: font.pointSize,
      approximate: true,
      // Computed the same way the fgid branch below does (rather than a
      // hardcoded true) — DEFAULT_FGID is Courier 10 pitch, a fixed-
      // spacing font, so this correctly comes out false: the "proportional
      // widths are an approximation" caveat shouldn't show for a fixed
      // font just because it's ALSO a P-field fallback. The two caveats
      // are independent (isPlaceholderMetrics: substitute-font AFM widths;
      // approximate: program-to-system field, runtime value unknown) and
      // webviewClient.js's tooltip already shows them as separate clauses.
      isPlaceholderMetrics: AfpFontMetrics.isPlaceholder(AfpFontMetrics.DEFAULT_FGID),
      resolutionNote: undefined,
    };
  }
  if (font.mode === "fontname") {
    const resolved = AfpCodedFontMetrics.resolveFontName(font.value);
    return Object.assign({ fgid: undefined, pointSize: font.pointSize, approximate: false }, resolved);
  }
  if (font.mode === "cdefnt") {
    const resolved = AfpCodedFontMetrics.resolveCodedFont(font.value);
    return Object.assign({ fgid: undefined, pointSize: font.pointSize, approximate: false }, resolved);
  }
  if (font.mode === "fntchrset") {
    const resolved = AfpCodedFontMetrics.resolveFontCharacterSet(font.fontCharacterSet);
    return Object.assign({ fgid: undefined, pointSize: font.pointSize, approximate: false }, resolved);
  }
  // mode === "fgid" — the pre-existing FONT/FGID resolution, unchanged.
  const fontInfo = AfpFontMetrics.getFontInfo(font.fgid);
  return {
    fgid: font.fgid,
    name: fontInfo.name,
    family: fontInfo.family,
    spacing: fontInfo.spacing,
    weight: fontInfo.weight,
    style: fontInfo.style,
    pointSize: font.pointSize,
    approximate: font.approximate,
    isPlaceholderMetrics: AfpFontMetrics.isPlaceholder(font.fgid),
    resolutionNote: undefined,
  };
}

/**
 * Batch EE (docs/TASKS.md) — CSS equivalents for COLOR's named-color set,
 * confirmed against IBM's DDS reference for printer files (the same eight
 * names Batch A's own NAMED_COLORS picklist in media/webviewClient.js
 * already offers). CSS's own "turquoise" keyword is a genuinely close
 * match to the AS/400 IPDS color of the same name; the rest are ordinary
 * CSS color keywords chosen as reasonable renderings of the names IBM
 * uses, not independently confirmed against a specific device's actual
 * ink/phosphor values (no such per-color-value confirmation is possible
 * without a physical *IPDS-capable color printer) — same "reasonable
 * rendering, not verified hardware colorimetry" caveat every font-metrics
 * resolution in this file already carries for AFM/FGID substitutes.
 */
const NAMED_COLOR_CSS = {
  "*BLK": "black",
  "*BLU": "blue",
  "*BRN": "brown",
  "*GRN": "green",
  "*PNK": "deeppink",
  "*RED": "red",
  "*TRQ": "turquoise",
  "*YLW": "#c8c800", // a mid-value yellow — pure CSS "yellow" reads as unreadably pale on the white page background this tool renders against
};

/**
 * Resolves COLOR's parameters (already round-tripped verbatim as raw
 * keyword params, e.g. "(*BLU)" or "(*RGB 0 0 0)") into a CSS color plus an
 * `approximate` flag. COLOR is a field-level-only printer-file keyword
 * (verified against IBM's DDS reference: "You use this field-level keyword
 * to specify the color for a field") — unlike resolveFont's FONT, it does
 * NOT cascade to the record or file level, so this only ever looks at the
 * entry's own keywords, not `record`/`fileLevel`.
 *
 * Named colors and *RGB (three literal 0-255 component tokens) are exact.
 * *CMYK/*CIELAB stay `approximate: true` with no `css` value — per Batch
 * A's own documented caveat, their exact special-value names and numeric
 * ranges were never independently confirmed against IBM's DDS reference,
 * so this deliberately doesn't guess a color for them rather than risk
 * rendering a wrong one. (docs/TASKS.md's own Batch EE entry describes
 * *RGB as equally unconfirmed/approximate alongside *CMYK/*CIELAB — that's
 * an overstatement of Batch A's actual, more precise finding: *RGB's
 * three-literal-integer form is confirmed against this project's own
 * `sample-afpds.pf` fixture, only *CMYK/*CIELAB are the unconfirmed ones.)
 */
function resolveColorStyle(entry, indicatorState) {
  const colorKw = findActiveKeyword(entry.keywords, "COLOR", indicatorState);
  if (!colorKw) return undefined;
  const tokens = paramTokens(colorKw);
  const model = tokens[0];
  if (Object.prototype.hasOwnProperty.call(NAMED_COLOR_CSS, model)) {
    return { css: NAMED_COLOR_CSS[model], model: "Named", approximate: false };
  }
  if (model === "*RGB") {
    const r = toNumber(tokens[1]);
    const g = toNumber(tokens[2]);
    const b = toNumber(tokens[3]);
    if (r !== undefined && g !== undefined && b !== undefined) {
      return { css: `rgb(${r}, ${g}, ${b})`, model: "*RGB", approximate: false };
    }
  }
  // *CMYK, *CIELAB, an *RGB with a non-literal (program-to-system field)
  // component, or anything else unrecognized: flagged, not guessed.
  return { css: undefined, model: model || "unknown", approximate: true };
}

/**
 * Batch EE (docs/TASKS.md) — resolves a per-cell rendering style from
 * COLOR/HIGHLIGHT/UNDERLINE, the same "resolve once here, apply in
 * webviewClient.js's renderPage" split resolveFont/resolveFontDisplay
 * already established for FONT.
 *
 * DSPATR is deliberately absent — checked against IBM's DDS reference for
 * printer files (the full "the following keywords are valid for printer
 * files" list) and confirmed NOT a valid printer-file keyword at all (it's
 * display-file only), the same kind of finding Batch Z made for
 * USER/SYSNAME. docs/TASKS.md's own Batch EE entry assumed DSPATR was in
 * scope; dropped here, documented the same way Batch Z documented its own
 * scope correction.
 *
 * HIGHLIGHT cascades record -> field with OR semantics, NOT
 * nearest-wins-and-stops like resolveFont's cascade — confirmed against
 * IBM's own wording: "If you specify HIGHLIGHT at the record level, the
 * keyword applies to all fields in that record. Thus, if both the record-
 * and field-level HIGHLIGHT keywords are specified and either indicator
 * condition is met, the HIGHLIGHT keyword is used." So this checks both
 * levels and highlights if EITHER is currently active, rather than
 * stopping at the first level that has the keyword at all.
 *
 * COLOR and UNDERLINE are field-level-only printer-file keywords (verified
 * against IBM's DDS reference for each — see resolveColorStyle's own
 * comment for COLOR; UNDERLINE's own keyword description opens the same
 * way, "You use this field-level keyword...") — neither cascades from
 * `record`/`fileLevel` the way FONT or HIGHLIGHT do, so only `entry.keywords`
 * is ever checked for them.
 *
 * Not attempted here: HIGHLIGHT's own already-existing "ignored if CDEFNT
 * or FNTCHRSET is also coded" conflict (surfaced today only as a
 * fieldWarnings validation message — see prtfKeywordValidation.js) isn't
 * cross-checked against the resolved FONT mode to suppress the bold
 * styling below. Scoped out to keep this batch to "resolve + render", the
 * same boundary docs/TASKS.md's own Batch EE entry draws ("no model/
 * parser/writer change expected") — the existing warning already tells the
 * person HIGHLIGHT won't actually apply at print time in that case.
 */
function resolveStyle(entry, record, indicatorState) {
  const color = resolveColorStyle(entry, indicatorState);
  const underline = !!findActiveKeyword(entry.keywords, "UNDERLINE", indicatorState);
  const entryHighlight = !!findActiveKeyword(entry.keywords, "HIGHLIGHT", indicatorState);
  const recordHighlight = !!findActiveKeyword(record.keywords, "HIGHLIGHT", indicatorState);
  return {
    color,
    highlight: entryHighlight || recordHighlight,
    underline,
  };
}

/**
 * LINE(position-down position-across line-length line-direction line-width
 *      [line-pad] [color])
 * e.g. LINE(4 3 5 *HRZ .01) — verified against IBM's DDS reference for
 * printer files. Record-level keyword, AFPDS-only (requires
 * DEVTYPE(*AFPDS) on the CRTPRTF command — this tool doesn't check that,
 * it just renders what's coded). Position/length values are in the
 * compile's unit of measure — see toInches above.
 */
function parseLineGeometry(kw, cpi, lpi, uom) {
  const t = paramTokens(kw);
  const approximate = t.slice(0, 3).some(isFieldRef);
  const posDown = toInches(toNumber(t[0], 0), uom);
  const posAcross = toInches(toNumber(t[1], 0), uom);
  const length = toInches(toNumber(t[2], 1), uom);
  const direction = (t[3] || "*HRZ").toUpperCase();
  const row = Math.round(posDown * lpi) + 1;
  const col = Math.round(posAcross * cpi) + 1;
  if (direction === "*VRT") {
    return { type: "line", direction: "vertical", row1: row, col1: col, row2: row + Math.round(length * lpi), col2: col, approximate };
  }
  return { type: "line", direction: "horizontal", row1: row, col1: col, row2: row, col2: col + Math.round(length * cpi), approximate };
}

/**
 * BOX(first-corner-down first-corner-across diagonal-corner-down
 *     diagonal-corner-across line-width [color] [shading])
 * e.g. BOX(0 0 2 2 *MEDIUM) — verified against IBM's DDS reference.
 * Record-level, AFPDS-only, same caveats as LINE above.
 */
function parseBoxGeometry(kw, cpi, lpi, uom) {
  const t = paramTokens(kw);
  const approximate = t.slice(0, 4).some(isFieldRef);
  const d1 = toInches(toNumber(t[0], 0), uom);
  const a1 = toInches(toNumber(t[1], 0), uom);
  const d2 = toInches(toNumber(t[2], 1), uom);
  const a2 = toInches(toNumber(t[3], 1), uom);
  return {
    type: "box",
    row1: Math.round(d1 * lpi) + 1,
    col1: Math.round(a1 * cpi) + 1,
    row2: Math.round(d2 * lpi) + 1,
    col2: Math.round(a2 * cpi) + 1,
    approximate,
  };
}

/**
 * BARCODE(bar-code-ID [height] [*HRZ|*VRT] [*HRI|*HRITOP|*NOHRI]
 *         [*AST|*NOAST] [modifier] [unit-width] [symbol-width]
 *         [wide/narrow-ratio] ...)
 * Verified against IBM's DDS reference for printer files. Field-level
 * (unlike LINE/BOX, which are record-level), valid only for
 * IPDS/AFPDS-capable printer files. Real symbol rendering (actual bars) is
 * out of v1 scope per docs/REQUIREMENTS.md — this resolves just enough to
 * draw a labeled placeholder of roughly the right size: the bar-code-ID,
 * direction, and height (in character rows, converted from either a plain
 * line count or a "(height *UOM)" physical measurement via LPI; that
 * measurement is in the compile's unit of measure too — see toInches).
 *
 * docs/TASKS.md Batch C added the full structured parse of every BARCODE
 * parameter (prtfBarcodeParams.js's parseBarcodeParams, used by the
 * properties panel to make all of it editable) and fixed the gap this
 * function used to have on its own: HRI is a three-way value (below/
 * above/none — RLU's own screen exposes it as 1=Below/2=Above/3=None,
 * docs/KEYWORD-INVENTORY.md §3), not the boolean this function collapsed
 * it to. This function now delegates to that shared parser instead of
 * re-parsing independently, so the two can't drift; `hriPosition` is the
 * new three-way value, `hri` is kept (derived from it) for existing
 * callers/tests that just want "is HRI showing at all".
 */
function parseBarcodeGeometry(kw, lpi, uom) {
  const parsed = parseBarcodeParams(kw);
  const barCodeId = parsed.barCodeId;
  const direction = parsed.direction;
  const hriPosition = parsed.hriPosition;
  const hri = hriPosition !== "none";

  let heightLines = 2; // placeholder default when height isn't a plain line count
  let approximateHeight = true;
  if (parsed.heightMode === "lines") {
    heightLines = parsed.heightLines;
    approximateHeight = false;
  } else if (parsed.heightMode === "uom" && parsed.heightValue != null) {
    heightLines = Math.max(1, Math.round(toInches(parsed.heightValue, uom) * lpi));
    approximateHeight = false;
  }

  return { barCodeId, direction, hri, hriPosition, heightLines, approximateHeight };
}

/**
 * Batch E (docs/TASKS.md) — labeled placeholder boxes for the three
 * record-level AFP resource keywords that carry their own page position:
 * OVERLAY, PAGSEG, AFPRSC. (STRPAGGRP/ENDPAGGRP/DOCIDXTAG/DTASTMCMD have no
 * page position of their own — a page group is a logical grouping of
 * whole pages, not a place on one — so they're surfaced separately as a
 * non-positioned badge list; see collectPageGroupMetadata below.) A record
 * can carry more than one of these (e.g. a front overlay and a back
 * overlay via two OVERLAY keywords), so — like LINE/BOX — every instance
 * is rendered, even though the properties panel (media/webviewClient.js)
 * only edits by keyword name and so only reaches the first.
 */
function resolveResourcePlaceholders(record, cpi, lpi, uom, indicatorState) {
  return [
    ...findAllActiveKeywords(record.keywords, "OVERLAY", indicatorState).map((kw) => parseOverlay(kw, cpi, lpi, uom)),
    ...findAllActiveKeywords(record.keywords, "PAGSEG", indicatorState).map((kw) => parsePagseg(kw, cpi, lpi, uom)),
    ...findAllActiveKeywords(record.keywords, "AFPRSC", indicatorState).map((kw) => parseAfprsc(kw, cpi, lpi, uom)),
  ];
}

/**
 * Batch E — a short, human-readable summary of each STRPAGGRP/ENDPAGGRP/
 * DOCIDXTAG/DTASTMCMD occurrence on this record, for a non-positioned
 * "page-group / resource keywords" panel (these four don't place anything
 * on the printed page, so unlike resolveResourcePlaceholders above they
 * don't get row/col geometry).
 */
function collectPageGroupMetadata(record, indicatorState) {
  const items = [];
  findAllActiveKeywords(record.keywords, "STRPAGGRP", indicatorState).forEach((kw) => {
    const inner = String(kw.params || "").replace(/^\(/, "").replace(/\)$/, "").trim();
    items.push({ keyword: "STRPAGGRP", summary: inner ? "Start page group " + inner : "Start page group" });
  });
  findAllActiveKeywords(record.keywords, "ENDPAGGRP", indicatorState).forEach(() => {
    items.push({ keyword: "ENDPAGGRP", summary: "End page group" });
  });
  findAllActiveKeywords(record.keywords, "DOCIDXTAG", indicatorState).forEach((kw) => {
    const t = paramTokens(kw);
    items.push({ keyword: "DOCIDXTAG", summary: t.length ? "Index tag: " + t.join(" ") : "Index tag" });
  });
  findAllActiveKeywords(record.keywords, "DTASTMCMD", indicatorState).forEach((kw) => {
    const inner = String(kw.params || "").replace(/^\(/, "").replace(/\)$/, "").trim();
    items.push({ keyword: "DTASTMCMD", summary: inner ? "Data stream command: " + inner : "Data stream command" });
  });
  return items;
}

function resolvePageSize(record, fileLevel, indicatorState) {
  const kw = findActiveKeyword(record.keywords, "PAGSIZE", indicatorState) || findActiveKeyword(fileLevel.keywords, "PAGSIZE", indicatorState);
  let lines = 66;
  let cols = 132;
  if (kw) {
    const nums = String(kw.params).match(/\d+(\.\d+)?/g);
    if (nums && nums.length >= 1) lines = Number(nums[0]);
    if (nums && nums.length >= 2) cols = Number(nums[1]);
  }
  return { lines, cols };
}

// Batch Z (docs/TASKS.md) — system-constant fields (DATE/TIME/PAGNBR).
// Mirrors I-SDA's fieldDisplayText fallback: a constant entry with no
// literal text (entry.literal undefined — see prtfModel.ts's ConstantEntry
// comment) is rendered blank today, even though real DDS lets DATE/TIME/
// PAGNBR define a constant field purely via the keyword (see
// prtfParser.ts's constant-parsing branch, which already tolerates this
// shape). This resolves a *design-time placeholder* for those three —
// approximate, not a live-system value, same "no live-system
// verification" caveat as this file's other approximate-width keywords
// (see the file banner comment and docs/REQUIREMENTS.md §6).
//
// USER/SYSNAME were named in the original task alongside DATE/TIME/PAGNBR
// (mirroring I-SDA's own fieldDisplayText, which handles USER/SYSNAME for
// *display* files) but verification against IBM's DDS Reference: Printer
// Files keyword list turned up no USER or SYSNAME keyword for printer
// files at all — only DSPF supports them. Deliberately NOT implemented
// here; see docs/ROADMAP.md/docs/REQUIREMENTS.md for this correction,
// same honesty-over-silently-dropping-scope treatment as the earlier
// fictitious DRAW keyword correction (docs/TASKS.md's Batch history).
function resolveConstantPlaceholder(entry, indicatorState) {
  if (entry.literal !== undefined) return undefined;
  if (findActiveKeyword(entry.keywords, "DATE", indicatorState)) {
    // DATE's own *Y/*YY parameter controls a 2- vs 4-digit year (see
    // KEYWORD-INVENTORY.md / IBM's DATE keyword description) — approximate
    // that shape with the platform's local date string rather than
    // inventing DATFMT-aware formatting (explicit non-goal, see this
    // file's other EDTCDE/EDTWRD-adjacent approximations).
    return new Date().toLocaleDateString();
  }
  if (findActiveKeyword(entry.keywords, "TIME", indicatorState)) {
    return new Date().toLocaleTimeString();
  }
  if (findActiveKeyword(entry.keywords, "PAGNBR", indicatorState)) {
    return "1";
  }
  return undefined;
}

function indicatorActive(conditions, indicatorState) {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => {
    const state = !!indicatorState[c.indicator];
    return c.negate ? !state : state;
  });
}

/** Human-readable label for a resolved cell, for overlap-warning messages. */
function cellOverlapLabel(cell) {
  return cell.kind === "field" ? cell.name : cell.text || "(unnamed constant)";
}

/**
 * Batch HH (docs/TASKS.md) — formats a raw per-field sample value (real
 * RLU's SD sequence command) for the design preview, "respecting length/
 * decimal formatting" per this batch's own task wording, without
 * attempting full EDTCDE/EDTWRD emulation (the same explicit non-goal
 * resolveConstantPlaceholder's own DATE-formatting comment above already
 * states for a different keyword).
 *
 * Numeric data types (S/P/B/F, per IBM's DDS reference for printer files'
 * position-35 data-type list) are right-justified with a literal decimal
 * point inserted per decimalPositions, matching how a numeric field
 * actually prints; non-numeric types are left-justified, unpadded. Either
 * way the result is truncated — never overflowed — to the field's own
 * resolved length: a real printer never grows a field past its declared
 * width, it just prints what fits.
 */
function formatSampleValue(rawValue, length, dataType, decimalPositions) {
  const len = length || String(rawValue || "").length || 1;
  const isNumeric = dataType === "S" || dataType === "P" || dataType === "B" || dataType === "F";
  let text = String(rawValue == null ? "" : rawValue);
  if (isNumeric && decimalPositions) {
    const stripped = text.replace(/[^0-9.\-]/g, "");
    const parsed = Number(stripped);
    if (stripped && !Number.isNaN(parsed)) text = parsed.toFixed(decimalPositions);
  }
  if (text.length > len) return text.slice(0, len);
  return isNumeric ? text.padStart(len, " ") : text;
}

/**
 * Batch GG (docs/TASKS.md) — field/constant overlap detection.
 *
 * Reference: I-SDA's `dspfEngine.js` `resolveScreen` runs the same
 * (line, column)-sorted, first-claim-wins pass, but I-SDA is a DISPLAY
 * file engine: it drops a losing field from the resolved render entirely
 * (`resolved.push(f)` only happens when unblocked) because an interactive
 * 5250 screen can only show one thing per cell.
 *
 * Printer files behave differently — confirmed against IBM's own DDS
 * reference for printer files ("Overlapping fields"): "If fields overlap,
 * the printer overprints." There is no dropped field at print time, only
 * literal overprinted ink. So this pass mirrors I-SDA's detection logic
 * (same sort, same first-claim-wins "who blocked whom" bookkeeping, so the
 * warning message is exactly as specific) but deliberately does NOT drop
 * anything from the caller's `cells` array — every cell already in `cells`
 * still renders, exactly as a real CRTPRTF-compiled overprint would. This
 * function only returns a side-channel `overlaps` list for a warning
 * banner, same "surfaced separately, not silently dropped" shape I-SDA's
 * own `overlaps` array already uses (this project just leans on that shape
 * for the *entire* result here, not just the diagnostic reporting half of
 * it).
 *
 * Scope boundary: this checks only the fields/constants already active for
 * the CURRENT indicator-toggle preview (the `cells` array), not every
 * indicator combination that could ever be true at once. IBM's own DDS
 * reference notes the real compiler diagnoses overlap treating conditioned
 * fields "as if they were selected" (i.e. a static, indicator-state-blind
 * check) — this tool is a live, indicator-togglable design-time preview
 * rather than a static compile-time analyzer, so overlap here is
 * intentionally reported per-current-toggle-state; toggling indicators and
 * re-checking is how a person exercises other combinations, the same
 * boundary this project's other indicator-conditioned resolvers already
 * draw.
 */
function detectFieldOverlaps(cells) {
  const candidates = cells.slice().sort((a, b) => a.line - b.line || a.position - b.position);
  const occupied = {}; // "line:col" -> the first cell that claimed it
  const overlaps = [];
  for (const cell of candidates) {
    let blockedBy = null;
    for (let c = cell.position; c < cell.position + cell.length && !blockedBy; c++) {
      const key = cell.line + ":" + c;
      if (occupied[key]) blockedBy = occupied[key];
    }
    if (blockedBy) {
      overlaps.push({
        field: cellOverlapLabel(cell),
        blockedBy: cellOverlapLabel(blockedBy),
        line: cell.line,
        position: cell.position,
      });
      continue; // matches I-SDA's own claim logic: a blocked cell doesn't itself claim further cells
    }
    for (let c = cell.position; c < cell.position + cell.length; c++) {
      occupied[cell.line + ":" + c] = cell;
    }
  }
  return overlaps;
}

function resolveLayout(model, recordName, indicatorState, uom) {
  indicatorState = indicatorState || {};
  uom = uom === "cm" ? "cm" : "inch"; // default to inch, CRTPRTF's own default
  const record = model.records.find((r) => r.name === recordName) || model.records[0];
  if (!record) return null;

  const { lines: pageLines, cols: pageCols } = resolvePageSize(record, model.fileLevel, indicatorState);
  const { cpi, lpi } = resolveCpiLpi(record, model.fileLevel, indicatorState);

  const draws = [
    ...findAllActiveKeywords(record.keywords, "LINE", indicatorState).map((kw) => parseLineGeometry(kw, cpi, lpi, uom)),
    ...findAllActiveKeywords(record.keywords, "BOX", indicatorState).map((kw) => parseBoxGeometry(kw, cpi, lpi, uom)),
  ];

  // Batch E (docs/TASKS.md) — AFP page-group / resource keyword
  // placeholders. `resources` are the positioned ones (OVERLAY/PAGSEG/
  // AFPRSC, rendered as labeled boxes); `pageGroupKeywords` are the
  // non-positioned ones (STRPAGGRP/ENDPAGGRP/DOCIDXTAG/DTASTMCMD, surfaced
  // as a badge list instead — see collectPageGroupMetadata's own comment).
  const resources = resolveResourcePlaceholders(record, cpi, lpi, uom, indicatorState);
  const pageGroupKeywords = collectPageGroupMetadata(record, indicatorState);

  let cursorLine = 1;
  let cursorCol = 1;
  const cells = [];
  const skipped = [];

  for (const entry of record.fields) {
    if (!indicatorActive(entry.conditions, indicatorState)) {
      skipped.push(entry);
      continue;
    }

    const skipB = findActiveKeyword(entry.keywords, "SKIPB", indicatorState);
    const spaceB = findActiveKeyword(entry.keywords, "SPACEB", indicatorState);
    if (skipB) cursorLine = numericParam(skipB, cursorLine);
    if (spaceB) cursorLine += numericParam(spaceB, 0);

    const line = entry.line || cursorLine;
    const position = entry.position || cursorCol;

    // Batch Z (docs/TASKS.md) — resolved once per constant so both `text`
    // and `length` below agree on the same placeholder (a system-constant
    // field's design-time length is the placeholder text's length, not the
    // entry.length||1 fallback that only makes sense for a truly blank
    // constant).
    const constantPlaceholder = entry.kind === "constant" ? resolveConstantPlaceholder(entry, indicatorState) : undefined;

    const length =
      entry.kind === "field"
        ? entry.length || (entry.name || "").length || 1
        : entry.literal
        ? entry.literal.length
        : constantPlaceholder
        ? constantPlaceholder.length
        : entry.length || 1;
    const barcodeKw = entry.kind === "field" ? findActiveKeyword(entry.keywords, "BARCODE", indicatorState) : undefined;
    const font = resolveFont(entry, record, model.fileLevel, indicatorState);
    const fontDisplay = resolveFontDisplay(font);
    const style = resolveStyle(entry, record, indicatorState);

    cells.push({
      id: entry.id,
      kind: entry.kind,
      name: entry.kind === "field" ? entry.name : undefined,
      text: entry.kind === "constant" ? entry.literal || constantPlaceholder || "" : entry.name,
      line,
      position,
      length,
      // Extra properties so the webview's edit panel can prefill a form
      // without a second round trip to the extension host.
      dataType: entry.kind === "field" ? entry.dataType : undefined,
      decimalPositions: entry.kind === "field" ? entry.decimalPositions : undefined,
      usage: entry.kind === "field" ? entry.usage : undefined,
      literal: entry.kind === "constant" ? entry.literal : undefined,
      // Batch H (docs/TASKS.md) — "Reference a field" (position 29 'R').
      // `reference` mirrors entry.reference so the properties panel's
      // toggle can prefill; `refTarget` (only when reference is on) is the
      // pure "where to look" resolution from resolveReferenceTarget, so the
      // panel's field/library/file inputs can prefill too, without a second
      // round trip to the extension host just to read back what REFFLD/REF
      // already say.
      reference: entry.kind === "field" ? !!entry.reference : undefined,
      refTarget: entry.kind === "field" && entry.reference ? resolveReferenceTarget(model, record, entry) : undefined,
      // Batch G (docs/TASKS.md) — field-level applicability warnings for
      // data/edit keywords (e.g. FLTPCN on a non-F field).
      fieldWarnings: entry.kind === "field" ? validateFieldKeywords(entry) : undefined,
      barcode: barcodeKw ? parseBarcodeGeometry(barcodeKw, lpi, uom) : undefined,
      // Batch C (docs/TASKS.md) — the full structured parse of every
      // BARCODE parameter (not just the geometry subset `barcode` above
      // carries), so the properties panel's BARCODE form can prefill
      // without a second round trip to the extension host.
      barcodeParams: barcodeKw ? parseBarcodeParams(barcodeKw) : undefined,
      // Raw keyword array (fields and constants) so the webview's various
      // properties-panel sections — Batch G data/edit keywords, Batch B
      // font & sizing (FONT/CDEFNT/FNTCHRSET/FONTNAME/CHRID/CHRSIZ/CCSID),
      // and Batch A general keywords — can all prefill from the same
      // entry.keywords without a second round trip. NOTE: this key used to
      // be set twice in this object literal (once field-only for Batch G,
      // once unconditionally for Batch B) — the second silently won, so the
      // field-only restriction was already dead. Keeping the unconditional
      // version since Batch A's general-keywords panel needs it for
      // constants too.
      keywords: entry.keywords,
      // Batch L (continued) — fontDisplay resolves whichever of
      // FONT/CDEFNT/FNTCHRSET/FONTNAME is actually in effect (see
      // resolveFont/resolveFontDisplay above); previously this object was
      // built inline here and only ever handled FONT/FGID.
      font: fontDisplay,
      // Batch EE (docs/TASKS.md) — COLOR/HIGHLIGHT/UNDERLINE resolved to a
      // renderable style object (see resolveStyle's own comment for the
      // per-keyword cascade rules and the DSPATR scope correction).
      style,
      // Batch HH (docs/TASKS.md) — design-time-only sample value (real
      // RLU's SD sequence command). `sampleValue` is the raw text so the
      // properties panel can prefill its input; `sampleDisplay` is the
      // length/decimal-formatted version media/webviewClient.js's
      // renderPage shows in place of "{FIELDNAME}" (see
      // FieldEntry.sampleValue's own comment for why this never touches
      // DDS source).
      sampleValue: entry.kind === "field" ? entry.sampleValue : undefined,
      sampleDisplay:
        entry.kind === "field" && entry.sampleValue
          ? formatSampleValue(entry.sampleValue, length, entry.dataType, entry.decimalPositions)
          : undefined,
    });

    cursorLine = line;
    cursorCol = position + length;

    const skipA = findActiveKeyword(entry.keywords, "SKIPA", indicatorState);
    const spaceA = findActiveKeyword(entry.keywords, "SPACEA", indicatorState);
    if (skipA) cursorLine = numericParam(skipA, cursorLine);
    if (spaceA) cursorLine += numericParam(spaceA, 0);
  }

  return {
    recordName: record.name,
    pageLines,
    pageCols,
    cells,
    draws,
    resources,
    pageGroupKeywords,
    skippedByIndicator: skipped.map((e) => (e.kind === "field" ? e.name : e.literal || "(constant)")),
    // Batch GG (docs/TASKS.md) — see detectFieldOverlaps' own comment for
    // why this is warn-only (no cell removal), unlike I-SDA's display-file
    // equivalent.
    overlaps: detectFieldOverlaps(cells),
    // Pixel grid derived from the record's CPI/LPI at 96 DPI (standard web
    // display density): cellWidthPx = 96/CPI, cellHeightPx = 96/LPI. This
    // is the same character-cell grid RLU itself was built around, just
    // expressed in the units a webview needs.
    grid: { cpi, lpi, cellWidthPx: 96 / cpi, cellHeightPx: 96 / lpi },
  };
}

function listRecordNames(model) {
  return model.records.map((r) => r.name);
}

/** Collects every indicator referenced anywhere in the record, for building an indicator-toggle panel. */
function collectIndicators(record) {
  const set = new Set();
  const visit = (conditions) => (conditions || []).forEach((c) => set.add(c.indicator));
  visit(record.conditions);
  for (const kw of record.keywords || []) visit(kw.conditions);
  for (const f of record.fields) {
    visit(f.conditions);
    // An indicator referenced ONLY by an attached keyword's own
    // conditioning (see prtfModel.ts's Keyword.conditions comment) — e.g.
    // two mutually-exclusive COLOR keywords on one field, each on its own
    // indicator, with the field's own line left unconditioned — wouldn't
    // otherwise show up in the toggle panel at all, so there'd be no way
    // to preview the field switching between them.
    for (const kw of f.keywords) visit(kw.conditions);
  }
  return Array.from(set).sort();
}

const mod = {
  resolveLayout,
  listRecordNames,
  collectIndicators,
  // Shared with prtfKeywordValidation.js's AFPDS-heuristic (looksLikeAfpds
  // uses the same font/barcode keyword names this file resolves geometry
  // for), and reused by the webview's font/sizing properties-panel UI so
  // P-field (&NAME) detection and the FONT nested-*POINTSIZE grammar
  // aren't duplicated between engine and UI code.
  paramTokens,
  isFieldRef,
  parseFontKeyword,
  // Batch L (continued) — exported directly (not just via resolveLayout's
  // cells[].font) so they're unit-testable in isolation.
  resolveFont,
  resolveFontDisplay,
  resolveColorStyle,
  resolveStyle,
  // Batch GG (docs/TASKS.md) — exported directly so it's unit-testable in
  // isolation, same rationale as resolveFont/resolveStyle above.
  detectFieldOverlaps,
  // Batch HH (docs/TASKS.md) — exported directly so it's unit-testable in
  // isolation, same rationale as detectFieldOverlaps above.
  formatSampleValue,
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfLayout = mod;
