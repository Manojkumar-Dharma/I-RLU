// Conditioning indicators, applied per KEYWORD rather than just per field/
// constant/record — the real DDS/RLU technique of attaching one or more
// ADDITIONAL keyword(s) to an already-defined field or constant via a
// separate physical line whose name/type/length/usage/line/position
// columns are all blank but which carries its OWN conditioning in columns
// 8-16 (see prtfModel.ts's Keyword.conditions comment for the full
// explanation). The classic example this file's tests are built around:
// two mutually-exclusive COLOR keywords on the same field, one active
// under indicator 05, the other under N05.
//
// Before this existed, prtfParser.ts treated ANY blank-name line inside a
// record as a brand-new (bogus) constant, regardless of whether it had a
// literal or even a Location (line/position) — so a real conditioned-
// keyword-continuation line for an existing FIELD silently turned into a
// phantom, invisible "constant" entry, and the field never got the
// keyword at all. This file's parser tests guard against that regressing.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, groupKeywordsByConditions, emitEntryWithConditionedKeywords, buildPositional } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveLayout, collectIndicators } = require("../src/prtfEngine.js");

function padR(s: string, n: number): string {
  s = s || "";
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number): string {
  s = s || "";
  return s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s;
}

/** Builds one exact-column DDS positional+keyword line for these tests, per the column layout documented in prtfModel.ts. */
function buildLine(opts: {
  slot1?: string;
  slot2?: string;
  slot3?: string;
  type?: string;
  name?: string;
  ref?: string;
  length?: string;
  dataType?: string;
  dec?: string;
  usage?: string;
  line?: string;
  pos?: string;
  kw?: string;
}): string {
  let s = "";
  s += padR("", 5); // 1-5 sequence
  s += " "; // 6 form type
  s += " "; // 7 comment/AND-OR
  s += padL(opts.slot1 || "", 3);
  s += padL(opts.slot2 || "", 3);
  s += padL(opts.slot3 || "", 3);
  s += padR(opts.type || "", 1); // 17
  s += " "; // 18
  s += padR(opts.name || "", 10); // 19-28
  s += padR(opts.ref || "", 1); // 29
  s += padL(opts.length || "", 5); // 30-34
  s += padR(opts.dataType || "", 1); // 35
  s += padL(opts.dec || "", 2); // 36-37
  s += padR(opts.usage || "", 1); // 38
  s += padL(opts.line || "", 3); // 39-41
  s += padL(opts.pos || "", 3); // 42-44
  s += opts.kw || "";
  return s;
}

function buildSource(lines: string[]): string {
  // The real writer trims trailing whitespace from every emitted line
  // (see prtfWriter.js's emitWithKeywords), so hand-built expected source
  // in these round-trip tests needs the same trim to compare fairly —
  // trailing padding differences are not a real round-trip mismatch.
  return lines.map((l) => l.replace(/\s+$/, "")).join("\n") + "\n";
}

test("parser: an attached keyword-only line with its own conditioning is added to the PRECEDING field, not turned into a phantom constant", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ name: "CUSTNAME", length: "50", dataType: "A", usage: "O", line: "2", pos: "10" }),
    buildLine({ slot1: "05", kw: "COLOR(BLU)" }),
    buildLine({ slot1: "N05", kw: "COLOR(RED)" }),
  ]);
  const model = parseSource(src);
  const record = model.records[0];
  // Exactly one entry (CUSTNAME) — no phantom constants.
  assert.equal(record.fields.length, 1);
  const custname = record.fields[0] as any;
  assert.equal(custname.kind, "field");
  assert.equal(custname.name, "CUSTNAME");
  assert.equal(custname.keywords.length, 2);
  assert.equal(custname.keywords[0].raw, "COLOR(BLU)");
  assert.deepEqual(custname.keywords[0].conditions, [{ raw: "05", negate: false, indicator: "05" }]);
  assert.equal(custname.keywords[1].raw, "COLOR(RED)");
  assert.deepEqual(custname.keywords[1].conditions, [{ raw: "N05", negate: true, indicator: "05" }]);
});

