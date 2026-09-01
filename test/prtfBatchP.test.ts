// Tests for docs/TASKS.md Batch P — add/rename/delete/reorder record
// formats from the designer. Exercises prtfEdits.applyEditToModel's four
// new edit kinds (addRecord/renameRecord/deleteRecord/reorderRecord)
// directly, the same no-vscode-dependency approach test/prtfEdits.test.ts
// already uses, plus PrtfEngine.validatePageGroupOrder (the STRPAGGRP/
// ENDPAGGRP cross-record ordering check this batch added specifically
// because reordering is the most direct way to break that pairing).
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
import { applyEditToModel } from "../src/prtfEdits";
import { ParsedSource, RecordFormatEntry } from "../src/prtfModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

/**
 * Three record formats (HEADER/DETAIL/FOOTER), each with one field or
 * constant, plus a trailing comment line between DETAIL and FOOTER — that
 * comment exists specifically to exercise reorderRecord's documented
 * "trailing comments move with the earlier record" decision.
 */
function buildModel(): ParsedSource {
  const lines = [
    ...emitWithKeywords(buildPositional({}), "PAGSIZE(66 132)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 1 }), ""),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "DETAIL" }), ""),
    ...emitWithKeywords(buildPositional({ name: "AMOUNT", length: 9, dataType: "S", decimalPositions: 2, usage: "O", lineNo: 1, position: 1 }), ""),
    "      * trailing comment after DETAIL's last field",
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "FOOTER" }), ""),
    ...emitWithKeywords(buildPositional({ lineNo: 1, position: 1 }), "'Total:'"),
  ];
  return parseSource(lines.join("\n") + "\n");
}

function recordNames(model: ParsedSource): string[] {
  return model.records.map((r) => r.name);
}

/** Round-trips model through regenerateSource + parseSource, same helper shape test/prtfEdits.test.ts uses. */
function roundTrip(model: ParsedSource): ParsedSource {
  return parseSource(regenerateSource(model));
}

// --- addRecord ------------------------------------------------------------

test("addRecord: inserted immediately after afterRecordName, not always at the end", () => {
  const model = buildModel();
  const ok = applyEditToModel(model, { kind: "addRecord", name: "SUBTOTAL", afterRecordName: "DETAIL" });
  assert.equal(ok, true);
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "SUBTOTAL", "FOOTER"]);
  const reparsed = roundTrip(model);
  assert.deepEqual(recordNames(reparsed), ["HEADER", "DETAIL", "SUBTOTAL", "FOOTER"]);
  const subtotal = reparsed.records.find((r) => r.name === "SUBTOTAL")!;
  assert.equal(subtotal.fields.length, 0);
});

test("addRecord: falls back to appending at the end when afterRecordName is omitted", () => {
  const model = buildModel();
  applyEditToModel(model, { kind: "addRecord", name: "GRANDTOTAL" });
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "FOOTER", "GRANDTOTAL"]);
});

test("addRecord: falls back to appending at the end when afterRecordName doesn't match any existing record", () => {
  const model = buildModel();
  applyEditToModel(model, { kind: "addRecord", name: "GRANDTOTAL", afterRecordName: "NOSUCHRECORD" });
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "FOOTER", "GRANDTOTAL"]);
});

test("addRecord: rejects a duplicate name (no-op, model unchanged)", () => {
  const model = buildModel();
  const ok = applyEditToModel(model, { kind: "addRecord", name: "DETAIL" });
  assert.equal(ok, false);
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "FOOTER"]);
});

test("addRecord: rejects an empty/whitespace-only name", () => {
  const model = buildModel();
  assert.equal(applyEditToModel(model, { kind: "addRecord", name: "" }), false);
  assert.equal(applyEditToModel(model, { kind: "addRecord", name: "   " }), false);
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "FOOTER"]);
});

// --- renameRecord -----------------------------------------------------

