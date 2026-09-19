// Tests for docs/TASKS.md Batch III — a conditioned file-level keyword
// line loses its leading blank/newline on regenerate.
//
// Root cause: emitEntryWithConditionedKeywords (src/prtfWriter.js) always
// emitted a "header" line via emitGroupKeywordLines even when the entry's
// first keyword group was conditioned (leaving headerKeywords empty). For
// a record/field/constant that's harmless — the header line still carries
// the entry's own identity content (R RECNAME, or the field's own
// declaration) regardless of headerKeywords being empty. But
// model.fileLevel has NO identity content of its own — it's nothing but
// keywords — so an empty headerKeywords group there produced a genuinely
// content-free, wasted blank line ahead of the line that actually carries
// the entry's (conditioned) keywords. Confirmed pre-existing (reproduces
// with plain PAGSIZE, a keyword no other batch touches) and specific to
// fileLevel (the identical pattern at the record level already round-
// tripped correctly, since a record's header line is never truly empty).
//
// Fix: a new requiresHeaderLine parameter (default true, so every
// existing record/field/constant call site is unaffected) lets the
// fileLevel call site opt out of forcing an empty header line when there's
// no unconditioned keyword group to put on it.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

// --- The original repro, and its generalization to the keyword this
// batch was found while testing (SKIPA) ---------------------------------

test("Batch III: a file whose ONLY file-level keyword is conditioned round-trips without a spurious leading blank line (PAGSIZE repro)", () => {
  const original = [
    ...emitWithKeywords(buildPositional({ conditions: [{ indicator: "01" }] }), "PAGSIZE(66 132)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ].join("\n") + "\n";
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
});

test("Batch III: a file whose ONLY file-level keyword is a conditioned SKIPA round-trips without a spurious leading blank line", () => {
  const original = [
    ...emitWithKeywords(buildPositional({ conditions: [{ indicator: "01" }] }), "SKIPA(5)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ].join("\n") + "\n";
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
  assert.ok(PrtfEngine.findKeyword(model.fileLevel.keywords, "SKIPA"));
});

// --- Not scoped to the very first line of the whole file — the same bug
// shape reproduces with unrelated content ahead of it -------------------

test("Batch III: the same bug reproduces with a comment line ahead of the conditioned file-level keyword, ruling out \"first line in the file\" as the actual trigger", () => {
  const original = [
    "      * some header comment",
    "",
    ...emitWithKeywords(buildPositional({ conditions: [{ indicator: "01" }] }), "PAGSIZE(66 132)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ].join("\n") + "\n";
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
});

// --- Mixed unconditioned + conditioned file-level keywords, both orders,
// must both keep working (the already-working case this fix must not
// regress) --------------------------------------------------------------

test("Batch III: an unconditioned file-level keyword followed by a conditioned one still round-trips correctly", () => {
  const original = [
    ...emitWithKeywords(buildPositional({}), "PAGSIZE(66 132)"),
    ...emitWithKeywords(buildPositional({ conditions: [{ indicator: "01" }] }), "SKIPA(5)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ].join("\n") + "\n";
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
});

test("Batch III: a conditioned file-level keyword followed by an unconditioned one still round-trips correctly", () => {
  const original = [
    ...emitWithKeywords(buildPositional({ conditions: [{ indicator: "01" }] }), "SKIPA(5)"),
    ...emitWithKeywords(buildPositional({}), "PAGSIZE(66 132)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ].join("\n") + "\n";
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
});

// --- The ordinary, unconditioned-only case must remain unaffected -----

test("Batch III: a plain unconditioned file-level keyword (the common case) still round-trips correctly", () => {
  const original = [
    ...emitWithKeywords(buildPositional({}), "PAGSIZE(66 132)"),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ].join("\n") + "\n";
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
});

// --- Confirms the bug was genuinely fileLevel-specific, not a general
// conditioned-keyword issue: the identical pattern at the record level
// already worked before this fix and must still work after it ---------

test("Batch III: the identical conditioned-keyword-as-first-line pattern at the RECORD level round-trips correctly (confirms the bug was fileLevel-specific)", () => {
  const original = [
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), ""),
    ...emitWithKeywords(buildPositional({ conditions: [{ indicator: "01" }] }), "SPACEA(1)"),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ].join("\n") + "\n";
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);
});