test("parser: keywords on the field's own header line carry no conditions of their own (undefined, not the field's conditions repeated)", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ slot1: "50", name: "CUSTNAME", length: "50", dataType: "A", usage: "O", line: "2", pos: "10", kw: "DSPATR(HI)" }),
  ]);
  const model = parseSource(src);
  const custname = model.records[0].fields[0] as any;
  assert.equal(custname.conditions.length, 1); // the FIELD is conditioned on 50...
  assert.equal(custname.conditions[0].indicator, "50");
  assert.equal(custname.keywords[0].conditions, undefined); // ...but its inline keyword isn't separately tagged.
});

test("parser: a genuine constant (with its own Location) after a field is still parsed as a constant, not absorbed as an attached keyword line", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ name: "CUSTNAME", length: "50", dataType: "A", usage: "O", line: "2", pos: "10" }),
    buildLine({ line: "3", pos: "10", kw: "'Customer:'" }),
  ]);
  const model = parseSource(src);
  const record = model.records[0];
  assert.equal(record.fields.length, 2);
  assert.equal(record.fields[1].kind, "constant");
  assert.equal((record.fields[1] as any).literal, "Customer:");
});

test("parser: an attached keyword line's own +/- continuation is preserved and tagged with that line's conditions", () => {
  const longParams = "'" + "X".repeat(40) + "'";
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ name: "CUSTNAME", length: "50", dataType: "A", usage: "O", line: "2", pos: "10" }),
    buildLine({ slot1: "05", kw: padR("EDTWRD(" + longParams, 34) + "+" }),
    buildLine({ kw: ")" }),
  ]);
  const model = parseSource(src);
  const custname = model.records[0].fields[0] as any;
  assert.equal(custname.keywords.length, 1);
  assert.equal(custname.keywords[0].name, "EDTWRD");
  assert.deepEqual(custname.keywords[0].conditions, [{ raw: "05", negate: false, indicator: "05" }]);
});

test("round-trip: two independently-conditioned COLOR keywords on the same field reproduce the original source exactly", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ name: "CUSTNAME", length: "50", dataType: "A", usage: "O", line: "2", pos: "10" }),
    buildLine({ slot1: "05", kw: "COLOR(BLU)" }),
    buildLine({ slot1: "N05", kw: "COLOR(RED)" }),
  ]);
  const model = parseSource(src);
  assert.equal(regenerateSource(model), src);
});

test("round-trip: an unconditioned keyword run followed by a conditioned one, on the same field, reproduces exactly", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ name: "CUSTNAME", length: "50", dataType: "A", usage: "O", line: "2", pos: "10", kw: "DSPATR(HI)" }),
    buildLine({ slot1: "05", kw: "COLOR(BLU)" }),
  ]);
  const model = parseSource(src);
  assert.equal(regenerateSource(model), src);
});

test("collectIndicators: an indicator referenced ONLY by an attached keyword's own conditioning is still collected", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ name: "CUSTNAME", length: "50", dataType: "A", usage: "O", line: "2", pos: "10" }),
    buildLine({ slot1: "77", kw: "COLOR(BLU)" }),
  ]);
  const model = parseSource(src);
  assert.deepEqual(collectIndicators(model.records[0]), ["77"]);
});

test("groupKeywordsByConditions: groups consecutive keywords sharing the same conditioning, starting a new group whenever conditions change", () => {
  const a = { name: "A", params: "", raw: "A", sourceLineIndex: 0 };
  const b = { name: "B", params: "", raw: "B", sourceLineIndex: 0, conditions: [{ raw: "05", negate: false, indicator: "05" }] };
  const c = { name: "C", params: "", raw: "C", sourceLineIndex: 0, conditions: [{ raw: "05", negate: false, indicator: "05" }] };
  const d = { name: "D", params: "", raw: "D", sourceLineIndex: 0 };
  const groups = groupKeywordsByConditions([a, b, c, d]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].conditions, undefined);
  assert.deepEqual(groups[0].keywords, [a]);
  assert.ok(groups[1].conditions);
  assert.deepEqual(groups[1].keywords, [b, c]);
  assert.equal(groups[2].conditions, undefined);
  assert.deepEqual(groups[2].keywords, [d]);
});