test("renameRecord: renames the record and round-trips with the new name in the source", () => {
  const model = buildModel();
  const ok = applyEditToModel(model, { kind: "renameRecord", oldName: "HEADER", newName: "HDR2" });
  assert.equal(ok, true);
  assert.deepEqual(recordNames(model), ["HDR2", "DETAIL", "FOOTER"]);
  const reparsed = roundTrip(model);
  assert.deepEqual(recordNames(reparsed), ["HDR2", "DETAIL", "FOOTER"]);
  // The renamed record's own field survived the rename untouched.
  const hdr2 = reparsed.records.find((r) => r.name === "HDR2")!;
  assert.equal(hdr2.fields.length, 1);
});

test("renameRecord: rejects renaming to a name another record already uses", () => {
  const model = buildModel();
  const ok = applyEditToModel(model, { kind: "renameRecord", oldName: "HEADER", newName: "DETAIL" });
  assert.equal(ok, false);
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "FOOTER"]);
});

test("renameRecord: renaming a record to its own current name is a no-op success, not a false 'duplicate'", () => {
  const model = buildModel();
  const ok = applyEditToModel(model, { kind: "renameRecord", oldName: "HEADER", newName: "HEADER" });
  assert.equal(ok, true);
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "FOOTER"]);
});

test("renameRecord: rejects an unknown oldName", () => {
  const model = buildModel();
  assert.equal(applyEditToModel(model, { kind: "renameRecord", oldName: "NOSUCHRECORD", newName: "X" }), false);
});

test("renameRecord: rejects an empty newName", () => {
  const model = buildModel();
  assert.equal(applyEditToModel(model, { kind: "renameRecord", oldName: "HEADER", newName: "" }), false);
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "FOOTER"]);
});

test("renameRecord: REF/REFFLD elsewhere in the model are unaffected by a record rename, since neither ever names a record format within the same source", () => {
  // Regression guard for docs/TASKS.md Batch P's own investigation: REFFLD's
  // parameters are always [field-name, *SRC-or-external-file] — *SRC
  // searches the whole file being defined BY FIELD NAME, never scoped to a
  // particular record format name. So renaming HEADER must not change how
  // a REFFLD(...*SRC) field elsewhere resolves.
  const lines = [
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 1 }), ""),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "DETAIL" }), ""),
    ...emitWithKeywords(buildPositional({ name: "CUSTNAME2", reference: true, lineNo: 1, position: 1 }), "REFFLD(CUSTNAME *SRC)"),
  ];
  const model = parseSource(lines.join("\n") + "\n");
  const detail = model.records.find((r) => r.name === "DETAIL")!;
  const custname2 = detail.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNAME2")! as any;

  const beforeTarget = PrtfEngine.resolveReferenceTarget(model, detail, custname2);
  assert.equal(beforeTarget, null); // *SRC has no live file to query — resolves to null both before and after

  applyEditToModel(model, { kind: "renameRecord", oldName: "HEADER", newName: "HDR2" });
  const afterTarget = PrtfEngine.resolveReferenceTarget(model, detail, custname2);
  assert.equal(afterTarget, null); // unchanged by the rename — confirms no dependency on record names
});

// --- deleteRecord -----------------------------------------------------

test("deleteRecord: removes the record and its fields entirely, round-trips cleanly", () => {
  const model = buildModel();
  const ok = applyEditToModel(model, { kind: "deleteRecord", name: "DETAIL" });
  assert.equal(ok, true);
  assert.deepEqual(recordNames(model), ["HEADER", "FOOTER"]);
  const reparsed = roundTrip(model);
  assert.deepEqual(recordNames(reparsed), ["HEADER", "FOOTER"]);
  // HEADER and FOOTER's own fields are untouched by DETAIL's removal.
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  const footer = reparsed.records.find((r) => r.name === "FOOTER")!;
  assert.equal(header.fields.length, 1);
  assert.equal(footer.fields.length, 1);
  // AMOUNT (DETAIL's own field) must not survive anywhere else.
  assert.ok(!reparsed.sequence.some((e: any) => e.kind === "field" && e.name === "AMOUNT"));
});

