// Tests for docs/TASKS.md Batch L (continued) — prtfLayout.js's
// resolveFont/resolveFontDisplay: the field/record/file cascade now
// checking all four font-selection keywords (FONT/CDEFNT/FNTCHRSET/
// FONTNAME) together at each level, not just FONT's own isolated cascade,
// and resolveLayout's cells[].font actually carrying whichever of the
// four was resolved.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

function buildModel({
  fileKeywordLines = [],
  recordKeywordLines = [],
  fieldKeywordLines = [],
}: {
  fileKeywordLines?: string[];
  recordKeywordLines?: string[];
  fieldKeywordLines?: string[];
}) {
  const lines: string[] = [];
  for (const kw of fileKeywordLines) lines.push(...emitWithKeywords(buildPositional({}), kw));
  lines.push(...emitWithKeywords(buildPositional({ nameType: "R", name: "REC" }), recordKeywordLines.join(" ")));
  lines.push(
    ...emitWithKeywords(
      buildPositional({ name: "F1", length: 5, dataType: "A", usage: "O", lineNo: 1, position: 1 }),
      fieldKeywordLines.join(" ")
    )
  );
  return parseSource(lines.join("\n") + "\n");
}

function fontFor(model: any) {
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  return layout.cells.find((c: any) => c.name === "F1").font;
}

// --- resolveFont precedence: field > record > file, across all four ----

test("resolveFont: with none of the four keywords anywhere, falls back to the default FGID", () => {
  const model = buildModel({});
  const font = PrtfEngine.resolveFont(model.records[0].fields[0], model.records[0], model.fileLevel);
  assert.equal(font.mode, "fgid");
  assert.equal(font.fgid, "11");
});

test("resolveFont: a field-level keyword wins over the same keyword at record level", () => {
  const model = buildModel({ recordKeywordLines: ["FONT(2304)"], fieldKeywordLines: ["FONT(2308)"] });
  const font = PrtfEngine.resolveFont(model.records[0].fields[0], model.records[0], model.fileLevel);
  assert.equal(font.mode, "fgid");
  assert.equal(font.fgid, "2308");
});

test("resolveFont: a field-level CDEFNT wins over a record-level FONT — nearest specification wins across different keyword types, not just within one", () => {
  const model = buildModel({ recordKeywordLines: ["FONT(2304)"], fieldKeywordLines: ["CDEFNT(X0GT10)"] });
  const font = PrtfEngine.resolveFont(model.records[0].fields[0], model.records[0], model.fileLevel);
  assert.equal(font.mode, "cdefnt");
  assert.equal(font.value, "X0GT10");
});

test("resolveFont: falls through record level to file level when the field has no font-selection keyword at all", () => {
  const model = buildModel({ fileKeywordLines: ["FONTNAME('Arial')"] });
  const font = PrtfEngine.resolveFont(model.records[0].fields[0], model.records[0], model.fileLevel);
  assert.equal(font.mode, "fontname");
  assert.equal(font.value, "Arial");
});

test("resolveFont: FNTCHRSET is resolved with both its parameters captured", () => {
  const model = buildModel({ fieldKeywordLines: ["FNTCHRSET(C0S0BRTR T1V10037)"] });
  const font = PrtfEngine.resolveFont(model.records[0].fields[0], model.records[0], model.fileLevel);
  assert.equal(font.mode, "fntchrset");
  assert.equal(font.fontCharacterSet, "C0S0BRTR");
  assert.equal(font.codePage, "T1V10037");
});

test("resolveFont: FONTNAME's quoted value with an internal space is captured correctly (not truncated at the space)", () => {
  const model = buildModel({ fieldKeywordLines: ["FONTNAME('Courier New')"] });
  const font = PrtfEngine.resolveFont(model.records[0].fields[0], model.records[0], model.fileLevel);
  assert.equal(font.mode, "fontname");
  assert.equal(font.value, "Courier New");
});

test("resolveFont: a &NAME program-to-system field for CDEFNT is flagged approximate", () => {
  const model = buildModel({ fieldKeywordLines: ["CDEFNT(&MYFONT)"] });
  const font = PrtfEngine.resolveFont(model.records[0].fields[0], model.records[0], model.fileLevel);
  assert.equal(font.mode, "cdefnt");
  assert.equal(font.approximate, true);
});

// --- resolveFontDisplay / end-to-end via resolveLayout -------------------

test("resolveLayout: a field with FONTNAME renders a font with the real name, no FGID", () => {
  const font = fontFor(buildModel({ fieldKeywordLines: ["FONTNAME('Arial')"] }));
  assert.equal(font.name, "Arial");
  assert.equal(font.fgid, undefined);
  assert.equal(font.family, '"Arial", sans-serif');
});

test("resolveLayout: a field with CDEFNT renders using afpCodedFontMetrics' resolution, no FGID", () => {
  const font = fontFor(buildModel({ fieldKeywordLines: ["CDEFNT(X0GT10)"] }));
  assert.equal(font.fgid, undefined);
  assert.equal(font.spacing, "fixed");
  assert.match(font.resolutionNote, /Gothic Text/);
});

test("resolveLayout: a field with FNTCHRSET renders using afpCodedFontMetrics' resolution", () => {
  const font = fontFor(buildModel({ fieldKeywordLines: ["FNTCHRSET(CZH200 T1V10274)"] }));
  assert.equal(font.fgid, undefined);
  assert.match(font.resolutionNote, /Custom outline font character set/);
});

test("resolveLayout: a field with plain FONT still resolves exactly as before (FGID path unaffected)", () => {
  const font = fontFor(buildModel({ fieldKeywordLines: ["FONT(2304)"] }));
  assert.equal(font.fgid, "2304");
  assert.equal(font.name, "Helvetica Roman Medium");
  assert.equal(font.isPlaceholderMetrics, true); // pre-existing AFM-substitute caveat, unchanged
});

test("resolveLayout: a &NAME program-to-system field for FONTNAME falls back to the default FGID, correctly marked non-placeholder for a fixed font", () => {
  const font = fontFor(buildModel({ fieldKeywordLines: ["FONTNAME(&MYFONT)"] }));
  assert.equal(font.fgid, "11");
  assert.equal(font.approximate, true);
  // Regression guard: DEFAULT_FGID (Courier 10 pitch) is a FIXED-spacing
  // font, so isPlaceholderMetrics must be false here even though
  // approximate is true — these are two independent caveats (substitute
  // AFM widths vs. an unresolvable runtime field value), not the same
  // thing. An earlier draft of this fallback branch hardcoded this to
  // true, which would have been wrong for exactly this case.
  assert.equal(font.isPlaceholderMetrics, false);
});

test("resolveLayout: with no font-selection keyword anywhere, resolves the same default as before this batch", () => {
  const font = fontFor(buildModel({}));
  assert.equal(font.fgid, "11");
  assert.equal(font.name, "Courier 10 (10 pitch)");
});
