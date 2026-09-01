"use strict";
/**
 * docs/TASKS.md Batch D — BARCODE real rendering.
 *
 * Batch C (prtfBarcodeParams.js) gave the properties panel every BARCODE
 * parameter; this module is what lets `media/webviewClient.js` turn a
 * subset of those into an actual rendered symbol (real bars, via the
 * vendored JsBarcode — see media/vendor/jsbarcode/README.md) instead of
 * the labeled placeholder box every BARCODE field got before this batch.
 *
 * Scope, per docs/TASKS.md ("scope to the symbologies IBM's DDS BARCODE
 * keyword actually supports; don't over-build"): IBM's DDS reference
 * defines specific bar-code-ID special values (see RENDERABLE below and
 * its sources) split across three tiers here —
 *   1. Renderable now: linear symbologies with a straightforward,
 *      deterministic bar-width encoding that the vendored JsBarcode
 *      already implements — MSI, UPCA, UPCE, UPC2, UPC5, EAN8, EAN13,
 *      EAN2, EAN5, CODEABAR, CODE128, CODE3OF9, INTERL2OF5.
 *   2. Valid DDS bar-code-IDs JsBarcode doesn't implement — INDUST2OF5,
 *      MATRIX2OF5, POSTNET, RM4SCC, AP4SCC, DUTCHKIX, JPBC — and the four
 *      2D symbologies (PDF417, MAXICODE, DATAMATRIX, QRCODE), which need
 *      their own, much more involved encoders (Reed-Solomon error
 *      correction, 2D symbol placement, ...). Implementing any of these
 *      was judged out of scope for "don't over-build"; they keep the
 *      existing labeled placeholder box.
 *   3. Anything not a recognized bar-code-ID at all (typo, a P-field, a
 *      future IBM addition) — also keeps the placeholder box; that's the
 *      existing, already-correct fallback behavior, unchanged by this
 *      batch.
 * `isBarcodeRenderable` is what `renderPage` (webviewClient.js) checks to
 * decide which of these three cases applies.
 *
 * UPC2/UPC5 note: IBM's Table 2 lists these as their own bar-code-IDs
 * (2-digit and 5-digit numeric, field lengths 2 and 5) distinct from
 * EAN2/EAN5, but they're the same "supplemental/add-on" symbol structure
 * historically shared by the UPC and EAN systems — same bar pattern
 * either way. JsBarcode only implements one pair of formats for that
 * shared structure (EAN2/EAN5), so UPC2/UPC5 are mapped onto them here;
 * this is a rendering equivalence, not a claim that UPC2 and EAN2 are the
 * same bar-code-ID (prtfBarcodeParams.js still stores/round-trips
 * whichever the source actually says).
 *
 * Design-time sample data: I-RLU is a static-source design tool with no
 * live compile/run (the same limitation REF/REFFLD already have — there's
 * no runtime field value here to encode), so `sampleBarcodeData` invents a
 * deterministic placeholder value that's valid for the symbology per
 * IBM's Table 2 (data type and field-length rules), long enough to render
 * a real-looking symbol without claiming to represent actual field data.
 * `renderBarcodeOptions` builds the (pure, DOM-free) options object;
 * webviewClient.js is what actually calls `window.JsBarcode` with it,
 * since that call needs a real DOM SVG element this module deliberately
 * doesn't touch, keeping this file plainly unit-testable under
 * `node --test` the same way the rest of the engine is.
 */

