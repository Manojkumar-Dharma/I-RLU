import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, upsertReffldKeyword } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveReferenceTarget } = require("../src/prtfEngine.js");

/**
 * Batch H (docs/TASKS.md) — REF/REFFLD resolution. Covers part 1 (the pure
 * "where do I look" resolution and the REFFLD keyword upsert, both fully
 * testable without a live IBM i) per the batch's own guidance to land that
 * part regardless of Code for i availability. See
 * PrtfEngine.resolveReferenceTarget's own doc comment (src/prtfEngine.js)
 * for the precedence rules under test here, mirrored from I-SDA's
 * DspfEngine.resolveReferenceTarget and IBM's DDS reference.
 */

function makeModel({ fileRef, recordRef, fieldKeywords, fieldReference }: any) {
  const fileLevel: any = { kind: "fileLevel", sourceLineIndex: 0, keywords: fileRef ? [{ name: "REF", params: "(" + fileRef + ")", raw: "REF(" + fileRef + ")", sourceLineIndex: 0 }] : [] };
  const field: any = {
    kind: "field",
    id: "f1",
    sourceLineIndex: 2,
    name: "CUSTNBR",
    reference: fieldReference,
    length: 7,
    dataType: "S",
    decimalPositions: 0,
    usage: "B",
    line: 1,
    position: 50,
    conditions: [],
    keywords: fieldKeywords || [],
  };
  const record: any = {
    kind: "record",
    sourceLineIndex: 1,
    name: "HEADER",
    conditions: [],
    keywords: recordRef ? [{ name: "REF", params: "(" + recordRef + ")", raw: "REF(" + recordRef + ")", sourceLineIndex: 1 }] : [],
    fields: [field],
  };
  const model: any = { rawLines: [], lineEnding: "\n", fileLevel, records: [record], sequence: [fileLevel, record, field] };
  return { model, record, field };
}

test("resolveReferenceTarget: REFFLD with explicit field name and library/file wins outright", () => {
  const { model, record, field } = makeModel({
    fieldReference: true,
    fieldKeywords: [{ name: "REFFLD", params: "(CUSTNO CUSTLIB/CUSTMAST)", raw: "REFFLD(CUSTNO CUSTLIB/CUSTMAST)", sourceLineIndex: 2 }],
  });
  const target = resolveReferenceTarget(model, record, field);
  assert.deepEqual(target, { fieldName: "CUSTNO", library: "CUSTLIB", file: "CUSTMAST" });
});

test("resolveReferenceTarget: REFFLD file with no library qualifier yields a null library", () => {
  const { model, record, field } = makeModel({
    fieldReference: true,
    fieldKeywords: [{ name: "REFFLD", params: "(CUSTNO CUSTMAST)", raw: "REFFLD(CUSTNO CUSTMAST)", sourceLineIndex: 2 }],
  });
  const target = resolveReferenceTarget(model, record, field);
  assert.deepEqual(target, { fieldName: "CUSTNO", library: null, file: "CUSTMAST" });
});

test("resolveReferenceTarget: a bare 'R' with no REFFLD falls back to the field's own name plus the record-level REF", () => {
  const { model, record, field } = makeModel({ fieldReference: true, recordRef: "CUSTLIB/CUSTMAST" });
  const target = resolveReferenceTarget(model, record, field);
  assert.deepEqual(target, { fieldName: "CUSTNBR", library: "CUSTLIB", file: "CUSTMAST" });
});

test("resolveReferenceTarget: falls back to the file-level REF when there's no record-level REF either", () => {
  const { model, record, field } = makeModel({ fieldReference: true, fileRef: "CUSTMAST" });
  const target = resolveReferenceTarget(model, record, field);
  assert.deepEqual(target, { fieldName: "CUSTNBR", library: null, file: "CUSTMAST" });
});

test("resolveReferenceTarget: record-level REF takes precedence over file-level REF", () => {
  const { model, record, field } = makeModel({ fieldReference: true, recordRef: "RECLIB/RECFILE", fileRef: "FILELIB/FILEFILE" });
  const target = resolveReferenceTarget(model, record, field);
  assert.deepEqual(target, { fieldName: "CUSTNBR", library: "RECLIB", file: "RECFILE" });
});