test("emitEntryWithConditionedKeywords: a conditioned group gets its own line with blank name/position columns but its own conditioning slots", () => {
  const positional = buildPositional({ name: "CUSTNAME", length: 50, dataType: "A", usage: "O", lineNo: 2, position: 10 });
  const keywords = [{ name: "COLOR", params: "(BLU)", raw: "COLOR(BLU)", sourceLineIndex: 0, conditions: [{ raw: "05", negate: false, indicator: "05" }] }];
  const lines = emitEntryWithConditionedKeywords(positional, keywords);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /CUSTNAME/); // header line: field's own name, no keywords on it
  assert.doesNotMatch(lines[0], /COLOR/);
  assert.equal(lines[1].slice(7, 10), " 05"); // conditioning slot 1 (cols 8-10) populated on the second line
  assert.match(lines[1], /COLOR\(BLU\)/);
  // Name/length/type/usage/line/position columns (17-44) blank on the conditioned line.
  assert.equal(lines[1].slice(16, 44).trim(), "");
});

test("layout: toggling the indicator on an attached DATE keyword switches whether it takes effect", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ length: "10", dataType: "A", usage: "O", line: "5", pos: "10" }), // blank constant; DATE attached conditionally below
    buildLine({ slot1: "10", kw: "DATE" }),
  ]);
  const model = parseSource(src);
  const off = resolveLayout(model, "RECORD1", { "10": false });
  const on = resolveLayout(model, "RECORD1", { "10": true });
  const cellOff = off.cells.find((c: any) => c.line === 5);
  const cellOn = on.cells.find((c: any) => c.line === 5);
  assert.equal(cellOff.text, "");
  assert.notEqual(cellOn.text, "");
});

test("layout: an attached SKIPB keyword only moves the cursor when its own indicator is active", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ name: "FIRST", length: "5", dataType: "A", usage: "O", line: "1", pos: "1" }),
    buildLine({ name: "SECOND", length: "5", dataType: "A", usage: "O" }), // no explicit line — falls to cursor
    buildLine({ slot1: "20", kw: "SKIPB(9)" }),
  ]);
  const model = parseSource(src);
  const off = resolveLayout(model, "RECORD1", { "20": false });
  const on = resolveLayout(model, "RECORD1", { "20": true });
  const secondOff = off.cells.find((c: any) => c.name === "SECOND");
  const secondOn = on.cells.find((c: any) => c.name === "SECOND");
  assert.notEqual(secondOff.line, 9);
  assert.equal(secondOn.line, 9);
});

// Batch CC follow-up (docs/TASKS.md) — threading indicatorState through the
// record/file-level geometry keywords resolveLayout resolves once per call
// (PAGSIZE, LINE/BOX, OVERLAY/PAGSEG/AFPRSC, STRPAGGRP/ENDPAGGRP/
// DOCIDXTAG/DTASTMCMD), not just the per-field/constant lookups the
// original Batch CC covered. Same attached-keyword-line mechanism, just
// exercised at the record level, where these keywords actually live.
test("layout: an attached PAGSIZE keyword only takes effect when its own indicator is active", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1", kw: "PAGSIZE(66 132)" }),
    buildLine({ slot1: "30", kw: "PAGSIZE(88 198)" }),
    buildLine({ name: "FIRST", length: "5", dataType: "A", usage: "O", line: "1", pos: "1" }),
  ]);
  const model = parseSource(src);
  const off = resolveLayout(model, "RECORD1", { "30": false });
  const on = resolveLayout(model, "RECORD1", { "30": true });
  assert.equal(off.pageLines, 66);
  assert.equal(off.pageCols, 132);
  assert.equal(on.pageLines, 88);
  assert.equal(on.pageCols, 198);
});

