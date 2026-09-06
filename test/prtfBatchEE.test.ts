// Tests for docs/TASKS.md Batch EE — resolving COLOR/HIGHLIGHT/UNDERLINE
// into a renderable per-cell style (prtfLayout.js's resolveStyle/
// resolveColorStyle), the same "resolve here, apply in
// media/webviewClient.js's renderPage" split resolveFont/resolveFontDisplay
// already established for FONT (see docs/TASKS.md Batch L continued).
//
// DSPATR is deliberately untested here — verified against IBM's DDS
// reference for printer files (the full "the following keywords are valid
// for printer files" enumeration) and confirmed NOT a valid printer-file
// keyword at all (display-file only), the same kind of scope correction
// Batch Z made for USER/SYSNAME. docs/TASKS.md's own Batch EE entry
// assumed DSPATR was in scope; dropped, documented in TASKS.md's own Batch
// EE detail section.
//
// Follows the same fixture-reuse pattern as test/prtfBatchA.test.ts:
// mutate sample1.pf's already-parsed model in memory and resolve layout
// directly (no writer/reparse round-trip needed — this batch is pure
// resolve+render, no model/parser/writer change).
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

const fixturePath = path.join(__dirname, "fixtures", "sample1.pf");

function withRecordKeyword(model: any, recordName: string, keyword: { name: string; params: string; raw: string }) {
  const record = model.records.find((r: any) => r.name === recordName);
  record.keywords.push({ ...keyword, sourceLineIndex: -1 });
  return model;
}

function withFieldKeyword(model: any, recordName: string, fieldName: string, keyword: { name: string; params: string; raw: string }) {
  const record = model.records.find((r: any) => r.name === recordName);
  const field = record.fields.find((f: any) => f.kind === "field" && f.name === fieldName);
  field.keywords.push({ ...keyword, sourceLineIndex: -1 });
  return model;
}

function cellFor(layout: any, name: string) {
  return layout.cells.find((c: any) => c.name === name);
}

test("Batch EE: COLOR named color resolves to an exact CSS color, not approximate", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  model = withFieldKeyword(model, "HEADER", "CUSTNAME", { name: "COLOR", params: "(*BLU)", raw: "COLOR(*BLU)" });
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});
  const cell = cellFor(layout, "CUSTNAME");
  assert.equal(cell.style.color.model, "Named");
  assert.equal(cell.style.color.approximate, false);
  assert.ok(cell.style.color.css, "named color should resolve to a real CSS value");
});

test("Batch EE: COLOR(*RGB r g b) resolves to an exact rgb() CSS color, not approximate", () => {
  // *RGB's three-literal-integer form is the one Batch A's own comment
  // confirms against this project's own sample-afpds.pf fixture — unlike
  // *CMYK/*CIELAB, this should NOT come back approximate (see
  // resolveColorStyle's own comment on the docs/TASKS.md Batch EE entry's
  // overstatement of this).
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  model = withFieldKeyword(model, "HEADER", "CUSTNAME", { name: "COLOR", params: "(*RGB 10 20 30)", raw: "COLOR(*RGB 10 20 30)" });
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});
  const cell = cellFor(layout, "CUSTNAME");
  assert.equal(cell.style.color.approximate, false);
  assert.equal(cell.style.color.css, "rgb(10, 20, 30)");
});

test("Batch EE: COLOR(*CMYK ...) / COLOR(*CIELAB ...) stay approximate with no guessed CSS value", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  model = withFieldKeyword(model, "HEADER", "CUSTNAME", { name: "COLOR", params: "(*CMYK 0 0 0 100)", raw: "COLOR(*CMYK 0 0 0 100)" });
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});
  const cell = cellFor(layout, "CUSTNAME");
  assert.equal(cell.style.color.approximate, true);
  assert.equal(cell.style.color.css, undefined);
});

