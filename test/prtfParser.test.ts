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

test("parser: assigns a stable, unique id to every field and constant", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const ids = model.records.flatMap((r) => r.fields.map((f: any) => f.id));
  assert.equal(ids.length, new Set(ids).size, "ids should be unique");
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
});

test("edit: addField inserts a new field into the record and source, and round-trips", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  const newField: any = {
    kind: "field",
    id: "tmpNEW",
    sourceLineIndex: -1,
    name: "CUSTPHN",
    reference: false,
    length: 12,
    dataType: "A",
    usage: "O",
    line: 2,
    position: 10,
    conditions: [],
    keywords: [],
  };
  header.fields.push(newField);
  const anchor = header.fields[header.fields.length - 2];
  const anchorIndex = model.sequence.indexOf(anchor);
  model.sequence.splice(anchorIndex + 1, 0, newField);

  const regenerated = regenerateSource(model);
  const reparsed = parseSource(regenerated);
  const header2 = reparsed.records.find((r) => r.name === "HEADER")!;
  const added = header2.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTPHN") as any;
  assert.ok(added, "new field should be present after regenerate + reparse");
  assert.equal(added.length, 12);
  assert.equal(added.line, 2);
  assert.equal(added.position, 10);
  // Original fields should still all be present.
  assert.ok(header2.fields.some((f: any) => f.name === "CUSTNAME"));
  assert.ok(header2.fields.some((f: any) => f.name === "CUSTNBR"));
});

test("edit: addConstant inserts a new literal constant and round-trips", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const footer = model.records.find((r) => r.name === "FOOTER")!;
  const newConst: any = {
    kind: "constant",
    id: "tmpNEW2",
    sourceLineIndex: -1,
    literal: "Thank you",
    line: 3,
    position: 5,
    conditions: [],
    keywords: [],
  };
  footer.fields.push(newConst);
  model.sequence.push(newConst);

  const regenerated = regenerateSource(model);
  const reparsed = parseSource(regenerated);
  const footer2 = reparsed.records.find((r) => r.name === "FOOTER")!;
  const added = footer2.fields.find((f) => f.kind === "constant" && (f as any).literal === "Thank you") as any;
  assert.ok(added, "new constant should be present after regenerate + reparse");
  assert.equal(added.line, 3);
  assert.equal(added.position, 5);
});

test("edit: delete removes a field from both the record and the sequence, and round-trips", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const detail = model.records.find((r) => r.name === "DETAIL")!;
  const target = detail.fields.find((f) => f.kind === "field" && (f as any).name === "ITEMQTY") as any;
  const fieldsIndex = detail.fields.indexOf(target);
  detail.fields.splice(fieldsIndex, 1);
  const seqIndex = model.sequence.indexOf(target);
  model.sequence.splice(seqIndex, 1);

  const regenerated = regenerateSource(model);
  const reparsed = parseSource(regenerated);
  const detail2 = reparsed.records.find((r) => r.name === "DETAIL")!;
  assert.ok(!detail2.fields.some((f: any) => f.name === "ITEMQTY"));
  // Siblings should be unaffected.
  assert.ok(detail2.fields.some((f: any) => f.name === "ITEMDESC"));
  assert.ok(detail2.fields.some((f: any) => f.name === "ITEMAMT"));
});

test("edit: updateField changes attributes in place and round-trips", () => {
  const original = fs.readFileSync(fixturePath, "utf8");
  const model = parseSource(original);
  const detail = model.records.find((r) => r.name === "DETAIL")!;
  const target = detail.fields.find((f) => f.kind === "field" && (f as any).name === "ITEMDESC") as any;
  Object.assign(target, { name: "ITEMDESC2", length: 25, usage: "B" });

  const regenerated = regenerateSource(model);
  const reparsed = parseSource(regenerated);
  const detail2 = reparsed.records.find((r) => r.name === "DETAIL")!;
  const updated = detail2.fields.find((f) => f.kind === "field" && (f as any).name === "ITEMDESC2") as any;
  assert.ok(updated);
  assert.equal(updated.length, 25);
  assert.equal(updated.usage, "B");
});
