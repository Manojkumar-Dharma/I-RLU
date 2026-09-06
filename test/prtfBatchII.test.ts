// Tests for docs/TASKS.md Batch II — duplicate/clone an entire record
// format (all its fields/constants/keywords) in one action. Exercises
// prtfEdits.applyEditToModel's new "duplicateRecord" edit kind directly,
// same no-vscode-dependency approach test/prtfBatchP.test.ts already uses
// for the sibling addRecord/renameRecord/deleteRecord/reorderRecord kinds.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
import { applyEditToModel, nextAvailableRecordName } from "../src/prtfEdits";
import { ParsedSource, FieldEntry, ConstantEntry } from "../src/prtfModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");

/**
 * Three record formats (HEADER/DETAIL/FOOTER). DETAIL has two fields (one
 * with its own keyword) and a trailing comment after its last field —
 * mirroring test/prtfBatchP.test.ts's own fixture shape, including the
 * trailing-comment placement, so the "trailing comments stay with the
 * SOURCE, not the duplicate" decision has something real to check against.
 */
function buildModel(): ParsedSource {
  const lines = [
    ...emitWithKeywords(buildPositional({}), "PAGSIZE(66 132)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 1 }), ""),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "DETAIL" }), "SKIPB(1)"),
    ...emitWithKeywords(buildPositional({ name: "AMOUNT", length: 9, dataType: "S", decimalPositions: 2, usage: "O", lineNo: 1, position: 1 }), "EDTCDE(J)"),
    ...emitWithKeywords(buildPositional({ lineNo: 1, position: 20 }), "'Total:'"),
    "      * trailing comment after DETAIL's last field",
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "FOOTER" }), ""),
    ...emitWithKeywords(buildPositional({ lineNo: 1, position: 1 }), "'End of report'"),
  ];
  return parseSource(lines.join("\n") + "\n");
}

function recordNames(model: ParsedSource): string[] {
  return model.records.map((r) => r.name);
}

/** Round-trips model through regenerateSource + parseSource. */
function roundTrip(model: ParsedSource): ParsedSource {
  return parseSource(regenerateSource(model));
}

test("duplicateRecord: clones a record's fields/constants/keywords byte-for-byte, only the record's own name changes", () => {
  const model = buildModel();
  const ok = applyEditToModel(model, { kind: "duplicateRecord", name: "DETAIL" });
  assert.equal(ok, true);
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "DETAIL2", "FOOTER"]);

  const source = model.records.find((r) => r.name === "DETAIL")!;
  const clone = model.records.find((r) => r.name === "DETAIL2")!;
  assert.equal(clone.fields.length, source.fields.length);
  assert.deepEqual(
    clone.keywords.map((k) => k.raw),
    source.keywords.map((k) => k.raw)
  );

  for (let i = 0; i < source.fields.length; i++) {
    const s = source.fields[i];
    const c = clone.fields[i];
    assert.equal(c.kind, s.kind);
    if (s.kind === "field") {
      const sf = s as FieldEntry;
      const cf = c as FieldEntry;
      assert.equal(cf.name, sf.name); // field names copied VERBATIM, unlike Batch Q's single-field copy
      assert.equal(cf.length, sf.length);
      assert.equal(cf.dataType, sf.dataType);
      assert.equal(cf.usage, sf.usage);
      assert.equal(cf.line, sf.line);
      assert.equal(cf.position, sf.position);
    } else {
      const sc = s as ConstantEntry;
      const cc = c as ConstantEntry;
      assert.equal(cc.literal, sc.literal);
      assert.equal(cc.line, sc.line);
      assert.equal(cc.position, sc.position);
    }
    assert.deepEqual(
      c.keywords.map((k) => k.raw),
      s.keywords.map((k) => k.raw)
    );
  }
});

test("duplicateRecord: cloned fields get fresh, distinct ids (not sharing the source's own ids)", () => {
  const model = buildModel();
  applyEditToModel(model, { kind: "duplicateRecord", name: "DETAIL" });
  const source = model.records.find((r) => r.name === "DETAIL")!;
  const clone = model.records.find((r) => r.name === "DETAIL2")!;
  const sourceIds = source.fields.map((f) => f.id);
  const cloneIds = clone.fields.map((f) => f.id);
  for (const id of cloneIds) {
    assert.ok(!sourceIds.includes(id), `cloned field id ${id} must not collide with a source field id`);
  }
  // Distinct from each other too.
  assert.equal(new Set(cloneIds).size, cloneIds.length);
});

