// Tests for docs/TASKS.md Batch E — AFP page-group / resource keyword
// placeholders: OVERLAY (record-level), PAGSEG, STRPAGGRP, ENDPAGGRP,
// DOCIDXTAG, AFPRSC, DTASTMCMD. Covers: (1) round-trip through the generic
// keyword model for all seven (parser/writer need no batch-specific
// changes — same as Batch F/G before it), (2) src/prtfPageGroupKeywords.js's
// parse/build pair for each keyword's own positional shape, including the
// `extra` free-text preservation for unmodeled optional params, and (3)
// that resolveLayout (prtfLayout.js) surfaces OVERLAY/PAGSEG/AFPRSC as
// positioned placeholders and STRPAGGRP/ENDPAGGRP/DOCIDXTAG/DTASTMCMD as
// non-positioned page-group metadata.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../src/prtfParser";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { regenerateSource, buildPositional, emitWithKeywords } = require("../src/prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("../src/prtfEngine.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  parseOverlay,
  buildOverlayParams,
  parsePagseg,
  buildPagsegParams,
  parseAfprsc,
  buildAfprscParams,
  parseDocidxtag,
  buildDocidxtagParams,
} = require("../src/prtfPageGroupKeywords.js");

function kw(name: string, params: string) {
  return { name, params, raw: name + params, sourceLineIndex: -1 };
}

function buildSource(fileLevelKeywords: string, recordKeywords: string): string {
  const lines = [
    "      * Batch E test fixture",
    "",
    ...emitWithKeywords(buildPositional({}), fileLevelKeywords),
    ...emitWithKeywords(buildPositional({ nameType: "R", name: "HEADER" }), recordKeywords),
    ...emitWithKeywords(
      buildPositional({ name: "CUSTNAME", length: 30, dataType: "A", usage: "B", lineNo: 1, position: 10 }),
      ""
    ),
  ];
  return lines.join("\n") + "\n";
}

test("Batch E round-trip: OVERLAY/PAGSEG/STRPAGGRP/ENDPAGGRP/DOCIDXTAG/AFPRSC/DTASTMCMD survive parse -> regenerate unchanged", () => {
  const original = buildSource(
    "PAGSIZE(66 132) DEVTYPE(*AFPDS)",
    "STRPAGGRP('513') PAGSEG(MYLIB/COMPLOGO 0.5 0.5) OVERLAY(STMTFORM 0 0) " +
      "AFPRSC('MYRSC' *PAGSEG 1 1) DOCIDXTAG('Policy Number' '43127' GROUP) " +
      "DTASTMCMD('some AFP command') ENDPAGGRP"
  );
  const model = parseSource(original);
  const regenerated = regenerateSource(model);
  assert.equal(regenerated, original);

  const header = model.records.find((r) => r.name === "HEADER")!;
  assert.equal(PrtfEngine.findKeyword(header.keywords, "STRPAGGRP").params, "('513')");
  assert.equal(PrtfEngine.findKeyword(header.keywords, "PAGSEG").params, "(MYLIB/COMPLOGO 0.5 0.5)");
  assert.equal(PrtfEngine.findKeyword(header.keywords, "OVERLAY").params, "(STMTFORM 0 0)");
  assert.equal(PrtfEngine.findKeyword(header.keywords, "AFPRSC").params, "('MYRSC' *PAGSEG 1 1)");
  assert.equal(PrtfEngine.findKeyword(header.keywords, "DOCIDXTAG").params, "('Policy Number' '43127' GROUP)");
  assert.equal(PrtfEngine.findKeyword(header.keywords, "DTASTMCMD").params, "('some AFP command')");
  assert.equal(PrtfEngine.findKeyword(header.keywords, "ENDPAGGRP").params, "");
});

test("Batch E round-trip: a record with none of these keywords is untouched", () => {
  const original = buildSource("PAGSIZE(66 132)", "SKIPB(1)");
  assert.equal(regenerateSource(parseSource(original)), original);
});

