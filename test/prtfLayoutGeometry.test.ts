// Dedicated coverage for the parts of src/prtfEngine.js that review comment
// #6 (docs/TASKS.md context) flagged as thin: resolveLayout's cursor/
// SKIPB/SPACEB/SKIPA/SPACEA placement logic, and the LINE/BOX/BARCODE
// geometry math (parseLineGeometry/parseBoxGeometry/parseBarcodeGeometry).
// Those three parsers aren't exported directly — they're only reachable
// through resolveLayout's `draws`/`cell.barcode` output — so these tests
// drive them the same way the webview does, via resolveLayout, rather than
// reaching into engine internals.
//
// Written and run against the current (pre-split) prtfEngine.js as a
// regression net BEFORE the file is split into prtfLayout.js/
// prtfReferenceField.js/prtfKeywordValidation.js (review comment #5) —
// intentionally imports only the top-level `PrtfEngine` module object
// (never a specific internal file path) so it keeps passing unchanged
// after that split, since prtfEngine.js's `mod = {...}` export is expected
// to keep re-exporting the same public shape.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

/**
 * Builds a minimal single-record model from scratch (no fixture file),
 * so each test controls exactly the file-level/record-level keywords and
 * field list it needs. `fileKeywordLines`/`recordKeywordLines` are raw
 * keyword text (e.g. "PAGSIZE(66 132)"); `fields` is a list of
 * `{ name, length, line, position, keywordLines }` for named fields, in
 * source order.
 */
function buildModel({
  fileKeywordLines = [],
  recordKeywordLines = [],
  fields = [],
}: {
  fileKeywordLines?: string[];
  recordKeywordLines?: string[];
  fields?: { name: string; length?: number; line?: number; position?: number; keywordLines?: string[] }[];
}) {
  const lines: string[] = [];
  for (const kw of fileKeywordLines) {
    lines.push(...emitWithKeywords(buildPositional({}), kw));
  }
  lines.push(...emitWithKeywords(buildPositional({ nameType: "R", name: "REC" }), recordKeywordLines.join(" ")));
  for (const f of fields) {
    lines.push(
      ...emitWithKeywords(
        buildPositional({
          name: f.name,
          length: f.length ?? 5,
          dataType: "A",
          usage: "O",
          lineNo: f.line,
          position: f.position,
        }),
        (f.keywordLines || []).join(" ")
      )
    );
  }
  return parseSource(lines.join("\n") + "\n");
}

// --- Cursor / SKIPB / SPACEB / SKIPA / SPACEA placement -------------------

test("layout: with no location and no skip/space keywords, fields default to line 1, and column advances by the prior field's length", () => {
  const model = buildModel({ fields: [{ name: "F1", length: 5 }, { name: "F2", length: 3 }] });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const f1 = layout.cells.find((c: any) => c.name === "F1");
  const f2 = layout.cells.find((c: any) => c.name === "F2");
  assert.equal(f1.line, 1);
  assert.equal(f1.position, 1);
  // cursorCol advances to position + length of the previous field (1 + 5 = 6)
  assert.equal(f2.line, 1);
  assert.equal(f2.position, 6);
});

test("layout: an explicit line/position on a field overrides the running cursor", () => {
  const model = buildModel({
    fields: [{ name: "F1", length: 5, line: 3, position: 20 }, { name: "F2", length: 4 }],
  });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const f1 = layout.cells.find((c: any) => c.name === "F1");
  const f2 = layout.cells.find((c: any) => c.name === "F2");
  assert.equal(f1.line, 3);
  assert.equal(f1.position, 20);
  // F2 has no explicit location, so it inherits the cursor left by F1:
  // cursorLine becomes 3 (F1's line), cursorCol becomes 20 + 5 = 25.
  assert.equal(f2.line, 3);
  assert.equal(f2.position, 25);
});

test("layout: SKIPB sets the cursor line to its parameter before the field is placed", () => {
  const model = buildModel({
    fields: [{ name: "F1", length: 5, keywordLines: ["SKIPB(10)"] }],
  });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const f1 = layout.cells.find((c: any) => c.name === "F1");
  assert.equal(f1.line, 10);
});

test("layout: SPACEB adds to the running cursor line before the field is placed", () => {
  const model = buildModel({
    fields: [{ name: "F1", length: 5, line: 2 }, { name: "F2", length: 5, keywordLines: ["SPACEB(3)"] }],
  });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const f2 = layout.cells.find((c: any) => c.name === "F2");
  // cursorLine after F1 is 2 (F1's own line); SPACEB(3) adds 3 more.
  assert.equal(f2.line, 5);
});

