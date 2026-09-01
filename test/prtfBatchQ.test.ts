// Tests for docs/TASKS.md Batch Q — copy/duplicate a field or constant.
// Two layers, matching where the actual logic lives:
// (1) src/prtfWebviewLogic.js's suggestCopyName/buildCopyPendingNew — the
//     pure "what should the pending-new form look like" decision, unit
//     tested without a DOM the same way this file already tests
//     paramsToText/pixelToLineCol/etc.
// (2) src/prtfEdits.ts's applyEditToModel — the actual model mutation once
//     the person clicks "Add copy", confirming sourceKeywords round-trip
//     into the new entry's keywords and (per this batch's own required
//     test scope) that copying never mutates the source entry itself.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
import { applyEditToModel } from "../src/prtfEdits";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfWebviewLogic = require("../src/prtfWebviewLogic.js");

function buildModel() {
  const lines = [
    "      * Batch Q test fixture",
    "",
    ...emitWithKeywords(buildPositional({}), "PAGSIZE(66 132)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNBR", length: 7, dataType: "S", decimalPositions: 0, usage: "O", lineNo: 3, position: 10 }),
      "EDTCDE('Z') COLOR(*BLU)"
    ),
  ];
  return parseSource(lines.join("\n") + "\n");
}

// --- suggestCopyName ---

test("suggestCopyName: appends the lowest available numeric suffix", () => {
  const existing = new Set(["CUSTNBR"]);
  assert.equal(PrtfWebviewLogic.suggestCopyName("CUSTNBR", existing), "CUSTNBR2");
});

test("suggestCopyName: skips suffixes that are already taken", () => {
  const existing = new Set(["CUSTNBR", "CUSTNBR2", "CUSTNBR3"]);
  assert.equal(PrtfWebviewLogic.suggestCopyName("CUSTNBR", existing), "CUSTNBR4");
});

test("suggestCopyName: truncates the base name so the suffixed result still fits DDS's 10-character limit", () => {
  // "CUSTNAME9" is 9 chars — appending "2" straight on would be 10 chars, fine;
  // but at a two-digit suffix (10+), the base must shrink to keep the total at 10.
  const nineChar = "CUSTNAME9";
  assert.equal(PrtfWebviewLogic.suggestCopyName(nineChar, new Set([nineChar])).length <= 10, true);

  const existing = new Set([nineChar]);
  for (let i = 2; i <= 10; i++) existing.add(nineChar.slice(0, 10 - String(i).length) + i);
  const suggestion = PrtfWebviewLogic.suggestCopyName(nineChar, existing);
  assert.equal(suggestion.length, 10);
  assert.equal(existing.has(suggestion), false);
});

test("suggestCopyName: never returns the exact source name", () => {
  const existing = new Set(["CUSTNBR"]);
  assert.notEqual(PrtfWebviewLogic.suggestCopyName("CUSTNBR", existing), "CUSTNBR");
});

// --- buildCopyPendingNew ---

test("buildCopyPendingNew (field): carries length/dataType/decimalPositions/usage and a non-colliding suggested name", () => {
  const source = { name: "CUSTNBR", length: 7, dataType: "S", decimalPositions: 0, usage: "O", keywords: [] };
  const pending = PrtfWebviewLogic.buildCopyPendingNew("field", 4, 20, source, new Set(["CUSTNBR"]));
  assert.equal(pending.kind, "field");
  assert.equal(pending.line, 4);
  assert.equal(pending.position, 20);
  assert.equal(pending.name, "CUSTNBR2");
  assert.equal(pending.length, 7);
  assert.equal(pending.dataType, "S");
  assert.equal(pending.decimalPositions, 0);
  assert.equal(pending.usage, "O");
});

test("buildCopyPendingNew: carries the source's keywords as plain name/params pairs", () => {
  const source = {
    name: "CUSTNBR",
    keywords: [
      { name: "EDTCDE", params: "('Z')", raw: "EDTCDE('Z')", sourceLineIndex: 5 },
      { name: "COLOR", params: "(*BLU)", raw: "COLOR(*BLU)", sourceLineIndex: 5 },
    ],
  };
  const pending = PrtfWebviewLogic.buildCopyPendingNew("field", 4, 20, source, new Set(["CUSTNBR"]));
  assert.deepEqual(pending.sourceKeywords, [
    { name: "EDTCDE", params: "('Z')" },
    { name: "COLOR", params: "(*BLU)" },
  ]);
});

test("buildCopyPendingNew: does not mutate the source object at all", () => {
  const source = { name: "CUSTNBR", length: 7, dataType: "S", keywords: [{ name: "EDTCDE", params: "('Z')" }] };
  const snapshot = JSON.parse(JSON.stringify(source));
  PrtfWebviewLogic.buildCopyPendingNew("field", 4, 20, source, new Set(["CUSTNBR"]));
  assert.deepEqual(source, snapshot);
});

test("buildCopyPendingNew (constant): carries the literal and keywords, no name/collision logic involved", () => {
  const source = { literal: "Statement Date:", keywords: [{ name: "COLOR", params: "(*RED)" }] };
  const pending = PrtfWebviewLogic.buildCopyPendingNew("constant", 6, 5, source, new Set());
  assert.equal(pending.kind, "constant");
  assert.equal(pending.literal, "Statement Date:");
  assert.deepEqual(pending.sourceKeywords, [{ name: "COLOR", params: "(*RED)" }]);
});

