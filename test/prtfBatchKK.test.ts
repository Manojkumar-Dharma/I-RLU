// Tests for docs/TASKS.md Batch KK — boundary shift-and-truncate.
//
// Real RLU's `LT(N)`/`RT(N)` sequence commands (per IBM's own AS/400
// "Report Layout Guide"): "Type RT(N) to shift and truncate data on the
// Right Side if crossing the Boundaries" / "Type LT(N) to shift and
// truncate data on the Left side if crossing the Boundaries." I-RLU has
// no sequence-command area, so this applies the same underlying
// principle to the move/resize/add paths I-RLU actually has (see
// src/prtfEdits.ts's clampToReportWidth/clampConstantToReportWidth for
// the full reasoning).
//
// Follows the same fixture-reuse pattern as test/prtfBatchGG.test.ts:
// parses sample1.pf (PAGSIZE 66 132, so pageCols = 132 throughout) and
// exercises applyEditToModel directly.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSource } from "../src/prtfParser";
import { applyEditToModel, findEntryById, clampToReportWidth, clampConstantToReportWidth, reportWidthCols } from "../src/prtfEdits";
import { ParsedSource, FieldEntry, ConstantEntry } from "../src/prtfModel";

const fixturePath = path.join(__dirname, "fixtures", "sample1.pf");

function loadModel(): ParsedSource {
  return parseSource(fs.readFileSync(fixturePath, "utf8"));
}

function fieldId(model: ParsedSource, recordName: string, fieldName: string): string {
  const record = model.records.find((r) => r.name === recordName)!;
  const field = record.fields.find((f) => f.kind === "field" && (f as FieldEntry).name === fieldName)! as FieldEntry;
  return field.id;
}

function constantId(model: ParsedSource, recordName: string, literalSubstring: string): string {
  const record = model.records.find((r) => r.name === recordName)!;
  const constant = record.fields.find((f) => f.kind === "constant" && (f as ConstantEntry).literal && (f as ConstantEntry).literal!.includes(literalSubstring))! as ConstantEntry;
  return constant.id;
}

// --- reportWidthCols --------------------------------------------------

test("reportWidthCols: reads the record/file-level PAGSIZE's column width (sample1.pf is PAGSIZE(66 132))", () => {
  const model = loadModel();
  const record = model.records.find((r) => r.name === "HEADER")!;
  assert.equal(reportWidthCols(model, record), 132);
});

// --- clampToReportWidth (pure unit tests) ------------------------------

test("clampToReportWidth: within bounds, position and length pass through unchanged", () => {
  assert.deepEqual(clampToReportWidth(10, 30, 132), { position: 10, length: 30 });
});

test("clampToReportWidth: a field extending past the right edge has its LENGTH truncated, position kept as requested", () => {
  // position 110, length 30 -> would end at 139, past 132.
  assert.deepEqual(clampToReportWidth(110, 30, 132), { position: 110, length: 23 });
});

test("clampToReportWidth: position below 1 (e.g. a malformed/synthetic edit bypassing the client's own clamp) is pulled up to 1", () => {
  assert.deepEqual(clampToReportWidth(0, 10, 132), { position: 1, length: 10 });
  assert.deepEqual(clampToReportWidth(-5, 10, 132), { position: 1, length: 10 });
});

test("clampToReportWidth: degenerate case — position itself already past the boundary — clamps position to pageCols and length to 1", () => {
  assert.deepEqual(clampToReportWidth(200, 30, 132), { position: 132, length: 1 });
});

test("clampToReportWidth: an undefined length defaults to 1 rather than throwing", () => {
  assert.deepEqual(clampToReportWidth(10, undefined, 132), { position: 10, length: 1 });
});

test("clampToReportWidth: a field ending EXACTLY on the last column is not truncated", () => {
  // position 103, length 30 -> ends at 132 exactly.
  assert.deepEqual(clampToReportWidth(103, 30, 132), { position: 103, length: 30 });
});

// --- clampConstantToReportWidth (pure unit tests) ----------------------

test("clampConstantToReportWidth: a literal within bounds is unchanged", () => {
  assert.deepEqual(clampConstantToReportWidth(10, "Invoice Date:", 132), { position: 10, literal: "Invoice Date:" });
});

test("clampConstantToReportWidth: a literal crossing the right edge is truncated at the END of the string", () => {
  // "Invoice Date:" is 13 chars; position 125 -> only 8 columns (125-132) fit.
  assert.deepEqual(clampConstantToReportWidth(125, "Invoice Date:", 132), { position: 125, literal: "Invoice " });
});

test("clampConstantToReportWidth: an undefined literal (system-constant field, e.g. DATE/TIME/PAGNBR) passes through untouched", () => {
  assert.deepEqual(clampConstantToReportWidth(125, undefined, 132), { position: 125, literal: undefined });
});

test("clampConstantToReportWidth: an empty-string literal passes through untouched (nothing to truncate)", () => {
  assert.deepEqual(clampConstantToReportWidth(125, "", 132), { position: 125, literal: "" });
});

// --- applyEditToModel: "move" ------------------------------------------

test("KK move: moving a field within bounds doesn't touch its length", () => {
  const model = loadModel();
  const id = fieldId(model, "HEADER", "CUSTNAME"); // length 30
  const ok = applyEditToModel(model, { kind: "move", id, line: 1, position: 20 });
  assert.equal(ok, true);
  const found = findEntryById(model, id)!;
  assert.equal((found.entry as FieldEntry).position, 20);
  assert.equal((found.entry as FieldEntry).length, 30);
});

