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

// ---------------------------------------------------------------------
// Resolve Referenced Field (REF/REFFLD, position 29 'R') — Batch H (see
// docs/TASKS.md). Given a field flagged as a database reference, works out
// WHICH field, in WHICH library/file, its length/type/decimals should be
// resolved from — the pure "where do I look" half of "Resolve Referenced
// Field via Code for i"; the actual network round-trip (DSPFFD + an SQL
// lookup) only makes sense on the extension host, so it lives in
// extension.ts, built on top of this. Mirrors I-SDA's own
// DspfEngine.resolveReferenceTarget (src/dspfEngine.js), adapted for PRTF's
// REF being valid at file, record, OR field level (KEYWORD-INVENTORY.md
// §1/§3), not just file level. See "When to specify REF and REFFLD
// keywords for DDS files" in IBM's DDS reference for the precedence rules
// this follows:
//   - REFFLD's own field-name parameter (defaulting to this field's own
//     name when REFFLD isn't present at all — a bare R means "same-named
//     field").
//   - REFFLD's own [library/]file parameter, if given, OVERRIDES any
//     record- or file-level REF.
//   - REFFLD(field-name *SRC) means "search the file being defined" —
//     there's no live database file to query for that, so this returns
//     null (unresolvable via this feature) rather than guessing.
//   - With no REFFLD file/library at all, falls back to the record-level
//     REF keyword, then the file-level REF keyword; with none of those,
//     there's nothing to resolve against.
// ---------------------------------------------------------------------

