// Tests for docs/TASKS.md Batch CCC — CHRID over-exposure at the record
// level + BARCODE's two additional record-level exclusions
// (docs/AUDIT-CROSS-LEVEL.md §4/§9).
//
// Two independent fixes:
//  1. CHRID is a field-level-only keyword per IBM's DDS reference, but the
//     shared FONT_SIZING_SPECS array (media/webviewClient.js) used to
//     render it identically at both the record-level and field-level
//     Font & sizing panel call sites, with no warning from
//     validateFontKeywords. Fixed by having renderFontSizingPanel take a
//     `level` parameter that drops CHRID from the rendered list at the
//     record level, plus a validateFontKeywords(keywords, "record")
//     defense-in-depth warning for any pre-existing hand-typed source.
//  2. BARCODE has two further documented exclusions scoped to the whole
//     record format (distinct from prtfBarcodeParams.js's existing
//     field-scoped BARCODE_EXCLUDED_KEYWORDS list): it can't share a
//     record format with BLKFOLD/CPI/DFNCHR, and it can't appear on any
//     field within a record that also has record-level CHRSIZ.
import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("path");

function kw(name: string, params = "") {
  return { name, params, raw: params ? name + "(" + params + ")" : name, sourceLineIndex: 0 };
}
function recordWith(opts: { keywords?: any[]; fields?: any[] }) {
  return { name: "TESTREC", keywords: opts.keywords || [], fields: opts.fields || [] };
}
function fieldWithKeywords(keywords: any[]) {
  return { kind: "field", name: "FLD1", keywords };
}

// --- validateFontKeywords: CHRID at the record level -----------------------

test("validateFontKeywords: CHRID is flagged as invalid at the record level", () => {
  const keywords = [kw("CHRID", "697 500")];
  const warnings = PrtfEngine.validateFontKeywords(keywords, "record");
  assert.equal(
    warnings.some((w: any) => w.keyword === "CHRID" && /field-level-only/.test(w.message)),
    true
  );
});

test("validateFontKeywords: CHRID is NOT flagged as invalid at the field level", () => {
  const keywords = [kw("CHRID", "697 500")];
  const warnings = PrtfEngine.validateFontKeywords(keywords, "field");
  assert.equal(
    warnings.some((w: any) => /field-level-only/.test(w.message)),
    false
  );
});

test("validateFontKeywords: CHRID's record-level-only check does not fire when no level is passed (backward compatibility)", () => {
  const keywords = [kw("CHRID", "697 500")];
  assert.deepEqual(PrtfEngine.validateFontKeywords(keywords), []);
});

test("validateFontKeywords: the record-level CHRID check and the CDEFNT/FNTCHRSET mutual-exclusion check can both fire together", () => {
  const keywords = [kw("CDEFNT", "X0N51EHC"), kw("CHRID", "697 500")];
  const warnings = PrtfEngine.validateFontKeywords(keywords, "record");
  const chridWarnings = warnings.filter((w: any) => w.keyword === "CHRID");
  assert.equal(chridWarnings.length, 2);
});

// --- renderFontSizingPanel: CHRID dropped from the record-level UI --------

test("webview: renderFontSizingPanel takes a level parameter and drops CHRID from the rendered specs at the record level", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  assert.match(source, /function renderFontSizingPanel\(keywords, applyFn, removeFn, titleSuffix, level\)/);
  assert.match(
    source,
    /const specsForLevel =\s*\n\s*level === "record"\s*\n\s*\? FONT_SIZING_SPECS\.filter\(\(spec\) => spec\.name !== "CHRID"\)\s*\n\s*: level === "file"\s*\n\s*\? FONT_SIZING_SPECS\.filter\(\(spec\) => spec\.name === "FNTCHRSET" \|\| spec\.name === "FONTNAME"\)\s*\n\s*: FONT_SIZING_SPECS;/
  );
});

test("webview: the record-level Font & sizing call site passes \"record\" as the level", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const recordCallMatch = source.match(/renderFontSizingPanel\(\s*record\.keywords,[\s\S]*?record\.name \+ " \(record\)",\s*"record"\s*\)/);
  assert.ok(recordCallMatch, "record-level renderFontSizingPanel call must pass \"record\" as its level argument");
});

test("webview: the field-level Font & sizing call site passes \"field\" as the level", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const fieldCallMatch = source.match(/renderFontSizingPanel\(\s*cell\.keywords,[\s\S]*?cell\.kind === "field" \? cell\.name : "constant",\s*"field"\s*\)/);
  assert.ok(fieldCallMatch, "field-level renderFontSizingPanel call must pass \"field\" as its level argument");
});

// --- validateBarcodeRecordKeywords -----------------------------------------

