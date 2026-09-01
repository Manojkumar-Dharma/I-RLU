// Tests for docs/TASKS.md Batch C — BARCODE full parameter surface
// (src/prtfBarcodeParams.js). Covers: (1) the full structured parse/build
// round-tripping every parameter IBM's DDS reference defines, including
// the ones the pre-Batch-C engine didn't parse at all (*AST/*NOAST,
// modifier, narrow bar width, ratio, 2D data), (2) the specific known-gap
// fix — HRI's three-way below/above/none value surviving edit-then-
// reparse instead of collapsing to a boolean, (3) that
// parseBarcodeGeometry (prtfLayout.js, rendering-only) now delegates to
// the same parser and exposes hriPosition while keeping its old `hri`
// boolean for backward compatibility, and (4) the client-side range
// validation hints.
import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseBarcodeParams, buildBarcodeParams, validateBarcodeParams } = require("../src/prtfBarcodeParams.js");

function kw(params: string) {
  return { name: "BARCODE", params, raw: "BARCODE" + params, sourceLineIndex: -1 };
}

test("parseBarcodeParams: full parameter set — every documented parameter parses correctly", () => {
  const parsed = parseBarcodeParams(kw("(CODE3OF9 5 *VRT *HRITOP *AST X'02' (*WIDTH 0.012) (*RATIO 2.75) (*QRCODE 4 1 *CONVERT(1) *TRIM))"));
  assert.equal(parsed.barCodeId, "CODE3OF9");
  assert.equal(parsed.heightMode, "lines");
  assert.equal(parsed.heightLines, 5);
  assert.equal(parsed.direction, "vertical");
  assert.equal(parsed.hriPosition, "above");
  assert.equal(parsed.asterisk, true);
  assert.equal(parsed.modifier, "02");
  assert.equal(parsed.narrowBarWidth, 0.012);
  assert.equal(parsed.ratio, 2.75);
  assert.equal(parsed.extra2D, "(*QRCODE 4 1 *CONVERT(1) *TRIM)");
  assert.deepEqual(parsed.unrecognizedRaw, []);
});

test("parseBarcodeParams: '(height *UOM)' physical height form parses distinctly from a line count", () => {
  const parsed = parseBarcodeParams(kw("(UPCA (0.5 *UOM) *HRZ)"));
  assert.equal(parsed.heightMode, "uom");
  assert.equal(parsed.heightValue, 0.5);
  assert.equal(parsed.heightLines, undefined);
});

test("parseBarcodeParams: defaults match IBM's documented defaults when optional params are omitted", () => {
  const parsed = parseBarcodeParams(kw("(UPCA)"));
  assert.equal(parsed.heightMode, "none");
  assert.equal(parsed.direction, "horizontal"); // *HRZ default
  assert.equal(parsed.hriPosition, "below"); // *HRI default
  assert.equal(parsed.asterisk, false); // *NOAST default
  assert.equal(parsed.modifier, "");
});

test("parseBarcodeParams: an unmodeled token (e.g. *SWIDTH) is preserved verbatim in unrecognizedRaw, not dropped", () => {
  const parsed = parseBarcodeParams(kw("(UPCA 3 *HRZ (*SWIDTH 1.5))"));
  assert.deepEqual(parsed.unrecognizedRaw, ["(*SWIDTH 1.5)"]);
  // Round-tripping through build must not lose it.
  const rebuilt = buildBarcodeParams(parsed);
  assert.ok(rebuilt.includes("(*SWIDTH 1.5)"));
});

test("buildBarcodeParams -> parseBarcodeParams round-trips the full parameter set", () => {
  const original = {
    barCodeId: "CODEABAR",
    heightMode: "lines" as const,
    heightLines: 4,
    heightValue: undefined,
    direction: "vertical" as const,
    hriPosition: "above" as const,
    asterisk: true,
    modifier: "0A",
    narrowBarWidth: 0.05,
    ratio: 2.5,
    extra2D: "",
    unrecognizedRaw: [] as string[],
  };
  const text = buildBarcodeParams(original);
  const reparsed = parseBarcodeParams(kw(text));
  assert.deepEqual(reparsed, original);
});

