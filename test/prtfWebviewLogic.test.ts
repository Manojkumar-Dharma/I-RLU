// Coverage for src/prtfWebviewLogic.js — the pure keyword-text
// serialize/parse and pixel-math helpers pulled out of
// media/webviewClient.js (docs/TASKS.md review comment #6:
// "webviewClient.js" had zero test coverage). webviewClient.js itself
// remains untested here — it's DOM manipulation top to bottom (element
// construction, event wiring, postMessage) and would need a jsdom-style
// harness this project doesn't have set up; these are the pieces of it
// that were actually pure logic, now testable on their own the same way
// prtfEdits.ts's applyEditToModel was pulled out of extension.ts.
import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfWebviewLogic = require("../src/prtfWebviewLogic.js");

// --- paramsToText / paramsInnerText (Batch A keyword-input round trip) ---

test("paramsToText: 'flag' kind never produces params text, even with a value", () => {
  assert.equal(PrtfWebviewLogic.paramsToText("flag", "anything"), "");
  assert.equal(PrtfWebviewLogic.paramsToText("flag", ""), "");
});

test("paramsToText: blank/whitespace-only value means 'omit the keyword' for every kind", () => {
  assert.equal(PrtfWebviewLogic.paramsToText("text", ""), "");
  assert.equal(PrtfWebviewLogic.paramsToText("text", "   "), "");
  assert.equal(PrtfWebviewLogic.paramsToText("quotedText", ""), "");
  assert.equal(PrtfWebviewLogic.paramsToText("quotedSelect", ""), "");
});

test("paramsToText: plain 'select'/'text' kinds wrap the value in bare parens", () => {
  assert.equal(PrtfWebviewLogic.paramsToText("select", "*YES"), "(*YES)");
  assert.equal(PrtfWebviewLogic.paramsToText("text", "4"), "(4)");
});

test("paramsToText: 'quotedText' always DDS-quotes the value and doubles embedded quotes", () => {
  assert.equal(PrtfWebviewLogic.paramsToText("quotedText", "0.00"), "('0.00')");
  assert.equal(PrtfWebviewLogic.paramsToText("quotedText", "O'Brien"), "('O''Brien')");
});

test("paramsToText: 'quotedSelect' quotes a literal separator but leaves a *-prefixed special value bare", () => {
  assert.equal(PrtfWebviewLogic.paramsToText("quotedSelect", "-"), "('-')");
  assert.equal(PrtfWebviewLogic.paramsToText("quotedSelect", "*JOB"), "(*JOB)");
});

test("paramsInnerText: returns '' for a missing keyword", () => {
  assert.equal(PrtfWebviewLogic.paramsInnerText(undefined, "text"), "");
  assert.equal(PrtfWebviewLogic.paramsInnerText(null, "text"), "");
});

test("paramsInnerText: strips bare parens for plain kinds", () => {
  assert.equal(PrtfWebviewLogic.paramsInnerText({ params: "(*YES)" }), "*YES");
});

test("paramsInnerText: strips parens AND the DDS quote pair for quoted kinds, undoubling embedded quotes", () => {
  assert.equal(PrtfWebviewLogic.paramsInnerText({ params: "('O''Brien')" }, "quotedText"), "O'Brien");
  assert.equal(PrtfWebviewLogic.paramsInnerText({ params: "(*JOB)" }, "quotedSelect"), "*JOB");
});

test("paramsToText / paramsInnerText round-trip for every kind", () => {
  const cases: { kind: string; value: string }[] = [
    { kind: "select", value: "*YES" },
    { kind: "text", value: "4" },
    { kind: "quotedText", value: "O'Brien" },
    { kind: "quotedSelect", value: "-" },
    { kind: "quotedSelect", value: "*JOB" },
  ];
  for (const { kind, value } of cases) {
    const text = PrtfWebviewLogic.paramsToText(kind, value);
    const roundTripped = PrtfWebviewLogic.paramsInnerText({ params: text }, kind);
    assert.equal(roundTripped, value, `round trip failed for kind=${kind} value=${value}`);
  }
});

// --- tokenToPField / parseFontSpecKeyword (Batch B P-field component) ---

test("tokenToPField: a plain token is not a P-field", () => {
  assert.deepEqual(PrtfWebviewLogic.tokenToPField("11"), { isPField: false, value: "11" });
});

test("tokenToPField: an &NAME token is a P-field with the & stripped", () => {
  assert.deepEqual(PrtfWebviewLogic.tokenToPField("&MYFONT"), { isPField: true, value: "MYFONT" });
});

test("tokenToPField: an empty/undefined token is neither, with an empty value", () => {
  assert.deepEqual(PrtfWebviewLogic.tokenToPField(undefined), { isPField: false, value: "" });
  assert.deepEqual(PrtfWebviewLogic.tokenToPField(""), { isPField: false, value: "" });
});

