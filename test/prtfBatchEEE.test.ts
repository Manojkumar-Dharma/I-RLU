// Tests for docs/TASKS.md Batch EEE — PRTQLTY field-level UI exposure +
// its unvalidated CHRSIZ/BARCODE dependency (docs/AUDIT-CROSS-LEVEL.md
// §6).
//
// PRTQLTY is record-level-or-field-level per IBM's DDS reference, but was
// only wired into the record-level panel; also unvalidated anywhere:
// "The PRTQLTY keyword is allowed only on records or fields for which a
// CHRSIZ or BARCODE keyword applies." CHRSIZ has both a record-level form
// (which applies to every field in that record) and a field-level form;
// BARCODE has no record-level form, so a record-level PRTQLTY can only
// lean on a BARCODE actually coded on one of the record's own fields —
// exactly what IBM's own worked example for PRTQLTY shows.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
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

// --- Round-trip: field-level PRTQLTY --------------------------------------

test("Batch EEE round-trip: field-level PRTQLTY survives parse -> regenerate unchanged", () => {
  const original = [
    "      * Batch EEE test fixture",
    "",
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      "PRTQLTY(*DRAFT) CHRSIZ(1.5 2.0)"
    ),
  ].join("\n") + "\n";
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  const custname = header.fields.find((f: any) => f.name === "CUSTNAME") as any;
  assert.equal(PrtfEngine.findKeyword(custname.keywords, "PRTQLTY").params, "(*DRAFT)");
});

// --- recordHasPrtqltyBasis --------------------------------------------

test("recordHasPrtqltyBasis: true when the record has its own CHRSIZ", () => {
  const record = recordWith({ keywords: [kw("CHRSIZ", "1.0 1.0")] });
  assert.equal(PrtfEngine.recordHasPrtqltyBasis(record), true);
});

test("recordHasPrtqltyBasis: true when a field in the record has BARCODE", () => {
  const record = recordWith({ fields: [fieldWithKeywords([kw("BARCODE", "CODE3OF9")])] });
  assert.equal(PrtfEngine.recordHasPrtqltyBasis(record), true);
});

test("recordHasPrtqltyBasis: false when neither is present", () => {
  const record = recordWith({ keywords: [kw("HIGHLIGHT")], fields: [fieldWithKeywords([])] });
  assert.equal(PrtfEngine.recordHasPrtqltyBasis(record), false);
});

// --- validateRecordKeywords: record-level PRTQLTY dependency --------------

test("validateRecordKeywords: PRTQLTY flagged when the record has neither CHRSIZ nor a field with BARCODE", () => {
  const record = recordWith({ keywords: [kw("PRTQLTY", "*NLQ")] });
  const warnings = PrtfEngine.validateRecordKeywords(record);
  assert.equal(
    warnings.some((w: any) => w.keyword === "PRTQLTY" && /CHRSIZ at the record level, or BARCODE/.test(w.message)),
    true
  );
});

test("validateRecordKeywords: PRTQLTY NOT flagged when the record has its own CHRSIZ", () => {
  const record = recordWith({ keywords: [kw("PRTQLTY", "*NLQ"), kw("CHRSIZ", "1.0 1.0")] });
  const warnings = PrtfEngine.validateRecordKeywords(record);
  assert.equal(warnings.some((w: any) => w.keyword === "PRTQLTY"), false);
});

test("validateRecordKeywords: PRTQLTY NOT flagged when a field in the record has BARCODE", () => {
  const record = recordWith({
    keywords: [kw("PRTQLTY", "*NLQ")],
    fields: [fieldWithKeywords([kw("BARCODE", "CODE3OF9")])],
  });
  const warnings = PrtfEngine.validateRecordKeywords(record);
  assert.equal(warnings.some((w: any) => w.keyword === "PRTQLTY"), false);
});

test("validateRecordKeywords: no PRTQLTY warning at all when PRTQLTY isn't present", () => {
  const record = recordWith({ keywords: [] });
  const warnings = PrtfEngine.validateRecordKeywords(record);
  assert.equal(warnings.some((w: any) => w.keyword === "PRTQLTY"), false);
});

