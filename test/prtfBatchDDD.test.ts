// Tests for docs/TASKS.md Batch DDD — modeling TEXT (record-level-or-
// field-level documentation keyword), found via docs/AUDIT-CROSS-LEVEL.md
// §7.
//
// TEXT('description') is a program-documentation comment, valid at both
// record and field level, with no compile or rendering effect — the DDS
// data-description processor just uses the first 50 characters if the
// text is longer. It already round-trips generically via the parser/
// writer (no batch-specific parse/build pair needed, same as Batch F/G
// before it) and was already added to NO_INDICATOR_KEYWORDS by Batch BBB.
// What was missing was a properties-panel row at either level — this
// batch adds a plain quotedText row (same shape DTASTMCMD's already uses)
// to BATCH_A_RECORD_KEYWORDS (record level) and BATCH_A_SHARED_KEYWORDS
// (field/constant level).
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

function buildSource(recordKeywords: string, fieldKeywords: string): string {
  const lines = [
    "      * Batch DDD test fixture",
    "",
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), recordKeywords),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      fieldKeywords
    ),
  ];
  return lines.join("\n") + "\n";
}

test("Batch DDD round-trip: record-level TEXT survives parse -> regenerate unchanged", () => {
  const original = buildSource("TEXT('Customer Master Record')", "");
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  assert.equal(PrtfEngine.findKeyword(header.keywords, "TEXT").params, "('Customer Master Record')");
});

test("Batch DDD round-trip: field-level TEXT survives parse -> regenerate unchanged", () => {
  const original = buildSource("", "TEXT('ORDER NUMBER FIELD')");
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  const custname = header.fields.find((f: any) => f.name === "CUSTNAME") as any;
  assert.equal(PrtfEngine.findKeyword(custname.keywords, "TEXT").params, "('ORDER NUMBER FIELD')");
});

test("Batch DDD round-trip: TEXT can be present at both record and field level simultaneously", () => {
  const original = buildSource("TEXT('Customer Master Record')", "TEXT('ORDER NUMBER FIELD')");
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
});

test("TEXT is already registered in NO_INDICATOR_KEYWORDS (Batch BBB) — option indicators are not valid for it", () => {
  assert.equal(PrtfEngine.NO_INDICATOR_KEYWORDS.indexOf("TEXT") !== -1, true);
});

// --- Properties-panel UI (source-shape checks — webviewClient.js isn't
// require()-able, same constraint every other webview-shape test in this
// project works around) ------------------------------------------------

test("webview: TEXT has a quotedText row in BATCH_A_RECORD_KEYWORDS (record-level General record keywords panel)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const arrayMatch = source.match(/const BATCH_A_RECORD_KEYWORDS = \[([\s\S]*?)\n  \];/);
  assert.ok(arrayMatch, "BATCH_A_RECORD_KEYWORDS array not found");
  assert.match(arrayMatch![1], /\{ name: "TEXT", kind: "quotedText"/, "TEXT must be modeled as a quotedText row in BATCH_A_RECORD_KEYWORDS");
});

test("webview: TEXT has a quotedText row in BATCH_A_SHARED_KEYWORDS (field/constant General keywords section)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const arrayMatch = source.match(/const BATCH_A_SHARED_KEYWORDS = \[([\s\S]*?)\n  \];/);
  assert.ok(arrayMatch, "BATCH_A_SHARED_KEYWORDS array not found");
  assert.match(arrayMatch![1], /\{ name: "TEXT", kind: "quotedText"/, "TEXT must be modeled as a quotedText row in BATCH_A_SHARED_KEYWORDS");
});

test("webview: TEXT's row hint mentions the 50-character truncation on both panels", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const textRowMatches = source.match(/\{ name: "TEXT", kind: "quotedText"[^}]*\}/g) || [];
  assert.equal(textRowMatches.length, 2, "TEXT should appear exactly twice — once per level");
  textRowMatches.forEach((row: string) => {
    assert.match(row, /50 charact/i, "TEXT's hint should mention the 50-character truncation documented by IBM's DDS reference");
  });
});
