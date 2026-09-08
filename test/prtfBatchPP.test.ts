// Tests for docs/TASKS.md Batch PP — line-preserving keyword regeneration.
//
// Before this batch, src/prtfWriter.js's regenerateSource rebuilt every
// keyword-bearing entry's ENTIRE physical-line block from scratch on every
// single edit (flattening all its keywords into one string and re-wrapping
// via emitWithKeywords), even when only one keyword on one entry actually
// changed. This is the repro Batch AA already documented: adding a single
// COLOR keyword flagged 67 of 93 lines as changed by the mod-tracking
// diff. This batch closes the root cause, not just the symptom AA fixed
// (the column-6 form-type character).
//
// The fix has two layers, both exercised below:
//  1. emitGroupKeywordLines prefers exact byte-for-byte reuse of a
//     conditions-group's ORIGINAL physical source lines whenever the
//     CURRENT keyword set for that run still matches the original text
//     exactly (originalRunRange/originalRunKeywordText, read from
//     ParsedSource.rawLines) — this is what makes an untouched entry, or
//     an untouched run within a touched entry, reproduce byte-identical
//     rather than being silently reflowed.
//  2. packKeywordsPreservingLines is the fallback for anything that
//     doesn't verbatim-match (a genuinely new/edited keyword, or a run
//     whose original composition changed) — it packs using each
//     keyword's own raw text as an atomic unit (never re-tokenized by
//     naive whitespace splitting, which would otherwise split a keyword
//     like LINE/BOX/FNTCHRSET mid-parameter), preferring to keep a keyword
//     on the physical line it already occupied (via sourceLineIndex) when
//     it still fits, and falling back to sub-tokenizing only a single
//     keyword whose own full text can't fit on one line at all.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSource } from "../src/prtfParser";
import { applyEditToModel } from "../src/prtfEdits";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfWriter = require("../src/prtfWriter.js");

const afpdsFixture = path.join(__dirname, "fixtures", "sample-afpds.pf");
const realworldFixture = path.join(__dirname, "fixtures", "scsprt1-realworld.prtf");

function findFieldById(model: any, id: string): any {
  for (const rec of model.records) {
    const f = rec.fields.find((f: any) => f.id === id);
    if (f) return f;
  }
  return undefined;
}

test("Batch PP: adding a keyword to one field does not change any other entry's physical lines", () => {
  const src = fs.readFileSync(afpdsFixture, "utf8");
  const model = parseSource(src);
  const rec = model.records.find((r) => r.name === "STMTHDR")!;
  const custname = rec.fields.find((f) => f.kind === "field" && (f as any).name === "CUSTNAME")! as any;

  applyEditToModel(model, { kind: "setFieldKeyword", id: custname.id, name: "TRNSPRCY", params: "(*NO)" });
  const out = PrtfWriter.regenerateSource(model).split("\n");
  const origLines = src.split(/\r\n|\n/);

  // STMTHDR's own record-level keywords (lines 5-6, 1-based -> index 4-5)
  // and the constant's lines (7-8 -> index 6-7) never touched CUSTNAME at
  // all, so they must be byte-for-byte identical to the original file.
  assert.equal(out[4], origLines[4]);
  assert.equal(out[5], origLines[5]);
  assert.equal(out[6], origLines[6]);
  assert.equal(out[7], origLines[7]);
  // ACCTBAL (the field after CUSTNAME) is also untouched.
  const acctbalLine = origLines[9];
  assert.ok(out.includes(acctbalLine), "ACCTBAL's line must still appear byte-for-byte unchanged");
});

test("Batch PP: an entirely untouched entry whose original keywords wrapped mid-parameter (PAGSEG) round-trips byte-identical", () => {
  const src = fs.readFileSync(afpdsFixture, "utf8");
  const model = parseSource(src);
  // Zero edits applied at all.
  const out = PrtfWriter.regenerateSource(model).split("\n");
  const origLines = src.split(/\r\n|\n/);
  // Lines 5-6 (1-based) hold STRPAGGRP/SKIPB/PAGSEG/OVERLAY, where PAGSEG's
  // own params originally wrap mid-keyword ("PAGSEG(COMPLOGO -" /
  // "0.5 0.5)"). Nothing here was edited, so these must reproduce exactly,
  // not get re-wrapped at whole-keyword boundaries.
  assert.equal(out[4], origLines[4]);
  assert.equal(out[5], origLines[5]);
});

