// Tests for src/prtfEdits.ts (applyEditToModel/findEntryById) — the model
// mutation extension.ts's applyEdit delegates to for every edit.kind the
// webview can send. Deliberately built on top of a model produced by
// parseSource(), the same way test/prtfBatchF.test.ts does, rather than a
// hand-typed fixture object: real ids assigned by the parser, real
// keyword/conditions shapes, so a mismatch between what the parser produces
// and what applyEditToModel expects would show up here rather than only at
// runtime in the extension host. Each edit is exercised via applyEditToModel
// directly (no vscode dependency needed — that's the whole point of pulling
// this out of extension.ts), and several are round-tripped through
// regenerateSource + parseSource to confirm the mutated model still emits
// valid, reparseable DDS.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
import { applyEditToModel, findEntryById } from "../src/prtfEdits";
import { FieldEntry, ParsedSource } from "../src/prtfModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

/**
 * One record ("HEADER") with two named fields (CUSTNAME, AMOUNT) and one
 * constant (a literal), covering the three entry kinds every id-scoped edit
 * needs to distinguish between. Field/constant ids are assigned by the
 * parser (see prtfParser.ts's nextId), so tests look them up by name/literal
 * rather than assuming a specific id string.
 */
function buildModel() {
  const lines = [
    "      * prtfEdits test fixture",
    "",
    ...emitWithKeywords(buildPositional({}), "PAGSIZE(66 132)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
    ...emitWithKeywords(
      buildPositional({ name: "AMOUNT", length: 9, dataType: "S", decimalPositions: 2, usage: "O", lineNo: 2, position: 10 }),
      ""
    ),
    ...emitWithKeywords(buildPositional({ lineNo: 3, position: 10 }), "'Total:'"),
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

test("findEntryById: finds a field by id, returns its owning record and index", () => {
  const model = buildModel();
  const custname = findByName(model, "CUSTNAME");
  const found = findEntryById(model, custname.id);
  assert.ok(found);
  assert.equal(found!.record.name, "HEADER");
  assert.equal(found!.entry.id, custname.id);
});

test("findEntryById: returns null for an id that doesn't exist", () => {
  const model = buildModel();
  assert.equal(findEntryById(model, "no-such-id"), null);
});

test("applyEditToModel: unrecognized edit.kind returns false and changes nothing", () => {
  const model = buildModel();
  const before = regenerateSource(model);
  // @ts-expect-error - deliberately passing an edit.kind not in the WebviewEdit union
  const changed = applyEditToModel(model, { kind: "notARealKind" });
  assert.equal(changed, false);
  assert.equal(regenerateSource(model), before);
});

test("applyEditToModel: move updates line/position for a field or constant", () => {
  const model = buildModel();
  const custname = findByName(model, "CUSTNAME");
  const changed = applyEditToModel(model, { kind: "move", id: custname.id, line: 5, position: 20 });
  assert.equal(changed, true);
  assert.equal(custname.line, 5);
  assert.equal(custname.position, 20);
});

test("applyEditToModel: move on a dangling id returns false", () => {
  const model = buildModel();
  const changed = applyEditToModel(model, { kind: "move", id: "gone", line: 5, position: 20 });
  assert.equal(changed, false);
});

test("applyEditToModel: updateField replaces the base positional attributes", () => {
  const model = buildModel();
  const amount = findByName(model, "AMOUNT");
  const changed = applyEditToModel(model, {
    kind: "updateField",
    id: amount.id,
    name: "AMOUNT2",
    length: 11,
    dataType: "S",
    decimalPositions: 3,
    usage: "I",
    line: 2,
    position: 15,
  });
  assert.equal(changed, true);
  assert.equal(amount.name, "AMOUNT2");
  assert.equal(amount.length, 11);
  assert.equal(amount.decimalPositions, 3);
  assert.equal(amount.usage, "I");
  assert.equal(amount.position, 15);
});

test("applyEditToModel: updateField on a constant's id returns false (kind mismatch)", () => {
  const model = buildModel();
  const constant = findConstant(model);
  const changed = applyEditToModel(model, {
    kind: "updateField",
    id: constant.id,
    name: "X",
    line: 1,
    position: 1,
  });
  assert.equal(changed, false);
});

test("applyEditToModel: updateField with reference=true adds a REFFLD keyword and sets reference", () => {
  const model = buildModel();
  const custname = findByName(model, "CUSTNAME");
  applyEditToModel(model, {
    kind: "updateField",
    id: custname.id,
    name: "CUSTNAME",
    length: 30,
    dataType: "A",
    usage: "B",
    line: 1,
    position: 10,
    reference: true,
    refFieldName: "CUSTNM",
    refLibrary: "MYLIB",
    refFile: "CUSTMAST",
  });
  assert.equal(custname.reference, true);
  const reffld = PrtfEngine.findKeyword(custname.keywords, "REFFLD");
  assert.ok(reffld);
  assert.match(reffld.raw, /CUSTNM/);
  assert.match(reffld.raw, /MYLIB\/CUSTMAST/);
});

test("applyEditToModel: updateField with reference=false removes the REFFLD keyword", () => {
  const model = buildModel();
  const custname = findByName(model, "CUSTNAME");
  applyEditToModel(model, {
    kind: "updateField",
    id: custname.id,
    name: "CUSTNAME",
    length: 30,
    dataType: "A",
    usage: "B",
    line: 1,
    position: 10,
    reference: true,
    refFieldName: "CUSTNM",
    refLibrary: "MYLIB",
    refFile: "CUSTMAST",
  });
  applyEditToModel(model, {
    kind: "updateField",
    id: custname.id,
    name: "CUSTNAME",
    length: 30,
    dataType: "A",
    usage: "B",
    line: 1,
    position: 10,
    reference: false,
  });
  assert.equal(custname.reference, false);
  assert.equal(PrtfEngine.findKeyword(custname.keywords, "REFFLD"), undefined);
});

test("applyEditToModel: updateField with edit.reference undefined leaves the REFFLD keyword untouched", () => {
  const model = buildModel();
  const custname = findByName(model, "CUSTNAME");
  applyEditToModel(model, {
    kind: "updateField",
    id: custname.id,
    name: "CUSTNAME",
    length: 30,
    dataType: "A",
    usage: "B",
    line: 1,
    position: 10,
    reference: true,
    refFieldName: "CUSTNM",
    refLibrary: "MYLIB",
    refFile: "CUSTMAST",
  });
  // A plain position/size move — reference not included in the edit at all.
  applyEditToModel(model, { kind: "updateField", id: custname.id, name: "CUSTNAME", length: 30, dataType: "A", usage: "B", line: 1, position: 25 });
  assert.equal(custname.reference, true);
  assert.ok(PrtfEngine.findKeyword(custname.keywords, "REFFLD"));
});

test("applyEditToModel: updateConstant replaces literal/line/position", () => {
  const model = buildModel();
  const constant = findConstant(model);
  const changed = applyEditToModel(model, { kind: "updateConstant", id: constant.id, literal: "Grand Total:", line: 3, position: 12 });
  assert.equal(changed, true);
  assert.equal(constant.literal, "Grand Total:");
  assert.equal(constant.position, 12);
});

test("applyEditToModel: delete removes the entry from both record.fields and model.sequence", () => {
  const model = buildModel();
  const amount = findByName(model, "AMOUNT");
  const header = model.records.find((r) => r.name === "HEADER")!;
  assert.ok(header.fields.includes(amount));
  assert.ok(model.sequence.includes(amount));

  const changed = applyEditToModel(model, { kind: "delete", id: amount.id });
  assert.equal(changed, true);
  assert.ok(!header.fields.includes(amount));
  assert.ok(!model.sequence.includes(amount));
  assert.throws(() => findByName(model, "AMOUNT"));
});

test("applyEditToModel: setRecordKeyword adds a new keyword, then replaces it on a second set", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;

  applyEditToModel(model, { kind: "setRecordKeyword", recordName: "HEADER", name: "DUPLEX", params: "(*YES)" });
  assert.equal(PrtfEngine.findKeyword(header.keywords, "DUPLEX").params, "(*YES)");

  applyEditToModel(model, { kind: "setRecordKeyword", recordName: "HEADER", name: "DUPLEX", params: "(*TUMBLE)" });
  const duplexKeywords = header.keywords.filter((k) => k.name === "DUPLEX");
  assert.equal(duplexKeywords.length, 1);
  assert.equal(duplexKeywords[0].params, "(*TUMBLE)");
});

test("applyEditToModel: removeRecordKeyword removes an existing keyword and is a no-op if absent", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;
  applyEditToModel(model, { kind: "setRecordKeyword", recordName: "HEADER", name: "FORCE" });
  assert.ok(PrtfEngine.findKeyword(header.keywords, "FORCE"));

  const changed = applyEditToModel(model, { kind: "removeRecordKeyword", recordName: "HEADER", name: "FORCE" });
  assert.equal(changed, true);
  assert.equal(PrtfEngine.findKeyword(header.keywords, "FORCE"), undefined);

  // Removing again (already gone) still reports "handled" (record found),
  // it's the missing-record case that returns false — see next test.
  assert.equal(applyEditToModel(model, { kind: "removeRecordKeyword", recordName: "HEADER", name: "FORCE" }), true);
});

test("applyEditToModel: setRecordKeyword/removeRecordKeyword on an unknown recordName return false", () => {
  const model = buildModel();
  assert.equal(applyEditToModel(model, { kind: "setRecordKeyword", recordName: "NOPE", name: "FORCE" }), false);
  assert.equal(applyEditToModel(model, { kind: "removeRecordKeyword", recordName: "NOPE", name: "FORCE" }), false);
});

test("applyEditToModel: setFieldKeyword/removeFieldKeyword work on a constant too (not restricted to fields)", () => {
  const model = buildModel();
  const constant = findConstant(model);
  applyEditToModel(model, { kind: "setFieldKeyword", id: constant.id, name: "HIGHLIGHT" });
  assert.ok(PrtfEngine.findKeyword(constant.keywords, "HIGHLIGHT"));

  applyEditToModel(model, { kind: "removeFieldKeyword", id: constant.id, name: "HIGHLIGHT" });
  assert.equal(PrtfEngine.findKeyword(constant.keywords, "HIGHLIGHT"), undefined);
});

test("applyEditToModel: setIndicatorText only touches the INDTXT for the given indicator", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;

  applyEditToModel(model, { kind: "setIndicatorText", recordName: "HEADER", indicator: "50", text: "Rush order" });
  applyEditToModel(model, { kind: "setIndicatorText", recordName: "HEADER", indicator: "51", text: "Backordered" });

  const indtxts = header.keywords.filter((k) => k.name === "INDTXT");
  assert.equal(indtxts.length, 2);
  const parsed50 = PrtfEngine.parseIndtxt(indtxts.find((k) => k.raw.includes("50")));
  assert.equal(parsed50.text, "Rush order");

  // Updating indicator 50's text again must not touch indicator 51's entry.
  applyEditToModel(model, { kind: "setIndicatorText", recordName: "HEADER", indicator: "50", text: "Rush order (updated)" });
  const stillTwo = header.keywords.filter((k) => k.name === "INDTXT");
  assert.equal(stillTwo.length, 2);
  const updated50 = PrtfEngine.parseIndtxt(stillTwo.find((k) => PrtfEngine.parseIndtxt(k)?.indicator === "50"));
  assert.equal(updated50.text, "Rush order (updated)");
  const still51 = PrtfEngine.parseIndtxt(stillTwo.find((k) => PrtfEngine.parseIndtxt(k)?.indicator === "51"));
  assert.equal(still51.text, "Backordered");
});