test("validateBarcodeRecordKeywords: no warnings when no field in the record has BARCODE", () => {
  const record = recordWith({ keywords: [kw("BLKFOLD"), kw("CHRSIZ", "1.0 1.0")], fields: [fieldWithKeywords([])] });
  assert.deepEqual(PrtfEngine.validateBarcodeRecordKeywords(record), []);
});

test("validateBarcodeRecordKeywords: flagged when BLKFOLD is on the record and a field has BARCODE", () => {
  const record = recordWith({
    keywords: [kw("BLKFOLD")],
    fields: [fieldWithKeywords([kw("BARCODE", "CODE3OF9")])],
  });
  const warnings = PrtfEngine.validateBarcodeRecordKeywords(record);
  assert.equal(
    warnings.some((w: any) => w.keyword === "BLKFOLD" && /can't be combined with BLKFOLD/.test(w.message)),
    true
  );
});

test("validateBarcodeRecordKeywords: flagged when CPI is on the record and a field has BARCODE", () => {
  const record = recordWith({
    keywords: [kw("CPI", "10")],
    fields: [fieldWithKeywords([kw("BARCODE", "CODE3OF9")])],
  });
  const warnings = PrtfEngine.validateBarcodeRecordKeywords(record);
  assert.equal(warnings.some((w: any) => w.keyword === "CPI"), true);
});

test("validateBarcodeRecordKeywords: flagged when DFNCHR is on the record and a field has BARCODE", () => {
  const record = recordWith({
    keywords: [kw("DFNCHR")],
    fields: [fieldWithKeywords([kw("BARCODE", "CODE3OF9")])],
  });
  const warnings = PrtfEngine.validateBarcodeRecordKeywords(record);
  assert.equal(warnings.some((w: any) => w.keyword === "DFNCHR"), true);
});

test("validateBarcodeRecordKeywords: flagged when CHRSIZ is at the record level and a field has BARCODE", () => {
  const record = recordWith({
    keywords: [kw("CHRSIZ", "1.5 2.0")],
    fields: [fieldWithKeywords([kw("BARCODE", "CODE3OF9")])],
  });
  const warnings = PrtfEngine.validateBarcodeRecordKeywords(record);
  assert.equal(
    warnings.some((w: any) => w.keyword === "CHRSIZ" && /not allowed on any field/.test(w.message)),
    true
  );
});

test("validateBarcodeRecordKeywords: no warnings when a field has BARCODE but none of the exclusions are on the record", () => {
  const record = recordWith({
    keywords: [kw("HIGHLIGHT")],
    fields: [fieldWithKeywords([kw("BARCODE", "CODE3OF9")])],
  });
  assert.deepEqual(PrtfEngine.validateBarcodeRecordKeywords(record), []);
});

test("validateBarcodeRecordKeywords: all three record-level exclusions can be flagged together, plus CHRSIZ", () => {
  const record = recordWith({
    keywords: [kw("BLKFOLD"), kw("CPI", "10"), kw("DFNCHR"), kw("CHRSIZ", "1.0 1.0")],
    fields: [fieldWithKeywords([kw("BARCODE", "CODE3OF9")])],
  });
  const warnings = PrtfEngine.validateBarcodeRecordKeywords(record);
  const flagged = warnings.map((w: any) => w.keyword).sort();
  assert.deepEqual(flagged, ["BLKFOLD", "CHRSIZ", "CPI", "DFNCHR"]);
});

test("validateBarcodeRecordKeywords: BARCODE on ANY field in the record triggers the check, not just the first", () => {
  const record = recordWith({
    keywords: [kw("DFNCHR")],
    fields: [fieldWithKeywords([]), fieldWithKeywords([kw("BARCODE", "CODABAR")])],
  });
  const warnings = PrtfEngine.validateBarcodeRecordKeywords(record);
  assert.equal(warnings.some((w: any) => w.keyword === "DFNCHR"), true);
});

// --- Folded into validateRecordKeywords -------------------------------

test("validateRecordKeywords: folds in the Batch CCC BARCODE record-level exclusion warnings", () => {
  const record = recordWith({
    keywords: [kw("BLKFOLD")],
    fields: [fieldWithKeywords([kw("BARCODE", "CODE3OF9")])],
  });
  const warnings = PrtfEngine.validateRecordKeywords(record);
  assert.equal(warnings.some((w: any) => w.keyword === "BLKFOLD"), true);
});

// --- BARCODE_RECORD_EXCLUSION_KEYWORDS --------------------------------

test("BARCODE_RECORD_EXCLUSION_KEYWORDS contains exactly BLKFOLD, CPI, DFNCHR", () => {
  assert.deepEqual(PrtfEngine.BARCODE_RECORD_EXCLUSION_KEYWORDS, ["BLKFOLD", "CPI", "DFNCHR"]);
});
