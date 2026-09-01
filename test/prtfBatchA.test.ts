// Tests for docs/TASKS.md Batch A — general properties-panel keyword
// editing: EDTCDE (two-part), EDTWRD, DATFMT/DATSEP, TIMFMT/TIMSEP, DFT
// (field-only, per IBM's DDS date/time field example); DATE/TIME/PAGNBR,
// MSGCON (constant-only, per IBM's DDS syntax overview); COLOR, HIGHLIGHT,
// UNDERLINE (shared); PRTQLTY/DRAWER/PAGRTT (record-level).
//
// Follows the same fixture-reuse pattern as test/prtfBatchB.test.ts:
// mutate sample1.pf's already-parsed model in memory, round-trip it through
// the real writer/parser, and assert on the reparsed result — rather than
// hand-building fixture source, since the writer/parser pairing is what's
// actually under test here, not the fixture's own content.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

const fixturePath = path.join(__dirname, "fixtures", "sample1.pf");

function withRecordKeyword(model: any, recordName: string, keyword: { name: string; params: string; raw: string }) {
  const record = model.records.find((r: any) => r.name === recordName);
  record.keywords.push({ ...keyword, sourceLineIndex: -1 });
  return model;
}

function withFieldKeyword(model: any, recordName: string, fieldName: string, keyword: { name: string; params: string; raw: string }) {
  const record = model.records.find((r: any) => r.name === recordName);
  const field = record.fields.find((f: any) => f.kind === "field" && f.name === fieldName);
  field.keywords.push({ ...keyword, sourceLineIndex: -1 });
  return model;
}

/** Adds a keyword to the nth constant entry (0-indexed, in source order) within a record — constants have no name to look up by. */
function withConstantKeyword(model: any, recordName: string, constantIndex: number, keyword: { name: string; params: string; raw: string }) {
  const record = model.records.find((r: any) => r.name === recordName);
  const constants = record.fields.filter((f: any) => f.kind === "constant");
  constants[constantIndex].keywords.push({ ...keyword, sourceLineIndex: -1 });
  return model;
}

function roundTrip(model: any) {
  const regenerated = regenerateSource(model);
  return parseSource(regenerated);
}

test("Batch A round-trip: record-level PRTQLTY/DRAWER/PAGRTT/HIGHLIGHT survive regenerate + reparse", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  model = withRecordKeyword(model, "HEADER", { name: "PRTQLTY", params: "(*NLQ)", raw: "PRTQLTY(*NLQ)" });
  model = withRecordKeyword(model, "HEADER", { name: "DRAWER", params: "(2)", raw: "DRAWER(2)" });
  model = withRecordKeyword(model, "HEADER", { name: "PAGRTT", params: "(90)", raw: "PAGRTT(90)" });
  model = withRecordKeyword(model, "HEADER", { name: "HIGHLIGHT", params: "", raw: "HIGHLIGHT" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r: any) => r.name === "HEADER")!;
  assert.ok(PrtfEngine.findKeyword(header.keywords, "PRTQLTY"));
  assert.equal(PrtfEngine.findKeyword(header.keywords, "DRAWER").params, "(2)");
  assert.equal(PrtfEngine.findKeyword(header.keywords, "PAGRTT").params, "(90)");
  assert.ok(PrtfEngine.findKeyword(header.keywords, "HIGHLIGHT"));
});

