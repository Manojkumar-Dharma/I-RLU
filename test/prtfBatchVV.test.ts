// Tests for docs/TASKS.md Batch VV — SKIPA/SKIPB/SPACEA/SPACEB constraint
// validation + layout fix (docs/AUDIT-FILE-LEVEL.md §4).
//
// Three documented restrictions, worded near-identically across all four
// keywords' own reference sections:
//  1. Invalid at record/field level on a record format that also has
//     BOX/ENDPAGE/GDF/LINE/OVERLAY/PAGSEG (record-level) or POSITION
//     (field-level) specified anywhere in that record format.
//  2. Invalid at record/field level on a record format where one or more
//     fields carry an explicit Location line number (columns 39-41).
//  3. Cardinality: once at record level, once per field (SKIPA/SKIPB
//     additionally once at file level, where an option indicator is also
//     required).
// Plus the separate layout bug: record-/file-level SKIPB previously had no
// effect on the preview's starting cursor line.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveLayout } = require("../src/prtfLayout.js");

function padR(s: string, n: number): string {
  s = s || "";
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number): string {
  s = s || "";
  return s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s;
}

/** Builds one exact-column DDS positional+keyword line, per prtfModel.ts's column layout — same approach as test/prtfBatchTT.test.ts. */
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

// --- File-level: option-indicator requirement + cardinality -------------

test("validateFileLevelKeywords: file-level SKIPB without an option indicator is flagged (non-AFPDS)", () => {
  const src = buildSource([buildLine({ kw: "SKIPB(5)" }), buildLine({ type: "R", name: "HEADER" })]);
  const model = parseSource(src);
  const warnings = PrtfEngine.validateFileLevelKeywords(model);
  assert.equal(
    warnings.some((w: any) => w.keyword === "SKIPB" && /option indicator/.test(w.message)),
    true
  );
});

test("validateFileLevelKeywords: file-level SKIPB WITH an option indicator is NOT flagged for a missing indicator (non-AFPDS)", () => {
  const src = buildSource([buildLine({ slot1: "05", kw: "SKIPB(5)" }), buildLine({ type: "R", name: "HEADER" })]);
  const model = parseSource(src);
  const warnings = PrtfEngine.validateFileLevelKeywords(model);
  assert.equal(
    warnings.some((w: any) => w.keyword === "SKIPB" && /option indicator/.test(w.message)),
    false
  );
});

test("validateFileLevelKeywords: file-level SKIPA specified twice is flagged for cardinality", () => {
  const src = buildSource([
    buildLine({ slot1: "05", kw: "SKIPA(3)" }),
    buildLine({ slot1: "06", kw: "SKIPA(4)" }),
    buildLine({ type: "R", name: "HEADER" }),
  ]);
  const model = parseSource(src);
  const warnings = PrtfEngine.validateFileLevelKeywords(model);
  assert.equal(
    warnings.some((w: any) => w.keyword === "SKIPA" && /only be specified once at the file level/.test(w.message)),
    true
  );
});

test("validateFileLevelKeywords: an AFPDS-targeted file's file-level SKIPB gets only the AFPDS restriction, not also the missing-indicator warning", () => {
  const src = buildSource([
    buildLine({ kw: "SKIPB(5)" }),
    buildLine({ type: "R", name: "HEADER", kw: "FONT(1051)" }),
  ]);
  const model = parseSource(src);
  const warnings = PrtfEngine.validateFileLevelKeywords(model).filter((w: any) => w.keyword === "SKIPB");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /AFPDS/);
});

test("validateFileLevelKeywords: no SKIPA/SKIPB at file level at all means no Batch VV warnings", () => {
  const src = buildSource([buildLine({ type: "R", name: "HEADER" })]);
  const model = parseSource(src);
  assert.deepEqual(PrtfEngine.validateFileLevelKeywords(model), []);
});

// --- Record level: exclusion set + line-number restriction + cardinality

test("validateRecordKeywords: SKIPA is flagged when the record also has BOX", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "HEADER", kw: "SKIPA(3) BOX(1 1 2 2 1)" }),
    buildLine({ name: "FLD1", length: "10", dataType: "A", usage: "O", line: "1", pos: "1" }),
  ]);
  const model = parseSource(src);
  const record = model.records[0];
  const warnings = PrtfEngine.validateRecordKeywords(record);
  assert.equal(
    warnings.some((w: any) => w.keyword === "SKIPA" && /BOX, ENDPAGE, GDF, LINE, OVERLAY, PAGSEG, or POSITION/.test(w.message)),
    true
  );
});