test("duplicateRecord: editing the clone's own keywords afterward doesn't mutate the source's (deep-cloned, not shared by reference)", () => {
  const model = buildModel();
  applyEditToModel(model, { kind: "duplicateRecord", name: "DETAIL" });
  const source = model.records.find((r) => r.name === "DETAIL")!;
  const clone = model.records.find((r) => r.name === "DETAIL2")!;
  const cloneAmount = clone.fields.find((f) => f.kind === "field" && (f as FieldEntry).name === "AMOUNT")! as FieldEntry;
  cloneAmount.keywords[0].params = "(Z)"; // mutate the clone's own EDTCDE
  const sourceAmount = source.fields.find((f) => f.kind === "field" && (f as FieldEntry).name === "AMOUNT")! as FieldEntry;
  assert.equal(sourceAmount.keywords[0].params, "(J)", "the source's own keyword must be unaffected by mutating the clone's");
});

test("duplicateRecord: inserted right after the source record, and the source's trailing comment stays with the source, not the duplicate", () => {
  const model = buildModel();
  applyEditToModel(model, { kind: "duplicateRecord", name: "DETAIL" });
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "DETAIL2", "FOOTER"]);

  const reparsed = roundTrip(model);
  assert.deepEqual(recordNames(reparsed), ["HEADER", "DETAIL", "DETAIL2", "FOOTER"]);
  const regenerated = regenerateSource(model);
  const lines = regenerated.split("\n");
  // The trailing comment line appears exactly once, and BEFORE the
  // DETAIL2 record line — i.e. it stayed attached to the original DETAIL
  // block rather than being duplicated or swept into the new block.
  const commentIdx = lines.findIndex((l: string) => l.includes("trailing comment after DETAIL's last field"));
  const detail2Idx = lines.findIndex((l: string) => l.includes("DETAIL2"));
  assert.ok(commentIdx !== -1, "expected the trailing comment to survive regeneration");
  assert.ok(detail2Idx !== -1, "expected the DETAIL2 record line to exist");
  assert.ok(commentIdx < detail2Idx, "the trailing comment must stay attached to the source DETAIL block, before the duplicate");
  assert.equal(lines.filter((l: string) => l.includes("trailing comment after DETAIL's last field")).length, 1, "the comment must not be duplicated");
});

test("duplicateRecord: naming collision — duplicating the same record twice in a row picks DETAIL2 then DETAIL3 (each lands right after the SOURCE record, per addRecord's own placement convention)", () => {
  const model = buildModel();
  applyEditToModel(model, { kind: "duplicateRecord", name: "DETAIL" });
  applyEditToModel(model, { kind: "duplicateRecord", name: "DETAIL" });
  // Each duplicate is inserted immediately after the SOURCE record (DETAIL
  // itself), the same placement convention this batch's own addRecord
  // sibling uses — so the second duplicate (DETAIL3) lands ahead of the
  // first (DETAIL2), not appended after it.
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "DETAIL3", "DETAIL2", "FOOTER"]);
});

test("duplicateRecord: rejects an unknown record name (no-op, model unchanged)", () => {
  const model = buildModel();
  const before = recordNames(model);
  const ok = applyEditToModel(model, { kind: "duplicateRecord", name: "NOSUCHRECORD" });
  assert.equal(ok, false);
  assert.deepEqual(recordNames(model), before);
});

test("duplicateRecord: duplicating a record with no fields/constants at all still succeeds with an empty clone", () => {
  const model = buildModel();
  applyEditToModel(model, { kind: "addRecord", name: "EMPTYREC", afterRecordName: "FOOTER" });
  const ok = applyEditToModel(model, { kind: "duplicateRecord", name: "EMPTYREC" });
  assert.equal(ok, true);
  const clone = model.records.find((r) => r.name === "EMPTYREC2")!;
  assert.equal(clone.fields.length, 0);
  const reparsed = roundTrip(model);
  assert.ok(reparsed.records.find((r) => r.name === "EMPTYREC2"));
});

// --- nextAvailableRecordName -----------------------------------------------

test("nextAvailableRecordName: an already-free base name wins outright (no forced numeric suffix)", () => {
  const model = buildModel();
  assert.equal(nextAvailableRecordName(model, "SUBTOTAL"), "SUBTOTAL");
});

test("nextAvailableRecordName: appends the lowest available numeric suffix on collision", () => {
  const model = buildModel();
  assert.equal(nextAvailableRecordName(model, "DETAIL"), "DETAIL2");
});

test("nextAvailableRecordName: truncates to fit the 10-character record-name limit", () => {
  const model = buildModel();
  applyEditToModel(model, { kind: "addRecord", name: "LONGRECNAM" }); // exactly 10 chars, now used
  const suggested = nextAvailableRecordName(model, "LONGRECNAM");
  assert.ok(suggested.length <= 10, `expected suggested name to fit 10 chars, got ${JSON.stringify(suggested)}`);
  assert.equal(suggested, "LONGRECNA2");
});
