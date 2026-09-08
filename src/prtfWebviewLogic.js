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

/**
 * Batch OO (docs/TASKS.md) — parses an existing LINE keyword's raw params
 * into per-param strings for populating the properties-panel edit form.
 * Per IBM's DDS reference (see prtfLayout.js's parseLineGeometry, which
 * this mirrors): LINE(position-down position-across line-length
 * line-direction [line-width] [line-pad] [color]) — the first four are
 * mandatory, the last three optional and trailing. Uses groupTokens (not a
 * bare whitespace split) for the same reason parseFontSpecKeyword above
 * does — consistent tokenizing even though LINE/BOX params don't
 * themselves contain quoted spans today, so a future param addition that
 * did wouldn't silently regress this. Returns empty strings (not undefined)
 * for missing pieces, so callers can feed the result straight into an
 * <input value="..."> without a defensiveness check at every call site.
 */
function parseLineParams(kw) {
  const inner = kw ? String(kw.params || "").replace(/^\(/, "").replace(/\)$/, "").trim() : "";
  const t = inner === "" ? [] : groupTokens(inner);
  return {
    down: t[0] || "",
    across: t[1] || "",
    length: t[2] || "",
    direction: (t[3] || "*HRZ").toUpperCase(),
    width: t[4] || "",
    pad: t[5] || "",
    color: t[6] || "",
  };
}

/** Batch OO — same as parseLineParams, for BOX(first-corner-down first-corner-across diagonal-corner-down diagonal-corner-across [line-width] [color] [shading]). */
function parseBoxParams(kw) {
  const inner = kw ? String(kw.params || "").replace(/^\(/, "").replace(/\)$/, "").trim() : "";
  const t = inner === "" ? [] : groupTokens(inner);
  return {
    down1: t[0] || "",
    across1: t[1] || "",
    down2: t[2] || "",
    across2: t[3] || "",
    width: t[4] || "",
    color: t[5] || "",
    shading: t[6] || "",
  };
}

/**
 * Batch OO — shared "required positional params, then trailing optional
 * ones" builder for LINE/BOX: once a later optional param is supplied, any
 * skipped earlier optional param is filled from `defaults` rather than
 * left as a blank positional slot (DDS has no named-parameter syntax —
 * `LINE(1 1 2 *HRZ  *RED)` with an empty width slot isn't valid source).
 * Trailing optional params that were never reached (nothing after them was
 * filled in either) are dropped entirely instead of defaulted, so leaving
 * every optional field blank reproduces the exact "just the mandatory
 * params" form IBM's own DDS examples show for the common case.
 */
function buildTrailingOptionalParams(requiredParts, optionalParts, defaults) {
  let lastIdx = -1;
  optionalParts.forEach((v, i) => {
    if (v !== undefined && v !== null && String(v).trim() !== "") lastIdx = i;
  });
  const kept = optionalParts.slice(0, lastIdx + 1).map((v, i) => {
    const val = (v || "").toString().trim();
    return val === "" ? defaults[i] : val;
  });
  return requiredParts.concat(kept).join(" ");
}

/**
 * Batch OO — builds a LINE keyword's "(...)" params text from the
 * properties-panel form's values. Returns null (meaning: don't write this
 * keyword) if any of the three mandatory numeric params is blank — mirrors
 * every other builder in this file's "blank mandatory input means don't
 * write the keyword at all" convention (see buildFontSpecParamsFromValues).
 * `direction` defaults to *HRZ (IBM's own DDS default) rather than being
 * treated as mandatory, since the form always shows a dropdown pre-set to
 * one of the two valid values and can never itself be blank.
 */
function buildLineParams(v) {
  if (!v) return null;
  const down = (v.down || "").toString().trim();
  const across = (v.across || "").toString().trim();
  const length = (v.length || "").toString().trim();
  if (!down || !across || !length) return null;
  const direction = (v.direction || "*HRZ").toUpperCase();
  const inner = buildTrailingOptionalParams([down, across, length, direction], [v.width, v.pad, v.color], ["0.01", "0", "*BLK"]);
  return "(" + inner + ")";
}

/** Batch OO — BOX counterpart of buildLineParams; all four corner params are mandatory (no direction to default). */
function buildBoxParams(v) {
  if (!v) return null;
  const down1 = (v.down1 || "").toString().trim();
  const across1 = (v.across1 || "").toString().trim();
  const down2 = (v.down2 || "").toString().trim();
  const across2 = (v.across2 || "").toString().trim();
  if (!down1 || !across1 || !down2 || !across2) return null;
  const inner = buildTrailingOptionalParams([down1, across1, down2, across2], [v.width, v.color, v.shading], ["0.01", "*BLK", "*NONE"]);
  return "(" + inner + ")";
}

/**
 * Batch OO — converts a 1-based DDS line/position grid cell (the same grid
 * pixelToLineCol above resolves a drag/drop point to) into the physical
 * down/across measurement LINE/BOX params are coded in, given the record's
 * current CPI/LPI and unit of measure. Exact inverse of prtfLayout.js's
 * parseLineGeometry/parseBoxGeometry forward math (row = round(posDown *
 * lpi) + 1 -> posDown = (row - 1) / lpi, then inches-to-uom). Rounded to 2
 * decimal places — matches the precision real DDS source for this keyword
 * is typically hand-authored to (e.g. "1.5 2.25"), and avoids float noise
 * (0.1 + 0.2-style) leaking into what gets written back to source on every
 * drag.
 */
function rowColToPhysical(row, col, cpi, lpi, uom) {
  const downInches = (row - 1) / lpi;
  const acrossInches = (col - 1) / cpi;
  return { down: roundPhysical(toUom(downInches, uom)), across: roundPhysical(toUom(acrossInches, uom)) };
}

