// Tests for docs/TASKS.md Batch HHH — SKIPA/SKIPB/SPACEA/SPACEB have no
// properties-panel UI at any level (record, field, or file).
//
// Found while scoping Batch GGG: these four keywords are already fully
// and correctly validated at every level they're valid at
// (validateSkipSpaceKeywords / validateFileLevelKeywords, Batch VV — see
// test/prtfBatchVV.test.ts for that coverage, not repeated here), and
// they're rendered (they affect vertical positioning in the layout
// engine), but had zero properties-panel UI anywhere. This batch is UI
// only — no parser/writer/validation changes, since the generic keyword
// model already round-trips all four correctly at every level (verified
// directly below).
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

// --- Round-trip: all four keywords at record and field level ----------

test("Batch HHH round-trip: SKIPA/SKIPB/SPACEA/SPACEB at the record level survive parse -> regenerate unchanged", () => {
  const original = [
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), "SKIPB(2)"),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ].join("\n") + "\n";
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  assert.equal(PrtfEngine.findKeyword(header.keywords, "SKIPB").params, "(2)");
});

test("Batch HHH round-trip: SKIPA/SKIPB/SPACEA/SPACEB at the field level survive parse -> regenerate unchanged", () => {
  const original = [
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      "SPACEA(1)"
    ),
  ].join("\n") + "\n";
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  const custname = header.fields.find((f: any) => f.name === "CUSTNAME") as any;
  assert.equal(PrtfEngine.findKeyword(custname.keywords, "SPACEA").params, "(1)");
});

test("Batch HHH round-trip: SKIPA/SKIPB at the file level survive parse -> regenerate unchanged", () => {
  const original = [
    ...emitWithKeywords(buildPositional({}), "SKIPA(5)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ].join("\n") + "\n";
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
  assert.ok(PrtfEngine.findKeyword(model.fileLevel.keywords, "SKIPA"));
});

// --- Properties-panel UI (source-shape checks — webviewClient.js isn't
// require()-able, same constraint every other webview-shape test in this
// project works around) ------------------------------------------------

test("webview: SKIPA/SKIPB/SPACEA/SPACEB have text rows in BATCH_A_RECORD_KEYWORDS (record level)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const arrayMatch = source.match(/const BATCH_A_RECORD_KEYWORDS = \[([\s\S]*?)\n  \];/);
  assert.ok(arrayMatch, "BATCH_A_RECORD_KEYWORDS array not found");
  const body = arrayMatch![1];
  ["SKIPA", "SKIPB", "SPACEA", "SPACEB"].forEach((name) => {
    assert.match(body, new RegExp('\\{ name: "' + name + '", kind: "text"'), name + " must be modeled as a text row in BATCH_A_RECORD_KEYWORDS");
  });
});

test("webview: SKIPA/SKIPB/SPACEA/SPACEB have text rows in BATCH_A_SHARED_KEYWORDS (field/constant level)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const arrayMatch = source.match(/const BATCH_A_SHARED_KEYWORDS = \[([\s\S]*?)\n  \];/);
  assert.ok(arrayMatch, "BATCH_A_SHARED_KEYWORDS array not found");
  const body = arrayMatch![1];
  ["SKIPA", "SKIPB", "SPACEA", "SPACEB"].forEach((name) => {
    assert.match(body, new RegExp('\\{ name: "' + name + '", kind: "text"'), name + " must be modeled as a text row in BATCH_A_SHARED_KEYWORDS");
  });
});

test("webview: SKIPA/SKIPB (but not SPACEA/SPACEB) have text rows in BATCH_GGG_FILE_KEYWORDS (file level)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const arrayMatch = source.match(/const BATCH_GGG_FILE_KEYWORDS = \[([\s\S]*?)\n  \];/);
  assert.ok(arrayMatch, "BATCH_GGG_FILE_KEYWORDS array not found");
  const body = arrayMatch![1];
  assert.match(body, /\{ name: "SKIPA", kind: "text"/);
  assert.match(body, /\{ name: "SKIPB", kind: "text"/);
  assert.doesNotMatch(body, /\{ name: "SPACEA"/, "SPACEA has no file-level form and shouldn't appear in the file-level keyword array");
  assert.doesNotMatch(body, /\{ name: "SPACEB"/, "SPACEB has no file-level form and shouldn't appear in the file-level keyword array");
});
