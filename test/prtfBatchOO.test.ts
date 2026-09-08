// Batch OO (docs/TASKS.md) — LINE/BOX properties-panel UI: add/copy/edit/
// delete a LINE or BOX record-level keyword, plus interactive drag-to-move
// and drag-to-resize on the design canvas. LINE/BOX have rendered on the
// canvas since Batch I, but had no properties-panel surface at all, unlike
// fields/constants (Batch A onward) — this batch adds one, following the
// same "pure logic in prtfWebviewLogic.js, DOM wiring in webviewClient.js
// left untested" split every prior webview batch's own test file uses (see
// test/prtfWebviewLogic.test.ts's own header).
//
// Three areas of coverage:
//  1. src/prtfWebviewLogic.js — parse/build LINE/BOX params, and the grid/
//     physical-unit conversions the canvas drag/resize handlers use.
//  2. src/prtfLayout.js's resolveDrawsWithKeywordIndex — confirms each
//     resolved draw is tagged with the right `keywordIndex` into
//     record.keywords, including with multiple LINE/BOX instances and
//     indicator-conditioned ones mixed on the same record.
//  3. src/prtfEdits.ts's applyEditToModel — the four new edit kinds
//     (addDrawKeyword/updateDrawKeyword/removeDrawKeyword/copyDrawKeyword),
//     including the "index points at something that isn't a LINE/BOX
//     keyword" and "record not found" no-op cases every other edit kind's
//     own tests already cover for their own id/name lookups.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
import { applyEditToModel } from "../src/prtfEdits";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfLayout = require("../src/prtfLayout.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfWebviewLogic = require("../src/prtfWebviewLogic.js");

/** Same shape as test/prtfLayoutGeometry.test.ts's own buildModel — kept local rather than shared/exported, since only this file needs it. */
function buildModel({
  recordKeywordLines = [],
  fields = [],
}: {
  recordKeywordLines?: string[];
  fields?: { name: string; line?: number; position?: number }[];
}) {
  const lines: string[] = [];
  lines.push(...emitWithKeywords(buildPositional({}), "PAGSIZE(66 132)"));
  lines.push(...emitWithKeywords(buildPositional({ nameType: "R", name: "REC" }), recordKeywordLines.join(" ")));
  for (const f of fields) {
    lines.push(...emitWithKeywords(buildPositional({ name: f.name, length: 5, dataType: "A", usage: "O", lineNo: f.line, position: f.position }), ""));
  }
  const source = lines.join("\n") + "\n";
  return parseSource(source);
}

// --- prtfWebviewLogic.js: parseLineParams / parseBoxParams ---

test("parseLineParams: reads all seven positional params, defaulting direction to *HRZ when absent", () => {
  const parsed = PrtfWebviewLogic.parseLineParams({ params: "(1 2 3 *VRT 0.02 0.01 *RED)" });
  assert.deepEqual(parsed, { down: "1", across: "2", length: "3", direction: "*VRT", width: "0.02", pad: "0.01", color: "*RED" });
});

test("parseLineParams: missing optional trailing params come back as empty strings, not undefined", () => {
  const parsed = PrtfWebviewLogic.parseLineParams({ params: "(1 2 3)" });
  assert.equal(parsed.direction, "*HRZ");
  assert.equal(parsed.width, "");
  assert.equal(parsed.pad, "");
  assert.equal(parsed.color, "");
});

test("parseLineParams: a missing/undefined keyword returns all-blank fields rather than throwing", () => {
  const parsed = PrtfWebviewLogic.parseLineParams(undefined);
  assert.equal(parsed.down, "");
  assert.equal(parsed.direction, "*HRZ");
});

test("parseBoxParams: reads all seven positional params", () => {
  const parsed = PrtfWebviewLogic.parseBoxParams({ params: "(0 0 2 4 *MEDIUM *BLU *LT)" });
  assert.deepEqual(parsed, { down1: "0", across1: "0", down2: "2", across2: "4", width: "*MEDIUM", color: "*BLU", shading: "*LT" });
});

// --- prtfWebviewLogic.js: buildLineParams / buildBoxParams ---

test("buildLineParams: mandatory-only form omits every optional trailing param entirely", () => {
  assert.equal(PrtfWebviewLogic.buildLineParams({ down: "1", across: "2", length: "3", direction: "*HRZ" }), "(1 2 3 *HRZ)");
});

test("buildLineParams: a blank mandatory field (down/across/length) means 'don't write this keyword'", () => {
  assert.equal(PrtfWebviewLogic.buildLineParams({ down: "", across: "2", length: "3" }), null);
  assert.equal(PrtfWebviewLogic.buildLineParams({ down: "1", across: "", length: "3" }), null);
  assert.equal(PrtfWebviewLogic.buildLineParams({ down: "1", across: "2", length: "" }), null);
  assert.equal(PrtfWebviewLogic.buildLineParams(null), null);
});

test("buildLineParams: supplying only Color (skipping Width/Pad) fills the skipped ones from defaults rather than leaving blank positional slots", () => {
  const params = PrtfWebviewLogic.buildLineParams({ down: "1", across: "1", length: "2", direction: "*HRZ", color: "*RED" });
  assert.equal(params, "(1 1 2 *HRZ 0.01 0 *RED)");
});

test("buildLineParams: direction defaults to *HRZ when blank", () => {
  assert.equal(PrtfWebviewLogic.buildLineParams({ down: "1", across: "1", length: "1", direction: "" }), "(1 1 1 *HRZ)");
});

test("buildBoxParams: mandatory-only form (all four corners) omits every optional trailing param", () => {
  assert.equal(PrtfWebviewLogic.buildBoxParams({ down1: "0", across1: "0", down2: "2", across2: "2" }), "(0 0 2 2)");
});

test("buildBoxParams: any blank corner means 'don't write this keyword'", () => {
  assert.equal(PrtfWebviewLogic.buildBoxParams({ down1: "", across1: "0", down2: "2", across2: "2" }), null);
  assert.equal(PrtfWebviewLogic.buildBoxParams({ down1: "0", across1: "0", down2: "2", across2: "" }), null);
});

test("buildBoxParams: supplying only Shading fills Width/Color from defaults", () => {
  const params = PrtfWebviewLogic.buildBoxParams({ down1: "0", across1: "0", down2: "2", across2: "2", shading: "*DRK" });
  assert.equal(params, "(0 0 2 2 0.01 *BLK *DRK)");
});

// --- prtfWebviewLogic.js: grid <-> physical conversions ---

test("rowColToPhysical: inverts parseLineGeometry's forward math for inches", () => {
  // 10 LPI / 6 CPI (66x132 page default) — row=1,col=1 is the origin (0,0).
  assert.deepEqual(PrtfWebviewLogic.rowColToPhysical(1, 1, 6, 10, "inch"), { down: 0, across: 0 });
  // row 11 -> (11-1)/10 = 1.0 inch down; col 25 -> (25-1)/6 = 4.0 inches across.
  assert.deepEqual(PrtfWebviewLogic.rowColToPhysical(11, 25, 6, 10, "inch"), { down: 1, across: 4 });
});

test("rowColToPhysical: converts to cm when uom is 'cm'", () => {
  const { down, across } = PrtfWebviewLogic.rowColToPhysical(11, 7, 6, 10, "cm");
  assert.equal(down, 2.54); // 1 inch * 2.54
  assert.equal(across, 2.54); // 1 inch * 2.54
});

test("deltaPhysicalFromGridDelta: a zero grid delta is a zero physical delta in either unit", () => {
  assert.deepEqual(PrtfWebviewLogic.deltaPhysicalFromGridDelta(0, 0, 6, 10, "inch"), { deltaDown: 0, deltaAcross: 0 });
  assert.deepEqual(PrtfWebviewLogic.deltaPhysicalFromGridDelta(0, 0, 6, 10, "cm"), { deltaDown: 0, deltaAcross: 0 });
});

test("physicalToGrid: inverts rowColToPhysical", () => {
  assert.deepEqual(PrtfWebviewLogic.physicalToGrid(1, 4, 6, 10, "inch"), { row: 11, col: 25 });
});

// --- prtfWebviewLogic.js: drag-to-move / drag-to-resize builders ---

test("movedLineParams: drop point becomes the new down/across; length/direction/color carry over unchanged", () => {
  const kw = { name: "LINE", params: "(1 1 3 *HRZ 0.01 0 *RED)" };
  const params = PrtfWebviewLogic.movedLineParams(kw, 11, 25, 6, 10, "inch"); // drop at row 11/col 25 -> down 1, across 4
  assert.equal(params, "(1 4 3 *HRZ 0.01 0 *RED)");
});

test("movedBoxParams: shifts BOTH corners by the same physical delta, preserving the box's size", () => {
  const kw = { name: "BOX", params: "(0 0 2 2 *MEDIUM)" };
  // Box's first corner (0,0) is currently at grid row1=1,col1=1; dropped at row 11 (delta +10 rows = +1 inch), col 1 (no change).
  const params = PrtfWebviewLogic.movedBoxParams(kw, 11, 1, 1, 1, 6, 10, "inch");
  assert.equal(params, "(1 0 3 2 *MEDIUM)");
});

test("resizedLineParams: horizontal line only responds to the column delta from its own anchor", () => {
  const kw = { name: "LINE", params: "(0 0 3 *HRZ)" }; // anchor at grid row1/col1 = (1,1)
  // Drag handle to col 13 (12 cols across = 2 inches at 6 CPI); row is irrelevant for a horizontal line.
  const params = PrtfWebviewLogic.resizedLineParams(kw, 99, 13, 6, 10, "inch");
  assert.equal(params, "(0 0 2 *HRZ)");
});

test("resizedLineParams: vertical line only responds to the row delta from its own anchor", () => {
  const kw = { name: "LINE", params: "(0 0 3 *VRT)" };
  // Drag handle to row 21 (20 rows down = 2 inches at 10 LPI); column is irrelevant for a vertical line.
  const params = PrtfWebviewLogic.resizedLineParams(kw, 21, 99, 6, 10, "inch");
  assert.equal(params, "(0 0 2 *VRT)");
});

test("resizedLineParams: dragging the handle back onto/past the anchor clamps to a minimum of one grid cell's length instead of going to zero/negative", () => {
  const kw = { name: "LINE", params: "(0 0 3 *HRZ)" };
  const params = PrtfWebviewLogic.resizedLineParams(kw, 1, 1, 6, 10, "inch"); // dropped exactly on the anchor
  assert.equal(params, "(0 0 0.17 *HRZ)"); // 1 grid cell at 6 CPI = 1/6 inch, rounded to 2 decimals
});

test("resizedBoxParams: moves the diagonal corner straight to the drop point, leaving the first corner untouched", () => {
  const kw = { name: "BOX", params: "(0 0 2 2 *MEDIUM)" };
  const params = PrtfWebviewLogic.resizedBoxParams(kw, 21, 31, 6, 10, "inch"); // row21/col31 -> down 2, across 5
  assert.equal(params, "(0 0 2 5 *MEDIUM)");
});

// --- prtfLayout.js: resolveDrawsWithKeywordIndex / resolveLayout's draws[] ---

test("resolveLayout: each draw carries the keywordIndex of its own LINE/BOX entry within record.keywords", () => {
  const model = buildModel({
    recordKeywordLines: ["HIGHLIGHT", "LINE(1 0 5 *HRZ .01)", "BOX(0 0 2 2 *MEDIUM)", "LINE(2 0 3 *VRT .01)"],
  });
  const layout = PrtfLayout.resolveLayout(model, "REC", {}, "inch");
  const record = model.records[0];
  assert.equal(layout.draws.length, 3);
  // HIGHLIGHT (index 0) isn't LINE/BOX, so the first draw's keywordIndex
  // must point at the first LINE (index 1), not at 0.
  assert.equal(record.keywords[layout.draws[0].keywordIndex].name, "LINE");
  assert.equal(record.keywords[layout.draws[0].keywordIndex].params, "(1 0 5 *HRZ .01)");
  assert.equal(record.keywords[layout.draws[1].keywordIndex].name, "BOX");
  assert.equal(record.keywords[layout.draws[2].keywordIndex].name, "LINE");
  assert.equal(record.keywords[layout.draws[2].keywordIndex].params, "(2 0 3 *VRT .01)");
});

test("resolveLayout: an indicator-conditioned LINE/BOX is only included in draws (with its own keywordIndex) when its indicator is active", () => {
  // Two LINE keywords on their own attached, independently-conditioned
  // lines (Batch CC's per-keyword conditioning) — only one active at a time.
  const lines: string[] = [];
  lines.push(...emitWithKeywords(buildPositional({}), "PAGSIZE(66 132)"));
  lines.push(...emitWithKeywords(buildPositional({ nameType: "R", name: "REC" }), ""));
  lines.push(...emitWithKeywords(buildPositional({ conditions: [{ indicator: "01", negate: true }] }), "LINE(1 0 5 *HRZ .01)"));
  lines.push(...emitWithKeywords(buildPositional({ conditions: [{ indicator: "01", negate: false }] }), "LINE(2 0 3 *VRT .01)"));
  const model = parseSource(lines.join("\n") + "\n");

  const offLayout = PrtfLayout.resolveLayout(model, "REC", {}, "inch");
  assert.equal(offLayout.draws.length, 1);
  assert.equal(offLayout.draws[0].direction, "horizontal");

  const onLayout = PrtfLayout.resolveLayout(model, "REC", { "01": true }, "inch");
  assert.equal(onLayout.draws.length, 1);
  assert.equal(onLayout.draws[0].direction, "vertical");
});

// --- prtfEdits.ts: applyEditToModel — addDrawKeyword / updateDrawKeyword / removeDrawKeyword / copyDrawKeyword ---

test("applyEditToModel addDrawKeyword: appends a new LINE/BOX keyword to the record", () => {
  const model = buildModel({ recordKeywordLines: ["LINE(1 0 5 *HRZ .01)"] });
  const record = model.records[0];
  const changed = applyEditToModel(model, { kind: "addDrawKeyword", recordName: "REC", name: "BOX", params: "(0 0 2 2)" });
  assert.equal(changed, true);
  assert.equal(record.keywords.length, 2);
  assert.equal(record.keywords[1].name, "BOX");
  assert.equal(record.keywords[1].params, "(0 0 2 2)");
  assert.equal(record.keywords[1].raw, "BOX(0 0 2 2)");
});

test("applyEditToModel addDrawKeyword: no-op (returns false) for an unknown record name", () => {
  const model = buildModel({});
  const changed = applyEditToModel(model, { kind: "addDrawKeyword", recordName: "NOSUCH", name: "LINE", params: "(0 0 1 *HRZ)" });
  assert.equal(changed, false);
});

test("applyEditToModel updateDrawKeyword: replaces params of the LINE/BOX at the given keywordIndex only", () => {
  const model = buildModel({ recordKeywordLines: ["LINE(1 0 5 *HRZ .01)", "LINE(2 0 3 *VRT .01)"] });
  const record = model.records[0];
  const changed = applyEditToModel(model, { kind: "updateDrawKeyword", recordName: "REC", keywordIndex: 1, params: "(9 9 9 *VRT)" });
  assert.equal(changed, true);
  assert.equal(record.keywords[0].params, "(1 0 5 *HRZ .01)"); // untouched
  assert.equal(record.keywords[1].params, "(9 9 9 *VRT)");
  assert.equal(record.keywords[1].raw, "LINE(9 9 9 *VRT)");
});

test("applyEditToModel updateDrawKeyword: no-op if the index points at a non-LINE/BOX keyword", () => {
  const model = buildModel({ recordKeywordLines: ["HIGHLIGHT", "LINE(1 0 5 *HRZ .01)"] });
  const changed = applyEditToModel(model, { kind: "updateDrawKeyword", recordName: "REC", keywordIndex: 0, params: "(1 2 3 *HRZ)" });
  assert.equal(changed, false);
  assert.equal(model.records[0].keywords[0].name, "HIGHLIGHT");
});

test("applyEditToModel updateDrawKeyword: no-op for an out-of-range keywordIndex", () => {
  const model = buildModel({ recordKeywordLines: ["LINE(1 0 5 *HRZ .01)"] });
  const changed = applyEditToModel(model, { kind: "updateDrawKeyword", recordName: "REC", keywordIndex: 5, params: "(1 2 3 *HRZ)" });
  assert.equal(changed, false);
});

test("applyEditToModel removeDrawKeyword: deletes only the LINE/BOX at the given keywordIndex", () => {
  const model = buildModel({ recordKeywordLines: ["LINE(1 0 5 *HRZ .01)", "BOX(0 0 2 2)"] });
  const record = model.records[0];
  const changed = applyEditToModel(model, { kind: "removeDrawKeyword", recordName: "REC", keywordIndex: 0 });
  assert.equal(changed, true);
  assert.equal(record.keywords.length, 1);
  assert.equal(record.keywords[0].name, "BOX");
});

test("applyEditToModel removeDrawKeyword: no-op if the index points at a non-LINE/BOX keyword", () => {
  const model = buildModel({ recordKeywordLines: ["HIGHLIGHT"] });
  const changed = applyEditToModel(model, { kind: "removeDrawKeyword", recordName: "REC", keywordIndex: 0 });
  assert.equal(changed, false);
  assert.equal(model.records[0].keywords.length, 1);
});

test("applyEditToModel copyDrawKeyword: duplicates the LINE/BOX immediately after itself, exact same params", () => {
  const model = buildModel({ recordKeywordLines: ["LINE(1 0 5 *HRZ .01)", "BOX(0 0 2 2)"] });
  const record = model.records[0];
  const changed = applyEditToModel(model, { kind: "copyDrawKeyword", recordName: "REC", keywordIndex: 0 });
  assert.equal(changed, true);
  assert.equal(record.keywords.length, 3);
  assert.equal(record.keywords[0].name, "LINE");
  assert.equal(record.keywords[1].name, "LINE"); // the copy, spliced right after the source
  assert.equal(record.keywords[1].params, "(1 0 5 *HRZ .01)");
  assert.equal(record.keywords[2].name, "BOX"); // pushed one slot further along
});

test("applyEditToModel copyDrawKeyword: mutating the copy afterward doesn't affect the source", () => {
  const model = buildModel({ recordKeywordLines: ["LINE(1 0 5 *HRZ .01)"] });
  const record = model.records[0];
  applyEditToModel(model, { kind: "copyDrawKeyword", recordName: "REC", keywordIndex: 0 });
  applyEditToModel(model, { kind: "updateDrawKeyword", recordName: "REC", keywordIndex: 1, params: "(9 9 9 *VRT)" });
  assert.equal(record.keywords[0].params, "(1 0 5 *HRZ .01)");
  assert.equal(record.keywords[1].params, "(9 9 9 *VRT)");
});

test("applyEditToModel copyDrawKeyword: no-op if the index points at a non-LINE/BOX keyword", () => {
  const model = buildModel({ recordKeywordLines: ["HIGHLIGHT"] });
  const changed = applyEditToModel(model, { kind: "copyDrawKeyword", recordName: "REC", keywordIndex: 0 });
  assert.equal(changed, false);
  assert.equal(model.records[0].keywords.length, 1);
});