test("applyEditToModel: removeIndicatorText removes only the matching indicator's INDTXT", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;
  applyEditToModel(model, { kind: "setIndicatorText", recordName: "HEADER", indicator: "50", text: "Rush order" });
  applyEditToModel(model, { kind: "setIndicatorText", recordName: "HEADER", indicator: "51", text: "Backordered" });

  applyEditToModel(model, { kind: "removeIndicatorText", recordName: "HEADER", indicator: "50" });
  const remaining = header.keywords.filter((k) => k.name === "INDTXT");
  assert.equal(remaining.length, 1);
  assert.equal(PrtfEngine.parseIndtxt(remaining[0]).indicator, "51");
});

test("applyEditToModel: addField appends a new field to the record and inserts it into model.sequence right after the record's last field", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;
  const fieldsBefore = header.fields.length;

  const changed = applyEditToModel(model, {
    kind: "addField",
    recordName: "HEADER",
    line: 4,
    position: 10,
    name: "NEWFLD",
    length: 5,
    dataType: "A",
    usage: "O",
  });
  assert.equal(changed, true);
  assert.equal(header.fields.length, fieldsBefore + 1);
  const newField = header.fields[header.fields.length - 1];
  assert.equal(newField.kind, "field");
  assert.equal((newField as any).name, "NEWFLD");

  // Inserted right after the previously-last field/constant in sequence order.
  const prevLastEntry = header.fields[header.fields.length - 2];
  const seqIndexOfPrev = model.sequence.indexOf(prevLastEntry);
  const seqIndexOfNew = model.sequence.indexOf(newField);
  assert.equal(seqIndexOfNew, seqIndexOfPrev + 1);
});

