// Unit tests for src/afpCodedFontMetrics.js — docs/TASKS.md Batch L
// (continued): best-effort resolution for FONTNAME/CDEFNT/FNTCHRSET, the
// three font-selection keywords resolveFont previously left completely
// unresolved. See that module's own header for the sourcing behind every
// example used here (IBM's own DDS reference "Example: Specifying a
// font" supplies X0N51EHC/CZH200/C0S0BRTR verbatim; the "Coded fonts" and
// AFP Font Collection documentation supply X0GT10/X0SHAD and the C0/CZ/
// X0/XZ prefix conventions).
import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AfpCodedFontMetrics = require("../src/afpCodedFontMetrics.js");

// --- resolveFontName ---------------------------------------------------

test("resolveFontName: uses the exact name as the CSS family, with a monospace fallback for a known monospace font", () => {
  const r = AfpCodedFontMetrics.resolveFontName("Courier New");
  assert.equal(r.name, "Courier New");
  assert.equal(r.family, '"Courier New", monospace');
  assert.equal(r.spacing, "fixed");
  assert.equal(r.isPlaceholderMetrics, false); // this IS the real named font, not a substitute
  assert.equal(r.resolutionNote, undefined);
});

test("resolveFontName: known sans-serif and serif names get the right generic fallback and spacing", () => {
  const arial = AfpCodedFontMetrics.resolveFontName("Arial");
  assert.equal(arial.family, '"Arial", sans-serif');
  assert.equal(arial.spacing, "proportional");

  const times = AfpCodedFontMetrics.resolveFontName("Times New Roman");
  assert.equal(times.family, '"Times New Roman", serif');
  assert.equal(times.spacing, "proportional");
});

test("resolveFontName: name matching is case-insensitive against the known-name table", () => {
  const r = AfpCodedFontMetrics.resolveFontName("COURIER NEW");
  assert.equal(r.spacing, "fixed");
});

test("resolveFontName: an unrecognized name still renders using the exact name, with an honest note and unknown spacing", () => {
  const r = AfpCodedFontMetrics.resolveFontName("Bookman Old Style");
  assert.equal(r.name, "Bookman Old Style");
  assert.equal(r.family, '"Bookman Old Style", sans-serif'); // conservative default fallback
  assert.equal(r.spacing, undefined); // honestly unknown, not guessed
  assert.match(r.resolutionNote, /aren't independently verified/);
});

test("resolveFontName: a family name containing a double quote doesn't produce invalid CSS", () => {
  const r = AfpCodedFontMetrics.resolveFontName('Weird"Font');
  assert.ok(!r.family.includes('Weird"Font"'), "the embedded quote should be stripped, not doubled into broken CSS");
});

// --- resolveCodedFont (CDEFNT) ------------------------------------------

test("resolveCodedFont: a known IBM-documented example (X0GT10) resolves with real name/spacing info", () => {
  const r = AfpCodedFontMetrics.resolveCodedFont("X0GT10");
  assert.equal(r.spacing, "fixed");
  assert.equal(r.isPlaceholderMetrics, false);
  assert.match(r.resolutionNote, /Gothic Text/);
});

test("resolveCodedFont: another known example (X0SHAD) also resolves", () => {
  const r = AfpCodedFontMetrics.resolveCodedFont("X0SHAD");
  assert.equal(r.isPlaceholderMetrics, false);
  assert.match(r.resolutionNote, /shading/i);
});

test("resolveCodedFont: IBM's own DDS-reference example name (X0N51EHC) is honestly unresolved, not guessed", () => {
  // X0N51EHC is IBM's own worked example from "Example: Specifying a
  // font" (CDEFNT(X0N51EHC)) — deliberately NOT in KNOWN_CODED_FONTS,
  // since nothing in that source documents what typeface it actually is;
  // this confirms the module doesn't silently invent an answer for a name
  // just because it's a well-known example elsewhere.
  const r = AfpCodedFontMetrics.resolveCodedFont("X0N51EHC");
  assert.equal(r.isPlaceholderMetrics, true);
  assert.match(r.resolutionNote, /Custom raster coded font/);
  assert.match(r.resolutionNote, /WRKFNTRSC/);
});

test("resolveCodedFont: the XZ (outline) prefix is recognized and described differently from X0 (raster)", () => {
  const r = AfpCodedFontMetrics.resolveCodedFont("XZABCDEF");
  assert.match(r.resolutionNote, /Custom outline coded font/);
});

test("resolveCodedFont: a library-qualified name is matched by its object name alone", () => {
  const r = AfpCodedFontMetrics.resolveCodedFont("QGPL/X0GT10");
  assert.equal(r.isPlaceholderMetrics, false);
  assert.match(r.resolutionNote, /Gothic Text/);
});

test("resolveCodedFont: a name with neither the X0 nor XZ prefix gets the generic 'unrecognized' note, not a raster/outline claim", () => {
  const r = AfpCodedFontMetrics.resolveCodedFont("QGPL/SOMETHING");
  assert.match(r.resolutionNote, /^Unrecognized coded font name/);
});

// --- resolveFontCharacterSet (FNTCHRSET) --------------------------------

test("resolveFontCharacterSet: the C0 (raster) prefix is recognized", () => {
  // C0S0BRTR is IBM's own worked example (FNTCHRSET(C0S0BRTR T1V10037))
  // from "Example: Specifying a font" — deliberately not claiming to know
  // its exact typeface, same "prefix decoded, rest honestly unresolved"
  // treatment as CDEFNT above.
  const r = AfpCodedFontMetrics.resolveFontCharacterSet("C0S0BRTR");
  assert.match(r.resolutionNote, /Custom raster font character set/);
  assert.equal(r.isPlaceholderMetrics, true);
});

test("resolveFontCharacterSet: the CZ (outline) prefix is recognized", () => {
  // CZH200 is also IBM's own worked example
  // (FNTCHRSET(CZH200 T1V10274 (*POINTSIZE 48 10))).
  const r = AfpCodedFontMetrics.resolveFontCharacterSet("CZH200");
  assert.match(r.resolutionNote, /Custom outline font character set/);
});

test("resolveFontCharacterSet: an unrecognized prefix gets the generic note", () => {
  const r = AfpCodedFontMetrics.resolveFontCharacterSet("ZZWHATEVER");
  assert.match(r.resolutionNote, /^Unrecognized font character set name/);
});