test("resolveReferenceTarget: REFFLD's own file, when given, overrides record- and file-level REF", () => {
  const { model, record, field } = makeModel({
    fieldReference: true,
    recordRef: "RECLIB/RECFILE",
    fieldKeywords: [{ name: "REFFLD", params: "(CUSTNO OVERLIB/OVERFILE)", raw: "REFFLD(CUSTNO OVERLIB/OVERFILE)", sourceLineIndex: 2 }],
  });
  const target = resolveReferenceTarget(model, record, field);
  assert.deepEqual(target, { fieldName: "CUSTNO", library: "OVERLIB", file: "OVERFILE" });
});

test("resolveReferenceTarget: REFFLD(field *SRC) is unresolvable — no live file to query", () => {
  const { model, record, field } = makeModel({
    fieldReference: true,
    fieldKeywords: [{ name: "REFFLD", params: "(CUSTNO *SRC)", raw: "REFFLD(CUSTNO *SRC)", sourceLineIndex: 2 }],
  });
  assert.equal(resolveReferenceTarget(model, record, field), null);
});

test("resolveReferenceTarget: a field not flagged as a reference (position 29 blank) is never resolved, even with REF/REFFLD present", () => {
  const { model, record, field } = makeModel({
    fieldReference: false,
    fileRef: "CUSTMAST",
    fieldKeywords: [{ name: "REFFLD", params: "(CUSTNO CUSTMAST)", raw: "REFFLD(CUSTNO CUSTMAST)", sourceLineIndex: 2 }],
  });
  assert.equal(resolveReferenceTarget(model, record, field), null);
});

test("resolveReferenceTarget: nothing to resolve against when reference is set but no REF/REFFLD exists anywhere", () => {
  const { model, record, field } = makeModel({ fieldReference: true });
  assert.equal(resolveReferenceTarget(model, record, field), null);
});

test("upsertReffldKeyword: adds a REFFLD keyword with library/file when none existed", () => {
  const result = upsertReffldKeyword([], { fieldName: "custno", library: "custlib", file: "custmast" });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "REFFLD");
  assert.equal(result[0].raw, "REFFLD(CUSTNO CUSTLIB/CUSTMAST)");
});

test("upsertReffldKeyword: replaces an existing REFFLD rather than duplicating it", () => {
  const existing = [{ name: "REFFLD", params: "(OLDFLD OLDLIB/OLDFILE)", raw: "REFFLD(OLDFLD OLDLIB/OLDFILE)", sourceLineIndex: 5 }];
  const result = upsertReffldKeyword(existing, { fieldName: "NEWFLD", library: null, file: "NEWFILE" });
  assert.equal(result.length, 1);
  assert.equal(result[0].raw, "REFFLD(NEWFLD NEWFILE)");
});

test("upsertReffldKeyword: a null target removes REFFLD but leaves other keywords untouched", () => {
  const existing = [
    { name: "EDTCDE", params: "(J)", raw: "EDTCDE(J)", sourceLineIndex: 5 },
    { name: "REFFLD", params: "(OLDFLD OLDLIB/OLDFILE)", raw: "REFFLD(OLDFLD OLDLIB/OLDFILE)", sourceLineIndex: 5 },
  ];
  const result = upsertReffldKeyword(existing, null);
  assert.deepEqual(result.map((k: any) => k.name), ["EDTCDE"]);
});

test("round trip: a field carrying REFFLD survives parse -> regenerate unchanged", () => {
  const original = [
    "                R HEADER",
    "        50        CUSTNBR        7S 0B  1 50REFFLD(CUSTNO CUSTLIB/CUSTMAST)",
  ].join("\n") + "\n";
  // Position 29 must be 'R' for the reference flag - rebuild the second
  // line precisely at that column so this test doesn't depend on hand
  // counting spaces drifting out of sync with prtfModel.ts's documented
  // column layout.
  const lines = original.split("\n");
  const fieldLine = lines[1];
  const withRef = fieldLine.slice(0, 28) + "R" + fieldLine.slice(29);
  lines[1] = withRef;
  const text = lines.join("\n");

  const model = parseSource(text);
  const header = model.records.find((r) => r.name === "HEADER")!;
  const custnbr: any = header.fields.find((f: any) => f.kind === "field" && f.name === "CUSTNBR");
  assert.equal(custnbr.reference, true);
  const reffld = custnbr.keywords.find((k: any) => k.name === "REFFLD");
  assert.ok(reffld, "expected REFFLD keyword to be parsed");

  const target = resolveReferenceTarget(model, header, custnbr);
  assert.deepEqual(target, { fieldName: "CUSTNO", library: "CUSTLIB", file: "CUSTMAST" });

  const regenerated = regenerateSource(model);
  assert.equal(regenerated, text);
});
