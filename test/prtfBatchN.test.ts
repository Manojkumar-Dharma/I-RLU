// Tests for docs/TASKS.md Batch N — BARCODE mutual-exclusion validation
// (src/prtfBarcodeParams.js's validateBarcodeExclusions). Verifies the
// exact excluded-keyword list against IBM's DDS reference for BARCODE
// ("Do not specify BARCODE in the same field with the CHRSIZ, CHRID,
// CVTDTA, DATE, EDTCDE, EDTWRD, FONT, HIGHLIGHT, PAGNBR, TIME, or
// UNDERLINE keywords") — a superset of README.md's own shorthand list
// (FONT/EDTCDE/EDTWRD/DATE/TIME/PAGNBR/etc), confirming the "etc." does
// in fact cover CHRSIZ/CHRID/CVTDTA/HIGHLIGHT/UNDERLINE too, per this
// batch's own instruction to verify against IBM's reference rather than
// trust README's list as exhaustive.
import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateBarcodeExclusions } = require("../src/prtfBarcodeParams.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

function kw(name: string, params = "") {
  return { name, params, raw: name + params, sourceLineIndex: -1 };
}

test("validateBarcodeExclusions: BARCODE alone (no conflicting keyword) produces no hints", () => {
  assert.deepEqual(validateBarcodeExclusions([kw("BARCODE", "(UPCA)")]), []);
});

test("validateBarcodeExclusions: no BARCODE at all produces no hints, even with an otherwise-excluded keyword present", () => {
  assert.deepEqual(validateBarcodeExclusions([kw("FONT", "(11)")]), []);
});

test("validateBarcodeExclusions: BARCODE + FONT on the same field triggers a hint naming FONT", () => {
  const hints = validateBarcodeExclusions([kw("BARCODE", "(UPCA)"), kw("FONT", "(11)")]);
  assert.equal(hints.length, 1);
  assert.match(hints[0], /FONT/);
  assert.match(hints[0], /BARCODE/);
});

// Every keyword IBM's DDS reference actually names — deliberately testing
// each individually rather than just the README-derived subset, since the
// point of this batch was confirming the FULL list, not just the ones
// README already called out by name.
const FULL_EXCLUDED_LIST = ["CHRSIZ", "CHRID", "CVTDTA", "DATE", "EDTCDE", "EDTWRD", "FONT", "HIGHLIGHT", "PAGNBR", "TIME", "UNDERLINE"];

for (const name of FULL_EXCLUDED_LIST) {
  test(`validateBarcodeExclusions: BARCODE + ${name} triggers a hint naming ${name}`, () => {
    const hints = validateBarcodeExclusions([kw("BARCODE", "(UPCA)"), kw(name, "(*YES)")]);
    assert.equal(hints.length, 1);
    assert.match(hints[0], new RegExp(name));
  });
}

test("validateBarcodeExclusions: non-conflicting keywords alongside BARCODE (e.g. COLOR, DFT) don't trigger any hint", () => {
  assert.deepEqual(validateBarcodeExclusions([kw("BARCODE", "(UPCA)"), kw("COLOR", "(*BLU)"), kw("DFT", "('123')")]), []);
});

test("validateBarcodeExclusions: multiple conflicting keywords each produce their own hint", () => {
  const hints = validateBarcodeExclusions([kw("BARCODE", "(UPCA)"), kw("FONT", "(11)"), kw("EDTCDE", "(J)")]);
  assert.equal(hints.length, 2);
  assert.ok(hints.some((h: string) => /FONT/.test(h)));
  assert.ok(hints.some((h: string) => /EDTCDE/.test(h)));
});

test("validateBarcodeExclusions is re-exported from PrtfEngine's public shape", () => {
  assert.equal(typeof PrtfEngine.validateBarcodeExclusions, "function");
  assert.equal(PrtfEngine.validateBarcodeExclusions([kw("BARCODE", "(UPCA)"), kw("FONT", "(11)")]).length, 1);
});
