// Tests for docs/TASKS.md Batch GG — field/constant overlap detection
// (prtfLayout.js's detectFieldOverlaps, wired into resolveLayout's
// returned `overlaps`).
//
// Scope note (see detectFieldOverlaps' own comment for the full
// reasoning): unlike I-SDA's dspfEngine.js resolveScreen, which DROPS a
// losing field from the resolved display-file render, this is warn-only —
// confirmed against IBM's own DDS reference for printer files ("If fields
// overlap, the printer overprints"), so every field/constant already in
// resolveLayout's `cells` stays there; `overlaps` is purely an additional
// side-channel for a UI warning banner.
//
// Follows the same fixture-reuse pattern as test/prtfBatchEE.test.ts:
// mutate sample1.pf's already-parsed model in memory and resolve layout
// directly.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfLayout = require("../src/prtfLayout.js");

const fixturePath = path.join(__dirname, "fixtures", "sample1.pf");

function setFieldPosition(model: any, recordName: string, fieldName: string, line: number, position: number) {
  const record = model.records.find((r: any) => r.name === recordName)!;
  const field = record.fields.find((f: any) => (f.kind === "field" ? f.name === fieldName : false))!;
  field.line = line;
  field.position = position;
  return model;
}

test("Batch GG: no overlap reported when fields occupy disjoint ranges", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});
  // sample1.pf's HEADER has CUSTNAME (line 1, pos 10, len 30 -> 10-39) and
  // CUSTNBR (line 1, pos 50, len 7 -> 50-56, conditioned on indicator 50,
  // inactive here) — neither overlaps the other regardless.
  assert.deepEqual(layout.overlaps, []);
});

test("Batch GG: two fields on the same line/position range are reported as overlapping", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  // Move INVDATE (line 5, pos 25, len 8 -> 25-32) to overlap CUSTNAME
  // (line 1, pos 10, len 30 -> 10-39) by relocating it onto line 1, pos 20.
  model = setFieldPosition(model, "HEADER", "INVDATE", 1, 20);
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});

  assert.equal(layout.overlaps.length, 1);
  assert.equal(layout.overlaps[0].field, "INVDATE");
  assert.equal(layout.overlaps[0].blockedBy, "CUSTNAME");
  assert.equal(layout.overlaps[0].line, 1);
  assert.equal(layout.overlaps[0].position, 20);

  // Warn-only: the overlapping field is NOT dropped from cells — a real
  // printer would overprint, not silently omit it.
  const invdateCell = layout.cells.find((c: any) => c.name === "INVDATE");
  assert.ok(invdateCell, "INVDATE must still be present in resolved cells");
});

test("Batch GG: overlap is reported against a constant, using its literal text as the label", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  // FOOTER: constant 'Page' (line 1, pos 5, len 4 -> 5-8) then PAGNBR
  // constant (line 1, pos 12). Move PAGNBR onto pos 6 to force overlap.
  const record = model.records.find((r: any) => r.name === "FOOTER")!;
  const pagnbrConstant = record.fields.find((f: any) => f.kind === "constant" && (f.keywords || []).some((k: any) => k.name === "PAGNBR"))!;
  pagnbrConstant.position = 6;
  const layout = PrtfEngine.resolveLayout(model, "FOOTER", {});

  assert.equal(layout.overlaps.length, 1);
  assert.equal(layout.overlaps[0].blockedBy, "Page");
});

test("Batch GG: a field hidden by the current indicator toggle state is excluded from overlap checks", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  // CUSTNBR is conditioned on indicator 50 and inactive by default, so
  // relocating it on top of CUSTNAME should report nothing while
  // indicator 50 stays off...
  model = setFieldPosition(model, "HEADER", "CUSTNBR", 1, 15);
  const layoutOff = PrtfEngine.resolveLayout(model, "HEADER", {});
  assert.deepEqual(layoutOff.overlaps, []);

  // ...but reports the overlap once indicator 50 is toggled on, matching
  // how every other indicator-conditioned resolution in this project
  // already works off the current toggle state rather than every
  // combination at once (see detectFieldOverlaps' own scope-boundary
  // comment).
  const layoutOn = PrtfEngine.resolveLayout(model, "HEADER", { 50: true });
  assert.equal(layoutOn.overlaps.length, 1);
  assert.equal(layoutOn.overlaps[0].field, "CUSTNBR");
  assert.equal(layoutOn.overlaps[0].blockedBy, "CUSTNAME");
});

test("Batch GG: detectFieldOverlaps unit — first cell in (line, position) order wins, later overlapping cells are chained", () => {
  const cells = [
    { kind: "field", name: "A", line: 1, position: 10, length: 10 }, // 10-19
    { kind: "field", name: "B", line: 1, position: 15, length: 10 }, // 15-24, overlaps A
    { kind: "field", name: "C", line: 1, position: 30, length: 5 }, // 25-... no overlap
  ];
  const overlaps = PrtfLayout.detectFieldOverlaps(cells);
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].field, "B");
  assert.equal(overlaps[0].blockedBy, "A");
});

test("Batch GG: detectFieldOverlaps unit — fields on different lines never overlap", () => {
  const cells = [
    { kind: "field", name: "A", line: 1, position: 10, length: 10 },
    { kind: "field", name: "B", line: 2, position: 10, length: 10 },
  ];
  assert.deepEqual(PrtfLayout.detectFieldOverlaps(cells), []);
});