test("deleteRecord: rejects an unknown name (no-op)", () => {
  const model = buildModel();
  assert.equal(applyEditToModel(model, { kind: "deleteRecord", name: "NOSUCHRECORD" }), false);
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "FOOTER"]);
});

// --- reorderRecord ----------------------------------------------------

test("reorderRecord: 'up' swaps with the immediately preceding record, in both model.records and the regenerated source", () => {
  const model = buildModel();
  const ok = applyEditToModel(model, { kind: "reorderRecord", name: "DETAIL", direction: "up" });
  assert.equal(ok, true);
  assert.deepEqual(recordNames(model), ["DETAIL", "HEADER", "FOOTER"]);
  const reparsed = roundTrip(model);
  assert.deepEqual(recordNames(reparsed), ["DETAIL", "HEADER", "FOOTER"]);
  // Each record's own field moved WITH it, not left behind.
  const detail = reparsed.records.find((r) => r.name === "DETAIL")!;
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  assert.ok(detail.fields.some((f: any) => f.name === "AMOUNT"));
  assert.ok(header.fields.some((f: any) => f.name === "CUSTNAME"));
});

test("reorderRecord: 'down' swaps with the immediately following record", () => {
  const model = buildModel();
  const ok = applyEditToModel(model, { kind: "reorderRecord", name: "HEADER", direction: "down" });
  assert.equal(ok, true);
  assert.deepEqual(recordNames(model), ["DETAIL", "HEADER", "FOOTER"]);
});

test("reorderRecord: moving the first record 'up' is a no-op (already at that edge)", () => {
  const model = buildModel();
  const ok = applyEditToModel(model, { kind: "reorderRecord", name: "HEADER", direction: "up" });
  assert.equal(ok, false);
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "FOOTER"]);
});

test("reorderRecord: moving the last record 'down' is a no-op (already at that edge)", () => {
  const model = buildModel();
  const ok = applyEditToModel(model, { kind: "reorderRecord", name: "FOOTER", direction: "down" });
  assert.equal(ok, false);
  assert.deepEqual(recordNames(model), ["HEADER", "DETAIL", "FOOTER"]);
});

test("reorderRecord: rejects an unknown name (no-op)", () => {
  const model = buildModel();
  assert.equal(applyEditToModel(model, { kind: "reorderRecord", name: "NOSUCHRECORD", direction: "up" }), false);
});

test("reorderRecord: a trailing comment after a record's last field moves WITH that record (documented decision, not split)", () => {
  // The fixture has "* trailing comment after DETAIL's last field" between
  // DETAIL's AMOUNT field and the FOOTER record. Moving DETAIL down (past
  // FOOTER) should carry that comment along with DETAIL's block. Checked
  // via model.sequence positions directly (not substring-searching the
  // regenerated text), since the comment's own wording contains "DETAIL",
  // which would make a naive text search ambiguous.
  const model = buildModel();
  const commentEntry = model.sequence.find((e) => e.kind === "comment");
  assert.ok(commentEntry, "fixture should include the trailing comment");
  const ok = applyEditToModel(model, { kind: "reorderRecord", name: "DETAIL", direction: "down" });
  assert.equal(ok, true);
  assert.deepEqual(recordNames(model), ["HEADER", "FOOTER", "DETAIL"]);
  const detailRecord = model.records.find((r) => r.name === "DETAIL")!;
  const footerRecord = model.records.find((r) => r.name === "FOOTER")!;
  const commentIdx = model.sequence.indexOf(commentEntry!);
  const detailIdx = model.sequence.indexOf(detailRecord);
  const footerIdx = model.sequence.indexOf(footerRecord);
  assert.ok(commentIdx > detailIdx, "comment should still come after DETAIL's own record entry");
  assert.ok(commentIdx > footerIdx, "comment should now come after FOOTER too, since DETAIL (and its comment) moved past it");
});

