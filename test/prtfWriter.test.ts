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
const { emitWithKeywords } = require("../src/prtfWriter.js");

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
