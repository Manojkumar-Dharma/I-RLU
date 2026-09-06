# Vendored font fixtures — attribution

These three real, unmodified TrueType font files are test fixtures for
`src/afpTrueTypeMetrics.js` (docs/TASKS.md's real-TTF/OTF-metrics batch) and
`afpCodedFontMetrics.js`'s `FONTNAME` resolution. All three are licensed
under the [SIL Open Font License, Version 1.1](./LICENSE-OFL-1.1.txt),
which permits use, study, modification, and redistribution as long as the
fonts themselves aren't sold standalone — satisfied here since they're
bundled as test fixtures, not sold. Sourced from the
[`google/fonts`](https://github.com/google/fonts) repository (`ofl/`
directory), commit `5e35378e6bda803962ee6fd257e444a7d459660d`.

| File | Font | Copyright | Upstream path |
| --- | --- | --- | --- |
| `Cousine-Regular.ttf` | Cousine Regular | Copyright 2026 The Cousine Project Authors (<https://github.com/googlefonts/cousine>) | `ofl/cousine/Cousine-Regular.ttf` |
| `Tinos-Regular.ttf` | Tinos Regular | Copyright 2026 The Tinos Project Authors (<https://github.com/googlefonts/tinos>) | `ofl/tinos/Tinos-Regular.ttf` |
| `PTSans-Regular.ttf` | PT Sans Regular | ParaType (designer: Steve Matteson for Cousine/Tinos; ParaType for PT Sans) — see each font's own `METADATA.pb`/`OFL.txt` upstream for the exact copyright text | `ofl/ptsans/PT_Sans-Web-Regular.ttf` |

## Why these three specific fonts

Cousine and Tinos are the "Chrome OS core fonts" (originally by Ascender
Corp, now maintained under Google Fonts) explicitly designed for metric
compatibility with Courier New and Times New Roman respectively — the two
of `FONTNAME_GENERIC_FALLBACK`'s (`src/afpCodedFontMetrics.js`) monospace/
serif buckets that have a well-known, purpose-built open substitute. PT
Sans fills the sans-serif bucket; it is NOT purpose-built as an Arial
substitute (the historical Arial-compatible croscore font, Arimo, is only
distributed as a variable font in the current `google/fonts` repository,
which this project's fixed-width-per-glyph metrics model isn't built to
read) — this is stated plainly in `afpCodedFontMetrics.js`'s own
`resolutionNote` for the sans-serif case, following this project's
existing "be honest about what's a verified match vs. a reasonable proxy"
convention (see afpFontMetrics.js's own Helvetica/Times AFM-substitute
caveat for the precedent).

## Why real vendored fonts instead of another hand-typed width table

`afpFontMetrics.js`'s `FONT`/FGID Helvetica/Times tables are hand-transcribed
from Adobe's published AFM metrics — appropriate there since AFM files are
themselves just published width tables, nothing more. A TrueType/OpenType
font is a binary format with real internal structure (sfnt table directory,
`cmap` codepoint-to-glyph mapping, `hmtx` per-glyph widths) — vendoring real
font files and parsing them for real lets this project's own
`afpTrueTypeMetrics.js` parser be verified against an actual binary format
(cross-checked line-for-line against `fontTools`, the industry-standard
Python font library, across the full ASCII printable range for all three
fonts during development — zero mismatches), not just re-typed as another
static table. It also means the exact same parser is ready to read a real
font pulled from a connected IBM i's IFS the moment that becomes possible
(see docs/ROADMAP.md's "real AFP font metrics" item) — nothing about it is
specific to these three substitute fonts.
