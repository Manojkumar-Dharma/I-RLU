// Tests for docs/TASKS.md Batch GGG — building a file-level properties
// panel (docs/AUDIT-CROSS-LEVEL.md §2/§3).
//
// Before this batch, model.fileLevel was never referenced anywhere in
// media/webviewClient.js except the one validateFileLevelKeywords(state.model)
// warnings call — no panel let a person view or edit a file-level keyword.
// This batch adds:
//   1. A setFileLevelKeyword/removeFileLevelKeyword edit-kind pair
//      (src/prtfEdits.ts), analogous to setRecordKeyword/removeRecordKeyword
//      but targeting model.fileLevel.keywords — including the two edge
//      cases that model.fileLevel being a single object only conditionally
//      present in model.sequence (see prtfParser.ts) requires handling.
//   2. Simple rows for REF/RELPOS/INDARA/DFNCHR (media/webviewClient.js's
//      new BATCH_GGG_FILE_KEYWORDS + renderFileLevelPanel).
//   3. The file-level slice of the shared Font & sizing panel
//      (CCSID/FNTCHRSET/FONTNAME) via a new "file" level for
//      renderFontSizingPanel, which also needed CHRSIZ suppressed
//      entirely (Record+Field only, not File+Record+Field).
//
// Deliberately NOT in scope for this batch (documented, not silently
// omitted): INDTXT at the file level (would need generalizing the
// record-scoped setIndicatorText edit kind), SKIPA/SKIPB/SPACEA/SPACEB UI
// (these have zero UI at ANY level today, not just file — a separate,
// broader gap), and DFNCHR's record-level form plus its DRAWER exclusion.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
import { applyEditToModel } from "../src/prtfEdits";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("path");

