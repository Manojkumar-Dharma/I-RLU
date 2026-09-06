// Tests for docs/TASKS.md Batch JJ — bulkMove/bulkDelete/bulkCopy, the
// multi-selected-set equivalents of the existing move/delete/addField edit
// kinds. Follows the same buildModel()-from-real-parseSource fixture
// pattern as test/prtfEdits.test.ts (real ids assigned by the parser, real
// keyword shapes) rather than a hand-typed model object.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
import { applyEditToModel, findEntryById } from "../src/prtfEdits";
import { FieldEntry, ParsedSource } from "../src/prtfModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");

/**
 * One record ("HEADER") with three named fields (CUSTNAME, AMOUNT, QTY) and
 * one constant, plus a SECOND record ("FOOTER") with one field (TOTAL) —
 * the second record exists specifically to exercise bulkCopy's
 * same-record-only scope guard (an id from a different record must be
 * silently skipped, not copied into the wrong record).
 */
function buildModel() {
  const lines = [
    "      * prtfBatchJJ test fixture",
    "",
    ...emitWithKeywords(buildPositional({}), "PAGSIZE(66 132)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      "COLOR(*BLU)"
    ),
    ...emitWithKeywords(
      buildPositional({ name: "AMOUNT", length: 9, dataType: "S", decimalPositions: 2, usage: "O", lineNo: 2, position: 10 }),
      ""
    ),
    ...emitWithKeywords(
      buildPositional({ name: "QTY", length: 5, dataType: "S", decimalPositions: 0, usage: "O", lineNo: 2, position: 25 }),
      ""
    ),
    ...emitWithKeywords(buildPositional({ lineNo: 3, position: 10 }), "'Total:'"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "FOOTER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "TOTAL", length: 9, dataType: "S", decimalPositions: 2, usage: "O", lineNo: 1, position: 10 }),
      ""
    ),
  ];
  const source = lines.join("\n") + "\n";
  return parseSource(source);
}

function findByName(model: ParsedSource, name: string): FieldEntry {
  for (const record of model.records) {
    const found = record.fields.find((f): f is FieldEntry => f.kind === "field" && f.name === name);
    if (found) return found;
  }
  throw new Error(`fixture field ${name} not found`);
}

function findConstant(model: ParsedSource) {
  for (const record of model.records) {
    const found = record.fields.find((f) => f.kind === "constant");
    if (found) return found;
  }
  throw new Error("fixture constant not found");
}

// --- bulkMove -----------------------------------------------------------

test("applyEditToModel: bulkMove shifts every id by the same delta, preserving relative layout", () => {
  const model = buildModel();
  const custname = findByName(model, "CUSTNAME");
  const amount = findByName(model, "AMOUNT");
  const constant = findConstant(model);
  const changed = applyEditToModel(model, {
    kind: "bulkMove",
    ids: [custname.id, amount.id, constant.id],
    deltaLine: 2,
    deltaPosition: -3,
  });
  assert.equal(changed, true);
  assert.equal(custname.line, 3);
  assert.equal(custname.position, 7);
  assert.equal(amount.line, 4);
  assert.equal(amount.position, 7);
  assert.equal(constant.line, 5);
  assert.equal(constant.position, 7);
});

test("applyEditToModel: bulkMove skips a dangling id but still moves the live ones, returning true", () => {
  const model = buildModel();
  const custname = findByName(model, "CUSTNAME");
  const changed = applyEditToModel(model, { kind: "bulkMove", ids: [custname.id, "gone"], deltaLine: 1, deltaPosition: 1 });
  assert.equal(changed, true);
  assert.equal(custname.line, 2);
  assert.equal(custname.position, 11);
});

test("applyEditToModel: bulkMove with every id dangling returns false and changes nothing", () => {
  const model = buildModel();
  const before = regenerateSource(model);
  const changed = applyEditToModel(model, { kind: "bulkMove", ids: ["gone1", "gone2"], deltaLine: 1, deltaPosition: 1 });
  assert.equal(changed, false);
  assert.equal(regenerateSource(model), before);
});