// --- applyEditToModel: addField/addConstant with sourceKeywords ---

test("applyEditToModel: addField with sourceKeywords gives the new field the source's keywords, rebuilt with raw/sourceLineIndex", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;

  applyEditToModel(model, {
    kind: "addField",
    recordName: "HEADER",
    line: 4,
    position: 10,
    name: "CUSTNBR2",
    length: 7,
    dataType: "S",
    decimalPositions: 0,
    usage: "O",
    sourceKeywords: [
      { name: "EDTCDE", params: "('Z')" },
      { name: "COLOR", params: "(*BLU)" },
    ],
  });

  const copy = header.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNBR2")!;
  assert.ok(copy);
  assert.equal(copy.keywords.length, 2);
  const edtcde = PrtfEngine.findKeyword(copy.keywords, "EDTCDE");
  assert.equal(edtcde.params, "('Z')");
  assert.equal(edtcde.raw, "EDTCDE('Z')");
  assert.equal(edtcde.sourceLineIndex, -1);
  assert.ok(PrtfEngine.findKeyword(copy.keywords, "COLOR"));
});

test("applyEditToModel: addField without sourceKeywords still gets an empty keywords array (plain add, unaffected by this batch)", () => {
  const model = buildModel();
  applyEditToModel(model, {
    kind: "addField",
    recordName: "HEADER",
    line: 4,
    position: 10,
    name: "PLAINFLD",
    length: 5,
    dataType: "A",
    usage: "O",
  });
  const header = model.records.find((r) => r.name === "HEADER")!;
  const plain = header.fields.find((f) => f.kind === "field" && (f as any).name === "PLAINFLD")!;
  assert.deepEqual(plain.keywords, []);
});

test("applyEditToModel: copying a field does NOT mutate the source field's own keywords array", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;
  const source = header.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNBR")!;
  const sourceKeywordsBefore = JSON.parse(JSON.stringify(source.keywords));

  applyEditToModel(model, {
    kind: "addField",
    recordName: "HEADER",
    line: 4,
    position: 10,
    name: "CUSTNBR2",
    length: 7,
    dataType: "S",
    usage: "O",
    sourceKeywords: source.keywords.map((k) => ({ name: k.name, params: k.params })),
  });

  // The copy's keyword objects must not be the SAME objects as the source's
  // (a shallow-reuse bug would make later edits to the copy silently also
  // change the source), and the source's own keywords array must be
  // byte-for-byte unchanged.
  const copy = header.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNBR2")!;
  assert.notEqual(copy.keywords[0], source.keywords[0]);
  assert.deepEqual(source.keywords, sourceKeywordsBefore);
});

test("applyEditToModel: copying a field does not remove or rename the source field itself (copy, not move)", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;
  const fieldsBefore = header.fields.length;

  applyEditToModel(model, {
    kind: "addField",
    recordName: "HEADER",
    line: 4,
    position: 10,
    name: "CUSTNBR2",
    length: 7,
    dataType: "S",
    usage: "O",
    sourceKeywords: [{ name: "EDTCDE", params: "('Z')" }],
  });

  assert.equal(header.fields.length, fieldsBefore + 1);
  assert.ok(header.fields.some((f) => f.kind === "field" && (f as any).name === "CUSTNBR"));
  assert.ok(header.fields.some((f) => f.kind === "field" && (f as any).name === "CUSTNBR2"));
});

test("applyEditToModel: addConstant with sourceKeywords carries them onto the new constant", () => {
  const model = buildModel();
  const header = model.records.find((r) => r.name === "HEADER")!;
  applyEditToModel(model, {
    kind: "addConstant",
    recordName: "HEADER",
    line: 6,
    position: 5,
    literal: "Statement Date:",
    sourceKeywords: [{ name: "COLOR", params: "(*RED)" }],
  });
  const newConstant = header.fields.find((f) => f.kind === "constant" && (f as any).literal === "Statement Date:")!;
  assert.ok(newConstant);
  assert.ok(PrtfEngine.findKeyword(newConstant.keywords, "COLOR"));
});

test("round trip: a copied field with keywords regenerates to valid, reparseable DDS carrying those keywords", () => {
  const model = buildModel();
  applyEditToModel(model, {
    kind: "addField",
    recordName: "HEADER",
    line: 4,
    position: 10,
    name: "CUSTNBR2",
    length: 7,
    dataType: "S",
    decimalPositions: 0,
    usage: "O",
    sourceKeywords: [
      { name: "EDTCDE", params: "('Z')" },
      { name: "COLOR", params: "(*BLU)" },
    ],
  });

  const text = regenerateSource(model);
  const reparsed = parseSource(text);
  const reparsedHeader = reparsed.records.find((r) => r.name === "HEADER")!;
  const reparsedCopy = reparsedHeader.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNBR2");
  assert.ok(reparsedCopy);
  assert.ok(PrtfEngine.findKeyword((reparsedCopy as any).keywords, "EDTCDE"));
  assert.ok(PrtfEngine.findKeyword((reparsedCopy as any).keywords, "COLOR"));

  // The original CUSTNBR field must still be present, unmodified, with its own keywords intact.
  const reparsedOriginal = reparsedHeader.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNBR");
  assert.ok(reparsedOriginal);
  assert.ok(PrtfEngine.findKeyword((reparsedOriginal as any).keywords, "EDTCDE"));

  // Idempotence: regenerating the reparsed model again produces identical text.
  assert.equal(regenerateSource(reparsed), text);
});
