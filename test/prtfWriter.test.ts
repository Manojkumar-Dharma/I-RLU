// Unit tests for src/prtfWriter.js's line-wrapping logic, isolated from the
// parser so a regression here fails independently of any fixture file.
//
// The Batch M test below is the one that matters most: it pins down the
// continuation-character bug fixed in this batch (docs/TASKS.md Batch M) —
// prtfWriter.js used to always emit '+' continuation when wrapping a
// keyword area, which drops the space at the join per real DDS semantics
// ('+' = no implied space, '-' = implied single space). Since this
// function's wrapping algorithm only ever splits between separate
// whitespace-delimited tokens (never mid-token), the space between the last
// token kept on one line and the first token pushed to the next is always
// real and must survive the round trip — meaning '-' is the only correct
// choice this function should ever produce.
import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { emitWithKeywords, tokenizeKeywordText } = require("../src/prtfWriter.js");

function keywordArea(line: string): string {
  // Columns 45-80 (1-indexed) = 0-indexed slice [44, 80).
  return line.slice(44, 80);
}

test("Batch M: a wrap that falls between two space-separated tokens uses '-' continuation, not '+'", () => {
  // Long enough to force a wrap inside KEYWORD_WIDTH (34 cols): the
  // wrap point falls exactly between "PAGSEG(COMPLOGO" and "0.5", which
  // were separated by a real space in the source keyword text.
  const positional = " ".repeat(44);
  const lines = emitWithKeywords(
    positional,
    "STRPAGGRP SKIPB(1) PAGSEG(COMPLOGO 0.5 0.5) OVERLAY(STMTFORM 0 0)"
  );
  assert.ok(lines.length >= 2, "expected the keyword text to wrap onto more than one line");
  const firstLineArea = keywordArea(lines[0]);
  const continuationChar = firstLineArea[firstLineArea.length - 1];
  assert.equal(
    continuationChar,
    "-",
    `expected '-' continuation (implied space) at the wrap point, got ${JSON.stringify(continuationChar)}`
  );
});

test("Batch M: reassembling wrapped lines with the documented +/- semantics reproduces the original keyword text", () => {
  // This mirrors what the parser does on read (col 80 '-' => insert a
  // space at the join, '+' => no space) so the test fails if the writer
  // ever regresses to choosing the wrong character again, independent of
  // whether the parser itself is exercised.
  const original = "STRPAGGRP SKIPB(1) PAGSEG(COMPLOGO 0.5 0.5) OVERLAY(STMTFORM 0 0)";
  const positional = " ".repeat(44);
  const lines = emitWithKeywords(positional, original);
  let reassembled = "";
  for (const line of lines) {
    const area = keywordArea(line);
    const last = area[area.length - 1];
    const continues = last === "+" || last === "-";
    const text = (continues ? area.slice(0, -1) : area).replace(/\s+$/, "");
    reassembled += (continues && last === "-" ? text + " " : text);
  }
  assert.equal(reassembled.trim(), original);
});

test("last line of a wrapped keyword area has no trailing continuation character", () => {
  const positional = " ".repeat(44);
  const lines = emitWithKeywords(positional, "STRPAGGRP SKIPB(1) PAGSEG(COMPLOGO 0.5 0.5) OVERLAY(STMTFORM 0 0)");
  const lastArea = keywordArea(lines[lines.length - 1]).replace(/\s+$/, "");
  // The raw line may be right-trimmed already by emitWithKeywords, so just
  // confirm neither '+' nor '-' sits in the last non-space position of the
  // full 80-column area for the final line.
  const fullLastArea = lines[lines.length - 1].padEnd(80, " ").slice(44, 80);
  assert.notEqual(fullLastArea[fullLastArea.length - 1], "+");
  assert.notEqual(fullLastArea[fullLastArea.length - 1], "-");
  assert.ok(lastArea.length > 0);
});

