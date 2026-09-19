// Tests for docs/TASKS.md Batch FFF — DTASTMCMD field-level UI exposure
// (docs/AUDIT-CROSS-LEVEL.md §5).
//
// DTASTMCMD is record-level-or-field-level per IBM's DDS reference, but
// BATCH_E_SIMPLE_KEYWORDS (which contains it) was wired only to the
// record-level panel, and src/prtfLayout.js's collectPageGroupMetadata
// (the "page-group / resource keywords" panel's read-only badge summary)
// only ever read record.keywords, never a field/constant's own keywords.
// It already round-trips generically via the parser/writer (no
// batch-specific parse/build pair needed, same as Batch DDD before it).
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

function buildSource(recordKeywords: string, fieldKeywords: string, field2Keywords = ""): string {
  const lines = [
    "      * Batch FFF test fixture",
    "",
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), recordKeywords),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      fieldKeywords
    ),
    ...(field2Keywords
      ? emitWithKeywords(
          buildPositional({ name: "ORDERNO", length: 10, dataType: "A", usage: "B", lineNo: 2, position: 10 }),
          field2Keywords
        )
      : []),
  ];
  return lines.join("\n") + "\n";
}

// --- Round-trip: field-level DTASTMCMD --------------------------------

test("Batch FFF round-trip: field-level DTASTMCMD survives parse -> regenerate unchanged", () => {
  const original = buildSource("", "DTASTMCMD('TEXT(Field 1)')");
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  const custname = header.fields.find((f: any) => f.name === "CUSTNAME") as any;
  assert.equal(PrtfEngine.findKeyword(custname.keywords, "DTASTMCMD").params, "('TEXT(Field 1)')");
});

test("Batch FFF round-trip: DTASTMCMD can be present at both record and field level simultaneously", () => {
  const original = buildSource("DTASTMCMD('TEXT(Record 1)')", "DTASTMCMD('TEXT(Field 1)')");
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
});

// --- resolveLayout / collectPageGroupMetadata --------------------------

test("resolveLayout: a field's own DTASTMCMD surfaces in layout.pageGroupKeywords, labeled with the field's name", () => {
  const model = parseSource(buildSource("", "DTASTMCMD('some command')"));
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {}, "inch");
  const dtastmcmdItems = layout.pageGroupKeywords.filter((i: any) => i.keyword === "DTASTMCMD");
  assert.equal(dtastmcmdItems.length, 1);
  assert.match(dtastmcmdItems[0].summary, /some command/);
  assert.match(dtastmcmdItems[0].summary, /\(CUSTNAME\)/);
});

test("resolveLayout: record-level and field-level DTASTMCMD both surface, distinguishably", () => {
  const model = parseSource(buildSource("DTASTMCMD('record cmd')", "DTASTMCMD('field cmd')"));
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {}, "inch");
  const dtastmcmdItems = layout.pageGroupKeywords.filter((i: any) => i.keyword === "DTASTMCMD");
  assert.equal(dtastmcmdItems.length, 2);
  const summaries = dtastmcmdItems.map((i: any) => i.summary);
  assert.ok(summaries.some((s: string) => /record cmd/.test(s) && !/\(CUSTNAME\)/.test(s)), "record-level entry should have no field label");
  assert.ok(summaries.some((s: string) => /field cmd/.test(s) && /\(CUSTNAME\)/.test(s)), "field-level entry should be labeled with the field name");
});

test("resolveLayout: two different fields each with their own DTASTMCMD both surface, each labeled with its own field", () => {
  const model = parseSource(buildSource("", "DTASTMCMD('cmd one')", "DTASTMCMD('cmd two')"));
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {}, "inch");
  const dtastmcmdItems = layout.pageGroupKeywords.filter((i: any) => i.keyword === "DTASTMCMD");
  assert.equal(dtastmcmdItems.length, 2);
  const summaries = dtastmcmdItems.map((i: any) => i.summary).sort();
  assert.ok(summaries.some((s: string) => /cmd one/.test(s) && /\(CUSTNAME\)/.test(s)));
  assert.ok(summaries.some((s: string) => /cmd two/.test(s) && /\(ORDERNO\)/.test(s)));
});

test("resolveLayout: no DTASTMCMD anywhere contributes nothing to layout.pageGroupKeywords", () => {
  const model = parseSource(buildSource("", ""));
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {}, "inch");
  assert.equal(layout.pageGroupKeywords.filter((i: any) => i.keyword === "DTASTMCMD").length, 0);
});

// --- Properties-panel UI (source-shape check — webviewClient.js isn't
// require()-able, same constraint every other webview-shape test in this
// project works around) ------------------------------------------------

test("webview: DTASTMCMD has a quotedText row in BATCH_A_SHARED_KEYWORDS (field/constant General keywords section)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const arrayMatch = source.match(/const BATCH_A_SHARED_KEYWORDS = \[([\s\S]*?)\n  \];/);
  assert.ok(arrayMatch, "BATCH_A_SHARED_KEYWORDS array not found");
  assert.match(
    arrayMatch![1],
    /\{ name: "DTASTMCMD", kind: "quotedText", placeholder: "raw AFP data-stream command text, or &field"/,
    "DTASTMCMD must be modeled as a quotedText row in BATCH_A_SHARED_KEYWORDS, same placeholder/hint as the record-level row"
  );
});

test("webview: DTASTMCMD still has its pre-existing quotedText row in BATCH_E_SIMPLE_KEYWORDS (record-level)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const arrayMatch = source.match(/const BATCH_E_SIMPLE_KEYWORDS = \[([\s\S]*?)\n  \];/);
  assert.ok(arrayMatch, "BATCH_E_SIMPLE_KEYWORDS array not found");
  assert.match(arrayMatch![1], /\{ name: "DTASTMCMD", kind: "quotedText"/);
});