/** @returns {{fieldName:string, library:?string, file:string}|null} */
function resolveReferenceTarget(model, record, field) {
  if (!field || field.kind !== "field" || !field.reference) return null;

  const reffld = findKeyword(field.keywords, "REFFLD");
  let fieldName = field.name;
  let fileSpec = null;

  if (reffld) {
    const parts = paramTokens(reffld);
    if (parts.length === 0) return null;
    fieldName = parts[0];
    if (parts.length > 1) {
      if (parts[1].toUpperCase() === "*SRC") return null; // "search this DDS file itself" — no live file to query
      fileSpec = parts[1];
    }
  }

  if (!fileSpec) {
    const recordRef = record && findKeyword(record.keywords, "REF");
    const fileRef = model && model.fileLevel && findKeyword(model.fileLevel.keywords, "REF");
    const refKw = recordRef || fileRef;
    if (!refKw) return null; // nothing to resolve against
    const refParts = paramTokens(refKw);
    if (refParts.length === 0) return null;
    fileSpec = refParts[0];
  }

  const slash = fileSpec.indexOf("/");
  const library = slash >= 0 ? fileSpec.slice(0, slash) : null;
  const file = slash >= 0 ? fileSpec.slice(slash + 1) : fileSpec;
  if (!file) return null;

  return { fieldName, library, file };
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
      // Batch H (docs/TASKS.md) — "Reference a field" (position 29 'R').
      // `reference` mirrors entry.reference so the properties panel's
      // toggle can prefill; `refTarget` (only when reference is on) is the
      // pure "where to look" resolution from resolveReferenceTarget, so the
      // panel's field/library/file inputs can prefill too, without a second
      // round trip to the extension host just to read back what REFFLD/REF
      // already say.
      reference: entry.kind === "field" ? !!entry.reference : undefined,
      refTarget: entry.kind === "field" && entry.reference ? resolveReferenceTarget(model, record, entry) : undefined,
      // Batch G (docs/TASKS.md) — field-level data/edit keywords. Raw
      // keywords so the properties panel can prefill ALIAS/BLKFOLD/CVTDTA/
      // DLTEDT/FLTFIXDEC/FLTPCN/TRNSPY/TXTRTT without a second round trip,
      // plus any applicability warnings (e.g. FLTPCN on a non-F field).
      keywords: entry.kind === "field" ? entry.keywords : undefined,
      fieldWarnings: entry.kind === "field" ? validateFieldKeywords(entry) : undefined,
      barcode: barcodeKw ? parseBarcodeGeometry(barcodeKw, lpi, uom) : undefined,
      // Batch B: raw keyword array so the webview's Font & sizing panel can
      // read/prefill FONT/CDEFNT/FNTCHRSET/FONTNAME/CHRID/CHRSIZ/CCSID for
      // the selected field/constant without a second round trip.
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

// --- Batch G: field-level data/edit keywords (ALIAS, BLKFOLD, CVTDTA,
// DLTEDT, FLTFIXDEC, FLTPCN, TRNSPY, TXTRTT) + INDTXT indicator text ------
//
// None of these affect page-preview layout — ALIAS/CVTDTA/TRNSPY/TXTRTT
// describe how print-time data is interpreted or rotated (not something
// this character-grid preview models), BLKFOLD/DLTEDT/FLTFIXDEC/FLTPCN are
// print-time formatting choices, and INDTXT is documentation-only (no
// compile effect at all). Same validation-only approach as Batch F:
// CRTPRTF remains the real enforcement point, this just surfaces IBM's
// documented applicability rules as properties-panel hints.

/** Field-level keywords that take no parameters at all (option indicators only) — must be re-emitted as a bare keyword name, never "NAME()". */
const FIELD_LEVEL_VALUELESS_KEYWORDS = ["BLKFOLD", "DLTEDT", "TRNSPY", "FLTFIXDEC", "CVTDTA"];

/**
 * Validation hints for a single field's Batch G keywords — IBM's DDS
 * reference restricts several of these to a specific data type or to
 * reference fields, but the data-description processor is the only thing
 * that actually enforces it at compile time; this just surfaces the same
 * rule live in the designer. Returns [] when there's nothing to flag.
 */
function validateFieldKeywords(field) {
  const warnings = [];
  if (findKeyword(field.keywords, "DLTEDT") && !field.reference) {
    warnings.push({
      keyword: "DLTEDT",
      message: "DLTEDT only has an effect on a field that references another field (position 29 'R') — it deletes EDTCDE/EDTWRD editing that would otherwise be copied in from the referenced field.",
    });
  }
  const fltfixdec = findKeyword(field.keywords, "FLTFIXDEC");
  const fltpcn = findKeyword(field.keywords, "FLTPCN");
  [fltfixdec, fltpcn].forEach((kw) => {
    if (kw && field.dataType && field.dataType !== "F") {
      warnings.push({ keyword: kw.name, message: kw.name + " only applies to floating-point fields (data type F)." });
    }
  });
  if (fltpcn) {
    const val = (paramTokens(fltpcn)[0] || "").toUpperCase();
    if (val && val !== "*SINGLE" && val !== "*DOUBLE") {
      warnings.push({ keyword: "FLTPCN", message: "FLTPCN's parameter must be *SINGLE or *DOUBLE, not " + val + "." });
    }
  }
  const trnspy = findKeyword(field.keywords, "TRNSPY");
  if (trnspy && field.dataType && field.dataType !== "A") {
    warnings.push({ keyword: "TRNSPY", message: "TRNSPY only applies to character fields (data type A)." });
  }
  const txtrtt = findKeyword(field.keywords, "TXTRTT");
  if (txtrtt) {
    const deg = paramTokens(txtrtt)[0];
    if (deg && ["0", "90", "180", "270"].indexOf(deg) === -1) {
      warnings.push({ keyword: "TXTRTT", message: "TXTRTT's rotation must be 0, 90, 180, or 270 degrees, not " + deg + "." });
    }
  }
  return warnings;
}

/**
 * Batch B validation hints for FONT/CDEFNT/FNTCHRSET/CHRSIZ/CHRID, generic
 * over a keyword array so it works for both record-level and field-level
 * keywords without duplicating the checks. Per IBM's DDS reference:
 *  - HIGHLIGHT is ignored (with a compile-time message) if CDEFNT or
 *    FNTCHRSET is also coded on the same record/field.
 *  - CHRID is ignored (with a compile-time message) if CDEFNT or FNTCHRSET
 *    is also coded on the same record/field.
 *  - CHRSIZ requires an IPDS printer and is explicitly documented as one
 *    of the few keywords *not* supported under Host Print Transform — this
 *    is always worth a heads-up when CHRSIZ is present, not conditional on
 *    another keyword.
 * Returns [] when there's nothing to flag.
 */
function validateFontKeywords(keywords) {
  const warnings = [];
  const hasCdefnt = !!findKeyword(keywords, "CDEFNT");
  const hasFntchrset = !!findKeyword(keywords, "FNTCHRSET");
  if ((hasCdefnt || hasFntchrset) && findKeyword(keywords, "HIGHLIGHT")) {
    warnings.push({
      keyword: "HIGHLIGHT",
      message: "HIGHLIGHT is ignored (with a compile-time message) because " + (hasCdefnt ? "CDEFNT" : "FNTCHRSET") + " is also coded here.",
    });
  }
  if ((hasCdefnt || hasFntchrset) && findKeyword(keywords, "CHRID")) {
    warnings.push({
      keyword: "CHRID",
      message: "CHRID is ignored (with a compile-time message) because " + (hasCdefnt ? "CDEFNT" : "FNTCHRSET") + " is also coded here.",
    });
  }
  if (findKeyword(keywords, "CHRSIZ")) {
    warnings.push({
      keyword: "CHRSIZ",
      message: "CHRSIZ requires an IPDS printer — it's one of the few keywords not supported under Host Print Transform.",
    });
  }
  return warnings;
}

/**
 * Parses one INDTXT keyword's "(indicator 'text')" params into
 * {indicator, text}, or null if malformed. Indicator numbers are
 * normalized to uppercase (INDTXT documents response/option indicators,
 * which are numeric, but this stays consistent with how conditioning
 * indicators are stored elsewhere in this file).
 */
function parseIndtxt(kw) {
  const m = String(kw.params || "").match(/\(\s*([A-Za-z0-9]+)\s+'((?:[^']|'')*)'/);
  if (!m) return null;
  return { indicator: m[1].toUpperCase(), text: m[2].replace(/''/g, "'") };
}