test("short keyword text that fits on one line needs no continuation", () => {
  const positional = " ".repeat(44);
  const lines = emitWithKeywords(positional, "SKIPB(1)");
  assert.equal(lines.length, 1);
  const area = lines[0].padEnd(80, " ").slice(44, 80);
  assert.notEqual(area[area.length - 1], "+");
  assert.notEqual(area[area.length - 1], "-");
});

test("empty keyword text produces a single blank-keyword-area line, no continuation", () => {
  const positional = " ".repeat(44);
  const lines = emitWithKeywords(positional, "");
  assert.equal(lines.length, 1);
});

// --- Batch R: tokenizeKeywordText must not split whitespace inside a
// quoted DDS literal (docs/TASKS.md Batch R). A naive `text.split(/\s+/)`
// (what this replaced) has no concept of quote boundaries, so a run of
// spaces *inside* a quoted parameter like EDTWRD('  .  ') gets treated the
// same as the spaces *between* separate keywords — silently collapsing to
// a single space once tokens are rejoined for wrapping. Same class of bug
// as Batch M (wrong continuation character at a wrap point), but corrupting
// content nowhere near a wrap point at all.

test("tokenizeKeywordText: a single-quoted literal with multiple internal spaces stays one token, spaces intact", () => {
  assert.deepEqual(tokenizeKeywordText("EDTWRD('  .  ')"), ["EDTWRD('  .  ')"]);
});

test("tokenizeKeywordText: whitespace between separate keywords still splits normally", () => {
  assert.deepEqual(tokenizeKeywordText("DATE  TIME"), ["DATE", "TIME"]);
});

test("tokenizeKeywordText: a quoted literal followed by another keyword splits at the quote boundary, not inside it", () => {
  assert.deepEqual(tokenizeKeywordText("EDTWRD('  .  ') COLOR(*BLU)"), ["EDTWRD('  .  ')", "COLOR(*BLU)"]);
});

test("tokenizeKeywordText: a doubled '' inside a quoted literal (DDS's escaped-quote convention) stays inside the token, doesn't end it early", () => {
  assert.deepEqual(tokenizeKeywordText("MSGCON('It''s  ready')"), ["MSGCON('It''s  ready')"]);
});

test("tokenizeKeywordText: multiple quoted literals in the same keyword text are each kept whole", () => {
  assert.deepEqual(tokenizeKeywordText("DFT('  a  ') EDTWRD('  b  ')"), ["DFT('  a  ')", "EDTWRD('  b  ')"]);
});

test("tokenizeKeywordText: a leading/trailing space around otherwise normal tokens doesn't produce empty tokens", () => {
  assert.deepEqual(tokenizeKeywordText("  DATE   TIME  "), ["DATE", "TIME"]);
});

test("tokenizeKeywordText: empty input produces no tokens", () => {
  assert.deepEqual(tokenizeKeywordText(""), []);
});

test("Batch R (regression, unit level): emitWithKeywords preserves multiple internal spaces inside a quoted keyword literal end to end", () => {
  const positional = " ".repeat(44);
  const lines = emitWithKeywords(positional, "EDTWRD('  .  ')");
  assert.equal(lines.length, 1);
  const area = keywordArea(lines[0].padEnd(80, " "));
  assert.ok(area.startsWith("EDTWRD('  .  ')"), `expected keyword area to start with the untouched literal, got: ${JSON.stringify(area)}`);
});

