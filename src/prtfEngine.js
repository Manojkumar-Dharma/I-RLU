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
 */

// eslint-disable-next-line no-undef
const AfpFontMetrics = typeof module !== "undefined" && module.exports ? require("./afpFontMetrics.js") : window.AfpFontMetrics;

function findKeyword(keywords, name) {
  return (keywords || []).find((k) => k.name === name);
}

function findAllKeywords(keywords, name) {
  return (keywords || []).filter((k) => k.name === name);
}

function numericParam(kw, fallback) {
  if (!kw) return fallback;
  const m = String(kw.params).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : fallback;
}

/** Splits a keyword's "(...)" params into whitespace-separated tokens, respecting nothing fancier than that (no nested parens expected in LINE/BOX params). */
function paramTokens(kw) {
  const inner = String(kw.params || "").replace(/^\(/, "").replace(/\)$/, "");
  return inner.trim() === "" ? [] : inner.trim().split(/\s+/);
}

/** true if a LINE/BOX parameter token is a program-to-system field reference (&NAME) rather than a literal value — these can't be resolved without a live compile/run, so geometry using them is flagged approximate. */
function isFieldRef(tok) {
  return typeof tok === "string" && tok.startsWith("&");
}

function toNumber(tok, fallback) {
  if (tok === undefined || isFieldRef(tok)) return fallback;
  const n = Number(tok);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Converts a physical measurement to inches, given the unit of measure it
 * was coded in. LINE/BOX geometry and BARCODE's "(height *UOM)" form are
 * always specified in whatever unit CRTPRTF's UOM parameter selects for
 * that compile — there is no UOM keyword in DDS source itself, so this
 * tool has no way to know that unit from the source alone. Callers pass it
 * in explicitly (see resolveLayout's `uom` parameter), defaulting to
 * "inch" (CRTPRTF's own default) unless the person configures
 * i-rlu.unitOfMeasure to match what their shop actually compiles with.
 */
function toInches(value, uom) {
  return uom === "cm" ? value / 2.54 : value;
}

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
 */
function parseBarcodeGeometry(kw, lpi, uom) {
  const t = paramTokens(kw);
  const barCodeId = (t[0] || "").replace(/^\*/, "");
  const rest = t.slice(1);
  const direction = rest.some((x) => x.toUpperCase() === "*VRT") ? "vertical" : "horizontal";
  const hri = !rest.some((x) => x.toUpperCase() === "*NOHRI");

  let heightLines = 2; // placeholder default when height isn't a plain line count
  let approximateHeight = true;
  if (rest.length > 0) {
    const h = rest[0];
    if (/^\d+$/.test(h)) {
      const n = Number(h);
      if (n >= 1 && n <= 9) {
        heightLines = n;
        approximateHeight = false;
      }
    } else if (h.startsWith("(")) {
      // "(height *UOM)" form, e.g. "(0.5 *IN)" — find the closing token.
      let combined = h;
      for (let i = 1; i < rest.length && !combined.endsWith(")"); i++) combined += " " + rest[i];
      const m = combined.match(/\(([\d.]+)/);
      if (m) {
        heightLines = Math.max(1, Math.round(toInches(Number(m[1]), uom) * lpi));
        approximateHeight = false;
      }
    }
  }

  return { barCodeId, direction, hri, heightLines, approximateHeight };
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
      barcode: barcodeKw ? parseBarcodeGeometry(barcodeKw, lpi, uom) : undefined,
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

// --- Batch F: print/finishing keywords (DUPLEX, FORCE, OUTBIN, ZFOLD,
// STAPLE, INVMMAP) -----------------------------------------------------
//
// None of these affect page-preview layout (they're physical-printer
// behavior, not positioning), so there's no rendering here — just
// validation-only hints per IBM's documented restrictions, surfaced in the
// properties panel. CRTPRTF remains the real enforcement point; nothing
// here blocks an edit.

/** Record-level keywords that take no parameters at all (option indicators only) — must be re-emitted as a bare keyword name, never "NAME()". */
const VALUELESS_KEYWORDS = ["FORCE", "ZFOLD", "STAPLE"];

/** ZFOLD/STAPLE (and GDF, if ever modeled) only take effect when printing through PSF — silently ignored otherwise, per IBM's DDS reference. */
const PSF_ONLY_KEYWORDS = ["ZFOLD", "STAPLE"];

/**
 * Keywords whose presence is a strong signal a record targets *AFPDS.
 * DEVTYPE itself is a CRTPRTF/CHGPRTF/OVRPRTF command parameter, not DDS
 * source text, so I-RLU can never know for certain from the source alone
 * (same caveat as the i-rlu.unitOfMeasure setting) — this is a heuristic
 * used only to decide whether to surface the SKIPA/SKIPB file-level hint
 * below, not a hard classification.
 */
const AFPDS_INDICATOR_KEYWORDS = [
  "FONT", "CDEFNT", "FNTCHRSET", "FONTNAME", "PAGSEG", "OVERLAY",
  "STRPAGGRP", "ENDPAGGRP", "DOCIDXTAG", "AFPRSC", "DTASTMCMD", "BARCODE",
];

function looksLikeAfpds(model) {
  // DEVTYPE is itself a real file/record-level DDS keyword (see
  // test/fixtures/sample-afpds.pf, sample-scs.pf) — when present it's an
  // authoritative answer, not a guess. Only fall back to the
  // AFPDS-typical-keyword heuristic when DEVTYPE isn't coded anywhere,
  // since DEVTYPE is optional (CRTPRTF's own DEVTYPE parameter applies
  // when it's omitted, and that's a compile-time value I-RLU can't see).
  const fileDevtype = findKeyword(model.fileLevel.keywords, "DEVTYPE");
  if (fileDevtype) return /\*AFPDS/.test(fileDevtype.params);
  const recordDevtype = model.records.map((r) => findKeyword(r.keywords, "DEVTYPE")).find(Boolean);
  if (recordDevtype) return /\*AFPDS/.test(recordDevtype.params);

  return model.records.some(
    (r) =>
      AFPDS_INDICATOR_KEYWORDS.some((name) => findKeyword(r.keywords, name)) ||
      r.fields.some((f) => AFPDS_INDICATOR_KEYWORDS.some((name) => findKeyword(f.keywords, name)))
  );
}

/** Validation hints for a single record's keywords — currently just the ZFOLD/STAPLE PSF-only notice. Returns [] when there's nothing to flag. */
function validateRecordKeywords(record) {
  const warnings = [];
  PSF_ONLY_KEYWORDS.forEach((name) => {
    if (findKeyword(record.keywords, name)) {
      warnings.push({
        keyword: name,
        message: name + " is only supported when printing through PSF (Print Services Facility) — it's ignored under Host Print Transform.",
      });
    }
  });
  return warnings;
}

/** Validation hints scoped to the whole file — currently just the *AFPDS file-level SKIPA/SKIPB restriction (folded into this batch per docs/TASKS.md). Returns [] when there's nothing to flag. */
function validateFileLevelKeywords(model) {
  const warnings = [];
  ["SKIPA", "SKIPB"].forEach((name) => {
    if (findKeyword(model.fileLevel.keywords, name) && looksLikeAfpds(model)) {
      warnings.push({
        keyword: name,
        message:
          name +
          " isn't allowed at the file level for *AFPDS spooled files (this file appears to target AFPDS — other AFPDS-typical keywords are present). Move it to the record level, or confirm this file actually compiles as SCS.",
      });
    }
  });
  return warnings;
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
  findKeyword,
  findAllKeywords,
  numericParam,
  // Batch F
  VALUELESS_KEYWORDS,
  PSF_ONLY_KEYWORDS,
  validateRecordKeywords,
  validateFileLevelKeywords,
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfEngine = mod;
