// Tests for docs/TASKS.md Batch F — print/finishing keywords (DUPLEX,
// FORCE, OUTBIN, ZFOLD, STAPLE, INVMMAP). Per the batch's own scope, these
// keywords don't affect page-preview layout, so there's no rendering test
// here — just (1) a round-trip check confirming the generic keyword model
// already parses/regenerates them correctly (nothing batch-specific needed
// in the parser/writer), and (2) unit tests for the validation-only hints
// added to prtfEngine.js.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

// Built via the writer's own positional/keyword-wrapping helpers (same
// approach test/prtfWriter.test.ts's Batch M tests use) rather than
// hand-typed column padding, so the fixture is guaranteed to line up with
// what prtfParser.ts actually expects — a hand-counted string of spaces is
// an easy way to get an off-by-one that silently breaks the test.
function buildSource(fileLevelKeywords: string, recordKeywords: string): string {
  const lines = [
    "      * Batch F test fixture",
    "",
    ...emitWithKeywords(buildPositional({}), fileLevelKeywords),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), recordKeywords),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ];
  return lines.join("\n") + "\n";
}

test("Batch F round-trip: DUPLEX/FORCE/OUTBIN/ZFOLD/STAPLE/INVMMAP survive parse -> regenerate unchanged", () => {
  const original = buildSource(
    "PAGSIZE(66 132)",
    "DUPLEX(*TUMBLE) FORCE OUTBIN(3) ZFOLD STAPLE INVMMAP(MYMAP)"
  );
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);

  const header = model.records.find((r) => r.name === "HEADER")!;
  assert.equal(PrtfEngine.findKeyword(header.keywords, "DUPLEX").params, "(*TUMBLE)");
  assert.equal(PrtfEngine.findKeyword(header.keywords, "FORCE").params, "");
  assert.equal(PrtfEngine.findKeyword(header.keywords, "OUTBIN").params, "(3)");
  assert.equal(PrtfEngine.findKeyword(header.keywords, "ZFOLD").params, "");
  assert.equal(PrtfEngine.findKeyword(header.keywords, "STAPLE").params, "");
  assert.equal(PrtfEngine.findKeyword(header.keywords, "INVMMAP").params, "(MYMAP)");
});

test("Batch F round-trip: a record with none of these keywords is untouched", () => {
  const original = buildSource("PAGSIZE(66 132)", "SKIPB(1)");
  const model = parseSource(original);
  assert.equal(regenerateSource(model), original);
});

test("validateRecordKeywords: ZFOLD and STAPLE each surface a PSF-only hint", () => {
  const original = buildSource("PAGSIZE(66 132)", "ZFOLD STAPLE");
  const model = parseSource(original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  const warnings = PrtfEngine.validateRecordKeywords(header);
  const flagged = warnings.map((w: any) => w.keyword).sort();
  assert.deepEqual(flagged, ["STAPLE", "ZFOLD"]);
  warnings.forEach((w: any) => assert.match(w.message, /PSF/));
});

test("validateRecordKeywords: DUPLEX/FORCE/OUTBIN/INVMMAP alone don't trigger any hint", () => {
  const original = buildSource("PAGSIZE(66 132)", "DUPLEX(*YES) FORCE OUTBIN(*DEVD) INVMMAP(MYMAP)");
  const model = parseSource(original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  assert.deepEqual(PrtfEngine.validateRecordKeywords(header), []);
});

test("validateFileLevelKeywords: file-level SKIPB is flagged based on the AFPDS-typical-keyword heuristic", () => {
  const lines = [
    "      * Batch F test fixture",
    "",
    ...emitWithKeywords(buildPositional({ conditions: [{ indicator: "05", negate: false }] }), "PAGSIZE(66 132) SKIPB(1)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), "FONT(*SYSTEM 10 10)"),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ];
  const original = lines.join("\n") + "\n";
  const model = parseSource(original);
  const warnings = PrtfEngine.validateFileLevelKeywords(model);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].keyword, "SKIPB");
  assert.match(warnings[0].message, /AFPDS/);
});

// Batch SS (docs/TASKS.md) — bug fix regression test. DEVTYPE is a
// CRTPRTF/CHGPRTF/OVRPRTF command parameter, not a real DDS keyword — it
// can never legally appear in DDS source, so a stray DEVTYPE keyword
// (however it got there) must never be trusted as an authoritative
// AFPDS/SCS signal. Only the AFPDS-typical-keyword heuristic decides now.
test("validateFileLevelKeywords: a stray DEVTYPE(*AFPDS) keyword is never trusted — no warning without an AFPDS-typical keyword present", () => {
  const lines = [
    "      * Batch F test fixture",
    "",
    ...emitWithKeywords(buildPositional({ conditions: [{ indicator: "05", negate: false }] }), "PAGSIZE(66 132) DEVTYPE(*AFPDS) SKIPB(1)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), "SKIPB(2)"),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ];
  const original = lines.join("\n") + "\n";
  const model = parseSource(original);
  assert.deepEqual(PrtfEngine.validateFileLevelKeywords(model), []);
});

test("validateFileLevelKeywords: a stray DEVTYPE(*SCS) keyword doesn't suppress a warning the heuristic otherwise supports", () => {
  const original = buildSource("PAGSIZE(66 132) DEVTYPE(*SCS) SKIPB(1)", "SKIPB(2) FONT(*SYSTEM 10 10)");
  const model = parseSource(original);
  const warnings = PrtfEngine.validateFileLevelKeywords(model);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].keyword, "SKIPB");
  assert.match(warnings[0].message, /AFPDS/);
});

test("validateFileLevelKeywords: no warning when no AFPDS-typical keyword is present anywhere", () => {
  const lines = [
    "      * Batch F test fixture",
    "",
    ...emitWithKeywords(buildPositional({ conditions: [{ indicator: "05", negate: false }] }), "PAGSIZE(66 132) SKIPB(1)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), "SKIPA(2)"),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ];
  const original = lines.join("\n") + "\n";
  const model = parseSource(original);
  assert.deepEqual(PrtfEngine.validateFileLevelKeywords(model), []);
});