test("Batch R: a quoted literal with internal spaces that's part of a longer keyword area still wraps correctly at the NEXT token boundary, not inside the literal", () => {
  const positional = " ".repeat(44);
  // "MSGCON('  hello world  ')" is 26 chars — well under the 34-col
  // KEYWORD_WIDTH on its own, so pairing it with a second keyword forces a
  // wrap; the wrap must land between the two keywords, never inside the
  // quoted literal itself (there's no token boundary inside it to split at).
  const lines = emitWithKeywords(positional, "MSGCON('  hello world  ') COLOR(*BLU)");
  assert.equal(lines.length, 2);
  const firstArea = keywordArea(lines[0].padEnd(80, " "));
  assert.ok(firstArea.includes("MSGCON('  hello world  ')"), `literal should be intact and whole on the first line, got: ${JSON.stringify(firstArea)}`);
  assert.ok(!firstArea.includes("COLOR"), "COLOR should have wrapped to the next line, not been split into the literal's line");
  const secondArea = keywordArea(lines[1].padEnd(80, " "));
  assert.ok(secondArea.trim().startsWith("COLOR(*BLU)"));
});

// --- Batch X: "Track source modifications" (docs/TASKS.md), ported from
// I-SDA's dspfWriter.js (same function names/shapes — commentOutLine,
// buildModTag, appendModTag, applyModificationTracking). Column
// conventions verified against this project's OWN regenerateSource
// (comment lines are `"      *" + text`, i.e. column 7 == '*' — see
// prtfParser.ts's `col(line, 7) === "*"` check) rather than assumed
// identical to I-SDA's.
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { commentOutLine, buildModTag, appendModTag, applyModificationTracking, regenerateSource } = require("../src/prtfWriter.js");

test("commentOutLine: sets column 7 to '*', leaves every other column (including a trailing continuation char) untouched", () => {
  // A record line, columns 1-16 blank (sequence/comment/conditioning),
  // 'R' at column 17, name at 19-28, keyword area with a trailing '-'.
  const line =
    " ".repeat(16) + "R" + " " + "HEADER".padEnd(10, " ") + " ".repeat(16) + "SKIPB(1)".padEnd(35, " ") + "-";
  const commented = commentOutLine(line);
  assert.equal(commented.slice(6, 7), "*", "column 7 should now be '*'");
  assert.equal(commented.slice(0, 6), line.slice(0, 6), "columns 1-6 must be unchanged");
  assert.equal(commented.slice(7).replace(/\s+$/, ""), line.slice(7).replace(/\s+$/, ""), "everything from column 8 on (including the trailing '-') must be unchanged");
});

test("commentOutLine: pads a too-short line out to at least 7 columns before setting column 7, never truncates", () => {
  const commented = commentOutLine("R HEADER");
  assert.equal(commented.length >= 7, true);
  assert.equal(commented.slice(6, 7), "*");
});

test("buildModTag: strips newlines and caps at 10 characters", () => {
  assert.equal(buildModTag("ABC\nDEF\r\n"), "ABCDEF");
  assert.equal(buildModTag("12345678901234"), "1234567890");
  assert.equal(buildModTag(""), "");
  assert.equal(buildModTag(undefined), "");
});

test("appendModTag: pads a short line to column 80 before appending the tag at column 81", () => {
  const tagged = appendModTag("SHORT", "TAG12345Z");
  assert.equal(tagged.length, 80 + "TAG12345Z".length);
  assert.equal(tagged.slice(0, 5), "SHORT");
  assert.equal(tagged.slice(80), "TAG12345Z");
});

test("appendModTag: a blank tag is a no-op, line returned unchanged", () => {
  assert.equal(appendModTag("SOMETHING", ""), "SOMETHING");
  assert.equal(appendModTag("SOMETHING", undefined), "SOMETHING");
});

test("applyModificationTracking: disabled (the common case) returns newLines completely unchanged", () => {
  const oldLines = ["A", "B", "C"];
  const newLines = ["A", "X", "C"];
  assert.deepEqual(applyModificationTracking(oldLines, newLines, { enabled: false, tag: "TAG" }), newLines);
});

test("applyModificationTracking: a blank tag is treated the same as disabled", () => {
  const oldLines = ["A", "B", "C"];
  const newLines = ["A", "X", "C"];
  assert.deepEqual(applyModificationTracking(oldLines, newLines, { enabled: true, tag: "" }), newLines);
});

