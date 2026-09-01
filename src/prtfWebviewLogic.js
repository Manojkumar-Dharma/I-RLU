"use strict";
/**
 * Pure, DOM-free logic extracted out of media/webviewClient.js (review
 * comment #6, docs/TASKS.md — webviewClient.js had zero test coverage).
 * webviewClient.js is almost entirely DOM manipulation (building elements,
 * wiring event handlers, posting messages to the extension host), which
 * isn't practical to unit test without a full jsdom-style harness. But a
 * handful of functions inside it do real, DOM-independent work — parsing
 * and serializing keyword parameter text, and turning a pixel offset into
 * a line/column — and those were only reachable as closures private to
 * webviewClient.js's top-level IIFE, so they couldn't be required and
 * tested on their own.
 *
 * This module pulls those out, following the same "extract the pure part,
 * leave a thin wrapper behind" pattern already used for extension.ts's
 * applyEdit -> prtfEdits.ts. webviewClient.js now calls these via the
 * window.PrtfWebviewLogic global (same inlining mechanism prtfEngine.js
 * and friends already use — see buildWebviewTemplate.js) instead of
 * defining them itself.
 */

// eslint-disable-next-line no-undef
const { isFieldRef } = typeof module !== "undefined" && module.exports ? require("./prtfKeywordHelpers.js") : window.PrtfKeywordHelpers;

/**
 * Serializes a properties-panel input value into a keyword's "(...)" params
 * text, per the Batch A "kind" convention (see docs/KEYWORD-INVENTORY.md
 * §3 and appendKeywordRows in webviewClient.js):
 *  - "flag": valueless keyword — never carries params text at all.
 *  - "quotedText": always DDS-quotes the value, e.g. EDTWRD/DFT.
 *  - "quotedSelect": quotes everything EXCEPT a "*"-prefixed special value
 *    (e.g. DATSEP('-') vs. DATSEP(*JOB) — IBM's DDS reference documents
 *    *JOB as a bare special value distinct from a literal separator char).
 *  - anything else ("select"/"text"/unspecified): plain "(value)".
 * Returns "" (meaning: omit the keyword entirely) for a blank/whitespace
 * value, since every one of these kinds treats "nothing entered" as "don't
 * write this keyword" rather than an empty-parens keyword.
 */
function paramsToText(kind, value) {
  if (kind === "flag") return "";
  const v = (value || "").trim();
  if (!v) return "";
  if (kind === "quotedText") return "('" + v.replace(/'/g, "''") + "')";
  if (kind === "quotedSelect") return v.startsWith("*") ? "(" + v + ")" : "('" + v.replace(/'/g, "''") + "')";
  return "(" + v + ")";
}

/**
 * Strips the surrounding parentheses (and, for the Batch A quoted kinds,
 * the DDS quote pair) from a Keyword's raw params (e.g. "(*YES)" ->
 * "*YES"), for populating an edit input from the current model. `kind`
 * defaults to plain/unquoted for call sites that predate the quoted kinds.
 * Inverse of paramsToText for every kind it supports.
 */
function paramsInnerText(kw, kind) {
  if (!kw) return "";
  let inner = String(kw.params || "").replace(/^\(/, "").replace(/\)$/, "").trim();
  if ((kind === "quotedText" || kind === "quotedSelect") && inner.length >= 2 && inner[0] === "'" && inner[inner.length - 1] === "'") {
    inner = inner.slice(1, -1).replace(/''/g, "'");
  }
  return inner;
}

/**
 * Classifies one already-split parameter token as a plain literal or a
 * program-to-system field reference (&NAME), for the Batch B P-field
 * toggle component (docs/TASKS.md) shared across FONT/CDEFNT/FNTCHRSET/
 * FONTNAME/CHRID. Mirrors PrtfEngine.isFieldRef's own &-prefix rule.
 */
function tokenToPField(tok) {
  if (!tok) return { isPField: false, value: "" };
  if (isFieldRef(tok)) return { isPField: true, value: tok.slice(1) };
  return { isPField: false, value: tok };
}

/**
 * Parses an existing FONT/CDEFNT/FNTCHRSET/FONTNAME/CHRID keyword's raw
 * params into per-param values plus an optional trailing
 * "(*POINTSIZE height [width])" block, per spec.params' order. IBM's DDS
 * reference places *POINTSIZE last, after all name/library params, for
 * every keyword that supports it — this assumes that documented order
 * rather than trying to parse an arbitrary interleaving.
 */
function parseFontSpecKeyword(spec, existingKw) {
  const raw = existingKw ? String(existingKw.params || "").replace(/^\(/, "").replace(/\)$/, "").trim() : "";
  let plainPart = raw;
  let height = null;
  let width = null;
  if (spec.pointSize) {
    const m = raw.match(/\(\s*\*POINTSIZE\s+(\S+?)(?:\s+(\S+?))?\s*\)\s*$/i);
    if (m) {
      height = m[1];
      width = m[2] || null;
      plainPart = raw.slice(0, m.index).trim();
    }
  }
  const tokens = plainPart === "" ? [] : plainPart.split(/\s+/);
  const values = spec.params.map((_p, i) => tokenToPField(tokens[i]));
  return { values, height: tokenToPField(height), width: tokenToPField(width) };
}

/**
 * Builds a keyword's params text ("(...)") from a plain array of param
 * value strings (already read out of whatever input widgets the caller
 * used — webviewClient.js's renderFontSizingPanel reads each P-field row
 * via its own .getValue() before calling this) plus an optional point-size
 * height/width pair. Returns null if the mandatory first param is empty
 * (meaning: don't write this keyword).
 */
function buildFontSpecParamsFromValues(spec, values, height, width) {
  const vals = values.slice();
  if (!vals[0]) return null;
  // Trim trailing empty *optional* params so e.g. an omitted library
  // doesn't leave a stray blank positional slot.
  while (vals.length > 1 && !vals[vals.length - 1] && spec.params[vals.length - 1] && spec.params[vals.length - 1].optional) {
    vals.pop();
  }
  let inner = vals.join(" ").replace(/\s+$/, "");
  if (spec.pointSize && height) {
    inner += (inner ? " " : "") + "(*POINTSIZE " + height + (width ? " " + width : "") + ")";
  }
  return "(" + inner + ")";
}

/**
 * Converts a pixel offset within the page-grid container (already computed
 * by the caller from a mouse event's clientX/clientY minus the container's
 * bounding rect — see webviewClient.js's lineColFromEvent) into a 1-based
 * DDS line/position pair, given the record's current per-character cell
 * size (from layout.grid — see resolveLayout in prtfLayout.js). Clamped to
 * a minimum of 1 in each dimension, since a click slightly above/left of
 * the container's origin (e.g. rounding at the very top-left cell) should
 * never resolve to line/position 0 or negative.
 */
function pixelToLineCol(x, y, cellWidthPx, cellHeightPx) {
  return {
    position: Math.max(1, Math.round(x / cellWidthPx) + 1),
    line: Math.max(1, Math.round(y / cellHeightPx) + 1),
  };
}

const mod = {
  paramsToText,
  paramsInnerText,
  tokenToPField,
  parseFontSpecKeyword,
  buildFontSpecParamsFromValues,
  pixelToLineCol,
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfWebviewLogic = mod;
