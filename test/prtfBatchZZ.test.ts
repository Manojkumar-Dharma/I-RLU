// Tests for docs/TASKS.md Batch ZZ — field-level small-fix bundle
// (docs/AUDIT-FIELD-LEVEL.md §1-3/§5). Four independent, small fixes:
//  1. TIMFMT's properties-panel option list wrongly offered *JOB (a
//     TIMSEP-only value, copy-adapted in from DATFMT's list without
//     dropping the one option that doesn't carry over).
//  2. EDTCDE/EDTWRD cannot be specified with DFT on the same field.
//  3. MSGCON cannot be specified with DATE/DFT/EDTCDE/EDTWRD/TIME on the
//     same field.
//  4. ALIAS's alternative-name parameter must differ from every other
//     field's ALIAS value and from every DDS field name in the record
//     format — a whole-record-scoped check.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

// --- §1: TIMFMT panel option-list fix --------------------------------

test("Batch ZZ §1: TIMFMT's properties-panel option list no longer offers *JOB", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const m = source.match(/\{\s*name:\s*"TIMFMT".*?\}/s);
  assert.ok(m, "TIMFMT's keyword-row definition should still exist in media/webviewClient.js");
  assert.doesNotMatch(m![0], /\*JOB/, "TIMFMT's option list should not include *JOB — that's a TIMSEP-only value");
  assert.match(m![0], /\*ISO/);
  assert.match(m![0], /\*HMS/);
});

test("Batch ZZ §1: DATFMT's option list is untouched and still legitimately includes *JOB", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const m = source.match(/\{\s*name:\s*"DATFMT".*?\}/s);
  assert.ok(m);
  assert.match(m![0], /\*JOB/);
});

// --- §2/§3: EDTCDE/EDTWRD vs DFT, MSGCON's exclusion set --------------

function kw(name: string, params = "") {
  return { name, params, raw: params ? name + params : name, sourceLineIndex: 0 };
}
function field(overrides: any = {}) {
  return { kind: "field", id: overrides.id || "f1", name: overrides.name || "FLD1", keywords: overrides.keywords || [] };
}

test("validateFieldKeywords: EDTCDE is flagged when DFT is also on the field", () => {
  const f = field({ keywords: [kw("DFT", "('x')"), kw("EDTCDE", "(1)")] });
  const warnings = PrtfEngine.validateFieldKeywords(f);
  assert.equal(warnings.some((w: any) => w.keyword === "EDTCDE" && /cannot be specified with DFT/.test(w.message)), true);
});

test("validateFieldKeywords: EDTWRD is flagged when DFT is also on the field", () => {
  const f = field({ keywords: [kw("DFT", "('x')"), kw("EDTWRD", "('   .  ')")] });
  const warnings = PrtfEngine.validateFieldKeywords(f);
  assert.equal(warnings.some((w: any) => w.keyword === "EDTWRD" && /cannot be specified with DFT/.test(w.message)), true);
});

test("validateFieldKeywords: both EDTCDE and EDTWRD are flagged when both are present alongside DFT", () => {
  const f = field({ keywords: [kw("DFT", "('x')"), kw("EDTCDE", "(1)"), kw("EDTWRD", "('   .  ')")] });
  const warnings = PrtfEngine.validateFieldKeywords(f);
  assert.equal(warnings.filter((w: any) => /cannot be specified with DFT/.test(w.message)).length, 2);
});

test("validateFieldKeywords: EDTCDE alone (no DFT) is not flagged", () => {
  const f = field({ keywords: [kw("EDTCDE", "(1)")] });
  const warnings = PrtfEngine.validateFieldKeywords(f);
  assert.equal(warnings.some((w: any) => /cannot be specified with DFT/.test(w.message)), false);
});

