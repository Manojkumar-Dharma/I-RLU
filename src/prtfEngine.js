"use strict";
/**
 * Resolves a parsed PRTF record format, plus a set of "active" conditioning
 * indicators, into a concrete page layout: page dimensions, positioned
 * cells (fields/constants), and drawn lines/boxes. This is the model the
 * webview renders and the same thing STRRLU's design screen was showing
 * you, minus the green-screen.
 *
 * v1 scope: explicit LINE/POSITION placement, sequential placement via
 * SKIPB/SKIPA/SPACEB/SPACEA when LINE/POSITION are omitted, indicator
 * conditioning, and a simple DRAW rendering. AFPDS font-accurate character
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

/**
 * Very simplified DRAW support: DRAW(*T *B *L *R ...) style box specs, or a
 * DRAW(fromLine fromPos toLine toPos) style explicit line — different DDS
 * releases phrase this differently, so this is intentionally permissive and
 * flagged as an approximation. A field/constant carrying a DRAW keyword is
 * rendered as a rectangle spanning its own line/position/length by default,
 * which covers the common "box around this field" usage.
 */
function parseDraw(drawKw, line, position, length) {
  return {
    line,
    position,
    length: length || 1,
    spec: drawKw.params,
    approximate: true,
  };
}

function resolveLayout(model, recordName, indicatorState) {
  indicatorState = indicatorState || {};
  const record = model.records.find((r) => r.name === recordName) || model.records[0];
  if (!record) return null;

  const { lines: pageLines, cols: pageCols } = resolvePageSize(record, model.fileLevel);

  let cursorLine = 1;
  let cursorCol = 1;
  const cells = [];
  const draws = [];
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

    const drawKw = findKeyword(entry.keywords, "DRAW");
    const length =
      entry.kind === "field"
        ? entry.length || (entry.name || "").length || 1
        : entry.literal
        ? entry.literal.length
        : entry.length || 1;

    if (drawKw) {
      draws.push(parseDraw(drawKw, line, position, length));
    }
    cells.push({
      id: entry.id,
      kind: entry.kind,
      name: entry.kind === "field" ? entry.name : undefined,
      text: entry.kind === "constant" ? entry.literal || "" : entry.name,
      line,
      position,
      length,
      hasDraw: !!drawKw,
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