test("Batch PP: editing one keyword among several sharing an original line only reflows that group, not sibling entries", () => {
  const src = fs.readFileSync(afpdsFixture, "utf8");
  const model = parseSource(src);
  const rec = model.records.find((r) => r.name === "STMTHDR")!;
  const constant = rec.fields.find((f) => f.kind === "constant")! as any;

  // The constant's own line originally reads:
  // "1 40'CUSTOMER STATEMENT' CDEFNT(920 -" / "*CURLIB) COLOR(*BLU)" —
  // CDEFNT and COLOR share one original continuation run. Editing only
  // COLOR must not disturb STMTHDR's own (unrelated) record-level keyword
  // line.
  applyEditToModel(model, { kind: "setFieldKeyword", id: constant.id, name: "COLOR", params: "(*RED)" });
  const out = PrtfWriter.regenerateSource(model).split("\n");
  const origLines = src.split(/\r\n|\n/);
  assert.equal(out[4], origLines[4]);
  assert.equal(out[5], origLines[5]);

  const reparsed = parseSource(out.join("\n"));
  const reparsedConstant = reparsed.records.find((r) => r.name === "STMTHDR")!.fields.find((f) => f.kind === "constant")! as any;
  assert.equal(reparsedConstant.literal, "CUSTOMER STATEMENT");
  const cdefnt = reparsedConstant.keywords.find((k: any) => k.name === "CDEFNT");
  const color = reparsedConstant.keywords.find((k: any) => k.name === "COLOR");
  assert.ok(cdefnt, "CDEFNT must survive unedited alongside the edited COLOR");
  assert.equal(color.params, "(*RED)");
});

test("Batch PP: a freshly-added long keyword whose full text can't fit one line wraps safely (no truncation)", () => {
  const model = parseSource(fs.readFileSync(afpdsFixture, "utf8"));
  const rec = model.records.find((r) => r.name === "STMTHDR")!;
  applyEditToModel(model, {
    kind: "setRecordKeyword",
    recordName: "STMTHDR",
    name: "FNTCHRSET",
    params: "(C0S0CR10 QFNTCPL T1V10500 QFNTCPL)",
  });
  const out = PrtfWriter.regenerateSource(model);
  const reparsed = parseSource(out);
  const kw = reparsed.records
    .find((r) => r.name === "STMTHDR")!
    .keywords.find((k) => k.name === "FNTCHRSET")!;
  assert.equal(kw.params, "(C0S0CR10 QFNTCPL T1V10500 QFNTCPL)");
});

test("Batch PP: a freshly-added LINE keyword is never split mid-parameter when it fits on one line", () => {
  const model = parseSource(fs.readFileSync(afpdsFixture, "utf8"));
  applyEditToModel(model, {
    kind: "addDrawKeyword",
    recordName: "STMTFTR",
    name: "LINE",
    params: "(4 3 5 *HRZ .01)",
  } as any);
  const out = PrtfWriter.regenerateSource(model).split("\n");
  // Every physical line's keyword-area text (cols 45-80) must never
  // contain a truncated/split LINE fragment — either the whole
  // "LINE(4 3 5 *HRZ .01)" appears intact on one line, or it's absent.
  const lineLines = out.filter((l: string) => l.includes("LINE("));
  assert.equal(lineLines.length, 1);
  assert.ok(lineLines[0].includes("LINE(4 3 5 *HRZ .01)"));
});