test("validateRecordKeywords: SPACEB is flagged when a field in the record has POSITION", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "HEADER", kw: "SPACEB(1)" }),
    buildLine({ name: "FLD1", length: "10", dataType: "A", usage: "O", kw: "POSITION(1.0 1.0)" }),
  ]);
  const model = parseSource(src);
  const record = model.records[0];
  const warnings = PrtfEngine.validateRecordKeywords(record);
  assert.equal(
    warnings.some((w: any) => w.keyword === "SPACEB" && /BOX, ENDPAGE, GDF, LINE, OVERLAY, PAGSEG, or POSITION/.test(w.message)),
    true
  );
});

test("validateRecordKeywords: SKIPB is flagged when the record has a field with an explicit Location line number", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "HEADER", kw: "SKIPB(3)" }),
    buildLine({ name: "FLD1", length: "10", dataType: "A", usage: "O", line: "5", pos: "1" }),
  ]);
  const model = parseSource(src);
  const record = model.records[0];
  const warnings = PrtfEngine.validateRecordKeywords(record);
  assert.equal(
    warnings.some((w: any) => w.keyword === "SKIPB" && /line numbers specified/.test(w.message)),
    true
  );
});

test("validateRecordKeywords: SPACEA specified twice at record level is flagged for cardinality", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "HEADER", kw: "SPACEA(1) SPACEA(2)" }),
    buildLine({ name: "FLD1", length: "10", dataType: "A", usage: "O" }),
  ]);
  const model = parseSource(src);
  const record = model.records[0];
  const warnings = PrtfEngine.validateRecordKeywords(record);
  assert.equal(
    warnings.some((w: any) => w.keyword === "SPACEA" && /only be specified once at the record level/.test(w.message)),
    true
  );
});

test("validateRecordKeywords: none of the four keywords are flagged when none of the Batch VV conditions apply", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "HEADER", kw: "SKIPB(3) SPACEA(1)" }),
    buildLine({ name: "FLD1", length: "10", dataType: "A", usage: "O" }),
  ]);
  const model = parseSource(src);
  const record = model.records[0];
  assert.deepEqual(PrtfEngine.validateRecordKeywords(record), []);
});

// --- Field level: same three checks, plus the `record` param being
// optional for backward compatibility with existing single-arg callers.

test("validateFieldKeywords: SPACEA on a field is flagged when its record also has LINE, given the record", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "HEADER", kw: "LINE(1 1 2 2)" }),
    buildLine({ name: "FLD1", length: "10", dataType: "A", usage: "O", line: "1", pos: "1", kw: "SPACEA(1)" }),
  ]);
  const model = parseSource(src);
  const record = model.records[0];
  const field = record.fields[0] as any;
  const warnings = PrtfEngine.validateFieldKeywords(field, record);
  assert.equal(
    warnings.some((w: any) => w.keyword === "SPACEA" && /BOX, ENDPAGE, GDF, LINE, OVERLAY, PAGSEG, or POSITION/.test(w.message)),
    true
  );
});

test("validateFieldKeywords: the SAME field, called WITHOUT the record argument, gets no Batch VV exclusion warning (backward compatible)", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "HEADER", kw: "LINE(1 1 2 2)" }),
    buildLine({ name: "FLD1", length: "10", dataType: "A", usage: "O", line: "1", pos: "1", kw: "SPACEA(1)" }),
  ]);
  const model = parseSource(src);
  const field = model.records[0].fields[0] as any;
  assert.deepEqual(PrtfEngine.validateFieldKeywords(field), []);
});

test("validateFieldKeywords: SKIPB specified twice on the same field is flagged for cardinality", () => {
  const src = buildSource([
    buildLine({ type: "R", name: "HEADER" }),
    buildLine({ name: "FLD1", length: "10", dataType: "A", usage: "O", kw: "SKIPB(3) SKIPB(4)" }),
  ]);
  const model = parseSource(src);
  const record = model.records[0];
  const field = record.fields[0] as any;
  const warnings = PrtfEngine.validateFieldKeywords(field, record);
  assert.equal(
    warnings.some((w: any) => w.keyword === "SKIPB" && /only be specified once per field/.test(w.message)),
    true
  );
});