test("Batch A round-trip: field-level EDTWRD, DATFMT, DATSEP, TIMFMT, TIMSEP, DFT survive regenerate + reparse", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  // Single-space EDTWRD content here; a dedicated test below (Batch R)
  // covers multiple consecutive internal spaces inside a quoted literal,
  // which used to be a separate writer bug (now fixed).
  model = withFieldKeyword(model, "HEADER", "CUSTNAME", { name: "EDTWRD", params: "(' . ')", raw: "EDTWRD(' . ')" });
  model = withFieldKeyword(model, "HEADER", "INVDATE", { name: "DATFMT", params: "(*DMY)", raw: "DATFMT(*DMY)" });
  model = withFieldKeyword(model, "HEADER", "INVDATE", { name: "DATSEP", params: "('-')", raw: "DATSEP('-')" });
  model = withFieldKeyword(model, "HEADER", "INVDATE", { name: "TIMFMT", params: "(*HMS)", raw: "TIMFMT(*HMS)" });
  model = withFieldKeyword(model, "HEADER", "INVDATE", { name: "TIMSEP", params: "(':')", raw: "TIMSEP(':')" });
  model = withFieldKeyword(model, "HEADER", "CUSTNBR", { name: "DFT", params: "('0')", raw: "DFT('0')" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r: any) => r.name === "HEADER")!;
  const custname = header.fields.find((f: any) => f.kind === "field" && f.name === "CUSTNAME") as any;
  const invdate = header.fields.find((f: any) => f.kind === "field" && f.name === "INVDATE") as any;
  const custnbr = header.fields.find((f: any) => f.kind === "field" && f.name === "CUSTNBR") as any;
  assert.equal(PrtfEngine.findKeyword(custname.keywords, "EDTWRD").params, "(' . ')");
  assert.equal(PrtfEngine.findKeyword(invdate.keywords, "DATFMT").params, "(*DMY)");
  assert.equal(PrtfEngine.findKeyword(invdate.keywords, "DATSEP").params, "('-')");
  assert.equal(PrtfEngine.findKeyword(invdate.keywords, "TIMFMT").params, "(*HMS)");
  assert.equal(PrtfEngine.findKeyword(invdate.keywords, "TIMSEP").params, "(':')");
  assert.equal(PrtfEngine.findKeyword(custnbr.keywords, "DFT").params, "('0')");
});

test("Batch R (fixed): emitWithKeywords no longer collapses multiple consecutive internal spaces inside a quoted keyword literal", () => {
  // A realistic EDTWRD mask like '  .  ' (multiple spaces are common in real
  // edit-word masks, e.g. for currency column alignment) used to get
  // corrupted to ' . ' by prtfWriter.js's emitWithKeywords, because its
  // tokenizer (`keywordText.trim().split(/\s+/)`) split on ANY whitespace
  // run with no awareness of quote boundaries — the same class of bug as
  // Batch M (docs/TASKS.md), but affecting quoted literal *content* instead
  // of the continuation-wrap point. Fixed by tokenizeKeywordText, which
  // treats an entire quoted span as one indivisible token. This test used
  // to pin down the broken behavior (see git history for the "KNOWN BUG"
  // version); it now asserts the correct, fixed behavior.
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  model = withFieldKeyword(model, "HEADER", "CUSTNAME", { name: "EDTWRD", params: "('  .  ')", raw: "EDTWRD('  .  ')" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r: any) => r.name === "HEADER")!;
  const custname = header.fields.find((f: any) => f.kind === "field" && f.name === "CUSTNAME") as any;
  assert.equal(PrtfEngine.findKeyword(custname.keywords, "EDTWRD").params, "('  .  ')");
});

test("Batch A: existing EDTCDE(J) two-part fixture value (code with no fill char) parses correctly", () => {
  // sample1.pf already has ITEMAMT with EDTCDE(J) — confirms the existing
  // fixture's single-token form keeps working, not just newly-added
  // two-part values.
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const detail = model.records.find((r: any) => r.name === "DETAIL")!;
  const itemamt = detail.fields.find((f: any) => f.kind === "field" && f.name === "ITEMAMT") as any;
  assert.equal(PrtfEngine.findKeyword(itemamt.keywords, "EDTCDE").params, "(J)");
});

test("Batch A round-trip: EDTCDE with both a code and a fill character survives regenerate + reparse", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const detail = model.records.find((r: any) => r.name === "DETAIL")!;
  const itemamt = detail.fields.find((f: any) => f.kind === "field" && f.name === "ITEMAMT") as any;
  // Replace the fixture's plain EDTCDE(J) with a two-part value.
  itemamt.keywords = itemamt.keywords.filter((k: any) => k.name !== "EDTCDE");
  itemamt.keywords.push({ name: "EDTCDE", params: "(J *)", raw: "EDTCDE(J *)", sourceLineIndex: -1 });
  const reparsed = roundTrip(model);
  const reparsedDetail = reparsed.records.find((r: any) => r.name === "DETAIL")!;
  const reparsedItemamt = reparsedDetail.fields.find((f: any) => f.kind === "field" && f.name === "ITEMAMT") as any;
  assert.equal(PrtfEngine.findKeyword(reparsedItemamt.keywords, "EDTCDE").params, "(J *)");
});

