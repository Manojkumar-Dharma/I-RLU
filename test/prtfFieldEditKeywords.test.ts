import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateFieldKeywords, collectIndicatorDescriptions, parseIndtxt } = require("../src/prtfEngine.js");

/**
 * Batch G (docs/TASKS.md) — field-level data/edit keywords (ALIAS,
 * BLKFOLD, CVTDTA, DLTEDT, FLTFIXDEC, FLTPCN, TRNSPY, TXTRTT) + INDTXT
 * indicator text. Covers PrtfEngine.validateFieldKeywords' applicability
 * warnings, parseIndtxt/collectIndicatorDescriptions' parsing and
 * level-precedence, and a write -> reparse round trip for a field carrying
 * several of these keywords at once.
 */

function makeField(overrides: any = {}) {
  return {
    kind: "field",
    id: "f1",
    sourceLineIndex: 2,
    name: "AMOUNT",
    reference: false,
    length: 9,
    dataType: "S",
    decimalPositions: 2,
    usage: "O",
    line: 1,
    position: 10,
    conditions: [],
    keywords: [],
    ...overrides,
  };
}

function kw(name: string, params: string) {
  return { name, params: "(" + params + ")", raw: name + "(" + params + ")", sourceLineIndex: 2 };
}

test("validateFieldKeywords: DLTEDT on a non-reference field is flagged", () => {
  const field = makeField({ reference: false, keywords: [{ name: "DLTEDT", params: "", raw: "DLTEDT", sourceLineIndex: 2 }] });
  const warnings = validateFieldKeywords(field);
  assert.equal(warnings.some((w: any) => w.keyword === "DLTEDT"), true);
});

test("validateFieldKeywords: DLTEDT on a reference field is fine", () => {
  const field = makeField({ reference: true, keywords: [{ name: "DLTEDT", params: "", raw: "DLTEDT", sourceLineIndex: 2 }] });
  assert.deepEqual(validateFieldKeywords(field), []);
});

test("validateFieldKeywords: FLTFIXDEC and FLTPCN on a non-floating-point field are both flagged", () => {
  const field = makeField({
    dataType: "S",
    keywords: [
      { name: "FLTFIXDEC", params: "", raw: "FLTFIXDEC", sourceLineIndex: 2 },
      kw("FLTPCN", "*DOUBLE"),
    ],
  });
  const warnings = validateFieldKeywords(field);
  assert.equal(warnings.filter((w: any) => w.keyword === "FLTFIXDEC" || w.keyword === "FLTPCN").length, 2);
});

test("validateFieldKeywords: FLTFIXDEC/FLTPCN on a floating-point field (type F) are fine", () => {
  const field = makeField({ dataType: "F", keywords: [{ name: "FLTFIXDEC", params: "", raw: "FLTFIXDEC", sourceLineIndex: 2 }, kw("FLTPCN", "*DOUBLE")] });
  assert.deepEqual(validateFieldKeywords(field), []);
});

test("validateFieldKeywords: an invalid FLTPCN parameter is flagged even on a floating-point field", () => {
  const field = makeField({ dataType: "F", keywords: [kw("FLTPCN", "*TRIPLE")] });
  const warnings = validateFieldKeywords(field);
  assert.equal(warnings.some((w: any) => w.keyword === "FLTPCN"), true);
});

test("validateFieldKeywords: TRNSPY on a non-character field is flagged, on a character field is fine", () => {
  const numeric = makeField({ dataType: "S", keywords: [{ name: "TRNSPY", params: "", raw: "TRNSPY", sourceLineIndex: 2 }] });
  assert.equal(validateFieldKeywords(numeric).some((w: any) => w.keyword === "TRNSPY"), true);

  const char = makeField({ dataType: "A", keywords: [{ name: "TRNSPY", params: "", raw: "TRNSPY", sourceLineIndex: 2 }] });
  assert.deepEqual(validateFieldKeywords(char), []);
});

test("validateFieldKeywords: TXTRTT accepts only 0/90/180/270 degrees", () => {
  const bad = makeField({ keywords: [kw("TXTRTT", "45")] });
  assert.equal(validateFieldKeywords(bad).some((w: any) => w.keyword === "TXTRTT"), true);

  const good = makeField({ keywords: [kw("TXTRTT", "180")] });
  assert.deepEqual(validateFieldKeywords(good), []);
});

test("parseIndtxt: parses indicator number and text, unescaping doubled quotes", () => {
  const parsed = parseIndtxt(kw("INDTXT", "50 'Customer''s balance is overdue'"));
  assert.deepEqual(parsed, { indicator: "50", text: "Customer's balance is overdue" });
});