test("parseOverlay: name, offsets, and trailing extra parse correctly, name is unquoted (object name, not a literal)", () => {
  const parsed = parseOverlay(kw("OVERLAY", "(MYLIB/STMTFORM 0.5 1.25 (*ROTATION 90))"), 10, 6, "inch");
  assert.equal(parsed.name, "MYLIB/STMTFORM");
  assert.equal(parsed.posDown, "0.5");
  assert.equal(parsed.posAcross, "1.25");
  assert.equal(parsed.extra, "(*ROTATION 90)");
  assert.equal(parsed.approximate, false);
});

test("parseOverlay: a program-to-system field name flags the placeholder as approximate", () => {
  const parsed = parseOverlay(kw("OVERLAY", "(&OVLNAME 0 0)"), 10, 6, "inch");
  assert.equal(parsed.name, "&OVLNAME");
  assert.equal(parsed.approximate, true);
});

test("buildOverlayParams / parseOverlay round-trip through the form fields, including extra", () => {
  const params = buildOverlayParams({ name: "STMTFORM", posDown: "0", posAcross: "0", extra: "(*ROTATION 90)" });
  assert.equal(params, "(STMTFORM 0 0 (*ROTATION 90))");
  const parsed = parseOverlay(kw("OVERLAY", params as string), 10, 6, "inch");
  assert.equal(parsed.name, "STMTFORM");
  assert.equal(parsed.extra, "(*ROTATION 90)");
});

test("buildOverlayParams: a blank name means don't write the keyword", () => {
  assert.equal(buildOverlayParams({ name: "  ", posDown: "0", posAcross: "0" }), null);
});

test("parsePagseg: offsets are optional as a pair — name-only PAGSEG parses with empty offsets", () => {
  const parsed = parsePagseg(kw("PAGSEG", "(COMPLOGO)"), 10, 6, "inch");
  assert.equal(parsed.name, "COMPLOGO");
  assert.equal(parsed.posDown, "");
  assert.equal(parsed.posAcross, "");
});

test("parsePagseg: name + offsets parse, matching this project's own sample-afpds.pf fixture shape", () => {
  const parsed = parsePagseg(kw("PAGSEG", "(COMPLOGO 0.5 0.5)"), 10, 6, "inch");
  assert.equal(parsed.name, "COMPLOGO");
  assert.equal(parsed.posDown, "0.5");
  assert.equal(parsed.posAcross, "0.5");
  assert.equal(parsed.row, Math.round(0.5 * 6) + 1);
  assert.equal(parsed.col, Math.round(0.5 * 10) + 1);
});

test("buildPagsegParams: omitting both offsets writes a name-only PAGSEG; providing either writes both", () => {
  assert.equal(buildPagsegParams({ name: "COMPLOGO", posDown: "", posAcross: "" }), "(COMPLOGO)");
  assert.equal(buildPagsegParams({ name: "COMPLOGO", posDown: "0.5", posAcross: "" }), "(COMPLOGO 0.5 0)");
  assert.equal(buildPagsegParams({ name: "  " }), null);
});

test("parseAfprsc: resource-name is unquoted from its quoted literal, object-type/positions/extra parse correctly", () => {
  const parsed = parseAfprsc(kw("AFPRSC", "('MYOVL' *OVL 1 1 (*SIZE 2 1))"), 10, 6, "inch");
  assert.equal(parsed.name, "MYOVL");
  assert.equal(parsed.objectType, "*OVL");
  assert.equal(parsed.posDown, "1");
  assert.equal(parsed.posAcross, "1");
  assert.equal(parsed.extra, "(*SIZE 2 1)");
});