/** One record ("HEADER") with a named field, plus a file-level PAGSIZE line — so model.fileLevel is already present in model.sequence going in. */
function buildModelWithFileLevel() {
  const lines = [
    ...emitWithKeywords(buildPositional({}), "PAGSIZE(66 132)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ];
  return parseSource(lines.join("\n") + "\n");
}

/** Same shape, but with NO file-level keyword line at all — model.fileLevel exists (per prtfParser.ts) but was never pushed into model.sequence. */
function buildModelWithoutFileLevel() {
  const lines = [
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ];
  return parseSource(lines.join("\n") + "\n");
}

// --- applyEditToModel: setFileLevelKeyword / removeFileLevelKeyword,
// ordinary case (fileLevel already in model.sequence) -----------------

test("applyEditToModel: setFileLevelKeyword adds a new keyword, then replaces it on a second set", () => {
  const model = buildModelWithFileLevel();
  applyEditToModel(model, { kind: "setFileLevelKeyword", name: "REF", params: "(MYLIB/MYFILE)" });
  assert.equal(PrtfEngine.findKeyword(model.fileLevel.keywords, "REF").params, "(MYLIB/MYFILE)");
  applyEditToModel(model, { kind: "setFileLevelKeyword", name: "REF", params: "(OTHERLIB/OTHERFILE)" });
  const refs = model.fileLevel.keywords.filter((k: any) => k.name === "REF");
  assert.equal(refs.length, 1, "setting the same file-level keyword twice should replace, not duplicate");
  assert.equal(refs[0].params, "(OTHERLIB/OTHERFILE)");
});

test("applyEditToModel: removeFileLevelKeyword removes an existing keyword and is a no-op (returns false) if absent", () => {
  const model = buildModelWithFileLevel();
  applyEditToModel(model, { kind: "setFileLevelKeyword", name: "INDARA" });
  assert.ok(PrtfEngine.findKeyword(model.fileLevel.keywords, "INDARA"));
  const changed = applyEditToModel(model, { kind: "removeFileLevelKeyword", name: "INDARA" });
  assert.equal(changed, true);
  assert.equal(PrtfEngine.findKeyword(model.fileLevel.keywords, "INDARA"), undefined);
  assert.equal(applyEditToModel(model, { kind: "removeFileLevelKeyword", name: "INDARA" }), false);
});

// --- Edge case: the FIRST file-level keyword ever on a file with none --

test("applyEditToModel: setFileLevelKeyword on a file with no existing file-level keywords splices model.fileLevel into model.sequence before the first record", () => {
  const model = buildModelWithoutFileLevel();
  assert.equal(model.sequence.indexOf(model.fileLevel), -1, "fileLevel should not be in sequence yet");
  applyEditToModel(model, { kind: "setFileLevelKeyword", name: "RELPOS" });
  const seqIndex = model.sequence.indexOf(model.fileLevel);
  assert.notEqual(seqIndex, -1, "fileLevel should now be spliced into sequence");
  const firstRecordIndex = model.sequence.findIndex((e: any) => e.kind === "record");
  assert.ok(seqIndex < firstRecordIndex, "fileLevel must precede the first record in sequence order");
});

test("applyEditToModel: the first-ever file-level keyword round-trips through regenerate + reparse, positioned before the record", () => {
  const model = buildModelWithoutFileLevel();
  applyEditToModel(model, { kind: "setFileLevelKeyword", name: "RELPOS" });
  const regenerated = regenerateSource(model);
  const reparsed = parseSource(regenerated);
  assert.ok(PrtfEngine.findKeyword(reparsed.fileLevel.keywords, "RELPOS"));
  const recordLineIndex = regenerated.split("\n").findIndex((l: string) => l.includes("R HEADER"));
  const relposLineIndex = regenerated.split("\n").findIndex((l: string) => l.includes("RELPOS"));
  assert.ok(relposLineIndex < recordLineIndex, "RELPOS line must appear before the record's own line in the regenerated source");
});

// --- Edge case: removing the LAST remaining file-level keyword ---------

test("applyEditToModel: removing the last file-level keyword takes model.fileLevel out of model.sequence entirely", () => {
  const model = buildModelWithFileLevel();
  applyEditToModel(model, { kind: "removeFileLevelKeyword", name: "PAGSIZE" });
  assert.equal(model.fileLevel.keywords.length, 0);
  assert.equal(model.sequence.indexOf(model.fileLevel), -1, "an emptied fileLevel should be removed from sequence, not left as a stray entry");
});

test("applyEditToModel: regenerating after removing the last file-level keyword leaves no stray blank line", () => {
  const model = buildModelWithFileLevel();
  applyEditToModel(model, { kind: "removeFileLevelKeyword", name: "PAGSIZE" });
  const regenerated = regenerateSource(model);
  const expected = regenerateSource(buildModelWithoutFileLevel());
  assert.equal(regenerated, expected, "removing the only file-level keyword should regenerate identically to a file that never had one");
});

// --- Round-trip: REF/RELPOS/INDARA/DFNCHR at the file level ------------

test("Batch GGG round-trip: REF/RELPOS/INDARA/DFNCHR at the file level survive parse -> regenerate unchanged", () => {
  const lines = [
    ...emitWithKeywords(buildPositional({}), "REF(MYLIB/MYFILE)"),
    ...emitWithKeywords(buildPositional({}), "RELPOS"),
    ...emitWithKeywords(buildPositional({}), "INDARA"),
    ...emitWithKeywords(buildPositional({}), "DFNCHR(X'41' X'0000000000000000')"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ];
  const original = lines.join("\n") + "\n";
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
  assert.ok(PrtfEngine.findKeyword(model.fileLevel.keywords, "REF"));
  assert.ok(PrtfEngine.findKeyword(model.fileLevel.keywords, "RELPOS"));
  assert.ok(PrtfEngine.findKeyword(model.fileLevel.keywords, "INDARA"));
  assert.equal(PrtfEngine.findKeyword(model.fileLevel.keywords, "DFNCHR").params, "(X'41' X'0000000000000000')");
});

// --- Properties-panel UI (source-shape checks — webviewClient.js isn't
// require()-able, same constraint every other webview-shape test in this
// project works around) ------------------------------------------------

test("webview: BATCH_GGG_FILE_KEYWORDS models REF (text), RELPOS (flag), INDARA (flag), and DFNCHR (text)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const arrayMatch = source.match(/const BATCH_GGG_FILE_KEYWORDS = \[([\s\S]*?)\n  \];/);
  assert.ok(arrayMatch, "BATCH_GGG_FILE_KEYWORDS array not found");
  const body = arrayMatch![1];
  assert.match(body, /\{ name: "REF", kind: "text"/);
  assert.match(body, /\{ name: "RELPOS", kind: "flag"/);
  assert.match(body, /\{ name: "INDARA", kind: "flag"/);
  assert.match(body, /\{ name: "DFNCHR", kind: "text"/);
});

test("webview: renderFileLevelPanel exists, renders BATCH_GGG_FILE_KEYWORDS against model.fileLevel.keywords, and includes the file-level Font & sizing slice", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const fnMatch = source.match(/function renderFileLevelPanel\(model\) \{([\s\S]*?)\n    return panel;\n  \}\n/);
  assert.ok(fnMatch, "renderFileLevelPanel function not found");
  const body = fnMatch![1];
  assert.match(body, /validateFileLevelKeywords\(model\)/);
  assert.match(body, /appendKeywordRows\(panel, BATCH_GGG_FILE_KEYWORDS, model\.fileLevel\.keywords,/);
  assert.match(body, /kind: "setFileLevelKeyword", name, params/);
  assert.match(body, /kind: "removeFileLevelKeyword", name/);
  assert.match(body, /renderFontSizingPanel\(model\.fileLevel\.keywords, onSet, onRemove, "file level", "file"\)/);
});

test("webview: render() appends renderFileLevelPanel unconditionally, ahead of the record-scoped panels", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  assert.match(source, /sideCol\.appendChild\(renderFileLevelPanel\(state\.model\)\);/);
});

test("webview: renderFontSizingPanel's file-level branch keeps only FNTCHRSET/FONTNAME from FONT_SIZING_SPECS", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  assert.match(
    source,
    /: level === "file"\s*\n\s*\? FONT_SIZING_SPECS\.filter\(\(spec\) => spec\.name === "FNTCHRSET" \|\| spec\.name === "FONTNAME"\)/
  );
});

test("webview: renderFontSizingPanel's CHRSIZ block is skipped entirely at the file level", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  assert.match(source, /if \(level !== "file"\) \{\s*\n\s*const chrsizExisting/);
});