/**
 * Batch OO — converts a grid-cell DELTA (rows/cols moved, not an absolute
 * position) into a physical down/across delta in the same unit. Used for
 * BOX's drag-to-move, which needs to shift BOTH corners by the same amount
 * to preserve the box's size rather than resolving each corner
 * independently through rowColToPhysical (which would round each corner's
 * absolute position separately and could very slightly distort the box's
 * width/height on repeated drags).
 */
function deltaPhysicalFromGridDelta(deltaRow, deltaCol, cpi, lpi, uom) {
  return {
    deltaDown: roundPhysical(toUom(deltaRow / lpi, uom)),
    deltaAcross: roundPhysical(toUom(deltaCol / cpi, uom)),
  };
}

function toUom(inches, uom) {
  return uom === "cm" ? inches * 2.54 : inches;
}

function toInchesLocal(value, uom) {
  return uom === "cm" ? value / 2.54 : value;
}

function roundPhysical(n) {
  return Math.round(n * 100) / 100;
}

/** Batch OO — exact inverse of rowColToPhysical, for resize math that needs a shape's already-coded anchor point back in grid terms. */
function physicalToGrid(down, across, cpi, lpi, uom) {
  const downInches = toInchesLocal(down, uom);
  const acrossInches = toInchesLocal(across, uom);
  return { row: Math.round(downInches * lpi) + 1, col: Math.round(acrossInches * cpi) + 1 };
}

/**
 * Batch OO — updated LINE params after a drag-to-move drop: the drop
 * point becomes the new position-down/across outright (same "set the
 * exact new anchor, not a delta from wherever within the shape was
 * grabbed" convention fields' own "move" edit already uses); length,
 * direction, and every optional param carry over unchanged.
 */
function movedLineParams(existingKw, dropLine, dropPosition, cpi, lpi, uom) {
  const parsed = parseLineParams(existingKw);
  const { down, across } = rowColToPhysical(dropLine, dropPosition, cpi, lpi, uom);
  return buildLineParams(Object.assign({}, parsed, { down: String(down), across: String(across) }));
}

/**
 * Batch OO — BOX counterpart of movedLineParams. Shifts BOTH corners by
 * the same physical delta (derived from the grid delta between the box's
 * CURRENT first corner — `oldRow1`/`oldCol1`, as already resolved by
 * prtfLayout.js's resolveDrawsWithKeywordIndex — and the drop point),
 * preserving the box's width/height, rather than resolving each corner
 * independently through rowColToPhysical (see deltaPhysicalFromGridDelta's
 * own header for why that would very slightly distort the box's size on
 * repeated drags).
 */
function movedBoxParams(existingKw, dropLine, dropPosition, oldRow1, oldCol1, cpi, lpi, uom) {
  const parsed = parseBoxParams(existingKw);
  const { deltaDown, deltaAcross } = deltaPhysicalFromGridDelta(dropLine - oldRow1, dropPosition - oldCol1, cpi, lpi, uom);
  const down1 = roundPhysical(parseFloat(parsed.down1 || "0") + deltaDown);
  const across1 = roundPhysical(parseFloat(parsed.across1 || "0") + deltaAcross);
  const down2 = roundPhysical(parseFloat(parsed.down2 || "0") + deltaDown);
  const across2 = roundPhysical(parseFloat(parsed.across2 || "0") + deltaAcross);
  return buildBoxParams(
    Object.assign({}, parsed, { down1: String(down1), across1: String(across1), down2: String(down2), across2: String(across2) })
  );
}

/**
 * Batch OO — resizes a LINE by dragging its far end: position-down/across
 * and direction stay fixed at the line's own anchor point, and `length` is
 * recomputed as the grid distance from that anchor to the new drop point,
 * projected along the line's own axis (horizontal lines only care about
 * the column delta, vertical only the row delta — dragging a horizontal
 * line's handle up/down has no effect on its length, matching how an
 * actual resize handle on an axis-aligned shape behaves). Clamped to a
 * minimum of one grid cell so dragging the handle back onto or past the
 * anchor can't produce a zero or negative length.
 */
function resizedLineParams(existingKw, dropLine, dropPosition, cpi, lpi, uom) {
  const parsed = parseLineParams(existingKw);
  const direction = (parsed.direction || "*HRZ").toUpperCase();
  const anchor = physicalToGrid(parseFloat(parsed.down || "0"), parseFloat(parsed.across || "0"), cpi, lpi, uom);
  const lengthInches = direction === "*VRT" ? Math.max(1, dropLine - anchor.row) / lpi : Math.max(1, dropPosition - anchor.col) / cpi;
  const length = Math.max(0.01, roundPhysical(toUom(lengthInches, uom)));
  return buildLineParams(Object.assign({}, parsed, { length: String(length) }));
}

/**
 * Batch OO — resizes a BOX by dragging its second (diagonal) corner:
 * moves diagonal-corner-down/across straight to the drop point (converted
 * to physical units), same "set the exact new value, not a delta" shape
 * as movedLineParams; the first corner and every optional param are left
 * untouched.
 */
function resizedBoxParams(existingKw, dropLine, dropPosition, cpi, lpi, uom) {
  const parsed = parseBoxParams(existingKw);
  const { down, across } = rowColToPhysical(dropLine, dropPosition, cpi, lpi, uom);
  return buildBoxParams(Object.assign({}, parsed, { down2: String(down), across2: String(across) }));
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
  parseLineParams,
  parseBoxParams,
  buildLineParams,
  buildBoxParams,
  rowColToPhysical,
  deltaPhysicalFromGridDelta,
  physicalToGrid,
  movedLineParams,
  movedBoxParams,
  resizedLineParams,
  resizedBoxParams,
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfWebviewLogic = mod;