// --- validatePageGroupOrder ---------------------------------------------

function buildPageGroupModel(assignments: { record: string; strpaggrp?: boolean; endpaggrp?: boolean }[]): ParsedSource {
  const lines: string[] = [];
  for (const a of assignments) {
    const kw: string[] = [];
    if (a.strpaggrp) kw.push("STRPAGGRP('GRP')");
    if (a.endpaggrp) kw.push("ENDPAGGRP");
    lines.push(...emitWithKeywords(buildPositional({ nameType: "R", name: a.record }), kw.join(" ")));
    lines.push(...emitWithKeywords(buildPositional({ name: a.record + "F", length: 1, dataType: "A", usage: "O", lineNo: 1, position: 1 }), ""));
  }
  return parseSource(lines.join("\n") + "\n");
}

test("validatePageGroupOrder: a correctly balanced STRPAGGRP/ENDPAGGRP pair produces no warnings", () => {
  const model = buildPageGroupModel([{ record: "A" }, { record: "B", strpaggrp: true }, { record: "C" }, { record: "D", endpaggrp: true }]);
  assert.deepEqual(PrtfEngine.validatePageGroupOrder(model), []);
});

test("validatePageGroupOrder: a file with no page-group keywords at all produces no warnings", () => {
  const model = buildPageGroupModel([{ record: "A" }, { record: "B" }]);
  assert.deepEqual(PrtfEngine.validatePageGroupOrder(model), []);
});

test("validatePageGroupOrder: an unclosed STRPAGGRP (never followed by ENDPAGGRP) is flagged", () => {
  const model = buildPageGroupModel([{ record: "A", strpaggrp: true }, { record: "B" }]);
  const warnings = PrtfEngine.validatePageGroupOrder(model);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].recordName, "A");
  assert.equal(warnings[0].keyword, "STRPAGGRP");
});

test("validatePageGroupOrder: an ENDPAGGRP with no preceding STRPAGGRP is flagged", () => {
  const model = buildPageGroupModel([{ record: "A" }, { record: "B", endpaggrp: true }]);
  const warnings = PrtfEngine.validatePageGroupOrder(model);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].recordName, "B");
  assert.equal(warnings[0].keyword, "ENDPAGGRP");
});

test("validatePageGroupOrder: a second STRPAGGRP before the first is closed (nesting) is flagged", () => {
  const model = buildPageGroupModel([
    { record: "A", strpaggrp: true },
    { record: "B", strpaggrp: true },
    { record: "C", endpaggrp: true },
  ]);
  const warnings = PrtfEngine.validatePageGroupOrder(model);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].recordName, "B");
  assert.equal(warnings[0].keyword, "STRPAGGRP");
});

test("validatePageGroupOrder: reordering a page-group-bracketed record past its partner turns a valid pairing into flagged warnings — the exact risk this batch's reorderRecord introduces", () => {
  const model = buildPageGroupModel([{ record: "A", strpaggrp: true }, { record: "B", endpaggrp: true }, { record: "C" }]);
  assert.deepEqual(PrtfEngine.validatePageGroupOrder(model), []); // valid before the reorder

  // Move A (STRPAGGRP) down past B (ENDPAGGRP), so ENDPAGGRP now precedes
  // STRPAGGRP in the file — an invalid ordering. This actually breaks TWO
  // independent things at once: B's ENDPAGGRP no longer has anything
  // before it to close, AND A's STRPAGGRP (now coming after B) is left
  // with nothing left to close it — both are correctly reported.
  const ok = applyEditToModel(model, { kind: "reorderRecord", name: "A", direction: "down" });
  assert.equal(ok, true);
  assert.deepEqual(recordNames(model), ["B", "A", "C"]);

  const warnings = PrtfEngine.validatePageGroupOrder(model);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((w: any) => w.recordName === "B" && w.keyword === "ENDPAGGRP"));
  assert.ok(warnings.some((w: any) => w.recordName === "A" && w.keyword === "STRPAGGRP"));
});
