// Tests for docs/TASKS.md Batch WW — model GDF (Graphic Data File), the
// record-level, PSF-only, AFPDS-only resource keyword found via
// docs/AUDIT-RECORD-LEVEL.md §2. Before this batch GDF got no
// placeholder-box rendering at all (unlike its OVERLAY/PAGSEG/AFPRSC
// siblings) and was missing from PSF_ONLY_KEYWORDS. Covers: (1) round-trip
// through the generic keyword model, (2) src/prtfPageGroupKeywords.js's
// parseGdf/buildGdfParams pair — including the "library-name/graph-file"
// qualified-name-in-one-token shape that sets GDF apart from OVERLAY's/
// PAGSEG's separate name param, and resolveResourceBoxSize's real
// depth/width -> character-grid sizing, (3) resolveLayout surfacing GDF as
// a positioned placeholder sized from its own graph-depth/graph-width
// (unlike OVERLAY/PAGSEG/AFPRSC's fixed default), and (4) PSF_ONLY_KEYWORDS
// and the AFPDS-typical-keyword heuristic both picking up GDF.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseGdf, buildGdfParams, resolveResourceBoxSize } = require("../src/prtfPageGroupKeywords.js");

function kw(name: string, params: string) {
  return { name, params, raw: name + params, sourceLineIndex: -1 };
}

function buildSource(fileLevelKeywords: string, recordKeywords: string): string {
  const lines = [
    "      * Batch WW test fixture",
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

test("Batch WW round-trip: GDF survives parse -> regenerate unchanged, both library-qualified and unqualified", () => {
  const original = buildSource("", "GDF(GRAPHLIB/GFILE MYGRAPH 1.557 2.831 7.0 4.5 90)");
  const model = parseSource(original);
  assert.equal(regenerateSource(model), original);
  const header = model.records.find((r) => r.name === "HEADER")!;
  assert.equal(PrtfEngine.findKeyword(header.keywords, "GDF").params, "(GRAPHLIB/GFILE MYGRAPH 1.557 2.831 7.0 4.5 90)");
});

test("Batch WW round-trip: a record can carry GDF multiple times (IBM's own reference explicitly allows this)", () => {
  const original = buildSource("", "GDF(GFILE MYGRAF 2.0 7.0 4.5 11.25 180) GDF(GFILE YOURGRAF 0.1 0.5 3.67 4.0 0)");
  assert.equal(regenerateSource(parseSource(original)), original);
});

test("Batch WW round-trip: a record with no GDF is untouched", () => {
  const original = buildSource("", "SKIPB(1)");
  assert.equal(regenerateSource(parseSource(original)), original);
});

test("parseGdf: an unqualified graph-file parses all 7 positional params correctly", () => {
  const parsed = parseGdf(kw("GDF", "(GFILE MYGRAF 2.0 7.0 4.5 11.25 180)"), 10, 6, "inch");
  assert.equal(parsed.name, "GFILE");
  assert.equal(parsed.graphMember, "MYGRAF");
  assert.equal(parsed.posDown, "2.0");
  assert.equal(parsed.posAcross, "7.0");
  assert.equal(parsed.graphDepth, "4.5");
  assert.equal(parsed.graphWidth, "11.25");
  assert.equal(parsed.graphRotation, "180");
  assert.equal(parsed.keyword, "GDF");
});

test("parseGdf: a library-qualified graph-file (library/file, one token) round-trips as a single field, not split into two", () => {
  const parsed = parseGdf(kw("GDF", "(GRAPHLIB/GFILE MYGRAPH 1.557 2.831 7.0 4.5 90)"), 10, 6, "inch");
  assert.equal(parsed.name, "GRAPHLIB/GFILE");
  assert.equal(parsed.graphMember, "MYGRAPH");
  const params = buildGdfParams(parsed);
  assert.equal(params, "(GRAPHLIB/GFILE MYGRAPH 1.557 2.831 7.0 4.5 90)");
});

test("parseGdf: &field references for graph-file/graph-member flag the placeholder as approximate", () => {
  const parsed = parseGdf(kw("GDF", "(&GLIB/&GFILE &GRAF &POSD &POSA &GDEP &GWID &GROT)"), 10, 6, "inch");
  assert.equal(parsed.name, "&GLIB/&GFILE");
  assert.equal(parsed.graphMember, "&GRAF");
  assert.equal(parsed.approximate, true);
});

test("buildGdfParams: requires both graph-file and graph-member; a blank either means don't write the keyword", () => {
  assert.equal(buildGdfParams({ name: "GFILE", graphMember: "" }), null);
  assert.equal(buildGdfParams({ name: "  ", graphMember: "MYGRAF" }), null);
  const params = buildGdfParams({ name: "GFILE", graphMember: "MYGRAF", posDown: "1", posAcross: "1", graphDepth: "2", graphWidth: "3", graphRotation: "0" });
  assert.equal(params, "(GFILE MYGRAF 1 1 2 3 0)");
});

test("buildGdfParams: preserves trailing extra text (e.g. a malformed/unmodeled 8th token) verbatim", () => {
  const params = buildGdfParams({ name: "GFILE", graphMember: "MYGRAF", posDown: "1", posAcross: "1", graphDepth: "2", graphWidth: "3", graphRotation: "0", extra: "SOMETHING" });
  assert.equal(params, "(GFILE MYGRAF 1 1 2 3 0 SOMETHING)");
});

test("resolveResourceBoxSize: a valid depth/width pair converts to character-grid rows/cols via lpi/cpi", () => {
  const size = resolveResourceBoxSize("4.5", "11.25", 10, 6, "inch");
  assert.equal(size.heightRows, Math.round(4.5 * 6));
  assert.equal(size.widthCols, Math.round(11.25 * 10));
  assert.equal(size.approximate, false);
});

test("resolveResourceBoxSize: a missing/non-numeric/&field token falls back to the shared default and flags approximate", () => {
  assert.deepEqual(resolveResourceBoxSize(undefined, undefined, 10, 6, "inch"), {
    heightRows: 3,
    widthCols: 20,
    approximate: true,
  });
  const withField = resolveResourceBoxSize("&GDEP", "5", 10, 6, "inch");
  assert.equal(withField.approximate, true);
  assert.equal(withField.widthCols, Math.round(5 * 10));
});

test("resolveResourceBoxSize: a zero/negative depth or width also falls back to the default rather than a zero-size box", () => {
  const size = resolveResourceBoxSize("0", "-3", 10, 6, "inch");
  assert.equal(size.approximate, true);
  assert.ok(size.heightRows > 0 && size.widthCols > 0);
});

test("resolveLayout: GDF surfaces as a positioned placeholder (layout.resources), sized from its own graph-depth/graph-width", () => {
  const source = buildSource("", "GDF(GFILE MYGRAF 1 1 0.5 2.0 0)");
  const model = parseSource(source);
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {}, "inch");
  assert.equal(layout.resources.length, 1);
  const gdf = layout.resources[0];
  assert.equal(gdf.keyword, "GDF");
  assert.equal(gdf.name, "GFILE");
  // 6 lpi / 10 cpi are resolveLayout's own defaults (no CPI/LPI keyword coded here).
  assert.equal(gdf.heightRows, Math.round(0.5 * 6));
  assert.equal(gdf.widthCols, Math.round(2.0 * 10));
});

test("resolveLayout: GDF sits alongside OVERLAY/PAGSEG/AFPRSC in the same layout.resources array", () => {
  const source = buildSource("", "PAGSEG(COMPLOGO 0.5 0.5) GDF(GFILE MYGRAF 1 1 0.5 2.0 0)");
  const model = parseSource(source);
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {}, "inch");
  const keywords = layout.resources.map((r: any) => r.keyword).sort();
  assert.deepEqual(keywords, ["GDF", "PAGSEG"]);
});

