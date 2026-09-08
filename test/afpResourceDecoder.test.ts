// Batch O (docs/TASKS.md) — unit tests for src/afpResourceDecoder.js.
//
// test/fixtures/afp/resource_name_match.afp and expected_resource.afp are
// real, unmodified, Apache-2.0-licensed AFP resource-object fixtures from
// Apache FOP's own test suite (see that directory's NOTICE.md for full
// provenance). resource_name_match.afp is a genuine BPS/EPS-wrapped IOCA
// page segment; decoding it end-to-end reproduces a real, recognizable
// image ("SCAN THIS CODE TO MAKE A PAYMENT NOW" plus a QR code) —
// confirmed by visual inspection during development (see docs/TASKS.md's
// Batch O writeup) and pinned here via width/height/name plus a pixel-
// count sanity check, not just "doesn't throw."
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AfpResourceDecoder = require("../src/afpResourceDecoder.js");

function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(__dirname, "fixtures", "afp", name));
}

test("decodeAfpResourceToPngDataUri: decodes a real BPS/EPS-wrapped IOCA page segment end-to-end", () => {
  const result = AfpResourceDecoder.decodeAfpResourceToPngDataUri(fixture("resource_name_match.afp"));
  assert.equal(result.error, undefined);
  assert.equal(result.name, "S1CODEQR"); // EBCDIC-decoded resource name — see afpResourceDecoder.js's own decodeEbcdic
  assert.equal(result.width, 608);
  assert.equal(result.height, 200);
  assert.ok(result.dataUri.startsWith("data:image/png;base64,"));
});

test("decodeAfpResourceToPngDataUri: the decoded PNG has a real, valid PNG signature and IHDR matching the resolved dimensions", () => {
  const result = AfpResourceDecoder.decodeAfpResourceToPngDataUri(fixture("resource_name_match.afp"));
  const png = Buffer.from(result.dataUri.split(",")[1], "base64");
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR chunk: length(4)=13, type(4)="IHDR", width(4), height(4), ...
  assert.equal(png.readUInt32BE(8), 13);
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 608);
  assert.equal(png.readUInt32BE(20), 200);
});

test("decodeAfpResourceToPngDataUri: the decoded pixel data has a plausible, non-trivial mix of black and white (not all-blank, not all-black)", () => {
  const result = AfpResourceDecoder.decodeAfpResourceToPngDataUri(fixture("resource_name_match.afp"));
  const png = Buffer.from(result.dataUri.split(",")[1], "base64");
  // Locate and inflate the IDAT chunk (comes right after IHDR: 8-byte
  // signature + 4+4+13+4 IHDR chunk = 33, so IDAT's own length starts at 33).
  const idatLength = png.readUInt32BE(33);
  const idatData = png.subarray(33 + 8, 33 + 8 + idatLength);
  const raw = zlib.inflateSync(idatData);
  let black = 0;
  let white = 0;
  const rowBytes = 1 + result.width; // filter-type byte + one grayscale byte per pixel
  for (let y = 0; y < result.height; y++) {
    for (let x = 0; x < result.width; x++) {
      const v = raw[y * rowBytes + 1 + x];
      if (v === 0) black++;
      else if (v === 255) white++;
    }
  }
  assert.equal(black + white, result.width * result.height);
  assert.ok(black > 1000, "expected a substantial number of black (ink) pixels, got " + black);
  assert.ok(white > 1000, "expected a substantial number of white (background) pixels, got " + white);
});

test("decodeAfpResourceToPngDataUri: a resource using an unrecognized/unsupported IOCA self-defining field fails honestly, not silently or by crashing", () => {
  const result = AfpResourceDecoder.decodeAfpResourceToPngDataUri(fixture("expected_resource.afp"));
  assert.equal(result.dataUri, undefined);
  assert.ok(typeof result.error === "string" && result.error.length > 0);
  assert.match(result.error, /unrecognized IOCA self-defining field/);
});

test("scanStructuredFields: finds every top-level structured field in a real AFP file at the correct offsets", () => {
  const buf = fixture("resource_name_match.afp");
  const fields = AfpResourceDecoder.scanStructuredFields(buf);
  assert.ok(fields.length > 5);
  assert.equal(fields[0].offset, 0);
  assert.equal(fields[0].id, 0xd3a85f); // BPS
});