test("layout: an attached LINE keyword's geometry only appears in `draws` when its own indicator is active", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ slot1: "40", kw: "LINE((1 1) (2 5))" }),
    buildLine({ name: "FIRST", length: "5", dataType: "A", usage: "O", line: "1", pos: "1" }),
  ]);
  const model = parseSource(src);
  const off = resolveLayout(model, "RECORD1", { "40": false });
  const on = resolveLayout(model, "RECORD1", { "40": true });
  assert.equal(off.draws.length, 0);
  assert.equal(on.draws.length, 1);
});

test("layout: an attached OVERLAY keyword only appears in `resources` when its own indicator is active", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ slot1: "N50", kw: "OVERLAY(LETTERHD 1 1)" }),
    buildLine({ name: "FIRST", length: "5", dataType: "A", usage: "O", line: "1", pos: "1" }),
  ]);
  const model = parseSource(src);
  const indicatorOn = resolveLayout(model, "RECORD1", { "50": true }); // N50 means active when 50 is OFF
  const indicatorOff = resolveLayout(model, "RECORD1", { "50": false });
  assert.equal(indicatorOn.resources.length, 0);
  assert.equal(indicatorOff.resources.length, 1);
});

test("layout: an attached STRPAGGRP keyword only appears in `pageGroupKeywords` when its own indicator is active", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ slot1: "60", kw: "STRPAGGRP" }),
    buildLine({ name: "FIRST", length: "5", dataType: "A", usage: "O", line: "1", pos: "1" }),
  ]);
  const model = parseSource(src);
  const off = resolveLayout(model, "RECORD1", { "60": false });
  const on = resolveLayout(model, "RECORD1", { "60": true });
  assert.equal(off.pageGroupKeywords.length, 0);
  assert.equal(on.pageGroupKeywords.length, 1);
});

test("layout: an attached CPI keyword's grid only takes effect when its own indicator is active", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ slot1: "15", kw: "CPI(15)" }),
    buildLine({ name: "FIRST", length: "5", dataType: "A", usage: "O", line: "1", pos: "1" }),
  ]);
  const model = parseSource(src);
  const off = resolveLayout(model, "RECORD1", { "15": false });
  const on = resolveLayout(model, "RECORD1", { "15": true });
  assert.equal(off.grid.cpi, 10); // library default when the conditioned CPI(15) isn't active
  assert.equal(on.grid.cpi, 15);
});

test("parser: an attached keyword line immediately after 'R RECORDNAME' (before any field) attaches to the RECORD, not a phantom constant", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1" }),
    buildLine({ slot1: "30", kw: "PAGSIZE(88 198)" }),
    buildLine({ name: "FIRST", length: "5", dataType: "A", usage: "O", line: "1", pos: "1" }),
  ]);
  const model = parseSource(src);
  const record = model.records[0];
  assert.equal(record.fields.length, 1); // FIRST only — no phantom constant
  assert.equal(record.keywords.length, 1);
  assert.equal(record.keywords[0].raw, "PAGSIZE(88 198)");
  assert.deepEqual(record.keywords[0].conditions, [{ raw: "30", negate: false, indicator: "30" }]);
});

test("round-trip: an attached keyword line on the RECORD (before any field) reproduces the original source exactly", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "RECORD1", kw: "PAGSIZE(66 132)" }),
    buildLine({ slot1: "30", kw: "PAGSIZE(88 198)" }),
    buildLine({ name: "FIRST", length: "5", dataType: "A", usage: "O", line: "1", pos: "1" }),
  ]);
  const model = parseSource(src);
  assert.equal(regenerateSource(model), src);
});

test("parser: a file-level keyword line's own conditioning is captured, not silently dropped", () => {
  const src = buildSource([
    buildLine({ slot1: "40", kw: "DUPLEX(*YES)" }),
    buildLine({ type: "R", name: "RECORD1" }),
  ]);
  const model = parseSource(src);
  assert.equal(model.fileLevel.keywords.length, 1);
  assert.deepEqual(model.fileLevel.keywords[0].conditions, [{ raw: "40", negate: false, indicator: "40" }]);
});
