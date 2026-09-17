// Tests for docs/TASKS.md Batch XX — use PAGSEG's real `(*SIZE height
// width)` sub-parameter for its placeholder box instead of always using
// the fixed 20x3 default. Covers: (1) parseSizeExpr's extraction of the
// `(*SIZE ...)` sub-expression from PAGSEG's raw extra tokens, (2) that
// the resulting placeholder box uses the real converted size, (3) that a
// program-to-system field height/width falls back to the fixed default
// (flagged approximate, same treatment as a field-ref position already
// gets), (4) that `extra`/round-trip is completely unaffected — the *SIZE
// text is still preserved verbatim, this batch only reads its numbers out
// for sizing, and (5) that OVERLAY/AFPRSC (which don't get this treatment
// per this batch's scope) are unaffected.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parsePagseg, buildPagsegParams, parseOverlay, DEFAULT_RESOURCE_COLS, DEFAULT_RESOURCE_ROWS, parseSizeExpr } =
  require("../src/prtfPageGroupKeywords.js");

function kw(name: string, params: string) {
  return { name, params, raw: name + params, sourceLineIndex: -1 };
}

function buildSource(recordKeywords: string): string {
  const lines = [
    "      * Batch XX test fixture",
    "",
    ...emitWithKeywords(buildPositional({}), "DEVTYPE(*AFPDS)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), recordKeywords),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ];
  return lines.join("\n") + "\n";
}

test("parseSizeExpr: extracts height/width from a (*SIZE h w) token among other extra tokens, case-insensitively", () => {
  assert.deepEqual(parseSizeExpr(["(*SIZE 1 2)"]), { heightTok: "1", widthTok: "2" });
  assert.deepEqual(parseSizeExpr(["(*size 1.5 2.25)"]), { heightTok: "1.5", widthTok: "2.25" });
  assert.deepEqual(parseSizeExpr(["(*ROTATION 90)", "(*SIZE 1 2)"]), { heightTok: "1", widthTok: "2" });
  assert.equal(parseSizeExpr(["(*ROTATION 90)"]), null);
  assert.equal(parseSizeExpr([]), null);
});

test("parsePagseg: no (*SIZE ...) present -> falls back to the fixed default placeholder size, exactly as before this batch", () => {
  const parsed = parsePagseg(kw("PAGSEG", "(COMPLOGO 0.5 0.5)"), 10, 6, "inch");
  assert.equal(parsed.widthCols, DEFAULT_RESOURCE_COLS);
  assert.equal(parsed.heightRows, DEFAULT_RESOURCE_ROWS);
  assert.equal(parsed.approximate, false);
  assert.equal(parsed.extra, "");
});

test("parsePagseg: (*SIZE height width) present -> placeholder box uses the real converted size", () => {
  // cpi=10, lpi=6, inch UOM: height 1in * 6 lpi = 6 rows; width 2in * 10 cpi = 20 cols.
  const parsed = parsePagseg(kw("PAGSEG", "(COMPLOGO 0.5 0.5 (*SIZE 1 2))"), 10, 6, "inch");
  assert.equal(parsed.heightRows, 6);
  assert.equal(parsed.widthCols, 20);
  assert.equal(parsed.approximate, false);
  // The *SIZE text itself is untouched in `extra` — this batch only reads
  // its numbers out, it doesn't restructure how PAGSEG round-trips.
  assert.equal(parsed.extra, "(*SIZE 1 2)");
});

test("parsePagseg: (*SIZE ...) alongside (*ROTATION ...) — both preserved verbatim in extra, size still extracted for geometry", () => {
  const parsed = parsePagseg(kw("PAGSEG", "(COMPLOGO 0.5 0.5 (*SIZE 1 2) (*ROTATION 90))"), 10, 6, "inch");
  assert.equal(parsed.heightRows, 6);
  assert.equal(parsed.widthCols, 20);
  assert.equal(parsed.extra, "(*SIZE 1 2) (*ROTATION 90)");
});

test("parsePagseg: a field-reference height/width can't be resolved at design time -> falls back to the fixed default, flagged approximate", () => {
  const parsed = parsePagseg(kw("PAGSEG", "(COMPLOGO 0.5 0.5 (*SIZE &HGT &WID))"), 10, 6, "inch");
  assert.equal(parsed.widthCols, DEFAULT_RESOURCE_COLS);
  assert.equal(parsed.heightRows, DEFAULT_RESOURCE_ROWS);
  assert.equal(parsed.approximate, true);
  assert.equal(parsed.extra, "(*SIZE &HGT &WID)");
});

test("buildPagsegParams: round-trips (*SIZE ...) unchanged since it's still just part of extra", () => {
  const parsed = parsePagseg(kw("PAGSEG", "(COMPLOGO 0.5 0.5 (*SIZE 1 2))"), 10, 6, "inch");
  assert.equal(buildPagsegParams(parsed), "(COMPLOGO 0.5 0.5 (*SIZE 1 2))");
});

test("full round-trip: PAGSEG with (*SIZE height width) survives parse -> regenerate unchanged", () => {
  const original = buildSource("PAGSEG(COMPLOGO 0.5 0.5 (*SIZE 1 2))");
  const model = parseSource(original);
  assert.equal(regenerateSource(model), original);
});

test("resolveLayout: a PAGSEG with (*SIZE ...) gets a differently-sized placeholder box than one without", () => {
  const withSize = parseSource(buildSource("PAGSEG(COMPLOGO 0.5 0.5 (*SIZE 1.5 1))"));
  const withoutSize = parseSource(buildSource("PAGSEG(COMPLOGO 0.5 0.5)"));
  const layoutWithSize = PrtfEngine.resolveLayout(withSize, "HEADER", {}, "inch");
  const layoutWithoutSize = PrtfEngine.resolveLayout(withoutSize, "HEADER", {}, "inch");
  const pagsegWithSize = layoutWithSize.resources.find((r: any) => r.keyword === "PAGSEG");
  const pagsegWithoutSize = layoutWithoutSize.resources.find((r: any) => r.keyword === "PAGSEG");
  assert.ok(pagsegWithSize);
  assert.ok(pagsegWithoutSize);
  assert.equal(pagsegWithoutSize.widthCols, DEFAULT_RESOURCE_COLS);
  assert.equal(pagsegWithoutSize.heightRows, DEFAULT_RESOURCE_ROWS);
  assert.notEqual(pagsegWithSize.widthCols, pagsegWithoutSize.widthCols);
  assert.notEqual(pagsegWithSize.heightRows, pagsegWithoutSize.heightRows);
});

test("parseOverlay: unaffected by this batch — OVERLAY's own optional (*ROTATION n) is still just opaque extra, no *SIZE modeling (out of this batch's scope)", () => {
  const parsed = parseOverlay(kw("OVERLAY", "(STMTFORM 0 0 (*ROTATION 90))"), 10, 6, "inch");
  assert.equal(parsed.widthCols, DEFAULT_RESOURCE_COLS);
  assert.equal(parsed.heightRows, DEFAULT_RESOURCE_ROWS);
  assert.equal(parsed.extra, "(*ROTATION 90)");
});
