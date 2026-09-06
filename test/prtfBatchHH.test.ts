// Tests for docs/TASKS.md Batch HH — design-time-only per-field sample
// value (real RLU's SD sequence command), shown in the design preview in
// place of "{FIELDNAME}".
//
// Persistence scope note (see FieldEntry.sampleValue's own comment in
// src/prtfModel.ts for the full reasoning): real RLU's own line-type model
// treats a "Sample line" as one of its four persisted line types, which
// suggests real RLU does carry sample data across STRRLU sessions — but no
// confirmed reference was found for the exact raw-source encoding it uses,
// so this batch deliberately keeps sample data OUT of the DDS source
// entirely (in-memory FieldEntry.sampleValue only, lost on re-parsing the
// file), the fallback this batch's own docs/TASKS.md entry explicitly
// allowed ("no writer/round-trip test needed if kept out of DDS source
// entirely"). Accordingly: no writer/round-trip test here, and no
// parser test — src/prtfParser.ts is untouched by this batch.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSource } from "../src/prtfParser";
import { applyEditToModel } from "../src/prtfEdits";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

const fixturePath = path.join(__dirname, "fixtures", "sample1.pf");

function cellFor(layout: any, name: string) {
  return layout.cells.find((c: any) => c.name === name);
}

test("Batch HH: formatSampleValue truncates (never overflows) a value longer than the field's length", () => {
  assert.equal(PrtfEngine.formatSampleValue("HELLO WORLD", 5, "A", undefined), "HELLO");
});

test("Batch HH: formatSampleValue leaves a character value left-justified, unpadded", () => {
  assert.equal(PrtfEngine.formatSampleValue("Jones", 10, "A", undefined), "Jones");
});

test("Batch HH: formatSampleValue inserts a decimal point for a numeric (S) field with decimal positions, right-justified", () => {
  const result = PrtfEngine.formatSampleValue("123.45", 9, "S", 2);
  assert.equal(result.trim(), "123.45");
  assert.equal(result.length, 9);
});

test("Batch HH: formatSampleValue on a non-numeric-parseable value for a numeric field falls back to the raw text truncated to length", () => {
  const result = PrtfEngine.formatSampleValue("N/A", 9, "S", 2);
  assert.equal(result, "N/A".padStart(9, " "));
});

test("Batch HH: setFieldSampleValue sets a field's sample value", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const record = model.records.find((r) => r.name === "HEADER")!;
  const field = record.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNAME")! as any;
  const ok = applyEditToModel(model, { kind: "setFieldSampleValue", id: field.id, sampleValue: "Acme Corp" });
  assert.equal(ok, true);
  assert.equal(field.sampleValue, "Acme Corp");
});

test("Batch HH: setFieldSampleValue with an empty string clears a previously-set sample value", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const record = model.records.find((r) => r.name === "HEADER")!;
  const field = record.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNAME")! as any;
  applyEditToModel(model, { kind: "setFieldSampleValue", id: field.id, sampleValue: "Acme Corp" });
  applyEditToModel(model, { kind: "setFieldSampleValue", id: field.id, sampleValue: "" });
  assert.equal(field.sampleValue, undefined);
});

test("Batch HH: setFieldSampleValue rejects a constant id (sample data is field-only)", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const record = model.records.find((r) => r.name === "HEADER")!;
  const constant = record.fields.find((f) => f.kind === "constant")! as any;
  const ok = applyEditToModel(model, { kind: "setFieldSampleValue", id: constant.id, sampleValue: "should not apply" });
  assert.equal(ok, false);
  assert.equal(constant.sampleValue, undefined);
});

test("Batch HH: resolveLayout carries sampleValue/sampleDisplay on a field's cell once set", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const record = model.records.find((r) => r.name === "HEADER")!;
  const field = record.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNAME")! as any;
  field.sampleValue = "Acme Corp";
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});
  const cell = cellFor(layout, "CUSTNAME");
  assert.equal(cell.sampleValue, "Acme Corp");
  assert.equal(cell.sampleDisplay, "Acme Corp"); // length 30, well within it, character type -> unpadded
});

test("Batch HH: resolveLayout leaves sampleDisplay undefined when no sample value is set, so the webview falls back to \"{FIELDNAME}\"", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {});
  const cell = cellFor(layout, "CUSTNAME");
  assert.equal(cell.sampleValue, undefined);
  assert.equal(cell.sampleDisplay, undefined);
});

test("Batch HH: resolveLayout respects the field's own length when formatting a numeric sample value", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const record = model.records.find((r) => r.name === "HEADER")!;
  // CUSTNBR: 7S 0 (zoned decimal, no decimal positions), length 7.
  const field = record.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNBR")! as any;
  field.sampleValue = "12345";
  const layout = PrtfEngine.resolveLayout(model, "HEADER", { 50: true }); // CUSTNBR is conditioned on indicator 50
  const cell = cellFor(layout, "CUSTNBR");
  assert.equal(cell.sampleDisplay.trim(), "12345");
  assert.equal(cell.sampleDisplay.length, 7);
});