const FONT_SPEC = { name: "FONT", params: [{ key: "fgid", label: "Font (FGID)" }], pointSize: true };
const CDEFNT_SPEC = {
  name: "CDEFNT",
  params: [{ key: "name", label: "Coded font name" }, { key: "library", label: "Library", optional: true }],
  pointSize: true,
};

test("parseFontSpecKeyword: no existing keyword yields empty/non-P-field values for every param", () => {
  const parsed = PrtfWebviewLogic.parseFontSpecKeyword(FONT_SPEC, undefined);
  assert.deepEqual(parsed.values, [{ isPField: false, value: "" }]);
  assert.deepEqual(parsed.height, { isPField: false, value: "" });
});

test("parseFontSpecKeyword: a plain FGID with no *POINTSIZE parses just the one param", () => {
  const parsed = PrtfWebviewLogic.parseFontSpecKeyword(FONT_SPEC, { params: "(11)" });
  assert.deepEqual(parsed.values, [{ isPField: false, value: "11" }]);
  assert.deepEqual(parsed.height, { isPField: false, value: "" });
  assert.deepEqual(parsed.width, { isPField: false, value: "" });
});

test("parseFontSpecKeyword: FGID plus '(*POINTSIZE height width)' splits both out correctly", () => {
  const parsed = PrtfWebviewLogic.parseFontSpecKeyword(FONT_SPEC, { params: "(2304 (*POINTSIZE 18 10))" });
  assert.deepEqual(parsed.values, [{ isPField: false, value: "2304" }]);
  assert.deepEqual(parsed.height, { isPField: false, value: "18" });
  assert.deepEqual(parsed.width, { isPField: false, value: "10" });
});

test("parseFontSpecKeyword: a &NAME P-field FGID is flagged as a P-field", () => {
  const parsed = PrtfWebviewLogic.parseFontSpecKeyword(FONT_SPEC, { params: "(&MYFONT)" });
  assert.deepEqual(parsed.values, [{ isPField: true, value: "MYFONT" }]);
});

test("parseFontSpecKeyword: a multi-param keyword (CDEFNT: name + optional library) parses both positions in order", () => {
  const parsed = PrtfWebviewLogic.parseFontSpecKeyword(CDEFNT_SPEC, { params: "(X0N51EHC MYLIB)" });
  assert.deepEqual(parsed.values, [
    { isPField: false, value: "X0N51EHC" },
    { isPField: false, value: "MYLIB" },
  ]);
});

// --- buildFontSpecParamsFromValues -----------------------------------

test("buildFontSpecParamsFromValues: returns null when the mandatory first param is empty", () => {
  assert.equal(PrtfWebviewLogic.buildFontSpecParamsFromValues(FONT_SPEC, [""], null, null), null);
});

test("buildFontSpecParamsFromValues: a single required param with no point size", () => {
  assert.equal(PrtfWebviewLogic.buildFontSpecParamsFromValues(FONT_SPEC, ["11"], null, null), "(11)");
});

test("buildFontSpecParamsFromValues: adds the '(*POINTSIZE height width)' suffix when a height is given", () => {
  assert.equal(PrtfWebviewLogic.buildFontSpecParamsFromValues(FONT_SPEC, ["2304"], "18", "10"), "(2304 (*POINTSIZE 18 10))");
});

test("buildFontSpecParamsFromValues: point-size height without a width omits the width", () => {
  assert.equal(PrtfWebviewLogic.buildFontSpecParamsFromValues(FONT_SPEC, ["2304"], "18", null), "(2304 (*POINTSIZE 18))");
});

test("buildFontSpecParamsFromValues: an empty optional trailing param (library) is trimmed, not left as a blank slot", () => {
  assert.equal(PrtfWebviewLogic.buildFontSpecParamsFromValues(CDEFNT_SPEC, ["X0N51EHC", ""], null, null), "(X0N51EHC)");
});

test("buildFontSpecParamsFromValues: a filled-in optional trailing param is kept", () => {
  assert.equal(PrtfWebviewLogic.buildFontSpecParamsFromValues(CDEFNT_SPEC, ["X0N51EHC", "MYLIB"], null, null), "(X0N51EHC MYLIB)");
});

// --- pixelToLineCol (click-to-place / drag placement math) --------------

test("pixelToLineCol: the top-left pixel resolves to line 1, position 1", () => {
  assert.deepEqual(PrtfWebviewLogic.pixelToLineCol(0, 0, 8, 18), { position: 1, line: 1 });
});

