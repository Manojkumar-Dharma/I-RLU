// Tests for docs/TASKS.md Batch TT — centralized "option indicators not
// valid for this keyword" validation (docs/AUDIT-FILE-LEVEL.md §5,
// docs/AUDIT-RECORD-LEVEL.md §6, docs/AUDIT-FIELD-LEVEL.md §4).
//
// A keyword in NO_INDICATOR_KEYWORDS is only invalid when it carries its
// OWN attached-line conditioning (kw.conditions) — the field/record/file
// it sits on can still be conditioned normally via positions 7-16, which
// is a completely separate, always-valid mechanism. These tests exercise
// both sides of that distinction at all three levels, using the same
// exact-column line-building approach as test/prtfConditionedKeywords.test.ts
// so the fixtures are guaranteed to match what prtfParser.ts expects.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

function padR(s: string, n: number): string {
  s = s || "";
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number): string {
  s = s || "";
  return s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s;
}

/** Builds one exact-column DDS positional+keyword line, per prtfModel.ts's column layout. */
function buildLine(opts: {
  slot1?: string;
  type?: string;
  name?: string;
  length?: string;
  dataType?: string;
  usage?: string;
  line?: string;
  pos?: string;
  kw?: string;
}): string {
  let s = "";
  s += padR("", 5); // 1-5 sequence
  s += " "; // 6 form type
  s += " "; // 7 comment/AND-OR
  s += padL(opts.slot1 || "", 3);
  s += padL("", 3);
  s += padL("", 3);
  s += padR(opts.type || "", 1); // 17
  s += " "; // 18
  s += padR(opts.name || "", 10); // 19-28
  s += " "; // 29 reference
  s += padL(opts.length || "", 5); // 30-34
  s += padR(opts.dataType || "", 1); // 35
  s += padL("", 2); // 36-37
  s += padR(opts.usage || "", 1); // 38
  s += padL(opts.line || "", 3); // 39-41
  s += padL(opts.pos || "", 3); // 42-44
  s += opts.kw || "";
  return s;
}

function buildSource(lines: string[]): string {
  return lines.map((l) => l.replace(/\s+$/, "")).join("\n") + "\n";
}

test("validateKeywordIndicators: flags a file-level keyword with its own attached conditioning", () => {
  const src = buildSource([
    "      * fixture",
    buildLine({ kw: "CCSID(37)" }),
    buildLine({ slot1: "05", kw: "CCSID(37)" }),
    buildLine({ type: "R", name: "HEADER" }),
  ]);
  const model = parseSource(src);
  const warnings = PrtfEngine.validateFileLevelKeywords(model);
  assert.equal(warnings.some((w: any) => w.keyword === "CCSID"), true);
});

test("validateKeywordIndicators: flags a record-level keyword with its own attached conditioning", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "HEADER" }),
    buildLine({ slot1: "10", kw: "INDARA" }),
    buildLine({ name: "CUSTNAME", length: "30", dataType: "A", usage: "O", line: "1", pos: "10" }),
  ]);
  const model = parseSource(src);
  const record = model.records[0];
  const warnings = PrtfEngine.validateRecordKeywords(record);
  assert.equal(warnings.some((w: any) => w.keyword === "INDARA"), true);
});

test("validateKeywordIndicators: flags a field-level keyword with its own attached conditioning", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "HEADER" }),
    buildLine({ name: "CUSTNAME", length: "30", dataType: "A", usage: "O", line: "1", pos: "10" }),
    buildLine({ slot1: "20", kw: "MSGCON(*NEXT '')" }),
  ]);
  const model = parseSource(src);
  const field = model.records[0].fields[0] as any;
  const warnings = PrtfEngine.validateFieldKeywords(field);
  assert.equal(warnings.some((w: any) => w.keyword === "MSGCON"), true);
});

test("validateKeywordIndicators: does NOT flag the same keywords when only the owning field/record/constant itself is conditioned (positions 7-16), not the keyword", () => {
  const src = buildSource([
    buildLine({ kw: "CCSID(37)" }),
    buildLine({ type: "R", name: "HEADER" }),
    buildLine({ slot1: "20", name: "CUSTNAME", length: "30", dataType: "A", usage: "O", line: "1", pos: "10", kw: "ALIAS(CUSTOMER_NAME) DATE" }),
  ]);
  const model = parseSource(src);
  const fileWarnings = PrtfEngine.validateFileLevelKeywords(model);
  assert.equal(fileWarnings.some((w: any) => w.keyword === "CCSID"), false);
  const field = model.records[0].fields[0] as any;
  assert.equal(field.conditions.length, 1); // the FIELD is conditioned...
  assert.equal(field.keywords[0].conditions, undefined); // ...but ALIAS/DATE aren't separately tagged.
  const fieldWarnings = PrtfEngine.validateFieldKeywords(field);
  assert.equal(fieldWarnings.some((w: any) => w.keyword === "ALIAS"), false);
  assert.equal(fieldWarnings.some((w: any) => w.keyword === "DATE"), false);
});

test("validateKeywordIndicators: unrelated conditioned keywords (e.g. COLOR) are never flagged", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "HEADER" }),
    buildLine({ name: "CUSTNAME", length: "30", dataType: "A", usage: "O", line: "1", pos: "10" }),
    buildLine({ slot1: "05", kw: "COLOR(BLU)" }),
  ]);
  const model = parseSource(src);
  const field = model.records[0].fields[0] as any;
  assert.deepEqual(PrtfEngine.validateFieldKeywords(field), []);
});

test("validateKeywordIndicators: standalone helper covers every audited keyword", () => {
  const NO_INDICATOR_KEYWORDS = PrtfEngine.NO_INDICATOR_KEYWORDS;
  [
    "REF", "INDARA", "RELPOS", "INDTXT", "CCSID",
    "ALIAS", "REFFLD", "MSGCON", "DATE", "DATFMT", "DATSEP", "TIMFMT", "TIMSEP",
  ].forEach((name) => {
    assert.equal(NO_INDICATOR_KEYWORDS.indexOf(name) !== -1, true, name + " should be in NO_INDICATOR_KEYWORDS");
    const warnings = PrtfEngine.validateKeywordIndicators([
      { name, params: "", raw: name, sourceLineIndex: 0, conditions: [{ raw: "01", negate: false, indicator: "01" }] },
    ]);
    assert.equal(warnings.length, 1, name + " should be flagged when it has its own conditions");
  });
  assert.deepEqual(
    PrtfEngine.validateKeywordIndicators([{ name: "COLOR", params: "(BLU)", raw: "COLOR(BLU)", sourceLineIndex: 0, conditions: [{ raw: "01", negate: false, indicator: "01" }] }]),
    []
  );
});