test("validateFieldKeywords: DFT alone (no EDTCDE/EDTWRD) is not flagged", () => {
  const f = field({ keywords: [kw("DFT", "('x')")] });
  const warnings = PrtfEngine.validateFieldKeywords(f);
  assert.equal(warnings.some((w: any) => /cannot be specified with DFT/.test(w.message)), false);
});

test("validateFieldKeywords: MSGCON is flagged when DATE is also on the field", () => {
  const f = field({ keywords: [kw("MSGCON"), kw("DATE")] });
  const warnings = PrtfEngine.validateFieldKeywords(f);
  assert.equal(warnings.some((w: any) => w.keyword === "MSGCON" && /DATE, DFT, EDTCDE, EDTWRD, or TIME/.test(w.message)), true);
});

test("validateFieldKeywords: MSGCON is flagged when DFT is also on the field", () => {
  const f = field({ keywords: [kw("MSGCON"), kw("DFT", "('x')")] });
  const warnings = PrtfEngine.validateFieldKeywords(f);
  assert.equal(warnings.some((w: any) => w.keyword === "MSGCON"), true);
});

test("validateFieldKeywords: MSGCON is flagged when TIME is also on the field", () => {
  const f = field({ keywords: [kw("MSGCON"), kw("TIME")] });
  const warnings = PrtfEngine.validateFieldKeywords(f);
  assert.equal(warnings.some((w: any) => w.keyword === "MSGCON"), true);
});

test("validateFieldKeywords: MSGCON alone is not flagged", () => {
  const f = field({ keywords: [kw("MSGCON")] });
  const warnings = PrtfEngine.validateFieldKeywords(f);
  assert.equal(warnings.some((w: any) => w.keyword === "MSGCON"), false);
});

test("validateFieldKeywords: DATE/DFT/EDTCDE/EDTWRD/TIME alone (no MSGCON) never produce an MSGCON warning", () => {
  const f = field({ keywords: [kw("DATE"), kw("DFT", "('x')"), kw("TIME")] });
  const warnings = PrtfEngine.validateFieldKeywords(f);
  assert.equal(warnings.some((w: any) => w.keyword === "MSGCON"), false);
});

// --- §5: ALIAS uniqueness (record-scoped) ------------------------------

function recordWith(fields: any[]) {
  return { name: "TESTREC", keywords: [], fields };
}

test("validateAliasUniqueness: no warnings when no field has ALIAS", () => {
  const record = recordWith([field({ id: "f1", name: "FLD1" }), field({ id: "f2", name: "FLD2" })]);
  assert.deepEqual(PrtfEngine.validateAliasUniqueness(record), []);
});

test("validateAliasUniqueness: no warnings when every ALIAS is unique and doesn't clash with any field name", () => {
  const record = recordWith([
    field({ id: "f1", name: "FLD1", keywords: [kw("ALIAS", "(CUSTNAME)")] }),
    field({ id: "f2", name: "FLD2", keywords: [kw("ALIAS", "(CUSTADDR)")] }),
  ]);
  assert.deepEqual(PrtfEngine.validateAliasUniqueness(record), []);
});

test("validateAliasUniqueness: two fields sharing the same ALIAS are both flagged", () => {
  const record = recordWith([
    field({ id: "f1", name: "FLD1", keywords: [kw("ALIAS", "(SAMENAME)")] }),
    field({ id: "f2", name: "FLD2", keywords: [kw("ALIAS", "(SAMENAME)")] }),
  ]);
  const warnings = PrtfEngine.validateAliasUniqueness(record);
  assert.equal(warnings.filter((w: any) => w.keyword === "ALIAS" && /must be unique/.test(w.message)).length, 2);
  assert.equal(warnings.some((w: any) => w.fieldId === "f1"), true);
  assert.equal(warnings.some((w: any) => w.fieldId === "f2"), true);
});