test("Batch EE: no COLOR keyword on the entry leaves style.color undefined", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});
  const cell = cellFor(layout, "CUSTNAME");
  assert.equal(cell.style.color, undefined);
});

test("Batch EE: field-level UNDERLINE resolves style.underline = true", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  model = withFieldKeyword(model, "HEADER", "CUSTNAME", { name: "UNDERLINE", params: "", raw: "UNDERLINE" });
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});
  const cell = cellFor(layout, "CUSTNAME");
  assert.equal(cell.style.underline, true);
  // A sibling field with no UNDERLINE of its own must stay false — UNDERLINE
  // is field-level-only per IBM's DDS reference, so it must NOT leak onto
  // other fields in the same record the way a record-level keyword would.
  const sibling = cellFor(layout, "INVDATE");
  assert.equal(sibling.style.underline, false);
});

test("Batch EE: field-level HIGHLIGHT alone resolves style.highlight = true", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  model = withFieldKeyword(model, "HEADER", "CUSTNAME", { name: "HIGHLIGHT", params: "", raw: "HIGHLIGHT" });
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});
  const cell = cellFor(layout, "CUSTNAME");
  assert.equal(cell.style.highlight, true);
});

test("Batch EE: record-level HIGHLIGHT applies to every field in the record (OR semantics, not override)", () => {
  // Verified against IBM's DDS reference for HIGHLIGHT: "If you specify
  // HIGHLIGHT at the record level, the keyword applies to all fields in
  // that record. Thus, if both the record- and field-level HIGHLIGHT
  // keywords are specified and either indicator condition is met, the
  // HIGHLIGHT keyword is used." — every field should come back highlighted
  // even though none of them carry their own field-level HIGHLIGHT.
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  model = withRecordKeyword(model, "HEADER", { name: "HIGHLIGHT", params: "", raw: "HIGHLIGHT" });
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});
  const custname = cellFor(layout, "CUSTNAME");
  const invdate = cellFor(layout, "INVDATE");
  assert.equal(custname.style.highlight, true);
  assert.equal(invdate.style.highlight, true);
});

test("Batch EE: no HIGHLIGHT at either level resolves style.highlight = false", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});
  const cell = cellFor(layout, "CUSTNAME");
  assert.equal(cell.style.highlight, false);
});

test("Batch EE: HIGHLIGHT/COLOR/UNDERLINE keywords are only recognized when their governing indicator is active (per-keyword conditioning, Batch CC/DD)", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const custname: any = model.records.find((r: any) => r.name === "HEADER")!.fields.find((f: any) => f.kind === "field" && f.name === "CUSTNAME");
  custname.keywords.push({
    name: "COLOR",
    params: "(*RED)",
    raw: "COLOR(*RED)",
    sourceLineIndex: -1,
    conditions: [{ raw: "05", negate: false, indicator: "05" }],
  });
  const offLayout = PrtfEngine.resolveLayout(model, "HEADER", { "05": false });
  const onLayout = PrtfEngine.resolveLayout(model, "HEADER", { "05": true });
  assert.equal(cellFor(offLayout, "CUSTNAME").style.color, undefined);
  assert.equal(cellFor(onLayout, "CUSTNAME").style.color.model, "Named");
});

test("Batch EE: DSPATR is not treated as a valid printer-file keyword — resolveStyle ignores it entirely", () => {
  // Confirms the scope correction: even if a raw DSPATR keyword somehow
  // ends up in an entry's keywords (e.g. hand-edited source, or a future
  // parser change), resolveStyle has no DSPATR handling at all, so it has
  // no effect on style.color/highlight/underline.
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  model = withFieldKeyword(model, "HEADER", "CUSTNAME", { name: "DSPATR", params: "(HI)", raw: "DSPATR(HI)" });
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});
  const cell = cellFor(layout, "CUSTNAME");
  assert.equal(cell.style.highlight, false);
  assert.equal(cell.style.underline, false);
  assert.equal(cell.style.color, undefined);
});
