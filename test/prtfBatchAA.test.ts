// Batch AA (docs/TASKS.md) — bug fix: regenerateSource unconditionally
// blanked out every line's optional column-6 "form type" marker instead of
// preserving whatever was already there, and rebuilds every line fresh on
// every edit regardless of whether it changed — the two combined to make
// Batch X's "Track source modifications" flag nearly the entire file as
// changed from a single one-field edit, on any source written in the
// (very common) `A`-in-column-6 style.
//
// Found reviewing two real-world sample files supplied for keyword-usage
// reference (test/fixtures/scsprt1-realworld.prtf,
// test/fixtures/afpprt1-realworld.prtf — copies of the originals supplied,
// both use `A` in column 6 throughout, including on continuation lines).
//
// IBM's own DDS reference confirms column 6 is optional and "for
// documentation purposes only" — its absence never affects compilation on
// its own — so this fix is about PRESERVING the person's own source
// exactly, not about correctness of what CRTPRTF would accept either way.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords, applyModificationTracking } = require("../src/prtfWriter.js");

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

test("buildPositional: honors an explicit formType instead of always blanking column 6", () => {
  const withA = buildPositional({ nameType: "R", name: "HEADER", formType: "A" });
  assert.equal(withA.slice(5, 6), "A");
  const blank = buildPositional({ nameType: "R", name: "HEADER" });
  assert.equal(blank.slice(5, 6), " ");
});

test("emitWithKeywords: a continuation line reuses the SAME formType character at column 6 as the first line, not blank", () => {
  const positional = buildPositional({ nameType: "R", name: "HDRREC", formType: "A" });
  const lines = emitWithKeywords(positional, "BOX(0.30 0.30 1.50 8.00 0.02) LINE(*HORIZONTAL 0.90 0.30 7.70 0.02) FONT(2304)", "A");
  assert.ok(lines.length >= 2, "expected this to actually wrap onto a continuation line");
  for (const line of lines) {
    assert.equal(line.slice(5, 6), "A", `every physical line (including continuations) should carry the same form-type char, got: ${JSON.stringify(line)}`);
  }
});

test("emitWithKeywords: omitting formType still defaults every line (including continuations) to blank, matching prior behavior", () => {
  const positional = buildPositional({ nameType: "R", name: "HDRREC" });
  const lines = emitWithKeywords(positional, "BOX(0.30 0.30 1.50 8.00 0.02) LINE(*HORIZONTAL 0.90 0.30 7.70 0.02) FONT(2304)");
  for (const line of lines) assert.equal(line.slice(5, 6), " ");
});

test("parseSource: captures column 6 on a comment line, a record line, a field line, and a constant line", () => {
  const source = [
    "     A*a comment",
    "     A          R HEADER",
    "     A            CUSTNAME      10A  O  1  2",
    "     A                                     1 20'Hello'",
  ].join("\n") + "\n";
  const model = parseSource(source);
  const comment = model.sequence.find((e) => e.kind === "comment");
  assert.equal(comment && (comment as any).formType, "A");
  const record = model.records[0];
  assert.equal(record.formType, "A");
  const field = record.fields.find((f) => f.kind === "field");
  assert.equal(field && field.formType, "A");
  const constant = record.fields.find((f) => f.kind === "constant");
  assert.equal(constant && constant.formType, "A");
});

test("parseSource: captures column 6 on the file-level entry from its FIRST contributing line", () => {
  const source = ["     A                                      INDARA", "     B                                      PRTQLTY(*STD)", "     A          R HEADER"].join("\n") + "\n";
  const model = parseSource(source);
  // First file-level line used 'A'; the second (merged into the same
  // entry) used 'B' — the entry's own formType should reflect the FIRST
  // line, since both get emitted as a single regenerated block.
  assert.equal(model.fileLevel.formType, "A");
});

test("parseSource: a freshly-parsed entry from ordinary blank-column-6 source captures a blank formType, not undefined — regenerateSource must still reproduce blank either way", () => {
  const source = "                R HEADER\n";
  const model = parseSource(source);
  assert.equal(model.records[0].formType, " ");
  assert.equal(regenerateSource(model), source);
});