test("Batch PP: a keyword legitimately placed before a constant's literal (real DDS, not just literal-first) still round-trips byte-identical when untouched", () => {
  const src = fs.readFileSync(realworldFixture, "utf8");
  const model = parseSource(src);
  const out = PrtfWriter.regenerateSource(model).split("\n");
  const origLines = src.split(/\r\n|\n/);
  // Line 24 (1-based, index 23): "2SPACEB(1) 'CUSTOMER MASTER LISTING'" —
  // keyword before the literal, a real ordering this fixture uses
  // throughout. Nothing is edited, so it must reproduce byte-for-byte,
  // not get silently reordered to literal-first.
  assert.equal(out[23], origLines[23]);
});

test("packKeywordsPreservingLines: keywords sharing an original line stay together when re-emitted unchanged", () => {
  const keywords = [
    { name: "COLOR", raw: "COLOR(BLU)", sourceLineIndex: 5 },
    { name: "DSPATR", raw: "DSPATR(HI)", sourceLineIndex: 5 },
  ];
  const groups = PrtfWriter.packKeywordsPreservingLines(keywords);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], ["COLOR(BLU)", "DSPATR(HI)"]);
});

test("packKeywordsPreservingLines: a dirty (edited) keyword bridges between two preserved keywords sharing an original line", () => {
  const keywords = [
    { name: "COLOR", raw: "COLOR(BLU)", sourceLineIndex: 5 },
    { name: "DSPATR", raw: "DSPATR(RI)", sourceLineIndex: -1 }, // just edited
    { name: "UNDERLINE", raw: "UNDERLINE", sourceLineIndex: 5 },
  ];
  const groups = PrtfWriter.packKeywordsPreservingLines(keywords);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], ["COLOR(BLU)", "DSPATR(RI)", "UNDERLINE"]);
});

test("packKeywordsPreservingLines: two keywords from genuinely DIFFERENT original lines never merge", () => {
  const keywords = [
    { name: "COLOR", raw: "COLOR(BLU)", sourceLineIndex: 5 },
    { name: "DSPATR", raw: "DSPATR(HI)", sourceLineIndex: 9 },
  ];
  const groups = PrtfWriter.packKeywordsPreservingLines(keywords);
  assert.equal(groups.length, 2);
});

test("packKeywordsPreservingLines: a single keyword longer than the column width is safely sub-split, never truncated", () => {
  const keywords = [{ name: "FNTCHRSET", raw: "FNTCHRSET(C0S0CR10 QFNTCPL T1V10500 QFNTCPL)", sourceLineIndex: -1 }];
  const groups = PrtfWriter.packKeywordsPreservingLines(keywords);
  const rejoined = groups.map((g: string[]) => g.join(" ")).join(" ");
  assert.equal(rejoined, "FNTCHRSET(C0S0CR10 QFNTCPL T1V10500 QFNTCPL)");
  for (const g of groups) assert.ok(g.join(" ").length <= 34);
});

test("packKeywordsPreservingLines: appends a new keyword to the last existing line when there's room", () => {
  const keywords = [
    { name: "COLOR", raw: "COLOR(BLU)", sourceLineIndex: 5 },
    { name: "NEWKW", raw: "TRNSPRCY(*NO)", sourceLineIndex: -1 },
  ];
  const groups = PrtfWriter.packKeywordsPreservingLines(keywords);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], ["COLOR(BLU)", "TRNSPRCY(*NO)"]);
});

test("originalRunRange/originalRunKeywordText: reconstructs a multi-line continuation run's original text exactly, including a mid-keyword wrap", () => {
  const rawLines = fs.readFileSync(afpdsFixture, "utf8").split(/\r\n|\n/);
  const [start, end] = PrtfWriter.originalRunRange(rawLines, 4);
  assert.equal(start, 4);
  assert.equal(end, 5);
  const text = PrtfWriter.originalRunKeywordText(rawLines, start, end);
  assert.equal(text, "STRPAGGRP SKIPB(1) PAGSEG(COMPLOGO 0.5 0.5) OVERLAY(STMTFORM 0 0)");
});

test("originalRunRange: a line with no continuation marker is its own one-line range", () => {
  const rawLines = ["                R FOOTER                    SKIPB(2)"];
  const [start, end] = PrtfWriter.originalRunRange(rawLines, 0);
  assert.equal(start, 0);
  assert.equal(end, 0);
});