test("validateFieldKeywords: a field's own Location line number doesn't self-flag its own SKIPA (the rule keys off OTHER fields in the record having one too — same record here, so it still fires)", () => {
  // Per the reference: "not valid at ... field level for records that have
  // line numbers specified" — this is a record-wide condition (ANY field's
  // line number invalidates SKIPA anywhere in the record, including on the
  // very field that carries the line number), not a same-field-only rule.
  const src = buildSource([
    buildLine({ type: "R", name: "HEADER" }),
    buildLine({ name: "FLD1", length: "10", dataType: "A", usage: "O", line: "1", pos: "1", kw: "SKIPA(1)" }),
  ]);
  const model = parseSource(src);
  const record = model.records[0];
  const field = record.fields[0] as any;
  const warnings = PrtfEngine.validateFieldKeywords(field, record);
  assert.equal(
    warnings.some((w: any) => w.keyword === "SKIPA" && /line numbers specified/.test(w.message)),
    true
  );
});

// --- SKIP_SPACE_KEYWORDS / recordHasSkipSpaceExclusion / recordHasLineNumbers exported helpers

test("SKIP_SPACE_KEYWORDS: covers all four audited keywords", () => {
  assert.deepEqual(PrtfEngine.SKIP_SPACE_KEYWORDS.slice().sort(), ["SKIPA", "SKIPB", "SPACEA", "SPACEB"]);
});

test("recordHasSkipSpaceExclusion / recordHasLineNumbers: standalone helpers agree with the validator's own findings", () => {
  const withBox = { keywords: [{ name: "BOX", params: "(1 1 2 2 1)", raw: "BOX(1 1 2 2 1)", sourceLineIndex: 0 }], fields: [] };
  assert.equal(PrtfEngine.recordHasSkipSpaceExclusion(withBox), true);
  const withoutBox = { keywords: [], fields: [] };
  assert.equal(PrtfEngine.recordHasSkipSpaceExclusion(withoutBox), false);

  const withLineNo = { keywords: [], fields: [{ kind: "field", line: 5, keywords: [] }] };
  assert.equal(PrtfEngine.recordHasLineNumbers(withLineNo), true);
  const withoutLineNo = { keywords: [], fields: [{ kind: "field", keywords: [] }] };
  assert.equal(PrtfEngine.recordHasLineNumbers(withoutLineNo), false);
});

// --- resolveLayout: record-/file-level SKIPB now sets the starting cursor line

function skipbKw(n: number) {
  return { name: "SKIPB", params: "(" + n + ")", raw: "SKIPB(" + n + ")", sourceLineIndex: 0 };
}

test("resolveLayout: no SKIPB anywhere still starts the preview at line 1 (unchanged default) for a field with no explicit Location line", () => {
  const model = {
    fileLevel: { keywords: [] },
    records: [
      {
        kind: "record",
        name: "TESTREC",
        conditions: [],
        keywords: [],
        fields: [{ kind: "field", id: "f1", name: "FLDA", length: 10, dataType: "A", position: 2, conditions: [], keywords: [] }],
      },
    ],
  };
  const layout = resolveLayout(model, "TESTREC", {}, "inch");
  assert.equal(layout.cells[0].line, 1);
});

test("resolveLayout: record-level SKIPB sets the starting cursor line for a field with no explicit Location line", () => {
  const model = {
    fileLevel: { keywords: [] },
    records: [
      {
        kind: "record",
        name: "TESTREC",
        conditions: [],
        keywords: [skipbKw(7)],
        fields: [{ kind: "field", id: "f1", name: "FLDA", length: 10, dataType: "A", position: 2, conditions: [], keywords: [] }],
      },
    ],
  };
  const layout = resolveLayout(model, "TESTREC", {}, "inch");
  assert.equal(layout.cells[0].line, 7);
});

test("resolveLayout: file-level SKIPB sets the starting cursor line when there's no record-level SKIPB", () => {
  const model = {
    fileLevel: { keywords: [skipbKw(9)] },
    records: [
      {
        kind: "record",
        name: "TESTREC",
        conditions: [],
        keywords: [],
        fields: [{ kind: "field", id: "f1", name: "FLDA", length: 10, dataType: "A", position: 2, conditions: [], keywords: [] }],
      },
    ],
  };
  const layout = resolveLayout(model, "TESTREC", {}, "inch");
  assert.equal(layout.cells[0].line, 9);
});

test("resolveLayout: record-level SKIPB wins over file-level SKIPB when both are present", () => {
  const model = {
    fileLevel: { keywords: [skipbKw(9)] },
    records: [
      {
        kind: "record",
        name: "TESTREC",
        conditions: [],
        keywords: [skipbKw(7)],
        fields: [{ kind: "field", id: "f1", name: "FLDA", length: 10, dataType: "A", position: 2, conditions: [], keywords: [] }],
      },
    ],
  };
  const layout = resolveLayout(model, "TESTREC", {}, "inch");
  assert.equal(layout.cells[0].line, 7);
});