test("KK move: dragging a field so it would cross the right edge truncates its length instead of overflowing silently", () => {
  const model = loadModel();
  const id = fieldId(model, "HEADER", "CUSTNAME"); // length 30, pageCols 132
  const ok = applyEditToModel(model, { kind: "move", id, line: 1, position: 110 });
  assert.equal(ok, true);
  const found = findEntryById(model, id)!;
  assert.equal((found.entry as FieldEntry).position, 110);
  assert.equal((found.entry as FieldEntry).length, 23); // 132 - 110 + 1
});

test("KK move: dragging a constant past the right edge truncates its literal text", () => {
  const model = loadModel();
  const id = constantId(model, "HEADER", "Invoice Date:");
  const ok = applyEditToModel(model, { kind: "move", id, line: 5, position: 125 });
  assert.equal(ok, true);
  const found = findEntryById(model, id)!;
  assert.equal((found.entry as ConstantEntry).position, 125);
  assert.equal((found.entry as ConstantEntry).literal, "Invoice ");
});

test("KK move: a malformed move with position 0 is defensively clamped to column 1 (the client's own drag math already prevents this, but applyEditToModel doesn't only trust the client)", () => {
  const model = loadModel();
  const id = fieldId(model, "HEADER", "CUSTNAME");
  const ok = applyEditToModel(model, { kind: "move", id, line: 1, position: 0 });
  assert.equal(ok, true);
  const found = findEntryById(model, id)!;
  assert.equal((found.entry as FieldEntry).position, 1);
});

// --- applyEditToModel: "updateField" (resize) ---------------------------

test("KK updateField: resizing (growing) a field so it would cross the right edge truncates the requested length", () => {
  const model = loadModel();
  const id = fieldId(model, "HEADER", "CUSTNAME"); // currently position 10
  const ok = applyEditToModel(model, {
    kind: "updateField",
    id,
    name: "CUSTNAME",
    length: 200, // grossly oversized on purpose
    dataType: "A",
    decimalPositions: undefined,
    usage: "B",
    line: 1,
    position: 10,
  });
  assert.equal(ok, true);
  const found = findEntryById(model, id)!;
  assert.equal((found.entry as FieldEntry).position, 10);
  assert.equal((found.entry as FieldEntry).length, 123); // 132 - 10 + 1
});

test("KK updateField: resizing within bounds is unaffected", () => {
  const model = loadModel();
  const id = fieldId(model, "HEADER", "CUSTNAME");
  const ok = applyEditToModel(model, {
    kind: "updateField",
    id,
    name: "CUSTNAME",
    length: 40,
    dataType: "A",
    decimalPositions: undefined,
    usage: "B",
    line: 1,
    position: 10,
  });
  assert.equal(ok, true);
  const found = findEntryById(model, id)!;
  assert.equal((found.entry as FieldEntry).length, 40);
});

// --- applyEditToModel: "updateConstant" ---------------------------------

test("KK updateConstant: editing a constant's position past the right edge truncates its literal", () => {
  const model = loadModel();
  const id = constantId(model, "HEADER", "Invoice Date:");
  const ok = applyEditToModel(model, { kind: "updateConstant", id, literal: "Invoice Date:", line: 5, position: 128 });
  assert.equal(ok, true);
  const found = findEntryById(model, id)!;
  assert.equal((found.entry as ConstantEntry).literal, "Invoi"); // 132 - 128 + 1 = 5 chars
});

test("KK updateConstant: an empty Text field still means 'no literal' (Batch Z behavior unaffected by this batch's clamp)", () => {
  const model = loadModel();
  const id = constantId(model, "HEADER", "Invoice Date:");
  const ok = applyEditToModel(model, { kind: "updateConstant", id, literal: "", line: 5, position: 10 });
  assert.equal(ok, true);
  const found = findEntryById(model, id)!;
  assert.equal((found.entry as ConstantEntry).literal, undefined);
});

// --- applyEditToModel: "addField" / "addConstant" -----------------------

test("KK addField: placing a new field near the right edge truncates its length to fit", () => {
  const model = loadModel();
  const ok = applyEditToModel(model, {
    kind: "addField",
    recordName: "HEADER",
    line: 6,
    position: 130,
    name: "NEWFLD",
    length: 10,
    dataType: "A",
    usage: "O",
  });
  assert.equal(ok, true);
  const record = model.records.find((r) => r.name === "HEADER")!;
  const added = record.fields.find((f) => f.kind === "field" && (f as FieldEntry).name === "NEWFLD")! as FieldEntry;
  assert.equal(added.position, 130);
  assert.equal(added.length, 3); // 132 - 130 + 1
});

test("KK addConstant: placing a new constant near the right edge truncates its literal to fit", () => {
  const model = loadModel();
  const ok = applyEditToModel(model, {
    kind: "addConstant",
    recordName: "HEADER",
    line: 6,
    position: 125,
    literal: "This text is way too long to fit",
  });
  assert.equal(ok, true);
  const record = model.records.find((r) => r.name === "HEADER")!;
  const added = record.fields.find(
    (f) => f.kind === "constant" && (f as ConstantEntry).literal && (f as ConstantEntry).literal!.startsWith("This")
  )! as ConstantEntry;
  assert.equal(added.position, 125);
  assert.equal(added.literal, "This tex"); // 132 - 125 + 1 = 8 chars
});

test("KK addField: placing a field well within bounds is unaffected", () => {
  const model = loadModel();
  const ok = applyEditToModel(model, {
    kind: "addField",
    recordName: "HEADER",
    line: 6,
    position: 60,
    name: "NEWFLD2",
    length: 15,
    dataType: "A",
    usage: "O",
  });
  assert.equal(ok, true);
  const record = model.records.find((r) => r.name === "HEADER")!;
  const added = record.fields.find((f) => f.kind === "field" && (f as FieldEntry).name === "NEWFLD2")! as FieldEntry;
  assert.equal(added.position, 60);
  assert.equal(added.length, 15);
});
