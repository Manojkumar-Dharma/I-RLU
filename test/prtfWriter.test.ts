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