test("layout: SKIPA sets the cursor line to its parameter after the field is placed, affecting the next field", () => {
  const model = buildModel({
    fields: [{ name: "F1", length: 5, line: 1, keywordLines: ["SKIPA(20)"] }, { name: "F2", length: 5 }],
  });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const f1 = layout.cells.find((c: any) => c.name === "F1");
  const f2 = layout.cells.find((c: any) => c.name === "F2");
  assert.equal(f1.line, 1); // SKIPA only affects the cursor AFTER placement, not F1 itself
  assert.equal(f2.line, 20);
});

test("layout: SPACEA adds to the cursor line after the field is placed, affecting the next field", () => {
  const model = buildModel({
    fields: [{ name: "F1", length: 5, line: 4, keywordLines: ["SPACEA(2)"] }, { name: "F2", length: 5 }],
  });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const f2 = layout.cells.find((c: any) => c.name === "F2");
  assert.equal(f2.line, 6); // 4 (F1's line) + 2 (SPACEA)
});

test("layout: a field skipped by indicator conditioning does not advance the cursor for the next field", () => {
  const lines: string[] = [];
  lines.push(...emitWithKeywords(buildPositional({ nameType: "R", name: "REC" }), ""));
  lines.push(
    ...emitWithKeywords(
      buildPositional({
        name: "F1",
        length: 5,
        dataType: "A",
        usage: "O",
        lineNo: 5,
        position: 30,
        conditions: [{ indicator: "50", negate: false }],
      }),
      ""
    )
  );
  lines.push(...emitWithKeywords(buildPositional({ name: "F2", length: 5, dataType: "A", usage: "O" }), ""));
  const model = parseSource(lines.join("\n") + "\n");
  const layout = PrtfEngine.resolveLayout(model, "REC", {}); // indicator 50 off by default
  assert.ok(layout.skippedByIndicator.includes("F1"));
  const f2 = layout.cells.find((c: any) => c.name === "F2");
  // Cursor was never advanced by the skipped F1, so F2 falls back to the
  // engine's initial cursor (line 1, position 1), not F1's line/position.
  assert.equal(f2.line, 1);
  assert.equal(f2.position, 1);
});

// --- LINE geometry ----------------------------------------------------

test("layout: LINE(*HRZ) resolves row/col from CPI/LPI and computes col2 from length", () => {
  const model = buildModel({ recordKeywordLines: ["LINE(1 0 5 *HRZ .01)"] });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const line = layout.draws.find((d: any) => d.type === "line");
  assert.equal(line.direction, "horizontal");
  // default CPI 10, LPI 6: posDown=1in -> row = round(1*6)+1 = 7; posAcross=0in -> col=1
  assert.equal(line.row1, 7);
  assert.equal(line.col1, 1);
  assert.equal(line.row2, 7);
  // length 5in at CPI 10 -> +50 columns
  assert.equal(line.col2, 51);
  assert.equal(line.approximate, false);
});

test("layout: LINE(*VRT) extends row2 by length*LPI instead of extending col2", () => {
  const model = buildModel({ recordKeywordLines: ["LINE(0 2 3 *VRT .01)"] });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const line = layout.draws.find((d: any) => d.type === "line");
  assert.equal(line.direction, "vertical");
  assert.equal(line.col1, 21); // posAcross 2in * CPI 10 + 1
  assert.equal(line.col2, 21); // same column, vertical line
  assert.equal(line.row2, line.row1 + 3 * 6); // length 3in * LPI 6
});

test("layout: LINE with a &NAME program-to-system field parameter is flagged approximate", () => {
  const model = buildModel({ recordKeywordLines: ["LINE(&FROMTOP 0 5 *HRZ .01)"] });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const line = layout.draws.find((d: any) => d.type === "line");
  assert.equal(line.approximate, true);
});

// --- BOX geometry -------------------------------------------------------

test("layout: BOX resolves all four corners from CPI/LPI", () => {
  const model = buildModel({ recordKeywordLines: ["BOX(0 0 2 4 *MEDIUM)"] });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const box = layout.draws.find((d: any) => d.type === "box");
  assert.equal(box.row1, 1); // 0in * LPI 6 + 1
  assert.equal(box.col1, 1); // 0in * CPI 10 + 1
  assert.equal(box.row2, 13); // 2in * LPI 6 + 1
  assert.equal(box.col2, 41); // 4in * CPI 10 + 1
  assert.equal(box.approximate, false);
});

test("layout: BOX with a &NAME parameter in any of its first four positions is flagged approximate", () => {
  const model = buildModel({ recordKeywordLines: ["BOX(0 0 2 &FARCOL *MEDIUM)"] });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const box = layout.draws.find((d: any) => d.type === "box");
  assert.equal(box.approximate, true);
});

