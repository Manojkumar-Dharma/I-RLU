// Tests for docs/TASKS.md Batch D — BARCODE real rendering
// (src/prtfBarcodeRender.js). Two layers:
//  1. Pure logic (no DOM) — the RENDERABLE symbology table, design-time
//     sample-data generation, and the options object built for
//     window.JsBarcode.
//  2. A real jsdom-backed integration check that the actual vendored
//     JsBarcode (media/vendor/jsbarcode/JsBarcode.all.min.js) successfully
//     renders every RENDERABLE symbology using this module's own sample
//     data — catching a real bug this test suite found during development
//     (UPCE initially used the field's full 10-digit length per IBM's
//     table, but JsBarcode's UPCE only accepts a plain 6- or 8-digit
//     "middle digits" form and silently reported invalid otherwise).
//
// displayValue is forced to false in the jsdom tests specifically: with
// displayValue true, JsBarcode measures the human-readable text via
// `document.createElement("canvas").getContext("2d")`, which needs the
// native `canvas` npm package (system Cairo/Pango bindings) that jsdom
// doesn't ship and this project doesn't otherwise depend on — a
// test-environment-only gap. Real VS Code webviews are a full browser
// with working canvas 2D contexts, so displayValue works there
// regardless; this is purely about what's practical to assert under
// `node --test` without adding a native-compiled dependency for one test
// file. The pure-logic test below still confirms displayValue/
// textPosition are derived correctly from hriPosition.
import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require("jsdom");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  RENDERABLE,
  isBarcodeRenderable,
  jsBarcodeFormatFor,
  sampleBarcodeData,
  renderBarcodeOptions,
} = require("../src/prtfBarcodeRender.js");

test("isBarcodeRenderable: true for every DDS bar-code-ID JsBarcode implements, false otherwise", () => {
  ["MSI", "UPCA", "UPCE", "UPC2", "UPC5", "EAN8", "EAN13", "EAN2", "EAN5", "CODEABAR", "CODE128", "CODE3OF9", "INTERL2OF5"].forEach((id) => {
    assert.equal(isBarcodeRenderable(id), true, id);
    assert.equal(isBarcodeRenderable(id.toLowerCase()), true, id + " (lowercase)"); // barCodeId is compared case-insensitively
  });
  // Valid DDS bar-code-IDs JsBarcode doesn't implement (2D symbologies and
  // the linear ones it doesn't cover) — placeholder box, not an error.
  ["INDUST2OF5", "MATRIX2OF5", "POSTNET", "RM4SCC", "AP4SCC", "DUTCHKIX", "JPBC", "PDF417", "MAXICODE", "DATAMATRIX", "QRCODE"].forEach((id) => {
    assert.equal(isBarcodeRenderable(id), false, id);
  });
  assert.equal(isBarcodeRenderable("NOTAREALSYMBOLOGY"), false);
  assert.equal(isBarcodeRenderable(undefined), false);
});

test("jsBarcodeFormatFor: maps every renderable bar-code-ID to a JsBarcode format string", () => {
  Object.keys(RENDERABLE).forEach((id) => {
    assert.equal(typeof jsBarcodeFormatFor(id), "string");
  });
  assert.equal(jsBarcodeFormatFor("QRCODE"), undefined);
});

test("sampleBarcodeData: numeric symbologies produce the documented field length, digits only", () => {
  assert.equal(sampleBarcodeData("UPCA", 999 /* fixed-length symbology ignores fieldLength */).length, 11);
  assert.equal(sampleBarcodeData("EAN13", 999).length, 12);
  assert.match(sampleBarcodeData("MSI", 12), /^[0-9]+$/);
  assert.equal(sampleBarcodeData("MSI", 12).length, 12);
  assert.equal(sampleBarcodeData("MSI", 0).length, 1); // clamped to the documented minimum
  assert.equal(sampleBarcodeData("MSI", 999).length, 31); // clamped to the documented maximum
});

test("sampleBarcodeData: INTERL2OF5 (Interleaved 2 of 5) is always an even length", () => {
  [1, 2, 5, 6, 31].forEach((fieldLength) => {
    const len = sampleBarcodeData("INTERL2OF5", fieldLength).length;
    assert.equal(len % 2, 0, `fieldLength ${fieldLength} -> sample length ${len}`);
  });
});

test("sampleBarcodeData: CODEABAR sample starts and ends with a letter (IBM's documented field rule)", () => {
  const data = sampleBarcodeData("CODEABAR", 11);
  assert.match(data[0], /[A-D]/);
  assert.match(data[data.length - 1], /[A-D]/);
  assert.equal(data.length, 11);
});

test("sampleBarcodeData: unrenderable bar-code-ID returns an empty string, not a guess", () => {
  assert.equal(sampleBarcodeData("QRCODE", 20), "");
});

test("renderBarcodeOptions: hriPosition maps to displayValue/textPosition correctly", () => {
  const base = { barCodeId: "CODE128", narrowBarWidth: undefined };
  assert.equal(renderBarcodeOptions({ ...base, hriPosition: "below" }, 40).displayValue, true);
  assert.equal(renderBarcodeOptions({ ...base, hriPosition: "below" }, 40).textPosition, "bottom");
  assert.equal(renderBarcodeOptions({ ...base, hriPosition: "above" }, 40).textPosition, "top");
  assert.equal(renderBarcodeOptions({ ...base, hriPosition: "none" }, 40).displayValue, false);
});

test("renderBarcodeOptions: narrowBarWidth (inches, Batch C) converts to a JsBarcode width in px", () => {
  const withWidth = renderBarcodeOptions({ barCodeId: "CODE128", hriPosition: "none", narrowBarWidth: 0.02 }, 40);
  assert.equal(withWidth.width, Math.round(0.02 * 96));
  const withoutWidth = renderBarcodeOptions({ barCodeId: "CODE128", hriPosition: "none", narrowBarWidth: undefined }, 40);
  assert.equal(withoutWidth.width, 2); // documented default
});

test("integration (jsdom): the vendored JsBarcode actually renders every RENDERABLE symbology using this module's own sample data", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const { window } = dom;
  const vendoredSrc = fs.readFileSync(path.join(__dirname, "..", "..", "media", "vendor", "jsbarcode", "JsBarcode.all.min.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function("window", "document", vendoredSrc)(window, window.document);
  assert.equal(typeof window.JsBarcode, "function", "vendored JsBarcode.all.min.js didn't set window.JsBarcode");

  Object.keys(RENDERABLE).forEach((barCodeId) => {
    const entry = RENDERABLE[barCodeId];
    const length = typeof entry.length === "number" ? entry.length : entry.length.max;
    const data = sampleBarcodeData(barCodeId, length);
    const svg = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    let valid = true;
    const options = renderBarcodeOptions({ barCodeId, hriPosition: "none", narrowBarWidth: undefined }, 40);
    options.valid = (v: boolean) => {
      valid = valid && v;
    };
    assert.doesNotThrow(() => window.JsBarcode(svg, data, options), `${barCodeId}: JsBarcode threw for sample data "${data}"`);
    assert.equal(valid, true, `${barCodeId}: JsBarcode rejected its own module's sample data "${data}" as invalid`);
    assert.ok(svg.querySelectorAll("rect").length > 0, `${barCodeId}: rendered SVG has no bars`);
  });
});