test("Batch AA headline repro: a single one-field edit no longer floods Track-source-modifications with unrelated lines, on A-in-column-6 source", () => {
  // A small, clean multi-field record in the same 'A'-in-column-6 style as
  // the real-world sample files, but deliberately free of this project's
  // OTHER known, separately-tracked limitations (DDS's "+n" relative
  // position notation — see docs/TASKS.md Batch DD — and multiple
  // file-level lines collapsing into one regenerated block), so this test
  // isolates Batch AA's own fix rather than being muddied by those.
  //
  // Built via buildPositional/emitWithKeywords directly (formType: "A")
  // rather than hand-typed fixed-width text, so the fixture itself can't
  // be wrong about DDS's exact column layout.
  const commentLines = ["==========================================================", " DTLREC - detail line", "=========================================================="].map((t) => "     A*" + t);
  const recordLine = emitWithKeywords(buildPositional({ nameType: "R", name: "DTLREC", formType: "A" }), "SKIPB(1)", "A")[0];
  const custnameLine = emitWithKeywords(buildPositional({ name: "CUSTNAME", length: 25, dataType: "A", usage: "O", lineNo: 1, position: 2, formType: "A" }), "", "A")[0];
  const orddateLine = emitWithKeywords(buildPositional({ name: "ORDDATE", dataType: "L", usage: "O", lineNo: 1, position: 30, formType: "A" }), "DATFMT(*ISO)", "A")[0];
  const amountLine = emitWithKeywords(buildPositional({ name: "AMOUNT", length: 7, dataType: "S", decimalPositions: 2, usage: "O", lineNo: 1, position: 60, formType: "A" }), "EDTCDE(J)", "A")[0];
  const source = [...commentLines, recordLine, custnameLine, orddateLine, amountLine].join("\n") + "\n";

  const model = parseSource(source);
  const oldText = source; // the real extension diffs against document.getText() (the actual on-disk file), not a re-regenerated copy
  assert.equal(regenerateSource(model), source, "sanity check: this clean fixture (unlike the messy real-world one) should round-trip byte-identical before any edit");

  const dtl = model.records.find((r) => r.name === "DTLREC");
  assert.ok(dtl);
  const custname = dtl!.fields.find((f) => f.kind === "field" && f.name === "CUSTNAME");
  assert.ok(custname);
  (custname as any).keywords.push({ name: "COLOR", params: "(BLU)", raw: "COLOR(BLU)", sourceLineIndex: -1 });

  const newText = regenerateSource(model);
  const tracked: string[] = applyModificationTracking(oldText.split(/\r\n|\n/), newText.split(/\r\n|\n/), { enabled: true, tag: "CHG00001" });
  const totalLines = tracked.length;
  const oldLines = oldText.split(/\r\n|\n/);
  let spuriousComments = 0;
  let taggedCount = 0;
  for (const line of tracked) {
    if (line.includes("CHG00001")) taggedCount++;
    // A NEWLY-commented line is one where column 7 is now '*' but the
    // ORIGINAL line at that same text (minus column 7) was NOT already a
    // comment — i.e. Batch X's commentOutLine introduced it for this edit,
    // it wasn't already in the source.
    if (line.slice(6, 7) === "*") {
      const wasAlreadyComment = oldLines.some((ol) => ol.slice(6, 7) === "*" && ol.slice(0, 6) + ol.slice(7) === line.slice(0, 6) + line.slice(7));
      if (!wasAlreadyComment) spuriousComments++;
    }
  }
  assert.equal(taggedCount, 1, `expected exactly the edited CUSTNAME line to be tagged, got ${taggedCount} tagged lines out of ${totalLines}`);
  assert.equal(spuriousComments, 1, `expected exactly the edited entry's OWN old line to be commented out (its unrelated neighbors, including the header comment block, must be untouched), got ${spuriousComments} newly-introduced comment lines out of ${totalLines}`);
  // The header-comment lines and the untouched record/ORDDATE/AMOUNT lines
  // must survive completely unchanged.
  for (const untouchedLine of [...commentLines, recordLine, orddateLine, amountLine]) {
    assert.ok(tracked.includes(untouchedLine), `expected this untouched line to survive byte-identical: ${JSON.stringify(untouchedLine)}`);
  }
});

test("Batch AA: column 6 'A' count is preserved end to end on the real-world SCS sample (other, separately-tracked limitations aside)", () => {
  const source = fixture("scsprt1-realworld.prtf");
  const model = parseSource(source);
  const regenerated = regenerateSource(model);
  const origLines = source.split(/\r\n|\n/);
  const newLines = regenerated.split(/\r\n|\n/);
  const origAcount = origLines.filter((l) => l.slice(5, 6) === "A").length;
  const newAcount = newLines.filter((l: string) => l.slice(5, 6) === "A").length;
  assert.ok(origAcount > 30, `sanity check: this fixture should have plenty of column-6 'A' lines to verify, got ${origAcount}`);
  assert.equal(newAcount, origAcount, `expected the same number of column-6 'A' lines before (${origAcount}) and after regeneration (${newAcount})`);
});