test("HRI three-way value (below/above/none) survives edit-then-reparse", () => {
  ["below", "above", "none"].forEach((hriPosition) => {
    const f = {
      barCodeId: "CODE128",
      heightMode: "none" as const,
      heightLines: undefined,
      heightValue: undefined,
      direction: "horizontal" as const,
      hriPosition: hriPosition as "below" | "above" | "none",
      asterisk: false,
      modifier: "",
      narrowBarWidth: undefined,
      ratio: undefined,
      extra2D: "",
      unrecognizedRaw: [] as string[],
    };
    const rebuilt = parseBarcodeParams(kw(buildBarcodeParams(f)));
    assert.equal(rebuilt.hriPosition, hriPosition);
  });
});

test("parseBarcodeGeometry (prtfLayout.js, via resolveLayout): exposes the fixed three-way hriPosition alongside the legacy hri boolean", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parseSource } = require("../src/prtfParser");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");

  function buildModel(barcodeText: string) {
    const lines = [
      ...emitWithKeywords(buildPositional({}), "PAGSIZE(66 132)"),
      ...emitWithKeywords(buildPositional({ nameType: "R", name: "REC" }), ""),
      ...emitWithKeywords(
        buildPositional({ name: "F1", length: 12, dataType: "A", usage: "O", lineNo: 2, position: 10 }),
        barcodeText
      ),
    ];
    return parseSource(lines.join("\n") + "\n");
  }

  const above = PrtfEngine.resolveLayout(buildModel("BARCODE(*3OF9 2 *HRZ *HRITOP)"), "REC", {});
  const below = PrtfEngine.resolveLayout(buildModel("BARCODE(*3OF9 2 *HRZ)"), "REC", {});
  const none = PrtfEngine.resolveLayout(buildModel("BARCODE(*3OF9 2 *HRZ *NOHRI)"), "REC", {});

  const cellAbove = above.cells.find((c: any) => c.name === "F1");
  const cellBelow = below.cells.find((c: any) => c.name === "F1");
  const cellNone = none.cells.find((c: any) => c.name === "F1");

  assert.equal(cellAbove.barcode.hriPosition, "above");
  assert.equal(cellAbove.barcode.hri, true);
  assert.equal(cellBelow.barcode.hriPosition, "below");
  assert.equal(cellBelow.barcode.hri, true);
  assert.equal(cellNone.barcode.hriPosition, "none");
  assert.equal(cellNone.barcode.hri, false);

  // The full structured parse is also attached, for the properties panel.
  assert.equal(cellAbove.barcodeParams.hriPosition, "above");
  assert.equal(cellAbove.barcodeParams.asterisk, false);
});

test("validateBarcodeParams: flags out-of-range modifier, narrow bar width, and ratio", () => {
  const f = {
    barCodeId: "UPCA",
    heightMode: "none" as const,
    heightLines: undefined,
    heightValue: undefined,
    direction: "horizontal" as const,
    hriPosition: "below" as const,
    asterisk: false,
    modifier: "FF",
    narrowBarWidth: 0.5,
    ratio: 5,
    extra2D: "",
    unrecognizedRaw: [] as string[],
  };
  const hints = validateBarcodeParams(f, "inch");
  assert.ok(hints.some((h: string) => h.includes("Modifier cannot be hex FF")));
  assert.ok(hints.some((h: string) => h.includes("Narrow bar width")));
  assert.ok(hints.some((h: string) => h.includes("ratio")));
});

test("validateBarcodeParams: in-range values produce no hints", () => {
  const f = {
    barCodeId: "UPCA",
    heightMode: "lines" as const,
    heightLines: 3,
    heightValue: undefined,
    direction: "horizontal" as const,
    hriPosition: "below" as const,
    asterisk: false,
    modifier: "02",
    narrowBarWidth: 0.05,
    ratio: 2.5,
    extra2D: "",
    unrecognizedRaw: [] as string[],
  };
  assert.deepEqual(validateBarcodeParams(f, "inch"), []);
});