test("Batch A round-trip: constant-level DATE/TIME/MSGCON survive regenerate + reparse", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  // HEADER's "Invoice Date:" constant (the only unnamed constant in HEADER
  // at the point this fixture was written) is constant index 0 there.
  model = withConstantKeyword(model, "HEADER", 0, { name: "DATE", params: "", raw: "DATE" });
  model = withConstantKeyword(model, "HEADER", 0, { name: "TIME", params: "", raw: "TIME" });
  model = withConstantKeyword(model, "FOOTER", 0, { name: "MSGCON", params: "(20 MSG0001 MYMSGF *LIBL)", raw: "MSGCON(20 MSG0001 MYMSGF *LIBL)" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r: any) => r.name === "HEADER")!;
  const footer = reparsed.records.find((r: any) => r.name === "FOOTER")!;
  const invoiceDateConst = header.fields.filter((f: any) => f.kind === "constant")[0] as any;
  const pageConst = footer.fields.filter((f: any) => f.kind === "constant")[0] as any;
  assert.ok(PrtfEngine.findKeyword(invoiceDateConst.keywords, "DATE"));
  assert.ok(PrtfEngine.findKeyword(invoiceDateConst.keywords, "TIME"));
  assert.equal(PrtfEngine.findKeyword(pageConst.keywords, "MSGCON").params, "(20 MSG0001 MYMSGF *LIBL)");
});

test("Batch A: existing PAGNBR constant in FOOTER (already in sample1.pf) is found correctly", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const footer = model.records.find((r: any) => r.name === "FOOTER")!;
  const pagnbrConst = footer.fields.filter((f: any) => f.kind === "constant")[1] as any;
  assert.ok(PrtfEngine.findKeyword(pagnbrConst.keywords, "PAGNBR"));
});

test("Batch A round-trip: COLOR named, *RGB, and (inferred-format) *CMYK all survive regenerate + reparse", () => {
  for (const params of ["(*BLU)", "(*RGB 10 20 30)", "(*CMYK 0 0 0 100)"]) {
    let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
    model = withFieldKeyword(model, "HEADER", "CUSTNAME", { name: "COLOR", params, raw: "COLOR" + params });
    const reparsed = roundTrip(model);
    const header = reparsed.records.find((r: any) => r.name === "HEADER")!;
    const custname = header.fields.find((f: any) => f.kind === "field" && f.name === "CUSTNAME") as any;
    assert.equal(PrtfEngine.findKeyword(custname.keywords, "COLOR").params, params, `round-trip failed for COLOR${params}`);
  }
});

test("Batch A round-trip: UNDERLINE (shared field/constant keyword) survives regenerate + reparse", () => {
  let model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  model = withFieldKeyword(model, "HEADER", "CUSTNAME", { name: "UNDERLINE", params: "", raw: "UNDERLINE" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r: any) => r.name === "HEADER")!;
  const custname = header.fields.find((f: any) => f.kind === "field" && f.name === "CUSTNAME") as any;
  assert.ok(PrtfEngine.findKeyword(custname.keywords, "UNDERLINE"));
});

test("DATSEP/TIMSEP quotedSelect distinguishes a literal separator character from the bare *JOB special value", () => {
  let quotedModel = parseSource(fs.readFileSync(fixturePath, "utf8"));
  quotedModel = withFieldKeyword(quotedModel, "HEADER", "INVDATE", { name: "DATSEP", params: "('-')", raw: "DATSEP('-')" });
  let bareModel = parseSource(fs.readFileSync(fixturePath, "utf8"));
  bareModel = withFieldKeyword(bareModel, "HEADER", "INVDATE", { name: "DATSEP", params: "(*JOB)", raw: "DATSEP(*JOB)" });

  const quotedReparsed = roundTrip(quotedModel);
  const bareReparsed = roundTrip(bareModel);
  const quotedInvdate = quotedReparsed.records.find((r: any) => r.name === "HEADER")!.fields.find((f: any) => f.kind === "field" && f.name === "INVDATE") as any;
  const bareInvdate = bareReparsed.records.find((r: any) => r.name === "HEADER")!.fields.find((f: any) => f.kind === "field" && f.name === "INVDATE") as any;
  assert.equal(PrtfEngine.findKeyword(quotedInvdate.keywords, "DATSEP").params, "('-')");
  assert.equal(PrtfEngine.findKeyword(bareInvdate.keywords, "DATSEP").params, "(*JOB)");
});