test("layout: LINE/BOX geometry respects i-rlu.unitOfMeasure (cm) by converting to inches before applying CPI/LPI", () => {
  const inchModel = buildModel({ recordKeywordLines: ["BOX(0 0 2 2 *MEDIUM)"] });
  const cmModel = buildModel({ recordKeywordLines: ["BOX(0 0 2 2 *MEDIUM)"] });
  const layoutInch = PrtfEngine.resolveLayout(inchModel, "REC", {}, "inch");
  const layoutCm = PrtfEngine.resolveLayout(cmModel, "REC", {}, "cm");
  const boxInch = layoutInch.draws.find((d: any) => d.type === "box");
  const boxCm = layoutCm.draws.find((d: any) => d.type === "box");
  // Same raw "2" parameter means a much smaller physical distance in cm
  // than in inches, so the cm-interpreted box should resolve to fewer rows.
  assert.ok(boxCm.row2 < boxInch.row2);
});

// --- BARCODE geometry -----------------------------------------------------

test("layout: BARCODE with a plain 1-9 line-count height uses it directly and is not approximate", () => {
  const model = buildModel({ fields: [{ name: "F1", keywordLines: ["BARCODE(*3OF9 3 *HRZ)"] }] });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const cell = layout.cells.find((c: any) => c.name === "F1");
  assert.ok(cell.barcode);
  assert.equal(cell.barcode.barCodeId, "3OF9");
  assert.equal(cell.barcode.direction, "horizontal");
  assert.equal(cell.barcode.heightLines, 3);
  assert.equal(cell.barcode.approximateHeight, false);
});

test("layout: BARCODE direction defaults to horizontal, and *VRT flips it to vertical", () => {
  const model = buildModel({ fields: [{ name: "F1", keywordLines: ["BARCODE(*UPCA 2 *VRT)"] }] });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const cell = layout.cells.find((c: any) => c.name === "F1");
  assert.equal(cell.barcode.direction, "vertical");
});

test("layout: BARCODE's *NOHRI suppresses the human-readable-interpretation flag, otherwise it defaults on", () => {
  const withHri = buildModel({ fields: [{ name: "F1", keywordLines: ["BARCODE(*3OF9 2 *HRZ)"] }] });
  const withoutHri = buildModel({ fields: [{ name: "F1", keywordLines: ["BARCODE(*3OF9 2 *HRZ *NOHRI)"] }] });
  const layoutWith = PrtfEngine.resolveLayout(withHri, "REC", {});
  const layoutWithout = PrtfEngine.resolveLayout(withoutHri, "REC", {});
  assert.equal(layoutWith.cells.find((c: any) => c.name === "F1").barcode.hri, true);
  assert.equal(layoutWithout.cells.find((c: any) => c.name === "F1").barcode.hri, false);
});

test("layout: BARCODE with a physical '(height *UOM)' form converts to line count via LPI, and is not flagged approximate", () => {
  const model = buildModel({ fields: [{ name: "F1", keywordLines: ["BARCODE(*3OF9 (0.5 *IN) *HRZ)"] }] });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const cell = layout.cells.find((c: any) => c.name === "F1");
  // default LPI 6: 0.5in * 6 = 3 lines
  assert.equal(cell.barcode.heightLines, 3);
  assert.equal(cell.barcode.approximateHeight, false);
});

test("layout: BARCODE with no recognizable height falls back to the 2-line placeholder default, flagged approximate", () => {
  const model = buildModel({ fields: [{ name: "F1", keywordLines: ["BARCODE(*3OF9)"] }] });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  const cell = layout.cells.find((c: any) => c.name === "F1");
  assert.equal(cell.barcode.heightLines, 2);
  assert.equal(cell.barcode.approximateHeight, true);
});

// --- CPI/LPI resolution --------------------------------------------------

test("layout: record-level CPI/LPI overrides file-level CPI/LPI", () => {
  const model = buildModel({
    fileKeywordLines: ["CPI(15)", "LPI(8)"],
    recordKeywordLines: ["CPI(12)"],
    fields: [{ name: "F1" }],
  });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  assert.equal(layout.grid.cpi, 12); // record-level wins over file-level
  assert.equal(layout.grid.lpi, 8); // falls back to file-level when record doesn't set it
});

test("layout: CPI/LPI default to 10/6 when neither file nor record specify them", () => {
  const model = buildModel({ fields: [{ name: "F1" }] });
  const layout = PrtfEngine.resolveLayout(model, "REC", {});
  assert.equal(layout.grid.cpi, 10);
  assert.equal(layout.grid.lpi, 6);
});
