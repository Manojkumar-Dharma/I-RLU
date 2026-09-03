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
// eslint-disable-next-line no-undef
// Batch L (continued) — groupTokens is needed here now that
// parseFontSpecKeyword/buildFontSpecParamsFromValues handle FONTNAME's
// quoted name param (see both functions' updated comments below); reused
// from prtfBarcodeParams.js rather than reimplemented, same as
// prtfPageGroupKeywords.js already does for the identical quote/paren-
// aware tokenizing need.
const { groupTokens } = typeof module !== "undefined" && module.exports ? require("./prtfBarcodeParams.js") : window.PrtfBarcodeParams;

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
 *
 * `quoted` (Batch L continued): FONTNAME's name param is DDS-quoted
 * (IBM's own example: FONTNAME('Courier New' ...)) — unlike CDEFNT/
 * FNTCHRSET's params, which are bare object/character-set names. When
 * `quoted` is true and the token isn't a P-field reference, this strips
 * the surrounding DDS quote pair and un-escapes doubled '' quotes, so the
 * P-field row's literal input shows the clean name text, not the raw
 * quoted source token.
 */
function tokenToPField(tok, quoted) {
  if (!tok) return { isPField: false, value: "" };
  if (isFieldRef(tok)) return { isPField: true, value: tok.slice(1) };
  if (quoted && tok.length >= 2 && tok[0] === "'" && tok[tok.length - 1] === "'") {
    return { isPField: false, value: tok.slice(1, -1).replace(/''/g, "'") };
  }
  return { isPField: false, value: tok };
}

/**
 * Parses an existing FONT/CDEFNT/FNTCHRSET/FONTNAME/CHRID keyword's raw
 * params into per-param values plus an optional trailing
 * "(*POINTSIZE height [width])" block, per spec.params' order. IBM's DDS
 * reference places *POINTSIZE last, after all name/library params, for
 * every keyword that supports it — this assumes that documented order
 * rather than trying to parse an arbitrary interleaving.
 *
 * Uses groupTokens (Batch L continued — previously a plain
 * `.split(/\s+/)`) rather than a bare whitespace split, because FONTNAME's
 * quoted name param can itself contain internal spaces (e.g. 'Courier
 * New', 'Times New Roman') that a naive split would incorrectly tear into
 * two tokens — this was a genuine pre-existing bug: FONTNAME('Courier
 * New') parsed to a mangled "'Courier" (losing "New" entirely), found
 * while adding real FONTNAME resolution (see afpCodedFontMetrics.js) and
 * fixed here since resolution downstream depends on getting the name
 * right. groupTokens keeps a whole quoted span together the same way it
 * already does for BARCODE's own quoted/parenthesized parameters.
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
  const tokens = plainPart === "" ? [] : groupTokens(plainPart);
  const values = spec.params.map((p, i) => tokenToPField(tokens[i], p.quoted));
  return { values, height: tokenToPField(height), width: tokenToPField(width) };
}

/**
 * Builds a keyword's params text ("(...)") from a plain array of param
 * value strings (already read out of whatever input widgets the caller
 * used — webviewClient.js's renderFontSizingPanel reads each P-field row
 * via its own .getValue() before calling this) plus an optional point-size
 * height/width pair. Returns null if the mandatory first param is empty
 * (meaning: don't write this keyword).
 *
 * Inverse of parseFontSpecKeyword's quoting handling above: a value whose
 * spec param is `quoted` gets DDS-quoted here (embedded '  doubled) UNLESS
 * it's a P-field reference (starts with "&", per pFieldRow.getValue()'s
 * own convention — a P-field is never quoted, same rule
 * PrtfKeywordHelpers.isFieldRef uses everywhere else in this codebase).
 */
function buildFontSpecParamsFromValues(spec, values, height, width) {
  const vals = values.slice();
  if (!vals[0]) return null;
  // Trim trailing empty *optional* params so e.g. an omitted library
  // doesn't leave a stray blank positional slot.
  while (vals.length > 1 && !vals[vals.length - 1] && spec.params[vals.length - 1] && spec.params[vals.length - 1].optional) {
    vals.pop();
  }
  const rendered = vals.map((v, i) => {
    const isPField = typeof v === "string" && v.startsWith("&");
    if (spec.params[i] && spec.params[i].quoted && v && !isPField) {
      return "'" + String(v).replace(/'/g, "''") + "'";
    }
    return v;
  });
  let inner = rendered.join(" ").replace(/\s+$/, "");
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

/**
 * Batch Q (docs/TASKS.md) — suggests a non-colliding field name for a
 * same-record copy: DDS requires unique field names within a record, so
 * the copy can't default to the exact source name. Appends the lowest
 * available numeric suffix (2, 3, 4, ...), truncating the base name as
 * needed so the result still fits DDS's 10-character name limit — e.g.
 * copying a field literally named "CUSTNAME9" (9 chars, no room to just
 * append "2") produces "CUSTNAME2", not an 11-char name. Pulled out here
 * (rather than left inline in webviewClient.js) so it's unit-testable —
 * same "pure logic extension.ts/webviewClient.js call into" split this
 * file already uses for everything else in it. The person can still
 * freely edit the suggestion in the pending-new form before saving; this
 * only has to avoid a silent same-name collision, not read the person's
 * mind about what they actually want to call it.
 */
function suggestCopyName(sourceName, existingNames) {
  const base = String(sourceName || "FIELD").toUpperCase();
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const candidate = (base.slice(0, Math.max(0, 10 - suffix.length)) + suffix).toUpperCase();
    if (!existingNames.has(candidate)) return candidate;
  }
  return base.slice(0, 10); // exhausted 2-999 — vanishingly unlikely, but don't throw
}

/**
 * Batch Q — builds the pre-filled `pendingNew` shape for a copy, once the
 * person has clicked where to place it. `source` and `existingFieldNames`
 * are plain data (a layout cell, and a Set of field names already in the
 * current record) — no DOM, no vscode — so this stays testable the same
 * way the rest of this file is. Keywords come along via `sourceKeywords`
 * (name/params pairs only — prtfEdits.ts rebuilds `raw`/`sourceLineIndex`
 * for the new entry, same as every other keyword-adding edit kind already
 * does). Scoped to the CURRENT record only (the caller passes
 * `existingFieldNames` already filtered to it) — matches this batch's own
 * "same-record copy only for v1" scope; cross-record copy is a follow-up,
 * not supported here. Does NOT mutate `source` in any way — every value
 * read from it is copied into a fresh plain object, so the source entry
 * this was copied from is left completely untouched regardless of what
 * happens to the pending-new form afterward.
 */
function buildCopyPendingNew(kind, line, position, source, existingFieldNames) {
  const sourceKeywords = (source.keywords || []).map((k) => ({ name: k.name, params: k.params }));
  if (kind === "field") {
    return {
      kind,
      line,
      position,
      name: suggestCopyName(source.name, existingFieldNames),
      length: source.length,
      dataType: source.dataType,
      decimalPositions: source.decimalPositions,
      usage: source.usage,
      sourceKeywords,
    };
  }
  return { kind, line, position, literal: source.literal || "", sourceKeywords };
}

const mod = {
  paramsToText,
  paramsInnerText,
  tokenToPField,
  parseFontSpecKeyword,
  buildFontSpecParamsFromValues,
  pixelToLineCol,
  suggestCopyName,
  buildCopyPendingNew,
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfWebviewLogic = mod;
