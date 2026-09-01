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
const { findKeyword, findAllKeywords, numericParam, paramTokens, isFieldRef, toNumber, toInches } =
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

/**
 * Resolves CPI (characters per inch) and LPI (lines per inch) for a
 * record, used to convert LINE/BOX/BARCODE geometry — specified in
 * whatever physical unit CRTPRTF's UOM parameter selects (see toInches
 * above) — into the same character-grid coordinates fields use. Defaults
 * (10 CPI, 6 LPI) match traditional SCS/line-printer defaults; real AFPDS
 * jobs may differ per font, so this is a rendering approximation, not a
 * production measurement.
 */
function resolveCpiLpi(record, fileLevel) {
  const cpiKw = findKeyword(record.keywords, "CPI") || findKeyword(fileLevel.keywords, "CPI");
  const lpiKw = findKeyword(record.keywords, "LPI") || findKeyword(fileLevel.keywords, "LPI");
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
 * Resolves the effective FONT for a field/constant entry: field-level
 * FONT keyword takes precedence, then record-level, then file-level, then
 * IBM i's own default substitution target (Courier 10 pitch, FGID 11 —
 * see afpFontMetrics.js).
 */
function resolveFont(entry, record, fileLevel) {
  const kw = findKeyword(entry.keywords, "FONT") || findKeyword(record.keywords, "FONT") || findKeyword(fileLevel.keywords, "FONT");
  if (!kw) return { fgid: AfpFontMetrics.DEFAULT_FGID, pointSize: undefined, approximate: false };
  return parseFontKeyword(kw);
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

function resolvePageSize(record, fileLevel) {
  const kw = findKeyword(record.keywords, "PAGSIZE") || findKeyword(fileLevel.keywords, "PAGSIZE");
  let lines = 66;
  let cols = 132;
  if (kw) {
    const nums = String(kw.params).match(/\d+(\.\d+)?/g);
    if (nums && nums.length >= 1) lines = Number(nums[0]);
    if (nums && nums.length >= 2) cols = Number(nums[1]);
  }
  return { lines, cols };
}

function indicatorActive(conditions, indicatorState) {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => {
    const state = !!indicatorState[c.indicator];
    return c.negate ? !state : state;
  });
}

function resolveLayout(model, recordName, indicatorState, uom) {
  indicatorState = indicatorState || {};
  uom = uom === "cm" ? "cm" : "inch"; // default to inch, CRTPRTF's own default
  const record = model.records.find((r) => r.name === recordName) || model.records[0];
  if (!record) return null;

  const { lines: pageLines, cols: pageCols } = resolvePageSize(record, model.fileLevel);
  const { cpi, lpi } = resolveCpiLpi(record, model.fileLevel);

  const draws = [
    ...findAllKeywords(record.keywords, "LINE").map((kw) => parseLineGeometry(kw, cpi, lpi, uom)),
    ...findAllKeywords(record.keywords, "BOX").map((kw) => parseBoxGeometry(kw, cpi, lpi, uom)),
  ];

  let cursorLine = 1;
  let cursorCol = 1;
  const cells = [];
  const skipped = [];

  for (const entry of record.fields) {
    if (!indicatorActive(entry.conditions, indicatorState)) {
      skipped.push(entry);
      continue;
    }

    const skipB = findKeyword(entry.keywords, "SKIPB");
    const spaceB = findKeyword(entry.keywords, "SPACEB");
    if (skipB) cursorLine = numericParam(skipB, cursorLine);
    if (spaceB) cursorLine += numericParam(spaceB, 0);

    const line = entry.line || cursorLine;
    const position = entry.position || cursorCol;

    const length =
      entry.kind === "field"
        ? entry.length || (entry.name || "").length || 1
        : entry.literal
        ? entry.literal.length
        : entry.length || 1;
    const barcodeKw = entry.kind === "field" ? findKeyword(entry.keywords, "BARCODE") : undefined;
    const font = resolveFont(entry, record, model.fileLevel);
    const fontInfo = AfpFontMetrics.getFontInfo(font.fgid);

    cells.push({
      id: entry.id,
      kind: entry.kind,
      name: entry.kind === "field" ? entry.name : undefined,
      text: entry.kind === "constant" ? entry.literal || "" : entry.name,
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
      font: {
        fgid: font.fgid,
        name: fontInfo.name,
        family: fontInfo.family,
        spacing: fontInfo.spacing,
        weight: fontInfo.weight,
        style: fontInfo.style,
        pointSize: font.pointSize,
        approximate: font.approximate,
        isPlaceholderMetrics: AfpFontMetrics.isPlaceholder(font.fgid),
      },
    });

    cursorLine = line;
    cursorCol = position + length;

    const skipA = findKeyword(entry.keywords, "SKIPA");
    const spaceA = findKeyword(entry.keywords, "SPACEA");
    if (skipA) cursorLine = numericParam(skipA, cursorLine);
    if (spaceA) cursorLine += numericParam(spaceA, 0);
  }

  return {
    recordName: record.name,
    pageLines,
    pageCols,
    cells,
    draws,
    skippedByIndicator: skipped.map((e) => (e.kind === "field" ? e.name : e.literal || "(constant)")),
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
  for (const f of record.fields) visit(f.conditions);
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
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfLayout = mod;