test("buildAfprscParams: quotes the resource name (a character value, unlike OVERLAY/PAGSEG's object names), requires both name and object-type", () => {
  const params = buildAfprscParams({ name: "MYOVL", objectType: "*OVL", posDown: "1", posAcross: "1" });
  assert.equal(params, "('MYOVL' *OVL 1 1)");
  assert.equal(buildAfprscParams({ name: "MYOVL", objectType: "" }), null);
  assert.equal(buildAfprscParams({ name: "", objectType: "*OVL" }), null);
});

test("buildAfprscParams: a &field resource name is left unquoted", () => {
  const params = buildAfprscParams({ name: "&RSCNAME", objectType: "*PAGSEG", posDown: "0", posAcross: "0" });
  assert.equal(params, "(&RSCNAME *PAGSEG 0 0)");
});

test("parseDocidxtag / buildDocidxtagParams round-trip, quoting attribute-name/value but not the GROUP/PAGE tag-level", () => {
  const parsed = parseDocidxtag(kw("DOCIDXTAG", "('Policy Number' '43127' PAGE)"));
  assert.equal(parsed.attributeName, "Policy Number");
  assert.equal(parsed.attributeValue, "43127");
  assert.equal(parsed.tagLevel, "PAGE");

  const params = buildDocidxtagParams(parsed);
  assert.equal(params, "('Policy Number' '43127' PAGE)");
});

test("parseDocidxtag: &field attribute-name/value are left unquoted", () => {
  const parsed = parseDocidxtag(kw("DOCIDXTAG", "(&ATTNAM &ATTVAL PAGE)"));
  assert.equal(parsed.attributeName, "&ATTNAM");
  assert.equal(parsed.attributeValue, "&ATTVAL");
});

test("resolveLayout: OVERLAY/PAGSEG/AFPRSC surface as positioned placeholders (layout.resources)", () => {
  const source = buildSource(
    "PAGSIZE(66 132) DEVTYPE(*AFPDS)",
    "PAGSEG(COMPLOGO 0.5 0.5) OVERLAY(STMTFORM 0 0)"
  );
  const model = parseSource(source);
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {}, "inch");
  assert.equal(layout.resources.length, 2);
  const pagseg = layout.resources.find((r: any) => r.keyword === "PAGSEG");
  const overlay = layout.resources.find((r: any) => r.keyword === "OVERLAY");
  assert.ok(pagseg);
  assert.ok(overlay);
  assert.equal(pagseg.name, "COMPLOGO");
  assert.equal(overlay.name, "STMTFORM");
  assert.equal(pagseg.widthCols > 0 && pagseg.heightRows > 0, true);
});

test("resolveLayout: STRPAGGRP/ENDPAGGRP/DOCIDXTAG/DTASTMCMD surface as non-positioned page-group metadata (layout.pageGroupKeywords), not layout.resources", () => {
  const source = buildSource(
    "PAGSIZE(66 132) DEVTYPE(*AFPDS)",
    "STRPAGGRP('513') DOCIDXTAG('Policy Number' '43127' GROUP) DTASTMCMD('x') ENDPAGGRP"
  );
  const model = parseSource(source);
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {}, "inch");
  assert.equal(layout.resources.length, 0);
  const kwNames = layout.pageGroupKeywords.map((i: any) => i.keyword).sort();
  assert.deepEqual(kwNames, ["DOCIDXTAG", "DTASTMCMD", "ENDPAGGRP", "STRPAGGRP"]);
});

test("resolveLayout: a record with two OVERLAY keywords (front/back) renders both placeholders, even though the properties panel only edits the first by name", () => {
  const source = buildSource(
    "PAGSIZE(66 132) DEVTYPE(*AFPDS)",
    "OVERLAY(FRONTFORM 0 0) OVERLAY(BACKFORM 0 0)"
  );
  const model = parseSource(source);
  const layout = PrtfEngine.resolveLayout(model, "HEADER", {}, "inch");
  const names = layout.resources.map((r: any) => r.name).sort();
  assert.deepEqual(names, ["BACKFORM", "FRONTFORM"]);
});