test("applyModificationTracking: trims the common prefix/suffix, only touches the genuinely differing middle", () => {
  const oldLines = ["UNCHANGED1", "OLDMID", "UNCHANGED2"];
  const newLines = ["UNCHANGED1", "NEWMID", "UNCHANGED2"];
  const result = applyModificationTracking(oldLines, newLines, { enabled: true, tag: "TAG" });
  assert.equal(result[0], "UNCHANGED1");
  assert.equal(result[result.length - 1], "UNCHANGED2");
  // The middle: old commented out, then new tagged.
  assert.equal(result[1], commentOutLine("OLDMID"));
  assert.equal(result[2], appendModTag("NEWMID", "TAG"));
  assert.equal(result.length, 4);
});

test("applyModificationTracking (Task L52 grouping, ported from I-SDA): a multi-line change groups ALL commented-out old lines together, THEN all tagged new lines — never interleaved", () => {
  // Two old lines both change to two new lines — if this were naively
  // interleaved (comment0, new0, comment1, new1) a continuation chain
  // between new0/new1 would be corrupted by comment0/comment1 landing in
  // between. The grouped shape (comment0, comment1, new0, new1) keeps the
  // new lines adjacent to each other.
  const oldLines = ["OLD0", "OLD1"];
  const newLines = ["NEW0", "NEW1"];
  const result = applyModificationTracking(oldLines, newLines, { enabled: true, tag: "TAG" });
  assert.deepEqual(result, [
    commentOutLine("OLD0"),
    commentOutLine("OLD1"),
    appendModTag("NEW0", "TAG"),
    appendModTag("NEW1", "TAG"),
  ]);
});

test("applyModificationTracking: a genuinely blank old line dropped by a shrinking edit is not preserved as an empty comment", () => {
  const oldLines = ["KEEP", "", "DROP-ME"];
  const newLines = ["KEEP"];
  const result = applyModificationTracking(oldLines, newLines, { enabled: true, tag: "TAG" });
  // The blank line contributes nothing; "DROP-ME" (non-blank) is preserved as history.
  assert.deepEqual(result, ["KEEP", commentOutLine("DROP-ME")]);
});

test("applyModificationTracking: a line unchanged at the same position within an otherwise-differing middle is carried through bare, no comment or tag", () => {
  // Sandwiched case: position 1 is identical in both old and new mid
  // regions even though positions 0 and 2 differ.
  const oldLines = ["PRE", "OLDA", "SAME", "OLDB", "POST"];
  const newLines = ["PRE", "NEWA", "SAME", "NEWB", "POST"];
  const result = applyModificationTracking(oldLines, newLines, { enabled: true, tag: "TAG" });
  assert.deepEqual(result, [
    "PRE",
    commentOutLine("OLDA"),
    commentOutLine("OLDB"),
    appendModTag("NEWA", "TAG"),
    "SAME",
    appendModTag("NEWB", "TAG"),
    "POST",
  ]);
});

// --- Batch X, multi-line CONSTANT round trip (the case explicitly called
// out to verify): a constant whose keyword area wraps across a
// continuation line (mirroring test/fixtures/sample-afpds.pf's own
// `1 40'CUSTOMER STATEMENT' CDEFNT(920 *CURLIB) COLOR(*BLU)` entry, which
// wraps onto a second physical line) must have BOTH its old physical
// lines commented out and BOTH its new physical lines tagged — and,
// critically, the edited constant must still reparse correctly afterward
// (the continuation relationship between its own two new lines must
// survive being placed after a block of unrelated old-line comments).
function buildMultiLineConstantSource(): string {
  const lines = [
    "      * sample",
    "                R HEADER",
    "                                        1 40'CUSTOMER STATEMENT' CDEFNT(920    -",
    "                                            *CURLIB) COLOR(*BLU)",
    "                  CUSTNAME      30A  O  3 10",
  ];
  return lines.join("\n") + "\n";
}