test("pixelToLineCol: converts pixel offsets to 1-based line/column using the given cell size", () => {
  // 3 cells across at 8px/col -> position 4 (24px / 8 = 3, +1)
  // 2 cells down at 18px/row -> line 3 (36px / 18 = 2, +1)
  assert.deepEqual(PrtfWebviewLogic.pixelToLineCol(24, 36, 8, 18), { position: 4, line: 3 });
});

test("pixelToLineCol: rounds to the nearest cell rather than always flooring", () => {
  // 4.6px at 8px/col rounds to col 1 (round(0.58) = 1), giving position 2
  assert.deepEqual(PrtfWebviewLogic.pixelToLineCol(4.6, 0, 8, 18).position, 2);
});

test("pixelToLineCol: never resolves below line/position 1, even for a negative pixel offset", () => {
  assert.deepEqual(PrtfWebviewLogic.pixelToLineCol(-50, -50, 8, 18), { position: 1, line: 1 });
});

// --- FONTNAME quoting (Batch L continued) --------------------------------
// Regression coverage for a real pre-existing bug found while adding real
// FONTNAME resolution: FONTNAME's value is DDS-quoted and routinely
// contains spaces ('Courier New', 'Times New Roman'), but
// parseFontSpecKeyword/buildFontSpecParamsFromValues used a plain
// whitespace split with no quote-awareness — FONTNAME('Courier New')
// parsed to a mangled "'Courier" (losing "New" entirely). Fixed by adding
// a `quoted` flag to a param spec (only set for FONTNAME's own "name"
// param — CDEFNT/FNTCHRSET's params are bare, unquoted object names and
// are NOT marked quoted) and using groupTokens (reused from
// prtfBarcodeParams.js) instead of a bare split.

const FONTNAME_SPEC_QUOTED = { name: "FONTNAME", params: [{ key: "name", label: "Font resource name", quoted: true }], pointSize: false };

test("parseFontSpecKeyword: a quoted FONTNAME value with an internal space is parsed as one complete token, not split at the space", () => {
  const parsed = PrtfWebviewLogic.parseFontSpecKeyword(FONTNAME_SPEC_QUOTED, { params: "('Courier New')" });
  assert.deepEqual(parsed.values, [{ isPField: false, value: "Courier New" }]);
});

test("parseFontSpecKeyword: a quoted FONTNAME value with an embedded doubled-quote escape is unescaped correctly", () => {
  const parsed = PrtfWebviewLogic.parseFontSpecKeyword(FONTNAME_SPEC_QUOTED, { params: "('O''Brien Sans')" });
  assert.deepEqual(parsed.values, [{ isPField: false, value: "O'Brien Sans" }]);
});

test("parseFontSpecKeyword: a &NAME P-field for a quoted param is still recognized as a P-field, not treated as quoted text", () => {
  const parsed = PrtfWebviewLogic.parseFontSpecKeyword(FONTNAME_SPEC_QUOTED, { params: "(&MYFONT)" });
  assert.deepEqual(parsed.values, [{ isPField: true, value: "MYFONT" }]);
});

test("parseFontSpecKeyword: an unquoted param (e.g. CDEFNT's name) is unaffected by the quoted-param handling", () => {
  const parsed = PrtfWebviewLogic.parseFontSpecKeyword(CDEFNT_SPEC, { params: "(X0N51EHC MYLIB)" });
  assert.deepEqual(parsed.values, [
    { isPField: false, value: "X0N51EHC" },
    { isPField: false, value: "MYLIB" },
  ]);
});

test("buildFontSpecParamsFromValues: a quoted param's value is written back DDS-quoted, with embedded quotes doubled", () => {
  assert.equal(PrtfWebviewLogic.buildFontSpecParamsFromValues(FONTNAME_SPEC_QUOTED, ["Courier New"], null, null), "('Courier New')");
  assert.equal(PrtfWebviewLogic.buildFontSpecParamsFromValues(FONTNAME_SPEC_QUOTED, ["O'Brien Sans"], null, null), "('O''Brien Sans')");
});

test("buildFontSpecParamsFromValues: a P-field value for a quoted param is written back bare (&NAME), never quoted", () => {
  assert.equal(PrtfWebviewLogic.buildFontSpecParamsFromValues(FONTNAME_SPEC_QUOTED, ["&MYFONT"], null, null), "(&MYFONT)");
});

test("FONTNAME quoting round-trips through parse -> build unchanged", () => {
  const original = "('Times New Roman')";
  const parsed = PrtfWebviewLogic.parseFontSpecKeyword(FONTNAME_SPEC_QUOTED, { params: original });
  const rebuilt = PrtfWebviewLogic.buildFontSpecParamsFromValues(
    FONTNAME_SPEC_QUOTED,
    parsed.values.map((v: any) => (v.isPField ? "&" + v.value : v.value)),
    null,
    null
  );
  assert.equal(rebuilt, original);
});

