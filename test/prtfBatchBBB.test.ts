// Tests for docs/TASKS.md Batch BBB — NO_INDICATOR_KEYWORDS missing 15 of
// 28 documented keywords (docs/AUDIT-CROSS-LEVEL.md §8).
//
// A full-text sweep of every "Option indicators are not valid for this
// keyword" occurrence in docs/DDS-PRINTER-FILE-REFERENCE.txt, mapped back
// to its enclosing keyword section, found 28 keywords total.
// NO_INDICATOR_KEYWORDS (Batch TT) only had 13; this batch adds the
// missing 15: BARCODE, BLKFOLD, CHRID, CHRSIZ, CVTDTA, DFT, DLTEDT,
// EDTCDE, EDTWRD, FLTFIXDEC, FLTPCN, LPI, TEXT, TIME, TRNSPY.
//
// validateKeywordIndicators only flags a keyword-specific *attached-line*
// conditioning (kw.conditions) — the owning field/record/constant can
// always be conditioned normally via positions 7-16, a separate and
// always-valid mechanism (see test/prtfBatchTT.test.ts for that
// distinction exercised via real parsed DDS source at all three levels).
// These tests build plain keyword objects directly, the same "object
// construction" style test/prtfBatchYY.test.ts and test/prtfBatchZZ.test.ts
// already use for standalone-validator-function coverage, since
// validateKeywordIndicators is a pure array scan with no level-specific
// behavior to exercise via a full parse.
import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

function kw(name: string, conditions?: { indicator: string; negate: boolean }[]) {
  return { name, params: "", raw: name, sourceLineIndex: 0, conditions };
}

const NEWLY_ADDED = [
  "BARCODE", "BLKFOLD", "CHRID", "CHRSIZ", "CVTDTA", "DFT", "DLTEDT",
  "EDTCDE", "EDTWRD", "FLTFIXDEC", "FLTPCN", "LPI", "TEXT", "TIME", "TRNSPY",
];

const PRE_EXISTING = [
  "REF", "INDARA", "RELPOS", "INDTXT", "CCSID",
  "ALIAS", "REFFLD", "MSGCON", "DATE", "DATFMT", "DATSEP", "TIMFMT", "TIMSEP",
];

test("NO_INDICATOR_KEYWORDS: now covers all 28 documented keywords (13 pre-existing + 15 new)", () => {
  const all = PRE_EXISTING.concat(NEWLY_ADDED);
  assert.equal(PrtfEngine.NO_INDICATOR_KEYWORDS.length, 28);
  all.forEach((name) => {
    assert.equal(PrtfEngine.NO_INDICATOR_KEYWORDS.indexOf(name) !== -1, true, name + " should be in NO_INDICATOR_KEYWORDS");
  });
});

test("NO_INDICATOR_KEYWORDS: the 13 pre-existing entries from Batch TT are untouched", () => {
  PRE_EXISTING.forEach((name) => {
    assert.equal(PrtfEngine.NO_INDICATOR_KEYWORDS.indexOf(name) !== -1, true);
  });
});

for (const name of NEWLY_ADDED) {
  test("validateKeywordIndicators: flags " + name + " when it carries its own attached-line conditioning", () => {
    const keywords = [kw(name, [{ indicator: "05", negate: false }])];
    const warnings = PrtfEngine.validateKeywordIndicators(keywords);
    assert.equal(
      warnings.some((w: any) => w.keyword === name && /option indicators are not valid/.test(w.message)),
      true
    );
  });

  test("validateKeywordIndicators: does NOT flag " + name + " when it carries no conditioning of its own", () => {
    const keywords = [kw(name)];
    const warnings = PrtfEngine.validateKeywordIndicators(keywords);
    assert.equal(warnings.some((w: any) => w.keyword === name), false);
  });
}

test("validateKeywordIndicators: a mixed keyword array flags only the NO_INDICATOR_KEYWORDS entries that are actually conditioned", () => {
  const keywords = [
    kw("BARCODE", [{ indicator: "05", negate: false }]), // newly added, conditioned -> flagged
    kw("CHRSIZ"), // newly added, not conditioned -> not flagged
    kw("FONT", [{ indicator: "06", negate: false }]), // not in the list at all -> never flagged
  ];
  const warnings = PrtfEngine.validateKeywordIndicators(keywords);
  assert.deepEqual(
    warnings.map((w: any) => w.keyword),
    ["BARCODE"]
  );
});

// Folded-in coverage: these checks run through validateRecordKeywords/
// validateFieldKeywords (which both already call validateKeywordIndicators
// internally), confirming the newly added record-level (LPI) and
// field-level keywords are actually reachable through those entry points,
// not just the standalone function.

test("validateRecordKeywords: flags a conditioned LPI (the one record-level keyword newly added by this batch)", () => {
  const record = { name: "TESTREC", keywords: [kw("LPI", [{ indicator: "05", negate: false }])], fields: [] };
  const warnings = PrtfEngine.validateRecordKeywords(record);
  assert.equal(warnings.some((w: any) => w.keyword === "LPI" && /option indicators are not valid/.test(w.message)), true);
});

test("validateFieldKeywords: flags a conditioned TIME (newly added, field-level)", () => {
  const field = { kind: "field", id: "f1", name: "FLD1", keywords: [kw("TIME", [{ indicator: "05", negate: false }])] };
  const warnings = PrtfEngine.validateFieldKeywords(field);
  assert.equal(warnings.some((w: any) => w.keyword === "TIME" && /option indicators are not valid/.test(w.message)), true);
});