test("Batch X: editing a multi-line (continuation-wrapped) constant comments out both its old physical lines and tags both new ones, and the result reparses correctly", () => {
  const source = buildMultiLineConstantSource();
  const model = parseSource(source);

  const record = model.records.find((r) => r.name === "HEADER");
  assert.ok(record);
  const constant = record.fields.find((f) => f.kind === "constant" && f.literal === "CUSTOMER STATEMENT");
  assert.ok(constant, "expected to find the multi-line CUSTOMER STATEMENT constant");

  // Confirm the fixture is actually multi-line before editing it — i.e.
  // this test exercises what it claims to.
  const oldText = regenerateSource(model);
  assert.equal(oldText, source, "sanity check: unedited round trip should be byte-identical");
  const oldLines = oldText.split(/\r\n|\r|\n/);

  // Edit: change the literal text. CDEFNT/COLOR keywords are untouched,
  // so the wrap should still land after CDEFNT's value, keeping this a
  // 2-physical-line entry both before and after the edit.
  (constant as any).literal = "CUSTOMER INVOICE STATEMENT";

  const newText = regenerateSource(model);
  const newLines = newText.split(/\r\n|\r|\n/);
  assert.notEqual(newText, oldText, "sanity check: the edit should actually change the source");

  const tracked = applyModificationTracking(oldLines, newLines, { enabled: true, tag: "CHGBY-MD" }).join("\n");

  // Both ORIGINAL physical lines of the constant must appear, commented out.
  const origLine1 = "                                        1 40'CUSTOMER STATEMENT' CDEFNT(920    -";
  const origLine2 = "                                            *CURLIB) COLOR(*BLU)";
  assert.ok(tracked.includes(commentOutLine(origLine1)), "expected the constant's first old physical line to be commented out, unchanged otherwise");
  assert.ok(tracked.includes(commentOutLine(origLine2)), "expected the constant's second (continuation) old physical line to be commented out, unchanged otherwise");

  // Reparse the tracked source and confirm the edited constant survives
  // intact — i.e. the continuation between its two NEW physical lines
  // wasn't broken by the old-line comments being grouped ahead of them.
  const reparsed = parseSource(tracked);
  const reparsedRecord = reparsed.records.find((r) => r.name === "HEADER");
  assert.ok(reparsedRecord);
  const reparsedConstant = reparsedRecord.fields.find((f) => f.kind === "constant" && f.literal === "CUSTOMER INVOICE STATEMENT");
  assert.ok(reparsedConstant, "expected the edited constant to reparse with its new literal text intact");
  const cdefnt = reparsedConstant!.keywords.find((k) => k.name === "CDEFNT");
  const color = reparsedConstant!.keywords.find((k) => k.name === "COLOR");
  assert.ok(cdefnt && cdefnt.params.includes("920") && cdefnt.params.includes("*CURLIB"), "CDEFNT's own value (which spans the continuation join) must survive intact");
  assert.ok(color && color.params.includes("*BLU"), "COLOR (on the continuation line) must survive intact");

  // The other, untouched entries in the file must be unaffected.
  const custname = reparsedRecord!.fields.find((f) => f.kind === "field" && f.name === "CUSTNAME");
  assert.ok(custname, "an unrelated, unedited field must still be present and untouched");

  // The tag itself must land past column 80 on both new physical lines
  // that changed, and must NOT appear in the (untouched) CUSTNAME line.
  const trackedLines = tracked.split("\n");
  const taggedLines = trackedLines.filter((l: string) => l.includes("CHGBY-MD"));
  assert.equal(taggedLines.length, 2, "both new physical lines of the edited constant should carry the tag");
  assert.ok(!trackedLines.some((l: string) => l.includes("CUSTNAME") && l.includes("CHGBY-MD")), "the untouched CUSTNAME field must not be tagged");
});