test("resolveLayout: a record with two GDF keywords renders both placeholders", () => {
  const source = buildSource("", "GDF(GFILE MYGRAF 2.0 7.0 4.5 11.25 180) GDF(GFILE YOURGRAF 0.1 0.5 3.67 4.0 0)");
  const model = parseSource(source);
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {}, "inch");
  assert.equal(layout.resources.filter((r: any) => r.keyword === "GDF").length, 2);
});

test("validateRecordKeywords: GDF is flagged as PSF-only, same as ZFOLD/STAPLE", () => {
  const source = buildSource("", "GDF(GFILE MYGRAF 1 1 1 1 0)");
  const model = parseSource(source);
  const header = model.records.find((r) => r.name === "HEADER")!;
  const warnings = PrtfEngine.validateRecordKeywords(header);
  const gdfWarning = warnings.find((w: any) => w.keyword === "GDF");
  assert.ok(gdfWarning);
  assert.match(gdfWarning.message, /PSF/);
});

test("looksLikeAfpds heuristic (via validateFileLevelKeywords) treats GDF as an AFPDS-typical keyword", () => {
  const source = buildSource("SKIPB(1)", "GDF(GFILE MYGRAF 1 1 1 1 0)");
  const model = parseSource(source);
  const warnings = PrtfEngine.validateFileLevelKeywords(model);
  const skipbWarning = warnings.find((w: any) => w.keyword === "SKIPB");
  assert.ok(skipbWarning);
  assert.match(skipbWarning.message, /AFPDS/);
});
