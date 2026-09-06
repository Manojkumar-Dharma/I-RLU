// Batch LL (docs/TASKS.md) — bug fix: DDS's RELPOS-style `+n` relative
// position notation (columns 42-44) was read by parseInt as a plain
// absolute number, silently discarding the "this is relative, not
// absolute" semantic — round-tripping such a field relocated it to a
// fixed, usually-wrong absolute column, and the designer's own preview
// rendered it at that same wrong column too.
//
// Found during Batch AA's own real-world round-trip testing against
// test/fixtures/scsprt1-realworld.prtf, which has several genuine `+n`
// fields (CUSTNAME/ORDDATE/ORDTIME/AMOUNT/CUSTSTAT, all `+1`/`+2`) and
// test/fixtures/afpprt1-realworld.prtf (CUSTNAME/ORDDATE/AMOUNT/CUSTBC/
// TOTAMT).
//
// IBM's own RELPOS keyword reference confirms: leaving the line number
// (39-41) blank and giving position (42-44) a `+n` value (0-99) means "n
// spaces after the end of the previous field on this line", resolved for
// real at CRTPRTF compile time — and explicitly requires the line number
// entry to be blank whenever a plus value is used. That requirement is
// exactly what this fix's own layout-resolution logic relies on (see
// prtfLayout.js's own comment) — a relatively-positioned field is
// guaranteed to be on the SAME physical line the running cursor column
// already reflects, never an unrelated one.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSource } from "../src/prtfParser";
import { applyEditToModel } from "../src/prtfEdits";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveLayout } = require("../src/prtfLayout.js");

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

test("parseSource: a '+n' position is captured as relativePosition:true with the plain numeric part in .position", () => {
  const model = parseSource(fixture("scsprt1-realworld.prtf"));
  const rec = model.records.find((r) => r.name === "DTLREC")!;
  const custname = rec.fields.find((f) => f.kind === "field" && f.name === "CUSTNAME") as any;
  assert.equal(custname.position, 2);
  assert.equal(custname.relativePosition, true);
  assert.equal(custname.line, undefined); // RELPOS requires the line number to be left blank
});

test("parseSource: a plain absolute position is NOT flagged as relative", () => {
  const model = parseSource(fixture("scsprt1-realworld.prtf"));
  const rec = model.records.find((r) => r.name === "DTLREC")!;
  const custno = rec.fields.find((f) => f.kind === "field" && f.name === "CUSTNO") as any;
  assert.equal(custno.position, 2);
  assert.equal(custno.relativePosition, false);
});

test("buildPositional: emits a relative position back as '+n', right-justified in the 3-column field", () => {
  const s = buildPositional({ position: 2, relativePosition: true });
  assert.equal(s.slice(41, 44), " +2");
  const s2 = buildPositional({ position: 15, relativePosition: true });
  assert.equal(s2.slice(41, 44), "+15");
});

test("buildPositional: an absolute position is unaffected by the relativePosition param when false/absent", () => {
  const s = buildPositional({ position: 2, relativePosition: false });
  assert.equal(s.slice(41, 44), "  2");
  const s2 = buildPositional({ position: 2 });
  assert.equal(s2.slice(41, 44), "  2");
});

test("regenerateSource: relative-position fields survive round-trip with the same position/relativePosition after reparsing (line-index-independent, since an unrelated pre-existing file-level line-count quirk can shift absolute line numbers elsewhere in these particular fixtures)", () => {
  for (const fixtureName of ["scsprt1-realworld.prtf", "afpprt1-realworld.prtf"]) {
    const text = fixture(fixtureName);
    const model = parseSource(text);
    const out = regenerateSource(model);
    const reparsed = parseSource(out);
    let checkedAtLeastOne = false;
    for (const record of model.records) {
      for (const entry of record.fields) {
        if (entry.kind !== "field" || !(entry as any).relativePosition) continue;
        checkedAtLeastOne = true;
        const reRecord = reparsed.records.find((r) => r.name === record.name)!;
        const reEntry = reRecord.fields.find((f) => f.kind === "field" && (f as any).name === (entry as any).name) as any;
        assert.ok(reEntry, fixtureName + ": " + (entry as any).name + " should still exist after round-trip");
        assert.equal(reEntry.relativePosition, true, fixtureName + ": " + (entry as any).name + " should still be relative after round-trip");
        assert.equal(reEntry.position, (entry as any).position, fixtureName + ": " + (entry as any).name + "'s +n value should be unchanged after round-trip");
      }
    }
    assert.ok(checkedAtLeastOne, fixtureName + " should contain at least one +n field to actually exercise this test");
  }
});

test("resolveLayout: resolves a chain of consecutive relative fields against the running cursor column, not a literal small number", () => {
  const model = parseSource(fixture("scsprt1-realworld.prtf"));
  const layout = resolveLayout(model, "DTLREC", {}, "inch");
  const byName: Record<string, any> = {};
  for (const cell of layout.cells) byName[cell.name] = cell;

  // CUSTNO: absolute position 2, length 6 -> ends at column 8.
  assert.equal(byName.CUSTNO.position, 2);
  assert.equal(byName.CUSTNO.relativePosition, false);
  // CUSTNAME: +2 after CUSTNO's end (8 + 2 = 10), length 25 -> ends at 35.
  assert.equal(byName.CUSTNAME.position, 10);
  assert.equal(byName.CUSTNAME.relativePosition, true);
  // ORDDATE: +2 after CUSTNAME's end (35 + 2 = 37), length 7 -> ends at 44.
  assert.equal(byName.ORDDATE.position, 37);
  // ORDTIME: +1 after ORDDATE's end (44 + 1 = 45).
  assert.equal(byName.ORDTIME.position, 45);
});

test("resolveLayout: a relative position on the very first field of a line resolves against the initial cursor (column 1)", () => {
  // Built directly as a model object rather than hand-typed fixed-column
  // DDS text, to avoid off-by-one column-counting errors in the test
  // itself — this exercises resolveLayout's own resolution logic
  // directly, which is what this test actually targets.
  const model: any = {
    fileLevel: { keywords: [] },
    records: [
      {
        kind: "record",
        name: "TESTREC",
        conditions: [],
        keywords: [],
        fields: [
          { kind: "field", id: "f1", name: "FLDA", length: 10, dataType: "A", position: 2, relativePosition: true, conditions: [], keywords: [] },
        ],
      },
    ],
  };
  const layout = resolveLayout(model, "TESTREC", {}, "inch");
  const cell = layout.cells.find((c: any) => c.name === "FLDA");
  // cursorCol starts at 1, so +2 resolves to column 3.
  assert.equal(cell.position, 3);
});

test("applyEditToModel: updateField/updateConstant/move fix a field at its resolved absolute column, clearing relativePosition", () => {
  const model = parseSource(fixture("scsprt1-realworld.prtf"));
  const rec = model.records.find((r) => r.name === "DTLREC")!;
  const custname = rec.fields.find((f) => f.kind === "field" && f.name === "CUSTNAME") as any;
  assert.equal(custname.relativePosition, true);

  applyEditToModel(model, {
    kind: "updateField",
    id: custname.id,
    name: "CUSTNAME",
    length: 25,
    dataType: "A",
    line: 1,
    position: 10, // the resolved absolute column the panel would have shown
  } as any);

  assert.equal(custname.relativePosition, false);
  assert.equal(custname.position, 10);

  // Regenerating now emits a plain absolute column, not '+10'.
  const out = regenerateSource(model);
  const outLine = out.split("\n")[custname.sourceLineIndex];
  assert.equal(outLine.slice(41, 44), " 10");
});