const RENDERABLE = {
  MSI: { jsFormat: "MSI", kind: "numeric", length: { min: 1, max: 31 } },
  UPCA: { jsFormat: "UPC", kind: "numeric", length: 11 },
  // JsBarcode's UPCE validator only accepts a plain 6-digit "middle
  // digits" form or an 8-digit form starting with 0/1 (it derives the
  // full UPC-A + check digit itself) — not arbitrary field lengths, so
  // this uses 6 regardless of IBM's documented UPCE field length (10);
  // see the UPC2/UPC5 note above for the same kind of "rendering
  // equivalence, not a field-length claim" caveat.
  UPCE: { jsFormat: "UPCE", kind: "numeric", length: 6 },
  UPC2: { jsFormat: "EAN2", kind: "numeric", length: 2 }, // see UPC2/UPC5 note above
  UPC5: { jsFormat: "EAN5", kind: "numeric", length: 5 },
  EAN8: { jsFormat: "EAN8", kind: "numeric", length: 7 },
  EAN13: { jsFormat: "EAN13", kind: "numeric", length: 12 },
  EAN2: { jsFormat: "EAN2", kind: "numeric", length: 2 },
  EAN5: { jsFormat: "EAN5", kind: "numeric", length: 5 },
  CODEABAR: { jsFormat: "codabar", kind: "codabar", length: { min: 1, max: 50 } },
  CODE128: { jsFormat: "CODE128", kind: "alpha", length: { min: 1, max: 50 } },
  CODE3OF9: { jsFormat: "CODE39", kind: "alpha", length: { min: 1, max: 50 } },
  INTERL2OF5: { jsFormat: "ITF", kind: "numeric", length: { min: 1, max: 31 }, requireEven: true },
};

function entryFor(barCodeId) {
  return RENDERABLE[String(barCodeId || "").toUpperCase()];
}

function isBarcodeRenderable(barCodeId) {
  return Boolean(entryFor(barCodeId));
}

function jsBarcodeFormatFor(barCodeId) {
  const e = entryFor(barCodeId);
  return e ? e.jsFormat : undefined;
}

function clampLength(fieldLength, min, max, requireEven) {
  let len = Number(fieldLength);
  if (!Number.isFinite(len) || len <= 0) len = min;
  len = Math.max(min, Math.min(max, len));
  if (requireEven && len % 2 !== 0) len = len + 1 <= max ? len + 1 : Math.max(min, len - 1);
  return len;
}

/** See module header ("Design-time sample data") for why this exists at all. */
function sampleBarcodeData(barCodeId, fieldLength) {
  const entry = entryFor(barCodeId);
  if (!entry) return "";
  const len = typeof entry.length === "number" ? entry.length : clampLength(fieldLength, entry.length.min, entry.length.max, entry.requireEven);

  if (entry.kind === "numeric") {
    // Repeating 0-9 digits — deterministic, and reads as "sample data" at
    // a glance rather than a plausible-looking real value.
    let s = "";
    for (let i = 0; i < len; i++) s += String(i % 10);
    return s;
  }
  if (entry.kind === "codabar") {
    // IBM's documented CODEABAR field rule: must start AND end with one
    // of A/B/C/D.
    const innerLen = Math.max(0, len - 2);
    let mid = "";
    for (let i = 0; i < innerLen; i++) mid += String(i % 10);
    return "A" + mid + "B";
  }
  // "alpha" (CODE128/CODE3OF9): a short readable sample, repeated/
  // truncated to fill the field length.
  const base = "SAMPLE0123456789";
  let s = "";
  while (s.length < len) s += base;
  return s.slice(0, len);
}

/**
 * Pure options object for `window.JsBarcode(svgEl, data, options)` — see
 * module header for why the actual DOM call lives in webviewClient.js
 * instead of here. `hriPosition` (below/above/none — Batch C) maps onto
 * JsBarcode's displayValue/textPosition; `narrowBarWidth` (inches, Batch
 * C) maps onto JsBarcode's `width` (px per narrow bar) via a 96dpi
 * approximation, same DPI assumption the rest of the engine uses nowhere
 * else numerically but is the standard CSS-pixel/inch conversion.
 */
function renderBarcodeOptions(params, boxHeightPx) {
  const showText = params.hriPosition !== "none";
  const textHeightPx = showText ? 14 : 0;
  return {
    format: jsBarcodeFormatFor(params.barCodeId),
    displayValue: showText,
    textPosition: params.hriPosition === "above" ? "top" : "bottom",
    margin: 0,
    width: params.narrowBarWidth ? Math.max(1, Math.round(params.narrowBarWidth * 96)) : 2,
    height: Math.max(10, boxHeightPx - textHeightPx),
    fontSize: 10,
  };
}

const mod = {
  RENDERABLE,
  isBarcodeRenderable,
  jsBarcodeFormatFor,
  sampleBarcodeData,
  renderBarcodeOptions,
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfBarcodeRender = mod;
