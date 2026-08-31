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

function roundTrip(model: any) {
  const regenerated = regenerateSource(model);
  return parseSource(regenerated);
}

test("Batch B round-trip: FONT with a literal FGID and *POINTSIZE survives regenerate + reparse", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  withRecordKeyword(model, "HEADER", { name: "FONT", params: "(2304 (*POINTSIZE 18 10))", raw: "FONT(2304 (*POINTSIZE 18 10))" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  const kw = PrtfEngine.findKeyword(header.keywords, "FONT");
  assert.ok(kw);
  const parsed = PrtfEngine.parseFontKeyword(kw);
  assert.equal(parsed.fgid, "2304");
  assert.deepEqual(parsed.pointSize, { height: 18, width: 10 });
});

test("Batch B round-trip: FONT with a P-field FGID survives regenerate + reparse and is flagged approximate", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  withRecordKeyword(model, "HEADER", { name: "FONT", params: "(&MYFONT)", raw: "FONT(&MYFONT)" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  const kw = PrtfEngine.findKeyword(header.keywords, "FONT");
  assert.ok(kw);
  assert.equal(PrtfEngine.paramTokens(kw)[0], "&MYFONT");
  assert.ok(PrtfEngine.isFieldRef(PrtfEngine.paramTokens(kw)[0]));
  const parsed = PrtfEngine.parseFontKeyword(kw);
  assert.equal(parsed.approximate, true);
});

test("Batch B round-trip: CDEFNT with name + library + *POINTSIZE survives regenerate + reparse", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  withRecordKeyword(model, "HEADER", { name: "CDEFNT", params: "(X0N51EHC QFNTCPL (*POINTSIZE 12))", raw: "CDEFNT(X0N51EHC QFNTCPL (*POINTSIZE 12))" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  const kw = PrtfEngine.findKeyword(header.keywords, "CDEFNT");
  assert.ok(kw);
  const tokens = PrtfEngine.paramTokens(kw);
  assert.equal(tokens[0], "X0N51EHC");
  assert.equal(tokens[1], "QFNTCPL");
});

test("Batch B round-trip: CDEFNT with a P-field name survives regenerate + reparse", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  withRecordKeyword(model, "HEADER", { name: "CDEFNT", params: "(&FONTFLD)", raw: "CDEFNT(&FONTFLD)" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  const kw = PrtfEngine.findKeyword(header.keywords, "CDEFNT");
  assert.equal(PrtfEngine.paramTokens(kw)[0], "&FONTFLD");
});

test("Batch B round-trip: FNTCHRSET with all four name/library params survives regenerate + reparse", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  withRecordKeyword(model, "HEADER", {
    name: "FNTCHRSET",
    params: "(C0S0CR10 QFNTCPL T1V10500 QFNTCPL)",
    raw: "FNTCHRSET(C0S0CR10 QFNTCPL T1V10500 QFNTCPL)",
  });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  const kw = PrtfEngine.findKeyword(header.keywords, "FNTCHRSET");
  const tokens = PrtfEngine.paramTokens(kw);
  assert.deepEqual(tokens, ["C0S0CR10", "QFNTCPL", "T1V10500", "QFNTCPL"]);
});

test("Batch B round-trip: FONTNAME with a literal name survives regenerate + reparse", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  withRecordKeyword(model, "HEADER", { name: "FONTNAME", params: "(ARIAL)", raw: "FONTNAME(ARIAL)" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  assert.equal(PrtfEngine.paramTokens(PrtfEngine.findKeyword(header.keywords, "FONTNAME"))[0], "ARIAL");
});

test("Batch B round-trip: FONTNAME with a P-field survives regenerate + reparse", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  withRecordKeyword(model, "HEADER", { name: "FONTNAME", params: "(&FNTNMFLD)", raw: "FONTNAME(&FNTNMFLD)" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  assert.equal(PrtfEngine.paramTokens(PrtfEngine.findKeyword(header.keywords, "FONTNAME"))[0], "&FNTNMFLD");
});

test("Batch B round-trip: CHRID with literal charset/codepage survives regenerate + reparse", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  withRecordKeyword(model, "HEADER", { name: "CHRID", params: "(697 500)", raw: "CHRID(697 500)" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  assert.deepEqual(PrtfEngine.paramTokens(PrtfEngine.findKeyword(header.keywords, "CHRID")), ["697", "500"]);
});

test("Batch B round-trip: CHRSIZ width/height multipliers survive regenerate + reparse", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  withRecordKeyword(model, "HEADER", { name: "CHRSIZ", params: "(1.5 2.0)", raw: "CHRSIZ(1.5 2.0)" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  assert.deepEqual(PrtfEngine.paramTokens(PrtfEngine.findKeyword(header.keywords, "CHRSIZ")), ["1.5", "2.0"]);
});

test("Batch B round-trip: CCSID survives regenerate + reparse", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  withRecordKeyword(model, "HEADER", { name: "CCSID", params: "(37)", raw: "CCSID(37)" });
  const reparsed = roundTrip(model);
  const header = reparsed.records.find((r) => r.name === "HEADER")!;
  assert.equal(PrtfEngine.paramTokens(PrtfEngine.findKeyword(header.keywords, "CCSID"))[0], "37");
});

test("Batch B validation: HIGHLIGHT is flagged when CDEFNT is also coded", () => {
  const keywords = [
    { name: "CDEFNT", params: "(X0N51EHC)", raw: "CDEFNT(X0N51EHC)", sourceLineIndex: -1 },
    { name: "HIGHLIGHT", params: "", raw: "HIGHLIGHT", sourceLineIndex: -1 },
  ];
  const warnings = PrtfEngine.validateFontKeywords(keywords);
  assert.ok(warnings.some((w: any) => w.keyword === "HIGHLIGHT"));
});

test("Batch B validation: CHRID is flagged when FNTCHRSET is also coded", () => {
  const keywords = [
    { name: "FNTCHRSET", params: "(C0S0CR10 QFNTCPL T1V10500 QFNTCPL)", raw: "FNTCHRSET(...)", sourceLineIndex: -1 },
    { name: "CHRID", params: "(697 500)", raw: "CHRID(697 500)", sourceLineIndex: -1 },
  ];
  const warnings = PrtfEngine.validateFontKeywords(keywords);
  assert.ok(warnings.some((w: any) => w.keyword === "CHRID"));
});

test("Batch B validation: CHRSIZ always gets an IPDS/HPT warning when present", () => {
  const keywords = [{ name: "CHRSIZ", params: "(1.5 2.0)", raw: "CHRSIZ(1.5 2.0)", sourceLineIndex: -1 }];
  const warnings = PrtfEngine.validateFontKeywords(keywords);
  assert.ok(warnings.some((w: any) => w.keyword === "CHRSIZ"));
});

test("Batch B validation: no warnings when there's nothing to flag", () => {
  const keywords = [{ name: "FONT", params: "(11)", raw: "FONT(11)", sourceLineIndex: -1 }];
  assert.deepEqual(PrtfEngine.validateFontKeywords(keywords), []);
});

test("Batch B: field-level FONT/CDEFNT/etc. keywords round-trip the same way as record-level", () => {
  const model = parseSource(fs.readFileSync(fixturePath, "utf8"));
  const header = model.records.find((r) => r.name === "HEADER")!;
  const custname = header.fields.find((f: any) => f.name === "CUSTNAME") as any;
  custname.keywords.push({ name: "FONT", params: "(2308 (*POINTSIZE 14))", raw: "FONT(2308 (*POINTSIZE 14))", sourceLineIndex: -1 });
  const reparsed = roundTrip(model);
  const header2 = reparsed.records.find((r) => r.name === "HEADER")!;
  const custname2 = header2.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNAME") as any;
  const kw = PrtfEngine.findKeyword(custname2.keywords, "FONT");
  assert.ok(kw);
  const parsed = PrtfEngine.parseFontKeyword(kw);
  assert.equal(parsed.fgid, "2308");
  assert.deepEqual(parsed.pointSize, { height: 14, width: undefined });
});