test("applyEditToModel: addConstant appends a new constant with the given literal", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;

  applyEditToModel(model, { kind: "addConstant", recordName: "HEADER", line: 5, position: 10, literal: "Page 1" });
  const newConstant = header.fields[header.fields.length - 1];
  assert.equal(newConstant.kind, "constant");
  assert.equal((newConstant as any).literal, "Page 1");
});

test("applyEditToModel: addField/addConstant on an unknown recordName return false", () => {
  const model = buildModel();
  assert.equal(applyEditToModel(model, { kind: "addField", recordName: "NOPE", line: 1, position: 1, name: "X", length: 1, dataType: "A", usage: "O" }), false);
  assert.equal(applyEditToModel(model, { kind: "addConstant", recordName: "NOPE", line: 1, position: 1, literal: "X" }), false);
});

test("round trip: several edits applied in sequence still regenerate to valid, reparseable DDS", () => {
  const model = buildModel();
  const custname = findByName(model, "CUSTNAME");
  applyEditToModel(model, { kind: "setFieldKeyword", id: custname.id, name: "ALIAS", params: "('CUSTNM')" });
  applyEditToModel(model, { kind: "setRecordKeyword", recordName: "HEADER", name: "DUPLEX", params: "(*YES)" });
  applyEditToModel(model, { kind: "setIndicatorText", recordName: "HEADER", indicator: "50", text: "Rush order" });
  applyEditToModel(model, {
    kind: "addField",
    recordName: "HEADER",
    line: 4,
    position: 10,
    name: "NEWFLD",
    length: 5,
    dataType: "A",
    usage: "O",
  });

  const text = regenerateSource(model);
  const reparsed = parseSource(text);
  const reparsedHeader = reparsed.records.find((r) => r.name === "HEADER")!;
  const reparsedCustname = reparsedHeader.fields.find((f) => f.kind === "field" && f.name === "CUSTNAME");
  assert.ok(reparsedCustname);
  assert.ok(PrtfEngine.findKeyword((reparsedCustname as any).keywords, "ALIAS"));
  assert.ok(PrtfEngine.findKeyword(reparsedHeader.keywords, "DUPLEX"));
  assert.ok(reparsedHeader.fields.some((f) => f.kind === "field" && f.name === "NEWFLD"));

  // Idempotence: regenerating the reparsed model again produces identical text.
  assert.equal(regenerateSource(reparsed), text);
});
