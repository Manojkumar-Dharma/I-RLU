// Tests for docs/TASKS.md Batch YY — ENDPAGE constraint validation +
// VALUELESS_KEYWORDS fix (docs/AUDIT-RECORD-LEVEL.md §4/§5).
//
// Three documented ENDPAGE rules, none previously validated:
//  1. Cannot be specified together with SPACEA/SPACEB/SKIPA/SKIPB on the
//     same record — the reverse direction of Batch VV's exclusion check
//     (ENDPAGE is already in SKIP_SPACE_RECORD_EXCLUSION_KEYWORDS, so that
//     side already worked; this batch adds ENDPAGE's own side).
//  2. An error is raised if a constant field is specified in a record
//     format that also has ENDPAGE (no escape hatch, unlike
//     BOX/GDF/LINE/OVERLAY/PAGSEG's "OK if that constant also has its own
//     POSITION" rule).
//  3. Needs DEVTYPE(*AFPDS) — same heuristic-only caveat as RELPOS/
//     SKIPA/SKIPB.
// Plus: ENDPAGE has no parameters but wasn't in VALUELESS_KEYWORDS.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");

// --- VALUELESS_KEYWORDS ---------------------------------------------------

test("VALUELESS_KEYWORDS: ENDPAGE is registered as taking no parameters", () => {
  assert.equal(PrtfEngine.VALUELESS_KEYWORDS.indexOf("ENDPAGE") !== -1, true);
});

test("ENDPAGE round-trips as a bare keyword (no parameters) through parse + regenerate", () => {
  const lines = [
    "      * Batch YY test fixture",
    "",
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), "ENDPAGE"),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ];
  const original = lines.join("\n") + "\n";
  const model = parseSource(original);
  const kw = model.records[0].keywords.find((k: any) => k.name === "ENDPAGE");
  assert.ok(kw, "ENDPAGE should be parsed");
  const regenerated = regenerateSource(model);
  assert.match(regenerated, /\bENDPAGE\b(?!\()/);
});

// --- validateEndpageKeywords: standalone helper ---------------------------

function recordWith(opts: { keywords?: any[]; fields?: any[] }) {
  return { name: "TESTREC", keywords: opts.keywords || [], fields: opts.fields || [] };
}
function kw(name: string) {
  return { name, params: "", raw: name, sourceLineIndex: 0 };
}
function afpdsModel() {
  return { records: [{ keywords: [kw("FONT")], fields: [] }] };
}
function nonAfpdsModel() {
  return { records: [{ keywords: [], fields: [] }] };
}

test("validateEndpageKeywords: no ENDPAGE on the record means no warnings at all", () => {
  const record = recordWith({ keywords: [kw("SPACEA")] });
  assert.deepEqual(PrtfEngine.validateEndpageKeywords(record, afpdsModel()), []);
});

test("validateEndpageKeywords: flagged when SPACEA is also on the record", () => {
  const record = recordWith({ keywords: [kw("ENDPAGE"), kw("SPACEA")] });
  const warnings = PrtfEngine.validateEndpageKeywords(record, afpdsModel());
  assert.equal(
    warnings.some((w: any) => w.keyword === "ENDPAGE" && /SPACEA, SPACEB, SKIPA, or SKIPB/.test(w.message)),
    true
  );
});

test("validateEndpageKeywords: flagged when SKIPB is also on the record", () => {
  const record = recordWith({ keywords: [kw("ENDPAGE"), kw("SKIPB")] });
  const warnings = PrtfEngine.validateEndpageKeywords(record, afpdsModel());
  assert.equal(
    warnings.some((w: any) => w.keyword === "ENDPAGE" && /SPACEA, SPACEB, SKIPA, or SKIPB/.test(w.message)),
    true
  );
});

test("validateEndpageKeywords: NOT flagged for the exclusion rule when none of SPACEA/SPACEB/SKIPA/SKIPB are present", () => {
  const record = recordWith({ keywords: [kw("ENDPAGE")] });
  const warnings = PrtfEngine.validateEndpageKeywords(record, afpdsModel());
  assert.equal(
    warnings.some((w: any) => /SPACEA, SPACEB, SKIPA, or SKIPB/.test(w.message)),
    false
  );
});

test("validateEndpageKeywords: flagged when a constant field is present in the record", () => {
  const record = recordWith({
    keywords: [kw("ENDPAGE")],
    fields: [{ kind: "constant", literal: "Thank you", keywords: [] }],
  });
  const warnings = PrtfEngine.validateEndpageKeywords(record, afpdsModel());
  assert.equal(
    warnings.some((w: any) => w.keyword === "ENDPAGE" && /constant field/.test(w.message)),
    true
  );
});

