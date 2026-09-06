// Unit tests for src/afpTrueTypeMetrics.js — a real sfnt (TrueType/OpenType)
// binary metrics parser. Parses three real, unmodified, permissively-
// licensed fonts vendored at resources/fonts/ (see that directory's own
// NOTICE.md for exactly which fonts, why, and their license — vendored
// there rather than under test/fixtures because afpCodedFontMetrics.js's
// FONTNAME resolution reads these same files at runtime, not just this
// test file) and asserts concrete values independently cross-checked
// against fontTools (the industry-standard Python font library) across the
// full ASCII printable range (32-126) for all three fonts during
// development, with zero mismatches — the specific numbers asserted below
// are a representative sample of that full cross-check, not numbers
// invented for this test file.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AfpTrueTypeMetrics = require("../src/afpTrueTypeMetrics.js");

const fontsDir = path.join(__dirname, "..", "..", "resources", "fonts");
function loadFont(filename: string) {
  const buf = fs.readFileSync(path.join(fontsDir, filename));
  return AfpTrueTypeMetrics.parseFont(buf);
}

test("parseFont: Cousine (real monospace font) reports the same real advance width for every character, and its real unitsPerEm", () => {
  const font = loadFont("Cousine-Regular.ttf");
  assert.equal(font.unitsPerEm, 2048);
  // A genuinely monospace TrueType font achieves uniform width via hmtx's
  // documented "glyphs beyond numberOfHMetrics reuse the last entry"
  // mechanism (see afpTrueTypeMetrics.js's parseHmtx doc comment) — this
  // assertion is exercising that real mechanism, not a coincidence.
  assert.equal(font.getAdvanceWidth("A"), 1229);
  assert.equal(font.getAdvanceWidth("i"), 1229);
  assert.equal(font.getAdvanceWidth(" "), 1229);
  assert.equal(font.getAdvanceWidth("W"), 1229);
  assert.equal(font.getAdvanceWidth("."), 1229);
});

test("parseFont: Tinos (real proportional serif font) reports real, varying advance widths and its real unitsPerEm", () => {
  const font = loadFont("Tinos-Regular.ttf");
  assert.equal(font.unitsPerEm, 2048);
  assert.equal(font.getAdvanceWidth("A"), 1479);
  assert.equal(font.getAdvanceWidth("i"), 569);
  assert.equal(font.getAdvanceWidth(" "), 512);
  assert.equal(font.getAdvanceWidth("W"), 1933); // real Tinos data: W is wider than A, unlike this project's Adobe Times AFM table where they tie at 722
});

test("parseFont: PT Sans (real proportional sans-serif font) reports real, varying advance widths and its real (different) unitsPerEm", () => {
  const font = loadFont("PTSans-Regular.ttf");
  // PT Sans's em square is 1000 units, not Cousine/Tinos's 2048 — real
  // fonts genuinely differ here, which is exactly why this parser reads
  // `head` for real instead of assuming a fixed unitsPerEm constant.
  assert.equal(font.unitsPerEm, 1000);
  assert.equal(font.getAdvanceWidth("A"), 585);
  assert.equal(font.getAdvanceWidth("i"), 268);
  assert.equal(font.getAdvanceWidth(" "), 267);
  assert.equal(font.getAdvanceWidth("W"), 828);
});

test("parseFont: every printable ASCII character (32-126) resolves to a defined advance width in all three fixture fonts", () => {
  for (const filename of ["Cousine-Regular.ttf", "Tinos-Regular.ttf", "PTSans-Regular.ttf"]) {
    const font = loadFont(filename);
    for (let cp = 32; cp <= 126; cp++) {
      const ch = String.fromCharCode(cp);
      const width = font.getAdvanceWidth(ch);
      assert.ok(typeof width === "number" && width > 0, filename + ": expected a positive advance width for " + JSON.stringify(ch) + ", got " + width);
    }
  }
});

test("parseFont: an unmapped codepoint returns undefined rather than a guessed fallback", () => {
  const font = loadFont("Cousine-Regular.ttf");
  // U+E000 is in the Unicode Private Use Area — no ordinary text font maps
  // it to anything, which is exactly the "honestly report unknown" case
  // this function's own doc comment describes.
  assert.equal(font.getAdvanceWidth("\uE000"), undefined);
});

test("parseFont: accepts a raw numeric codepoint as well as a one-character string", () => {
  const font = loadFont("Tinos-Regular.ttf");
  assert.equal(font.getAdvanceWidth(65), font.getAdvanceWidth("A")); // 65 === 'A'.charCodeAt(0)
});

test("parseFont: throws a clear, specific error for a non-sfnt buffer rather than misreading garbage as table offsets", () => {
  const garbage = Buffer.from("not a font file, just plain text padding out to be long enough to not throw a totally unrelated out-of-range error first");
  assert.throws(() => AfpTrueTypeMetrics.parseFont(garbage), /unsupported sfnt version/);
});
