import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveLayout, listRecordNames, collectIndicators } = require("../src/prtfEngine.js");

const fixturePath = path.join(__dirname, "fixtures", "sample1.pf");

test("round-trip: parse then regenerate reproduces the original source exactly", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
});

test("parser: extracts record formats in order", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  assert.deepEqual(
    model.records.map((r) => r.name),
    ["HEADER", "DETAIL", "FOOTER"]
  );
});

test("parser: field attributes are read from the correct columns", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  const custname = header.fields.find((f) => f.kind === "field" && f.name === "CUSTNAME") as any;
  assert.equal(custname.length, 30);
  assert.equal(custname.dataType, "A");
  assert.equal(custname.usage, "B");
  assert.equal(custname.line, 1);
  assert.equal(custname.position, 10);
});

test("parser: conditioning indicator is captured on a field", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  const custnbr = header.fields.find((f) => f.kind === "field" && f.name === "CUSTNBR") as any;
  assert.equal(custnbr.conditions.length, 1);
  assert.equal(custnbr.conditions[0].indicator, "50");
  assert.equal(custnbr.conditions[0].negate, false);
});

test("parser: constant literal text is captured", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  const constEntry = header.fields.find((f) => f.kind === "constant") as any;
  assert.equal(constEntry.literal, "Invoice Date:");
});

test("parser: file-level keywords (PAGSIZE) captured before first record", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const pagsize = model.fileLevel.keywords.find((k) => k.name === "PAGSIZE");
  assert.ok(pagsize);
  assert.equal(pagsize!.params, "(66 132)");
});

test("engine: resolves page size and default (unconditioned) field layout", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  assert.deepEqual(listRecordNames(model), ["HEADER", "DETAIL", "FOOTER"]);
  const layout = resolveLayout(model, "HEADER", {});
  assert.equal(layout.pageLines, 66);
  assert.equal(layout.pageCols, 132);
  // CUSTNBR is conditioned on indicator 50, which is off by default, so it
  // should be skipped, and CUSTNAME should still be present.
  const names = layout.cells.map((c: any) => c.name || c.text);
  assert.ok(names.includes("CUSTNAME"));
  assert.ok(!names.includes("CUSTNBR"));
  assert.ok(layout.skippedByIndicator.includes("CUSTNBR"));
});

test("engine: turning on indicator 50 includes the conditioned field", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const layout = resolveLayout(model, "HEADER", { "50": true });
  const names = layout.cells.map((c: any) => c.name || c.text);
  assert.ok(names.includes("CUSTNBR"));
});

test("engine: collectIndicators finds every indicator referenced in a record", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  assert.deepEqual(collectIndicators(header), ["50"]);
});

test("edit round-trip: changing a field's position and re-emitting keeps the file valid", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  const custname = header.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNAME") as any;
  custname.position = 20;
  const regenerated = regenerateSource(model);
  const reparsed = parseSource(regenerated);
  const header2 = reparsed.records.find((r) => r.name === "HEADER")!;
  const custname2 = header2.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNAME") as any;
  assert.equal(custname2.position, 20);
  // Everything else in the file should be untouched by this single edit.
  const custnbr2 = header2.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNBR") as any;
  assert.equal(custnbr2.position, 50);
});
