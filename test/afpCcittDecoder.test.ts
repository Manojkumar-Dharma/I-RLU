// Unit tests for src/afpCcittDecoder.js — a vendored, lightly adapted
// copy of Mozilla pdf.js's real CCITTFaxDecoder (Apache License 2.0; see
// that file's own header comment for full provenance and why porting a
// mature, real-world-hardened decoder was judged the right call here
// over writing a from-scratch ITU-T T.6 implementation).
//
// This is a genuine independent-encoder cross-check, the same
// verification strategy Batch L's afpTrueTypeMetrics.test.ts used against
// fontTools: a small, distinctive 64x32 bi-level test pattern (a
// horizontal bar, two blocks, and a per-row diagonal scatter of single
// pixels — enough real transitions for a G4 encoder to have real work to
// do, unlike a blank or trivial image) was compressed with Pillow/libtiff
// (an unrelated, trusted, independent G4 encoder) via:
//
//   from PIL import Image
//   import numpy as np
//   w, h = 64, 32
//   arr = np.zeros((h, w), dtype=np.uint8)
//   arr[4:10, 4:60] = 1
//   arr[12:28, 8:16] = 1
//   arr[12:28, 40:48] = 1
//   for i in range(h):
//       arr[i, (i * 2) % w] = 1
//   im = Image.fromarray((arr * 255).astype(np.uint8)).convert('1')
//   im.save('g4_testvector.tiff', compression='group4')
//   # then the TIFF's own single IFD strip (tag 273/279) was extracted as
//   # the raw G4-compressed bytes below — see this file's own comment at
//   # the constant for exactly how.
//
// Decoding those exact compressed bytes with this vendored decoder and
// comparing pixel-for-pixel against the same pattern gave a 100% exact
// match during development (see docs/TASKS.md's Batch O writeup) — the
// assertions below are that same real cross-check, not numbers invented
// for this test file.
import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CCITTFaxDecoder } = require("../src/afpCcittDecoder.js");

const WIDTH = 64;
const HEIGHT = 32;

// The exact raw G4-compressed strip bytes Pillow/libtiff produced for the
// pattern described above (66 bytes — see this file's own header comment
// for the generating Python code).
const G4_TEST_VECTOR_HEX =
  "26aa2475123a891d4220517fffc885123a998a24747517891d7c48ebe2475f123af891d7c48ebe21143f8fffffdfa2ebe2475f123a88891d448ea247510940040040";

/** Reproduces the exact same pattern the Python generator drew, so the
 * expected truth table lives in this test file as reviewable code rather
 * than an opaque precomputed array. */
function expectedPixel(x: number, y: number): number {
  if (y >= 4 && y < 10 && x >= 4 && x < 60) return 1; // horizontal bar
  if (y >= 12 && y < 28 && x >= 8 && x < 16) return 1; // left block
  if (y >= 12 && y < 28 && x >= 40 && x < 48) return 1; // right block
  if (x === (y * 2) % WIDTH) return 1; // per-row diagonal scatter
  return 0;
}

function decodeTestVector(): number[][] {
  const g4 = Buffer.from(G4_TEST_VECTOR_HEX, "hex");
  let pos = 0;
  const source = {
    next() {
      return pos < g4.length ? g4[pos++] : -1;
    },
  };
  const decoder = new CCITTFaxDecoder(source, {
    K: -1, // pure Group 4, 2-D encoding only
    Columns: WIDTH,
    Rows: HEIGHT,
    BlackIs1: true, // empirically verified below to match this test vector's own "1 == drawn/foreground" convention
    EndOfBlock: false,
  });
  const rows: number[][] = [];
  for (let y = 0; y < HEIGHT; y++) {
    const row: number[] = [];
    for (let x = 0; x < WIDTH; x += 8) {
      const byte = decoder.readNextChar();
      assert.notEqual(byte, -1, "decoder ran out of data before " + HEIGHT + " rows were read");
      for (let b = 7; b >= 0; b--) row.push((byte >> b) & 1);
    }
    rows.push(row);
  }
  return rows;
}

test("CCITTFaxDecoder: decodes a real G4-compressed test vector pixel-for-pixel against an independent encoder (Pillow/libtiff)", () => {
  const rows = decodeTestVector();
  let mismatches = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (rows[y][x] !== expectedPixel(x, y)) mismatches++;
    }
  }
  assert.equal(mismatches, 0, "expected 0 pixel mismatches against the independently-encoded test vector");
});

test("CCITTFaxDecoder: the horizontal bar region is fully decoded as foreground (1)", () => {
  const rows = decodeTestVector();
  for (let y = 4; y < 10; y++) {
    for (let x = 4; x < 60; x++) {
      assert.equal(rows[y][x], 1, `expected bar pixel (${x},${y}) to be 1`);
    }
  }
});

test("CCITTFaxDecoder: a background pixel outside every drawn region decodes as 0", () => {
  const rows = decodeTestVector();
  // (1,0): not the bar (starts at y=4), not either block, and row 0's own
  // diagonal-scatter pixel is x=0 (from (0*2)%64=0), not x=1 — so (1,0)
  // is genuinely background in every rule expectedPixel checks.
  assert.equal(expectedPixel(1, 0), 0);
  assert.equal(rows[0][1], 0);
});