test("applyEditToModel: bulkMove leaves QTY (not in ids) untouched", () => {
  const model = buildModel();
  const custname = findByName(model, "CUSTNAME");
  const qty = findByName(model, "QTY");
  applyEditToModel(model, { kind: "bulkMove", ids: [custname.id], deltaLine: 5, deltaPosition: 5 });
  assert.equal(qty.line, 2);
  assert.equal(qty.position, 25);
});

// --- bulkDelete -----------------------------------------------------------

test("applyEditToModel: bulkDelete removes every id from both record.fields and model.sequence", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;
  const amount = findByName(model, "AMOUNT");
  const qty = findByName(model, "QTY");

  const changed = applyEditToModel(model, { kind: "bulkDelete", ids: [amount.id, qty.id] });
  assert.equal(changed, true);
  assert.ok(!header.fields.includes(amount));
  assert.ok(!header.fields.includes(qty));
  assert.ok(!model.sequence.includes(amount));
  assert.ok(!model.sequence.includes(qty));
  assert.throws(() => findByName(model, "AMOUNT"));
  assert.throws(() => findByName(model, "QTY"));
  // CUSTNAME wasn't in the delete set — still present.
  assert.doesNotThrow(() => findByName(model, "CUSTNAME"));
});

test("applyEditToModel: bulkDelete with a dangling id among live ones still deletes the live ones", () => {
  const model = buildModel();
  const amount = findByName(model, "AMOUNT");
  const changed = applyEditToModel(model, { kind: "bulkDelete", ids: [amount.id, "gone"] });
  assert.equal(changed, true);
  assert.throws(() => findByName(model, "AMOUNT"));
});

test("applyEditToModel: bulkDelete with every id dangling returns false", () => {
  const model = buildModel();
  const before = regenerateSource(model);
  const changed = applyEditToModel(model, { kind: "bulkDelete", ids: ["gone1", "gone2"] });
  assert.equal(changed, false);
  assert.equal(regenerateSource(model), before);
});

// --- bulkCopy -------------------------------------------------------------

test("applyEditToModel: bulkCopy clones every id with a fresh non-colliding name, offset by the delta", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;
  const custname = findByName(model, "CUSTNAME");
  const amount = findByName(model, "AMOUNT");

  const changed = applyEditToModel(model, {
    kind: "bulkCopy",
    recordName: "HEADER",
    ids: [custname.id, amount.id],
    deltaLine: 10,
    deltaPosition: 1,
  });
  assert.equal(changed, true);

  const newCustname = header.fields.find(
    (f): f is FieldEntry => f.kind === "field" && f !== custname && f.name.startsWith("CUSTNAME")
  )!;
  const newAmount = header.fields.find((f): f is FieldEntry => f.kind === "field" && f !== amount && f.name.startsWith("AMOUNT"))!;
  assert.ok(newCustname, "expected a cloned CUSTNAME-derived field");
  assert.ok(newAmount, "expected a cloned AMOUNT-derived field");
  assert.notEqual(newCustname.name, "CUSTNAME"); // must be a fresh, non-colliding name
  assert.notEqual(newCustname.id, custname.id);
  assert.equal(newCustname.line, custname.line! + 10);
  assert.equal(newCustname.position, custname.position! + 1);
  assert.equal(newAmount.line, amount.line! + 10);
  assert.equal(newAmount.position, amount.position! + 1);

  // Source entries are untouched.
  assert.equal(custname.line, 1);
  assert.equal(amount.line, 2);
});

test("applyEditToModel: bulkCopy carries the source's keywords over to the clone", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;
  const custname = findByName(model, "CUSTNAME");
  assert.ok(custname.keywords.some((k) => k.name === "COLOR"));

  applyEditToModel(model, { kind: "bulkCopy", recordName: "HEADER", ids: [custname.id], deltaLine: 5, deltaPosition: 0 });
  const clone = header.fields.find((f): f is FieldEntry => f.kind === "field" && f !== custname && f.name.startsWith("CUSTNAME"))!;
  assert.ok(clone.keywords.some((k) => k.name === "COLOR" && k.params === "(*BLU)"));
  // Cloned keyword is its own object, not a shared reference to the source's.
  assert.notEqual(clone.keywords[0], custname.keywords[0]);
});

