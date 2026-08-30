// Round-trip and basic-parse coverage for the two new fixtures added
// alongside docs/KEYWORD-INVENTORY.md: sample-scs.pf (deliberately no
// AFPDS-only keywords) and sample-afpds.pf (exercises FONT, CDEFNT, COLOR,
// CHRSIZ, PAGSEG, record-level OVERLAY, STRPAGGRP/ENDPAGGRP, DUPLEX/OUTBIN,
// and a program-to-system-field parameter). These fixtures exist so future
// task batches (see docs/TASKS.md) have concrete source to test keyword
// rendering/UI work against, beyond sample1.pf's existing keyword set.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource } = require("../src/prtfWriter.js");

const scsFixturePath = path.join(__dirname, "fixtures", "sample-scs.pf");
const afpdsFixturePath = path.join(__dirname, "fixtures", "sample-afpds.pf");

test("SCS fixture: round-trip parse then regenerate reproduces the original source exactly", () => {
  const original = fs.readFileSync(scsFixturePath, "utf8");
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
});

test("SCS fixture: contains no AFPDS-only keywords", () => {
  const original = fs.readFileSync(scsFixturePath, "utf8");
  const model = parseSource(original);
  const afpdsOnlyKeywords = new Set([
    "FONT", "CDEFNT", "FNTCHRSET", "FONTNAME", "CHRSIZ", "CHRID", "COLOR",
    "PAGSEG", "OVERLAY", "STRPAGGRP", "ENDPAGGRP", "DOCIDXTAG", "AFPRSC",
    "DTASTMCMD", "LINE", "BOX", "BARCODE",
  ]);
  const allKeywordNames = [
    ...model.fileLevel.keywords.map((k: any) => k.name),
    ...model.records.flatMap((r: any) => [
      ...r.keywords.map((k: any) => k.name),
      ...r.fields.flatMap((f: any) => f.keywords.map((k: any) => k.name)),
    ]),
  ];
  for (const name of allKeywordNames) {
    assert.ok(!afpdsOnlyKeywords.has(name), `${name} should not appear in the SCS fixture`);
  }
  assert.ok(allKeywordNames.includes("DEVTYPE"));
});

test("SCS fixture: record formats and a conditioned-free field layout parse correctly", () => {
  const original = fs.readFileSync(scsFixturePath, "utf8");
  const model = parseSource(original);
  assert.deepEqual(
    model.records.map((r: any) => r.name),
    ["HEADER", "DETAIL", "FOOTER"]
  );
  const detail = model.records.find((r: any) => r.name === "DETAIL")!;
  const salesamt = detail.fields.find((f: any) => f.kind === "field" && f.name === "SALESAMT") as any;
  assert.equal(salesamt.length, 9);
  assert.equal(salesamt.decimalPositions, 2);
});

test("AFPDS fixture: round-trip parse then regenerate reproduces the original source exactly", () => {
  const original = fs.readFileSync(afpdsFixturePath, "utf8");
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
});

test("AFPDS fixture: record-level STRPAGGRP/ENDPAGGRP and PAGSEG/OVERLAY round-trip", () => {
  const original = fs.readFileSync(afpdsFixturePath, "utf8");
  const model = parseSource(original);
  const header = model.records.find((r: any) => r.name === "STMTHDR")!;
  const footer = model.records.find((r: any) => r.name === "STMTFTR")!;
  assert.ok(header.keywords.some((k: any) => k.name === "STRPAGGRP"));
  assert.ok(header.keywords.some((k: any) => k.name === "PAGSEG" && k.params === "(COMPLOGO 0.5 0.5)"));
  assert.ok(header.keywords.some((k: any) => k.name === "OVERLAY" && k.params === "(STMTFORM 0 0)"));
  assert.ok(footer.keywords.some((k: any) => k.name === "ENDPAGGRP"));
});

test("AFPDS fixture: COLOR keyword captures both named and *RGB forms", () => {
  const original = fs.readFileSync(afpdsFixturePath, "utf8");
  const model = parseSource(original);
  const header = model.records.find((r: any) => r.name === "STMTHDR")!;
  const constEntry = header.fields.find((f: any) => f.kind === "constant") as any;
  const custname = header.fields.find((f: any) => f.kind === "field" && f.name === "CUSTNAME") as any;
  assert.ok(constEntry.keywords.some((k: any) => k.name === "COLOR" && k.params === "(*BLU)"));
  assert.ok(custname.keywords.some((k: any) => k.name === "COLOR" && k.params === "(*RGB 0 0 0)"));
});

test("AFPDS fixture: program-to-system-field (&NAME) parameter round-trips as literal text", () => {
  const original = fs.readFileSync(afpdsFixturePath, "utf8");
  const model = parseSource(original);
  const header = model.records.find((r: any) => r.name === "STMTHDR")!;
  const acctbal = header.fields.find((f: any) => f.kind === "field" && f.name === "ACCTBAL") as any;
  const cdefnt = acctbal.keywords.find((k: any) => k.name === "CDEFNT");
  assert.equal(cdefnt.params, "(&CURFONT)");
});
