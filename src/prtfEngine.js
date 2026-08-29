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
 * line/position are omitted, indicator conditioning, and geometry for the
 * `LINE` and `BOX` keywords (record-level, AFPDS-only, specified in
 * physical units and converted here to the same character grid fields use
 * via CPI/LPI — see resolveCpiLpi below). AFPDS font-accurate character
 * widths are applied when a non-default FONT keyword is present and
 * afpFontMetrics has a table for it; otherwise layout assumes a monospace
 * cell grid (accurate for SCS, an approximation for AFPDS pending real font
 * resource data — see docs/REQUIREMENTS.md §9).
 */

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
 * Resolves CPI (characters per inch) and LPI (lines per inch) for a
 * record, used to convert LINE/BOX geometry — specified in physical units
 * (inches, per the printer file's UOM, assumed *INCH here since UOM isn't
 * modeled yet) — into the same character-grid coordinates fields use.
 * Defaults (10 CPI, 6 LPI) match traditional SCS/line-printer defaults;
 * real AFPDS jobs may differ per font, so this is a rendering
 * approximation, not a production measurement.
 */
function resolveCpiLpi(record, fileLevel) {
  const cpiKw = findKeyword(record.keywords, "CPI") || findKeyword(fileLevel.keywords, "CPI");
  const lpiKw = findKeyword(record.keywords, "LPI") || findKeyword(fileLevel.keywords, "LPI");
  return { cpi: numericParam(cpiKw, 10), lpi: numericParam(lpiKw, 6) };
}

/**
 * LINE(position-down position-across line-length line-direction line-width
 *      [line-pad] [color])
 * e.g. LINE(4 3 5 *HRZ .01) — verified against IBM's DDS reference for
 * printer files. Record-level keyword, AFPDS-only (requires
 * DEVTYPE(*AFPDS) on the CRTPRTF command — this tool doesn't check that,
 * it just renders what's coded).
 */
function parseLineGeometry(kw, cpi, lpi) {
  const t = paramTokens(kw);
  const approximate = t.slice(0, 3).some(isFieldRef);
  const posDown = toNumber(t[0], 0);
  const posAcross = toNumber(t[1], 0);
  const length = toNumber(t[2], 1);
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
function parseBoxGeometry(kw, cpi, lpi) {
  const t = paramTokens(kw);
  const approximate = t.slice(0, 4).some(isFieldRef);
  const d1 = toNumber(t[0], 0);
  const a1 = toNumber(t[1], 0);
  const d2 = toNumber(t[2], 1);
  const a2 = toNumber(t[3], 1);
  return {
    type: "box",
    row1: Math.round(d1 * lpi) + 1,
    col1: Math.round(a1 * cpi) + 1,
    row2: Math.round(d2 * lpi) + 1,
    col2: Math.round(a2 * cpi) + 1,
    approximate,
  };
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

function resolveLayout(model, recordName, indicatorState) {
  indicatorState = indicatorState || {};
  const record = model.records.find((r) => r.name === recordName) || model.records[0];
  if (!record) return null;

  const { lines: pageLines, cols: pageCols } = resolvePageSize(record, model.fileLevel);
  const { cpi, lpi } = resolveCpiLpi(record, model.fileLevel);

  const draws = [
    ...findAllKeywords(record.keywords, "LINE").map((kw) => parseLineGeometry(kw, cpi, lpi)),
    ...findAllKeywords(record.keywords, "BOX").map((kw) => parseBoxGeometry(kw, cpi, lpi)),
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

const mod = { resolveLayout, listRecordNames, collectIndicators, findKeyword, findAllKeywords, numericParam };
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfEngine = mod;
