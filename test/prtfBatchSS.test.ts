// Tests for docs/TASKS.md Batch SS — bug fix: PAGSIZE and DEVTYPE are not
// real DDS keywords.
//
// A full-text audit of IBM's DDS Reference for Printer Files
// (docs/DDS-PRINTER-FILE-REFERENCE.txt, docs/AUDIT-FILE-LEVEL.md §2/§3,
// docs/AUDIT-RECORD-LEVEL.md §1) confirms neither PAGSIZE/PAGESIZE nor
// DEVTYPE has a dedicated keyword section of its own — every mention of
// either is "on the CRTPRTF command" or "the DEVTYPE/PAGESIZE parameter."
// They cannot legally appear in DDS source at all. Yet src/prtfLayout.js
// (resolvePageSize) and src/prtfKeywordValidation.js (looksLikeAfpds) used
// to treat PAGSIZE(66 132)/DEVTYPE(*AFPDS) as parseable, trustworthy
// file/record-level DDS keyword text, and all 3 bundled test fixtures
// modeled an impossible DDS file to feed them.
//
// The fix: page size is now purely an external assumption (the
// i-rlu.pageSize VS Code setting, threaded down the same way
// i-rlu.unitOfMeasure already is), falling back to CRTPRTF's own real
// 66x132 default — never read from a parsed PAGSIZE keyword. DEVTYPE is
// simply never trusted any more; looksLikeAfpds relies solely on the
// pre-existing AFPDS-typical-keyword heuristic.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfLayout = require("../src/prtfLayout.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function buildSource(fileLevelKeywords: string, recordKeywords: string): string {
  const lines = [
    "      * Batch SS test fixture",
    "",
    ...emitWithKeywords(buildPositional({}), fileLevelKeywords),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "RECORD1" }), recordKeywords),
    ...emitWithKeywords(
      buildPositional({ name: "FIELD1", length: 5, dataType: "A", usage: "O", lineNo: 1, position: 1 }),
      ""
    ),
  ];
  return lines.join("\n") + "\n";
}

// --- resolvePageSize / resolveLayout -----------------------------------

test("resolvePageSize: with no override, falls back to CRTPRTF's own 66x132 default", () => {
  assert.deepEqual(PrtfLayout.resolvePageSize(), { lines: 66, cols: 132 });
  assert.deepEqual(PrtfLayout.resolvePageSize(undefined), { lines: 66, cols: 132 });
});

test("resolvePageSize: an invalid/partial override (matching i-rlu.pageSize misconfiguration) falls back to the default", () => {
  assert.deepEqual(PrtfLayout.resolvePageSize({}), { lines: 66, cols: 132 });
  assert.deepEqual(PrtfLayout.resolvePageSize({ lines: 0, cols: 0 }), { lines: 66, cols: 132 });
  assert.deepEqual(PrtfLayout.resolvePageSize({ lines: -5, cols: 80 }), { lines: 66, cols: 80 });
});

test("resolvePageSize: a valid override (the i-rlu.pageSize setting) is honored", () => {
  assert.deepEqual(PrtfLayout.resolvePageSize({ lines: 88, cols: 198 }), { lines: 88, cols: 198 });
});

test("resolveLayout: a bare PAGSIZE keyword in source has NO effect — page size only ever comes from the pageSize argument, never from parsed source", () => {
  const src = buildSource("PAGSIZE(88 198)", "PAGSIZE(44 80)");
  const model = parseSource(src);
  const defaultLayout = PrtfEngine.resolveLayout(model, "RECORD1", {}, "inch");
  assert.equal(defaultLayout.pageLines, 66);
  assert.equal(defaultLayout.pageCols, 132);

  const withSetting = PrtfEngine.resolveLayout(model, "RECORD1", {}, "inch", { lines: 60, cols: 100 });
  assert.equal(withSetting.pageLines, 60);
  assert.equal(withSetting.pageCols, 100);
});

// --- looksLikeAfpds (via validateFileLevelKeywords) --------------------

test("validateFileLevelKeywords: DEVTYPE(*AFPDS) alone (no AFPDS-typical keyword) is never trusted as authoritative", () => {
  const src = buildSource("DEVTYPE(*AFPDS) SKIPB(1)", "SKIPB(2)");
  const model = parseSource(src);
  assert.deepEqual(PrtfEngine.validateFileLevelKeywords(model), []);
});

test("validateFileLevelKeywords: DEVTYPE(*SCS) alone doesn't suppress the AFPDS-typical-keyword heuristic elsewhere in the file", () => {
  const src = buildSource("DEVTYPE(*SCS) SKIPB(1)", "SKIPB(2) FONT(*SYSTEM 10 10)");
  const model = parseSource(src);
  const warnings = PrtfEngine.validateFileLevelKeywords(model);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].keyword, "SKIPB");
});

// --- Fixtures no longer model an impossible DDS file --------------------

test("sample1.pf / sample-afpds.pf / sample-scs.pf no longer contain a fabricated PAGSIZE or DEVTYPE keyword", () => {
  for (const name of ["sample1.pf", "sample-afpds.pf", "sample-scs.pf"]) {
    const model = parseSource(fixture(name));
    const allKeywordNames = [
      ...model.fileLevel.keywords.map((k: any) => k.name),
      ...model.records.flatMap((r: any) => [
        ...r.keywords.map((k: any) => k.name),
        ...r.fields.flatMap((f: any) => f.keywords.map((k: any) => k.name)),
      ]),
    ];
    assert.ok(!allKeywordNames.includes("PAGSIZE"), `${name} should not contain PAGSIZE`);
    assert.ok(!allKeywordNames.includes("DEVTYPE"), `${name} should not contain DEVTYPE`);
  }
});

test("sample-afpds.pf still resolves as AFPDS via the keyword heuristic alone (no DEVTYPE present)", () => {
  const model = parseSource(fixture("sample-afpds.pf"));
  assert.ok(!model.fileLevel.keywords.some((k: any) => k.name === "DEVTYPE"));
  // Simulate a file-level SKIPB landing on this real fixture: the
  // heuristic must still catch it via FONT/PAGSEG/OVERLAY/STRPAGGRP
  // (already present on STMTHDR), with no DEVTYPE keyword anywhere.
  model.fileLevel.keywords.push({ name: "SKIPB", params: "(1)", raw: "SKIPB(1)", sourceLineIndex: -1 });
  const warnings = PrtfEngine.validateFileLevelKeywords(model);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].keyword, "SKIPB");
});