/**
 * Collects indicator -> description text from every INDTXT keyword in
 * scope for a record, so the indicator-toggle panel can show each
 * indicator's documented meaning next to its checkbox (docs/TASKS.md
 * Batch G, matching the UX I-SDA has for the same DSPF concept). INDTXT is
 * valid at file, record, AND field level (KEYWORD-INVENTORY.md §1/§2/§3),
 * so all three are scanned. When the same indicator is documented at more
 * than one level, the most specific scope wins (field, then record, then
 * file) — same "most specific wins" convention this file already follows
 * for REF/REFFLD (see resolveReferenceTarget).
 */
function collectIndicatorDescriptions(model, record) {
  const result = {};
  const apply = (keywords) => {
    findAllKeywords(keywords, "INDTXT").forEach((kw) => {
      const parsed = parseIndtxt(kw);
      if (parsed) result[parsed.indicator] = parsed.text;
    });
  };
  apply(model.fileLevel.keywords);
  apply(record.keywords);
  record.fields.forEach((f) => apply(f.keywords));
  return result;
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
  // Batch H
  resolveReferenceTarget,
  // Batch F
  VALUELESS_KEYWORDS,
  PSF_ONLY_KEYWORDS,
  validateRecordKeywords,
  validateFileLevelKeywords,
  // Batch G
  FIELD_LEVEL_VALUELESS_KEYWORDS,
  validateFieldKeywords,
  parseIndtxt,
  collectIndicatorDescriptions,
  // Batch B
  validateFontKeywords,
  // Batch B — shared parsing helpers, reused by the webview's font/sizing
  // properties-panel UI so P-field (&NAME) detection and the FONT
  // nested-*POINTSIZE grammar aren't duplicated between engine and UI code.
  paramTokens,
  isFieldRef,
  parseFontKeyword,
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfEngine = mod;