// --- validateFieldKeywords: field-level PRTQLTY dependency -----------------

test("validateFieldKeywords: PRTQLTY flagged when the field has neither CHRSIZ nor BARCODE and no record is given", () => {
  const field = fieldWithKeywords([kw("PRTQLTY", "*NLQ")]);
  const warnings = PrtfEngine.validateFieldKeywords(field);
  assert.equal(
    warnings.some((w: any) => w.keyword === "PRTQLTY" && /its own CHRSIZ or BARCODE/.test(w.message)),
    true
  );
});

test("validateFieldKeywords: PRTQLTY NOT flagged when the field has its own CHRSIZ", () => {
  const field = fieldWithKeywords([kw("PRTQLTY", "*NLQ"), kw("CHRSIZ", "1.0 1.0")]);
  const warnings = PrtfEngine.validateFieldKeywords(field);
  assert.equal(warnings.some((w: any) => w.keyword === "PRTQLTY"), false);
});

test("validateFieldKeywords: PRTQLTY NOT flagged when the field has its own BARCODE", () => {
  const field = fieldWithKeywords([kw("PRTQLTY", "*NLQ"), kw("BARCODE", "CODE3OF9")]);
  const warnings = PrtfEngine.validateFieldKeywords(field);
  assert.equal(warnings.some((w: any) => w.keyword === "PRTQLTY"), false);
});

test("validateFieldKeywords: PRTQLTY NOT flagged when the owning record has record-level CHRSIZ (inherited)", () => {
  const field = fieldWithKeywords([kw("PRTQLTY", "*NLQ")]);
  const record = recordWith({ keywords: [kw("CHRSIZ", "1.0 1.0")], fields: [field] });
  const warnings = PrtfEngine.validateFieldKeywords(field, record);
  assert.equal(warnings.some((w: any) => w.keyword === "PRTQLTY"), false);
});

test("validateFieldKeywords: PRTQLTY IS flagged when a DIFFERENT field in the same record has BARCODE (BARCODE has no record-level reach)", () => {
  const field = fieldWithKeywords([kw("PRTQLTY", "*NLQ")]);
  const otherField = { kind: "field", name: "FLD2", keywords: [kw("BARCODE", "CODE3OF9")] };
  const record = recordWith({ keywords: [], fields: [field, otherField] });
  const warnings = PrtfEngine.validateFieldKeywords(field, record);
  assert.equal(warnings.some((w: any) => w.keyword === "PRTQLTY"), true);
});

test("validateFieldKeywords: no PRTQLTY warning at all when PRTQLTY isn't present", () => {
  const field = fieldWithKeywords([]);
  assert.equal(PrtfEngine.validateFieldKeywords(field).some((w: any) => w.keyword === "PRTQLTY"), false);
});

// --- Properties-panel UI (source-shape check — webviewClient.js isn't
// require()-able, same constraint every other webview-shape test in this
// project works around) ------------------------------------------------

test("webview: PRTQLTY has a select row in BATCH_A_SHARED_KEYWORDS (field/constant General keywords section)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const arrayMatch = source.match(/const BATCH_A_SHARED_KEYWORDS = \[([\s\S]*?)\n  \];/);
  assert.ok(arrayMatch, "BATCH_A_SHARED_KEYWORDS array not found");
  assert.match(
    arrayMatch![1],
    /\{ name: "PRTQLTY", kind: "select", options: \["\*STD", "\*DRAFT", "\*NLQ", "\*FASTDRAFT"\]/,
    "PRTQLTY must be modeled as a select row in BATCH_A_SHARED_KEYWORDS, same options as the record-level row"
  );
});

test("webview: PRTQLTY still has its pre-existing select row in BATCH_A_RECORD_KEYWORDS (record-level)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const arrayMatch = source.match(/const BATCH_A_RECORD_KEYWORDS = \[([\s\S]*?)\n  \];/);
  assert.ok(arrayMatch, "BATCH_A_RECORD_KEYWORDS array not found");
  assert.match(arrayMatch![1], /\{ name: "PRTQLTY", kind: "select"/);
});