test("parseIndtxt: malformed params return null rather than throwing", () => {
  assert.equal(parseIndtxt({ name: "INDTXT", params: "()" }), null);
});

function makeModelForIndicators({ fileText, recordText, fieldText }: { fileText?: string; recordText?: string; fieldText?: string }) {
  const fileLevel: any = { kind: "fileLevel", sourceLineIndex: 0, keywords: fileText ? [kw("INDTXT", fileText)] : [] };
  const field: any = makeField({ keywords: fieldText ? [kw("INDTXT", fieldText)] : [] });
  const record: any = {
    kind: "record",
    sourceLineIndex: 1,
    name: "HEADER",
    conditions: [],
    keywords: recordText ? [kw("INDTXT", recordText)] : [],
    fields: [field],
  };
  return { model: { rawLines: [], lineEnding: "\n", fileLevel, records: [record], sequence: [] }, record };
}

test("collectIndicatorDescriptions: reads a file-level INDTXT", () => {
  const { model, record } = makeModelForIndicators({ fileText: "50 'Rush order'" });
  assert.deepEqual(collectIndicatorDescriptions(model, record), { "50": "Rush order" });
});

test("collectIndicatorDescriptions: record-level INDTXT overrides file-level for the same indicator", () => {
  const { model, record } = makeModelForIndicators({ fileText: "50 'file-level text'", recordText: "50 'record-level text'" });
  assert.deepEqual(collectIndicatorDescriptions(model, record), { "50": "record-level text" });
});

test("collectIndicatorDescriptions: field-level INDTXT overrides both file- and record-level for the same indicator", () => {
  const { model, record } = makeModelForIndicators({
    fileText: "50 'file-level text'",
    recordText: "50 'record-level text'",
    fieldText: "50 'field-level text'",
  });
  assert.deepEqual(collectIndicatorDescriptions(model, record), { "50": "field-level text" });
});

test("collectIndicatorDescriptions: distinct indicators from different levels all show up", () => {
  const { model, record } = makeModelForIndicators({ fileText: "50 'from file'", recordText: "51 'from record'", fieldText: "52 'from field'" });
  assert.deepEqual(collectIndicatorDescriptions(model, record), { "50": "from file", "51": "from record", "52": "from field" });
});

test("write -> reparse round trip: a field carrying several Batch G keywords survives intact", () => {
  const fileLevel: any = { kind: "fileLevel", sourceLineIndex: 0, keywords: [] };
  const field: any = makeField({
    name: "RATE",
    dataType: "F",
    length: 9,
    decimalPositions: 4,
    reference: false,
    keywords: [
      kw("ALIAS", "INTRATE"),
      { name: "FLTFIXDEC", params: "", raw: "FLTFIXDEC", sourceLineIndex: 2 },
      kw("FLTPCN", "*DOUBLE"),
      kw("TXTRTT", "90"),
    ],
  });
  const record: any = {
    kind: "record",
    sourceLineIndex: 1,
    name: "DETAIL",
    conditions: [],
    keywords: [kw("INDTXT", "60 'Rate overridden by supervisor'")],
    fields: [field],
  };
  const model: any = { rawLines: [], lineEnding: "\n", fileLevel, records: [record], sequence: [fileLevel, record, field] };

  const text = regenerateSource(model);
  const reparsed = parseSource(text);
  const reparsedRecord = reparsed.records.find((r) => r.name === "DETAIL")!;
  const reparsedField: any = reparsedRecord.fields.find((f: any) => f.kind === "field" && f.name === "RATE");

  assert.equal(reparsedField.dataType, "F");
  const alias = reparsedField.keywords.find((k: any) => k.name === "ALIAS");
  assert.ok(alias);
  assert.match(alias.raw, /INTRATE/);
  assert.ok(reparsedField.keywords.find((k: any) => k.name === "FLTFIXDEC"));
  const fltpcn = reparsedField.keywords.find((k: any) => k.name === "FLTPCN");
  assert.match(fltpcn.raw, /\*DOUBLE/);
  const txtrtt = reparsedField.keywords.find((k: any) => k.name === "TXTRTT");
  assert.match(txtrtt.raw, /90/);
  assert.deepEqual(validateFieldKeywords(reparsedField), []);
  assert.deepEqual(collectIndicatorDescriptions(reparsed, reparsedRecord), { "60": "Rate overridden by supervisor" });

  // Idempotence: regenerating the reparsed model again produces identical text.
  assert.equal(regenerateSource(reparsed), text);
});
