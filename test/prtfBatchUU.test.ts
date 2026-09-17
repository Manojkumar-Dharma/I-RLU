// Tests for docs/TASKS.md Batch UU — model RELPOS (file-level) and confirm
// whether/how it should gate the existing `+n` relative-positioning math.
//
// Investigation finding (see src/prtfLayout.js's own comment on this,
// right above the `position` calculation in resolveLayout): the two
// calculations IBM's RELPOS reference describes ("relative to the end of
// the previous field" with RELPOS vs. "relative to the beginning of the
// line" without it) produce the IDENTICAL result for a monospace
// character-grid model with no DBCS — which is the only kind of model
// I-RLU has. So there's no separate branch to test in resolveLayout
// itself; what Batch UU actually adds is (1) RELPOS round-tripping
// correctly as a bare, valueless keyword, and (2) a validation warning
// for its *DEVTYPE(*AFPDS) requirement, which is genuinely new behavior.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

function buildSource(fileLevelKeywords: string, recordKeywords: string): string {
  const lines = [
    "      * Batch UU test fixture",
    ...emitWithKeywords(buildPositional({}), fileLevelKeywords),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), recordKeywords),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ];
  return lines.join("\n") + "\n";
}

test("Batch UU round-trip: a bare file-level RELPOS survives parse -> regenerate unchanged", () => {
  const original = buildSource("RELPOS", "");
  const model = parseSource(original);
  assert.equal(regenerateSource(model), original);
  const relpos = PrtfEngine.findKeyword(model.fileLevel.keywords, "RELPOS");
  assert.ok(relpos);
  assert.equal(relpos.params, "");
});

test("VALUELESS_KEYWORDS: RELPOS is registered as taking no parameters", () => {
  assert.equal(PrtfEngine.VALUELESS_KEYWORDS.indexOf("RELPOS") !== -1, true);
});

test("validateFileLevelKeywords: file-level RELPOS is flagged when nothing else suggests an *AFPDS file", () => {
  const original = buildSource("RELPOS", "");
  const model = parseSource(original);
  const warnings = PrtfEngine.validateFileLevelKeywords(model);
  assert.equal(warnings.some((w: any) => w.keyword === "RELPOS"), true);
});

test("validateFileLevelKeywords: file-level RELPOS is NOT flagged when the file looks like *AFPDS (an AFPDS-typical keyword is present)", () => {
  const original = buildSource("RELPOS", "FONT(1051)");
  const model = parseSource(original);
  const warnings = PrtfEngine.validateFileLevelKeywords(model);
  assert.equal(warnings.some((w: any) => w.keyword === "RELPOS"), false);
});

test("validateFileLevelKeywords: no RELPOS keyword at all means no RELPOS warning either way", () => {
  const original = buildSource("", "");
  const model = parseSource(original);
  assert.deepEqual(
    PrtfEngine.validateFileLevelKeywords(model).filter((w: any) => w.keyword === "RELPOS"),
    []
  );
});

test("resolveLayout: `+n` relative positioning resolves identically whether or not the file declares RELPOS (see the investigation note in prtfLayout.js)", () => {
  function modelWith(fileLevelKeywords: any[]) {
    return {
      fileLevel: { keywords: fileLevelKeywords },
      records: [
        {
          kind: "record",
          name: "TESTREC",
          conditions: [],
          keywords: [],
          fields: [
            { kind: "field", id: "f1", name: "FLDA", length: 10, dataType: "A", line: 1, position: 2, relativePosition: false, conditions: [], keywords: [] },
            { kind: "field", id: "f2", name: "FLDB", length: 5, dataType: "A", position: 3, relativePosition: true, conditions: [], keywords: [] },
          ],
        },
      ],
    };
  }

  const withoutRelpos = require("../src/prtfLayout.js").resolveLayout(modelWith([]), "TESTREC", {}, "inch");
  const withRelpos = require("../src/prtfLayout.js").resolveLayout(
    modelWith([{ name: "RELPOS", params: "", raw: "RELPOS", sourceLineIndex: 0 }]),
    "TESTREC",
    {},
    "inch"
  );

  const posWithout = withoutRelpos.cells.find((c: any) => c.name === "FLDB").position;
  const posWith = withRelpos.cells.find((c: any) => c.name === "FLDB").position;
  // FLDA: position 2, length 10 -> ends at column 12. FLDB: +3 -> column 15.
  assert.equal(posWithout, 15);
  assert.equal(posWith, 15);
  assert.equal(posWithout, posWith);
});