test("validateAliasUniqueness: an ALIAS that duplicates ANOTHER field's real DDS name is flagged", () => {
  const record = recordWith([
    field({ id: "f1", name: "FLD1", keywords: [kw("ALIAS", "(FLD2)")] }),
    field({ id: "f2", name: "FLD2" }),
  ]);
  const warnings = PrtfEngine.validateAliasUniqueness(record);
  assert.equal(
    warnings.some((w: any) => w.fieldId === "f1" && w.keyword === "ALIAS" && /duplicates a DDS field name/.test(w.message)),
    true
  );
});

test("validateAliasUniqueness: an ALIAS that duplicates its OWN field's name is also flagged (reference doesn't exempt it)", () => {
  const record = recordWith([field({ id: "f1", name: "FLD1", keywords: [kw("ALIAS", "(FLD1)")] })]);
  const warnings = PrtfEngine.validateAliasUniqueness(record);
  assert.equal(
    warnings.some((w: any) => w.fieldId === "f1" && /duplicates a DDS field name/.test(w.message)),
    true
  );
});

test("validateAliasUniqueness: comparisons are case-insensitive (ALIAS names/DDS names aren't case-sensitive)", () => {
  const record = recordWith([
    field({ id: "f1", name: "FLD1", keywords: [kw("ALIAS", "(samename)")] }),
    field({ id: "f2", name: "FLD2", keywords: [kw("ALIAS", "(SAMENAME)")] }),
  ]);
  const warnings = PrtfEngine.validateAliasUniqueness(record);
  assert.equal(warnings.filter((w: any) => /must be unique/.test(w.message)).length, 2);
});

test("validateAliasUniqueness: constant fields (kind \"constant\") are ignored entirely — they have no DDS name and never carry ALIAS", () => {
  const record = recordWith([
    field({ id: "f1", name: "FLD1", keywords: [kw("ALIAS", "(FLD1TEXT)")] }),
    { kind: "constant", id: "c1", literal: "Total:", keywords: [] },
  ]);
  assert.deepEqual(PrtfEngine.validateAliasUniqueness(record), []);
});

test("validateFieldKeywords: folds in the ALIAS-uniqueness warning for the specific field it belongs to, given the record", () => {
  const f1 = field({ id: "f1", name: "FLD1", keywords: [kw("ALIAS", "(SAMENAME)")] });
  const f2 = field({ id: "f2", name: "FLD2", keywords: [kw("ALIAS", "(SAMENAME)")] });
  const record = recordWith([f1, f2]);
  const warnings1 = PrtfEngine.validateFieldKeywords(f1, record);
  assert.equal(warnings1.some((w: any) => w.keyword === "ALIAS" && /must be unique/.test(w.message)), true);
  const warnings2 = PrtfEngine.validateFieldKeywords(f2, record);
  assert.equal(warnings2.some((w: any) => w.keyword === "ALIAS" && /must be unique/.test(w.message)), true);
});

test("validateFieldKeywords: without a record argument, the ALIAS-uniqueness check is skipped (backward compatible, same convention as Batch VV)", () => {
  const f1 = field({ id: "f1", name: "FLD1", keywords: [kw("ALIAS", "(SAMENAME)")] });
  const warnings = PrtfEngine.validateFieldKeywords(f1);
  assert.equal(warnings.some((w: any) => w.keyword === "ALIAS"), false);
});

test("validateFieldKeywords: a field with no ALIAS clash at all, given a record with an unrelated clash elsewhere, gets no ALIAS warning of its own", () => {
  const f1 = field({ id: "f1", name: "FLD1", keywords: [kw("ALIAS", "(SAMENAME)")] });
  const f2 = field({ id: "f2", name: "FLD2", keywords: [kw("ALIAS", "(SAMENAME)")] });
  const f3 = field({ id: "f3", name: "FLD3", keywords: [kw("ALIAS", "(UNIQUENAME)")] });
  const record = recordWith([f1, f2, f3]);
  const warnings3 = PrtfEngine.validateFieldKeywords(f3, record);
  assert.equal(warnings3.some((w: any) => w.keyword === "ALIAS"), false);
});