test("applyEditToModel: bulkCopy also clones a constant, preserving its literal", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;
  const constant = findConstant(model);

  applyEditToModel(model, { kind: "bulkCopy", recordName: "HEADER", ids: [constant.id], deltaLine: 1, deltaPosition: 1 });
  const clones = header.fields.filter((f) => f.kind === "constant" && f !== constant);
  assert.equal(clones.length, 1);
  assert.equal((clones[0] as any).literal, (constant as any).literal);
  assert.equal(clones[0].line, constant.line! + 1);
  assert.equal(clones[0].position, constant.position! + 1);
});

test("applyEditToModel: bulkCopy silently skips an id belonging to a DIFFERENT record than recordName", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;
  const footer = model.records.find((r) => r.name === "FOOTER")!;
  const custname = findByName(model, "CUSTNAME");
  const total = findByName(model, "TOTAL"); // lives in FOOTER, not HEADER

  const changed = applyEditToModel(model, {
    kind: "bulkCopy",
    recordName: "HEADER",
    ids: [custname.id, total.id],
    deltaLine: 3,
    deltaPosition: 0,
  });
  assert.equal(changed, true); // custname's copy still succeeded
  // HEADER only gained one new field (the CUSTNAME clone), not two.
  const headerFieldCount = header.fields.filter((f) => f.kind === "field").length;
  assert.equal(headerFieldCount, 4); // CUSTNAME, AMOUNT, QTY + 1 clone
  // FOOTER's own TOTAL field was never touched or duplicated.
  const footerFieldCount = footer.fields.filter((f) => f.kind === "field").length;
  assert.equal(footerFieldCount, 1);
  assert.equal(total.line, 1); // untouched
});

test("applyEditToModel: bulkCopy on an unknown recordName returns false", () => {
  const model = buildModel();
  const before = regenerateSource(model);
  const custname = findByName(model, "CUSTNAME");
  const changed = applyEditToModel(model, {
    kind: "bulkCopy",
    recordName: "NOPE",
    ids: [custname.id],
    deltaLine: 1,
    deltaPosition: 1,
  });
  assert.equal(changed, false);
  assert.equal(regenerateSource(model), before);
});

test("applyEditToModel: bulkCopy of two same-named-base fields at once assigns each a distinct fresh name", () => {
  // Copying CUSTNAME twice in the same bulkCopy call (e.g. it appears
  // twice in a hypothetical selection — defensive, not a real UI path
  // today) must not produce two fields both named CUSTNAME2.
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;
  const custname = findByName(model, "CUSTNAME");
  applyEditToModel(model, {
    kind: "bulkCopy",
    recordName: "HEADER",
    ids: [custname.id, custname.id],
    deltaLine: 1,
    deltaPosition: 1,
  });
  const clones = header.fields.filter((f): f is FieldEntry => f.kind === "field" && f !== custname && f.name.startsWith("CUSTNAME"));
  assert.equal(clones.length, 2);
  assert.notEqual(clones[0].name, clones[1].name);
});

test("round trip: bulkMove/bulkCopy/bulkDelete applied in sequence still regenerate to valid, reparseable DDS", () => {
  const model = buildModel();
  const custname = findByName(model, "CUSTNAME");
  const amount = findByName(model, "AMOUNT");
  const qty = findByName(model, "QTY");

  applyEditToModel(model, { kind: "bulkCopy", recordName: "HEADER", ids: [custname.id], deltaLine: 8, deltaPosition: 0 });
  applyEditToModel(model, { kind: "bulkMove", ids: [amount.id, qty.id], deltaLine: 1, deltaPosition: 0 });
  applyEditToModel(model, { kind: "bulkDelete", ids: [qty.id] });

  const regenerated = regenerateSource(model);
  const reparsed = parseSource(regenerated);
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  assert.ok(header.fields.some((f) => f.kind === "field" && (f as FieldEntry).name === "CUSTNAME"));
  assert.ok(header.fields.some((f) => f.kind === "field" && (f as FieldEntry).name.startsWith("CUSTNAME") && (f as FieldEntry).name !== "CUSTNAME"));
  assert.ok(!header.fields.some((f) => f.kind === "field" && (f as FieldEntry).name === "QTY"));
});