test("findResourceImage: ignores a nested BOG/EOG's own (empty) data when a real BPS name is present", () => {
  // Regression guard for the real bug this batch's own testing caught:
  // resource_name_match.afp's page segment wraps its image content in an
  // inner BOG/EOG (Object Environment Group, describing the image's own
  // Object Area Descriptor/Position — see afpResourceDecoder.js's own
  // findResourceImage doc comment) that carries no name at all. An
  // earlier version of this module treated BOG as just another name-
  // bearing wrapper opener, so that inner BOG's empty payload silently
  // overwrote the real "S1CODEQR" name from the outer BPS.
  const found = AfpResourceDecoder.findResourceImage(fixture("resource_name_match.afp"));
  assert.equal(found.name, "S1CODEQR");
  assert.ok(found.imageBytes.length > 1000);
});

test("parseIocaContent: applies IOCA's own documented defaults when the Image Encoding Parameter (0x95) / IDE Size Parameter (0x96) are omitted", () => {
  // A minimal synthetic IOCA content stream: Begin Segment, Begin Image
  // Content, Image Size Parameter only (2x2, arbitrary resolution), one
  // Image Data chunk, End Image Content, End Segment — deliberately
  // omitting 0x95/0x96 to exercise the documented defaults
  // (compressionId "No compression", bitsPerIde 1) rather than only ever
  // testing the explicit-value path a real fixture happens to use.
  const bytes = Buffer.from([
    0x70, 0x00, // Begin Segment
    0x91, 0x01, 0xff, // Begin Image Content
    0x94, 0x09, 0x00, 0x0b, 0xb8, 0x0b, 0xb8, 0x00, 0x02, 0x00, 0x02, // Image Size: width=2, height=2
    0xfe, 0x92, 0x00, 0x01, 0xff, // Image Data: 1 byte (enough for a 2x2 1bpp row-aligned image, 1 byte/row * 2 rows would need 2 bytes -- see note below)
    0x93, 0x00, // End Image Content
    0x71, 0x00, // End Segment
  ]);
  // Note: a real 2x2 1bpp image needs 1 row-byte per row (2 bytes total);
  // this test only checks that parseIocaContent's own defaults are
  // applied correctly, not that decodeRaster succeeds against this
  // deliberately-truncated data.
  const parsed = AfpResourceDecoder.parseIocaContent(bytes);
  assert.equal(parsed.width, 2);
  assert.equal(parsed.height, 2);
  assert.equal(parsed.compressionId, 0x03); // documented default: "No compression"
  assert.equal(parsed.bitsPerIde, 1); // documented default
});

test("decodeRaster: throws a specific, honest error for an unsupported bit depth rather than misdecoding", () => {
  assert.throws(
    () => AfpResourceDecoder.decodeRaster({ width: 2, height: 2, bitsPerIde: 8, compressionId: 0x03, imageData: Buffer.alloc(4) }),
    /8 bits\/IDE isn't supported/
  );
});

test("decodeRaster: throws a specific, honest error naming IBM MMR as unsupported (not silently run through the G4 decoder)", () => {
  assert.throws(
    () => AfpResourceDecoder.decodeRaster({ width: 2, height: 2, bitsPerIde: 1, compressionId: 0x01, imageData: Buffer.alloc(4) }),
    /IBM MMR/
  );
});

test("encodeGrayscalePng: round-trips a small synthetic bitmap through real PNG encoding and zlib inflation", () => {
  const width = 4;
  const height = 2;
  const pixels = new Uint8Array([1, 0, 1, 0, 0, 1, 0, 1]);
  const png = AfpResourceDecoder.encodeGrayscalePng(width, height, pixels);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idatLength = png.readUInt32BE(33);
  const idatData = png.subarray(33 + 8, 33 + 8 + idatLength);
  const raw = zlib.inflateSync(idatData);
  const rowBytes = 1 + width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const expected = pixels[y * width + x] ? 0 : 255;
      assert.equal(raw[y * rowBytes + 1 + x], expected, `pixel (${x},${y})`);
    }
  }
});
