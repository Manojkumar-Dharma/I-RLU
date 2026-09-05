// Batch Z (docs/TASKS.md) — system-constant fields (DATE/TIME/PAGNBR).
//
// Covers three things end to end:
//   1. Parsing: a constant defined purely by DATE/TIME/PAGNBR (no literal)
//      already round-trips correctly — this was true before this batch (see
//      test/prtfBatchA.test.ts's own round-trip coverage) and stays true
//      here; not re-tested in depth, just used as the starting point for
//      the layout tests below.
//   2. Layout: prtfLayout.js's resolveConstantPlaceholder gives each of the
//      three a non-blank design-time placeholder (and the right display
//      length to match), while a genuinely blank constant (no literal, no
//      recognized keyword) still renders blank exactly as before.
//   3. Edits: the new "Add system constant" edit path (addConstant +
//      systemConstantKeyword) adds the bare keyword with no literal token,
//      and the updateConstant fix (empty Text -> undefined, not "") means
//      neither path leaves a spurious '' literal token on write-back.
//
// USER/SYSNAME are deliberately absent from every test here — see
// prtfLayout.js's resolveConstantPlaceholder comment and docs/ROADMAP.md
// for why: verified against IBM's DDS Reference: Printer Files, neither is
// a valid printer-file DDS keyword (display-file only).
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
import { applyEditToModel } from "../src/prtfEdits";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

/**
 * One record ("REC") with a named field (so the record isn't empty) plus
 * whichever constant lines `constantKeywordLines` describes — each entry is
 * raw keyword text for one constant (e.g. "DATE", "TIME", "PAGNBR", or ""
 * for a genuinely blank constant), placed on consecutive lines/positions so
 * none of them collide.
 */
function buildModel(constantKeywordLines: string[]) {
  const lines = [
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "REC" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "FLD1", length: 5, dataType: "A", usage: "O", lineNo: 1, position: 1 }),
      ""
    ),
    ...constantKeywordLines.flatMap((kwText, i) =>
      emitWithKeywords(buildPositional({ lineNo: i + 2, position: 20 }), kwText)
    ),
  ];
  return parseSource(lines.join("\n") + "\n");
}

// --- Layout: design-time placeholder text/length --------------------------

test("layout: a constant defined by DATE (no literal) gets a non-blank design-time placeholder", () => {
  const model = buildModel(["DATE"]);
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const cell = layout.cells.find((c: any) => c.kind === "constant");
  assert.ok(cell.text, "DATE constant should render placeholder text, not blank");
  assert.equal(cell.length, cell.text.length);
});

test("layout: a constant defined by TIME (no literal) gets a non-blank design-time placeholder", () => {
  const model = buildModel(["TIME"]);
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const cell = layout.cells.find((c: any) => c.kind === "constant");
  assert.ok(cell.text, "TIME constant should render placeholder text, not blank");
  assert.equal(cell.length, cell.text.length);
});

test("layout: a constant defined by PAGNBR (no literal) placeholders as page 1", () => {
  const model = buildModel(["PAGNBR"]);
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const cell = layout.cells.find((c: any) => c.kind === "constant");
  assert.equal(cell.text, "1");
  assert.equal(cell.length, 1);
});

test("layout: a genuinely blank constant (no literal, no DATE/TIME/PAGNBR) still renders blank, unchanged from before this batch", () => {
  const model = buildModel([""]);
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const cell = layout.cells.find((c: any) => c.kind === "constant");
  assert.equal(cell.text, "");
  assert.equal(cell.length, 1);
});

test("layout: an actual literal constant is unaffected by the placeholder logic even if paired with an unrelated keyword", () => {
  // Not realistic DDS (a literal constant wouldn't normally also carry
  // DATE), but confirms entry.literal still wins outright — the
  // placeholder path is only reached when entry.literal is undefined.
  const model = buildModel(["'Hello' EDTCDE(Y)"]);
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const cell = layout.cells.find((c: any) => c.kind === "constant");
  assert.equal(cell.text, "Hello");
  assert.equal(cell.length, 5);
});

// --- Edits: "Add system constant" and the empty-literal fix ---------------

test("edit: addConstant with systemConstantKeyword adds the bare keyword, no literal token, and round-trips clean", () => {
  const model = buildModel([]);
  const applied = applyEditToModel(model as any, {
    kind: "addConstant",
    recordName: "REC",
    line: 5,
    position: 20,
    literal: "",
    systemConstantKeyword: "PAGNBR",
  } as any);
  assert.equal(applied, true);
  const record = model.records.find((r) => r.name === "REC")!;
  const added = record.fields.find((f) => f.kind === "constant") as any;
  assert.ok(added, "new system-constant should be present in the model");
  assert.equal(added.literal, undefined, "a system-constant add should carry no literal at all");
  assert.ok(PrtfEngine.findKeyword(added.keywords, "PAGNBR"));

  const regenerated = regenerateSource(model);
  // No stray '' literal token should appear before the keyword.
  assert.ok(!regenerated.includes("''PAGNBR"), "write-back must not emit a spurious empty literal token");
  const reparsed = parseSource(regenerated);
  const reparsedRecord = reparsed.records.find((r) => r.name === "REC")!;
  const reparsedConst = reparsedRecord.fields.find((f) => f.kind === "constant" && PrtfEngine.findKeyword((f as any).keywords, "PAGNBR")) as any;
  assert.ok(reparsedConst, "PAGNBR constant should survive regenerate + reparse");
  assert.equal(reparsedConst.literal, undefined);
});

test("edit: updateConstant with an empty Text field clears literal to undefined, not '' (no spurious token on write-back)", () => {
  // Build a fixture with an existing PAGNBR-only constant, mirroring
  // sample1.pf's real FOOTER usage (docs/TASKS.md's Batch A test already
  // covers this shape existing in a real fixture).
  const model = buildModel(["PAGNBR"]);
  const record = model.records.find((r) => r.name === "REC")!;
  const existing = record.fields.find((f) => f.kind === "constant") as any;
  assert.equal(existing.literal, undefined, "sanity check: freshly parsed PAGNBR constant has no literal");

  // Simulate hitting Save on the properties panel without touching Text
  // (litInput.value defaults to "" per cell.literal || "").
  const applied = applyEditToModel(model as any, {
    kind: "updateConstant",
    id: existing.id,
    literal: "",
    line: existing.line,
    position: existing.position,
  });
  assert.equal(applied, true);
  assert.equal(existing.literal, undefined, "an empty Text save must not turn undefined into ''");

  const regenerated = regenerateSource(model);
  assert.ok(!regenerated.includes("''PAGNBR"), "write-back must not emit a spurious empty literal token");
});
