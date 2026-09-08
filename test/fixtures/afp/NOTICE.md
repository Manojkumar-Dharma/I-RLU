# Vendored AFP resource-object fixtures — attribution

These two real, unmodified AFP resource-object files are test fixtures for
`src/afpResourceDecoder.js` (docs/TASKS.md's Batch O — real AFP resource
rendering). Both are licensed under the
[Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0),
sourced from the [Apache FOP](https://xmlgraphics.apache.org/fop/) project's
own test suite — Apache FOP is licensed Apache-2.0 in full; see its
`LICENSE`/`NOTICE` at the repository root.

- **Repository:** <https://github.com/apache/xmlgraphics-fop>
- **Commit:** `2a8efc165a8769e6b57ab9dfa2ae152c9046f14d`
- **Upstream path:** `fop-core/src/test/resources/org/apache/fop/afp/`

| File | Upstream filename | What it's used for here |
| --- | --- | --- |
| `resource_name_match.afp` | same | A genuine `BPS`/`EPS`-wrapped IOCA page segment — real structured fields, real (uncompressed 1-bit) raster image data. Decoding it end-to-end reproduces a real, recognizable image: the text "SCAN THIS CODE TO MAKE A PAYMENT NOW" plus a QR code, 608×200 pixels, resource name `S1CODEQR` (EBCDIC-encoded in the file itself — see `afpResourceDecoder.js`'s own `decodeEbcdic`). |
| `expected_resource.afp` | same | A resource using a different/larger IOCA self-defining-field sequence this project's decoder doesn't recognize (outside its stated FS10 scope — see `afpResourceDecoder.js`'s own header comment) — used to test that unsupported content fails with a specific, honest error message rather than crashing or silently misdecoding. |

## Why these two specific fixtures, out of Apache FOP's own several

FOP's own test suite has half a dozen near-identical resource-object
fixtures (`resource_any_name.afp`, `resource_name_mismatch.afp`,
`resource_no_end_name.afp`, `expected_named_resource.afp`) built to test
FOP's own resource-*name-matching* logic specifically — for this
project's purposes (decoding the image content, not matching names) they
all decode to the exact same 608×200 `S1CODEQR` image `resource_name_match.afp`
does, so vendoring all of them would add file size with no additional
test coverage. `expected_resource.afp` was kept specifically because it
exercises a genuinely different code path (the honest-failure case).

## Why COMPRID (compression) in `resource_name_match.afp` is "no
## compression" despite being genuinely useful as raster test data

This file's Image Encoding Parameter declares COMPRID `0x03` — per IBM's
own IOCA Function Set 10 reference table, that value means "No
compression", not G4 MMR (`0x82`) as its numeric value might suggest at a
glance (an easy misreading this project's own development process made
once — see `afpResourceDecoder.js`'s own comment on the constant). The
raw image data is a plain, byte-aligned-per-row 1-bit bitmap, confirmed
by its exact byte length (15200 bytes = 608 × 200 ÷ 8, matching an
uncompressed bitmap precisely) and by successfully decoding it into the
real, recognizable image described above.

Real G4-compressed IOCA content is exercised instead by
`test/afpCcittDecoder.test.ts`'s own independently-generated test vector
(via Pillow/libtiff, an unrelated trusted G4 encoder) — see that file's
own header comment.
