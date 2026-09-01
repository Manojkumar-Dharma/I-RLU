import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, upsertReffldKeyword } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveReferenceTarget, mapDspffdRowToAttributes, groupDatabaseFileFieldRows } = require("../src/prtfEngine.js");

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

/**
 * Batch H "remaining" piece — the field/record-format picker
 * (docs/TASKS.md). mapDspffdRowToAttributes and groupDatabaseFileFieldRows
 * are the pure "given DSPFFD OUTFILE rows, work out what they mean" half
 * of extension.ts's fetchDatabaseFileFields — the DSPFFD command/SQL
 * itself, and the two-step "fetch, maybe disambiguate a record format,
 * fetch again" QuickPick flow around it, need a live Code for i connection
 * and have no test here, same reasoning docs/ROADMAP.md already gives for
 * why fetchReferencedFieldAttributes (part 2 of this same batch) has none
 * either — no established pattern in this codebase (or I-SDA's) for
 * mocking Code for i.
 */

test("mapDspffdRowToAttributes: character field uses WHFLDB (byte length), no decimals", () => {
  const attrs = mapDspffdRowToAttributes({ WHFLDT: "A", WHFLDB: 25, WHFLDD: 0, WHFLDP: 0 });
  assert.deepEqual(attrs, { length: 25, dataType: "", decimalPositions: null });
});

test("mapDspffdRowToAttributes: numeric field uses WHFLDD (total digits) and WHFLDP as decimals", () => {
  const attrs = mapDspffdRowToAttributes({ WHFLDT: "S", WHFLDB: 4, WHFLDD: 9, WHFLDP: 2 });
  assert.deepEqual(attrs, { length: 9, dataType: "S", decimalPositions: 2 });
});

test("mapDspffdRowToAttributes: WHFLDP of 0 means no decimals (null, not 0)", () => {
  const attrs = mapDspffdRowToAttributes({ WHFLDT: "S", WHFLDB: 4, WHFLDD: 7, WHFLDP: 0 });
  assert.equal(attrs.decimalPositions, null);
});

test("mapDspffdRowToAttributes: accepts lowercase column names too (some Code for i connection shapes lowercase them)", () => {
  const attrs = mapDspffdRowToAttributes({ whfldt: "P", whfldb: 4, whfldd: 5, whfldp: 0 });
  assert.deepEqual(attrs, { length: 5, dataType: "P", decimalPositions: null });
});

test("groupDatabaseFileFieldRows: a single-format file returns the field list directly, in WHFLDO (row) order", () => {
  const rows = [
    { WHNAME: "CUSTREC", WHFLDI: "CUSTNBR", WHFTXT: "Customer number", WHFLDT: "S", WHFLDB: 7, WHFLDD: 7, WHFLDP: 0 },
    { WHNAME: "CUSTREC", WHFLDI: "CUSTNAME", WHFTXT: "Customer name", WHFLDT: "A", WHFLDB: 30, WHFLDD: 0, WHFLDP: 0 },
  ];
  const result = groupDatabaseFileFieldRows(rows, undefined);
  assert.deepEqual(result, {
    recordFormat: "CUSTREC",
    fields: [
      { name: "CUSTNBR", text: "Customer number", length: 7, dataType: "S", decimalPositions: null },
      { name: "CUSTNAME", text: "Customer name", length: 30, dataType: "", decimalPositions: null },
    ],
  });
});

test("groupDatabaseFileFieldRows: a multi-format file (no recordFormat given) returns the distinct format names, not a mixed field list", () => {
  const rows = [
    { WHNAME: "FORMAT1", WHFLDI: "FLD1", WHFTXT: "", WHFLDT: "A", WHFLDB: 5, WHFLDD: 0, WHFLDP: 0 },
    { WHNAME: "FORMAT2", WHFLDI: "FLD2", WHFTXT: "", WHFLDT: "A", WHFLDB: 5, WHFLDD: 0, WHFLDP: 0 },
    { WHNAME: "FORMAT1", WHFLDI: "FLD3", WHFTXT: "", WHFLDT: "A", WHFLDB: 5, WHFLDD: 0, WHFLDP: 0 },
  ];
  const result = groupDatabaseFileFieldRows(rows, undefined);
  assert.deepEqual(result, { formats: ["FORMAT1", "FORMAT2"] });
});

test("groupDatabaseFileFieldRows: once a recordFormat IS given, returns that format's fields even if the file has others", () => {
  const rows = [
    // Caller already filtered the SQL to WHNAME = 'FORMAT1' (extension.ts's
    // fetchDatabaseFileFields does this via its own SQL WHERE clause when
    // recordFormat is passed) — this function trusts what it's handed.
    { WHFLDI: "FLD1", WHFTXT: "", WHFLDT: "A", WHFLDB: 5, WHFLDD: 0, WHFLDP: 0 },
  ];
  const result = groupDatabaseFileFieldRows(rows, "FORMAT1");
  assert.deepEqual(result, { recordFormat: "FORMAT1", fields: [{ name: "FLD1", text: "", length: 5, dataType: "", decimalPositions: null }] });
});

test("groupDatabaseFileFieldRows: empty rows produce an error, distinguishing 'no such format' from 'no such file/no fields'", () => {
  assert.deepEqual(groupDatabaseFileFieldRows([], undefined), { error: "No fields found." });
  assert.deepEqual(groupDatabaseFileFieldRows([], "NOSUCHFMT"), { error: 'Record format "NOSUCHFMT" was not found.' });
});

test("groupDatabaseFileFieldRows: accepts lowercase column names too", () => {
  const rows = [{ whname: "CUSTREC", whfldi: "CUSTNBR", whftxt: "", whfldt: "S", whfldb: 7, whfldd: 7, whfldp: 0 }];
  const result = groupDatabaseFileFieldRows(rows, undefined);
  assert.deepEqual(result, { recordFormat: "CUSTREC", fields: [{ name: "CUSTNBR", text: "", length: 7, dataType: "S", decimalPositions: null }] });
});