test("validateEndpageKeywords: NOT flagged for the constant-field rule when every field is a real field (kind \"field\")", () => {
  const record = recordWith({
    keywords: [kw("ENDPAGE")],
    fields: [{ kind: "field", name: "CUSTNAME", keywords: [] }],
  });
  const warnings = PrtfEngine.validateEndpageKeywords(record, afpdsModel());
  assert.equal(
    warnings.some((w: any) => /constant field/.test(w.message)),
    false
  );
});

test("validateEndpageKeywords: flagged (AFPDS heuristic) when no AFPDS-typical keyword is found anywhere in the model", () => {
  const record = recordWith({ keywords: [kw("ENDPAGE")] });
  const model = { records: [record] };
  const warnings = PrtfEngine.validateEndpageKeywords(record, model);
  assert.equal(
    warnings.some((w: any) => w.keyword === "ENDPAGE" && /AFPDS/.test(w.message)),
    true
  );
});

test("validateEndpageKeywords: NOT flagged for the AFPDS heuristic when an AFPDS-typical keyword is present elsewhere in the model", () => {
  const record = recordWith({ keywords: [kw("ENDPAGE")] });
  const warnings = PrtfEngine.validateEndpageKeywords(record, afpdsModel());
  assert.equal(
    warnings.some((w: any) => /AFPDS/.test(w.message)),
    false
  );
});

test("validateEndpageKeywords: the AFPDS heuristic check is skipped entirely when no model is passed", () => {
  const record = recordWith({ keywords: [kw("ENDPAGE")] });
  const warnings = PrtfEngine.validateEndpageKeywords(record);
  assert.equal(
    warnings.some((w: any) => /AFPDS/.test(w.message)),
    false
  );
});

test("validateEndpageKeywords: a bare ENDPAGE on an otherwise-clean, AFPDS-targeted record with no constants produces no warnings", () => {
  const record = recordWith({ keywords: [kw("ENDPAGE")], fields: [{ kind: "field", name: "F1", keywords: [] }] });
  assert.deepEqual(PrtfEngine.validateEndpageKeywords(record, afpdsModel()), []);
});

// --- validateEndpageKeywords folded into validateRecordKeywords -----------

test("validateRecordKeywords: surfaces the ENDPAGE constant-field warning when a model is passed", () => {
  const record = recordWith({
    keywords: [kw("ENDPAGE")],
    fields: [{ kind: "constant", literal: "Total:", keywords: [] }],
  });
  const warnings = PrtfEngine.validateRecordKeywords(record, afpdsModel());
  assert.equal(warnings.some((w: any) => w.keyword === "ENDPAGE" && /constant field/.test(w.message)), true);
});

test("validateRecordKeywords: without a model, the non-AFPDS-dependent ENDPAGE checks still fire", () => {
  const record = recordWith({
    keywords: [kw("ENDPAGE")],
    fields: [{ kind: "constant", literal: "Total:", keywords: [] }],
  });
  const warnings = PrtfEngine.validateRecordKeywords(record);
  assert.equal(warnings.some((w: any) => w.keyword === "ENDPAGE" && /constant field/.test(w.message)), true);
  assert.equal(warnings.some((w: any) => w.keyword === "ENDPAGE" && /AFPDS/.test(w.message)), false);
});

// --- The reverse direction (Batch VV's own side of the same exclusion
// rule) still fires now that ENDPAGE is exercised together with it —
// light regression coverage for the "single source of truth" link.

test("validateRecordKeywords: SPACEA is still flagged as invalid alongside ENDPAGE (Batch VV's side of the same rule)", () => {
  const record = recordWith({ keywords: [kw("ENDPAGE"), kw("SPACEA")] });
  const warnings = PrtfEngine.validateRecordKeywords(record, afpdsModel());
  assert.equal(
    warnings.some((w: any) => w.keyword === "SPACEA" && /BOX, ENDPAGE, GDF, LINE, OVERLAY, PAGSEG, or POSITION/.test(w.message)),
    true
  );
});

test("sanity: nonAfpdsModel()/afpdsModel() test helpers actually differ on looksLikeAfpds-equivalent input", () => {
  const record = recordWith({ keywords: [kw("ENDPAGE")] });
  assert.equal(PrtfEngine.validateEndpageKeywords(record, nonAfpdsModel()).some((w: any) => /AFPDS/.test(w.message)), true);
  assert.equal(PrtfEngine.validateEndpageKeywords(record, afpdsModel()).some((w: any) => /AFPDS/.test(w.message)), false);
});
