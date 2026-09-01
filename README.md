# I-RLU — Interactive Report Layout Utility

A VS Code replacement for IBM i's `STRRLU` (Report Layout Utility): design
printer file (`*PRTF`) DDS visually, in a live page-grid preview, while the
fixed-column DDS source stays the single source of truth.

See [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) for the full requirements
and architecture write-up this project is being built against, and
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what's implemented vs. still open.

## Status

Parser, writer, layout engine, and webview designer are all in place and
tested (see Features below for what's covered). Packaged as a `.vsix`
(Batch K); see the roadmap for what's still open.

## Features

- **Live, bidirectional page-grid designer** for `*PRTF` DDS source — a
  webview renders each record format as a real page grid (derived from
  `PAGSIZE`/CPI/LPI), stays in sync as the source changes, and writes every
  edit straight back through the real parser/writer as a normal VS Code
  `WorkspaceEdit` (undo/redo works normally; the DDS source stays the
  single source of truth).
- **Click-to-place and drag-to-reposition** for fields and constants, plus
  a properties panel for name, length, data type, decimals, usage, and
  line/position.
- **Copy/duplicate a field or constant** — keywords included, not just
  position/type — with a suggested non-colliding name for fields.
  Same-record only for now; picks a position via the same click-to-place
  flow as adding new.
- **Record format management** — switch, add, rename, delete, and reorder
  record formats from the designer itself.
- **Indicator-based conditioning** — toggle indicators to preview
  conditioned fields/constants showing or hiding, with `INDTXT`
  descriptions surfaced in the toggle panel.
- **Keyword editing** via properties panels (not just raw text) across:
  - General field/record keywords: `EDTCDE`, `EDTWRD`, `DATE`, `DATFMT`,
    `DATSEP`, `TIME`, `TIMFMT`, `TIMSEP`, `DFT`, `MSGCON`, `COLOR`,
    `HIGHLIGHT`, `UNDERLINE`, `PAGNBR`, `PRTQLTY`, `DRAWER`, `PAGRTT`.
  - Font/sizing: `FONT` (FGID), `CDEFNT`, `FNTCHRSET`, `FONTNAME`,
    `CHRSIZ`, `CHRID`, `CCSID` — including program-to-system-field
    (`&NAME`) indirection via a shared toggle component.
  - `BARCODE` — every documented parameter (symbology, height, bar format,
    HRI position, asterisk, modifier, narrow bar width, ratio, 2D params),
    real rendered bars (not a placeholder) for 13 linear symbologies, and
    live mutual-exclusion validation hints.
  - Print/finishing device keywords: `DUPLEX`, `FORCE`, `OUTBIN`, `ZFOLD`,
    `STAPLE`, `INVMMAP`.
  - Field-level data/edit keywords: `ALIAS`, `BLKFOLD`, `CVTDTA`, `DLTEDT`,
    `FLTFIXDEC`, `FLTPCN`, `TRNSPY`, `TXTRTT`.
  - AFP page-group/resource keywords: `OVERLAY`, `PAGSEG`, `AFPRSC`,
    `STRPAGGRP`/`ENDPAGGRP`, `DOCIDXTAG`, `DTASTMCMD` — rendered as labeled
    placeholders (see Known limitations) with full keyword editing.
  - `REF`/`REFFLD` — "Reference a field" / "Use referenced values" toggle
    pair, a "Browse fields…" picker over Code for i (record-format/field
    list), and one-click "Resolve Referenced Field" to pull real
    length/type/decimals from the referenced file.
- **`LINE`/`BOX` geometry** (AFPDS-only, record-level) rendered to scale
  from physical units via CPI/LPI and a configurable unit-of-measure
  setting.
- **Live validation hints**, non-blocking, for documented DDS restrictions
  (e.g. `BARCODE` mutual exclusion, `ZFOLD`/`STAPLE` PSF-only, file-level
  `SKIPA`/`SKIPB` on `*AFPDS`) — `CRTPRTF` remains the real enforcement
  point.
- **`CRTPRTF` compile command** via the Code for IBM i extension, with a
  library/source-file/member picker (prompted once per file and cached —
  `i-rlu.setCompileTarget` to change it; a file opened directly from a
  Code for i `member:` URI needs no prompt, its exact target is read from
  the URI).
- **Packaged as a `.vsix`** — installable like any other VS Code extension.

## Project layout

| Path | What it is |
|---|---|
| `src/prtfModel.ts` | Data model types for parsed PRTF DDS source |
| `src/prtfParser.ts` | Fixed-column DDS text → model |
| `src/prtfWriter.js` | Model → fixed-column DDS text (round-trip safe) |
| `src/prtfEngine.js` | Model + indicator state → resolved page layout |
| `src/afpFontMetrics.js` | AFP font width table — **placeholder**, see below |
| `src/extension.ts` | VS Code extension host (`CustomTextEditorProvider`, compile command) |
| `media/webviewClient.js` | Webview UI: renders the page grid, indicator toggles, drag-to-move |
| `src/buildWebviewTemplate.js` | Build step that inlines engine + font metrics + client script into one self-contained webview HTML blob |
| `test/` | Round-trip and engine tests (Node's built-in test runner) |

## Column layout this is built against

The parser/writer implement IBM's documented DDS positional-entry columns
for printer files (verified against IBM's DDS reference, not guessed):

```
1-5    Sequence number
6      Form type
7      Comment ('*' = whole line is a comment)
8-16   Conditioning indicators (three 3-character slots)
17     Type of name/specification ('R' = record format, blank = field/constant)
18     Reserved
19-28  Name
29     Reference ('R')
30-34  Length
35     Data type
36-37  Decimal positions
38     Usage
39-41  Location: line number
42-44  Location: position (column) number
45-80  Keyword area (continues onto following lines via '+'/'-' in column 80)
```

## Settings

| Setting | Default | What it does |
|---|---|---|
| `i-rlu.unitOfMeasure` | `inch` | Unit of measure I-RLU assumes when converting `LINE`/`BOX`/`BARCODE` physical measurements to the preview's character grid. There is no `UOM` DDS keyword — this is a `CRTPRTF` command parameter the tool can't see from source, so set this to match what your shop actually compiles with. |

## AFPDS font metrics

`FONT`'s parameter is a Font Global Identifier (FGID) — a different DDS
mechanism from `CDEFNT` ("coded font"), `FNTCHRSET` (host font
character-set + code page), or `FONTNAME` (TrueType/OpenType by name).
`src/afpFontMetrics.js` resolves `FONT`/FGID against a table verified
against IBM's own FGID/typeface documentation (Printer Device Programming,
the AFP Font Collection reference, and IBM support pages), covering the
common Courier/Gothic (fixed-pitch) and Helvetica/Times New Roman
(proportional) families, plus point-size-to-CPI conversion for scalable
monospace fonts. One correction worth calling out: an early reference this
project drew on mislabeled FGID 416 as "Times Roman" — it's actually
Courier Roman Medium; real Times New Roman Medium is FGID 2308. There's a
regression test (`FGID 416 correctly resolves to Courier Roman Medium...`)
guarding against that mistake resurfacing.

What's still an approximation: `CDEFNT`, `FNTCHRSET`, and `FONTNAME` aren't
resolved at all yet — those reference host/IFS font objects this tool
doesn't have access to. Proportional-font (Helvetica/Times New Roman)
character widths now use the real published Adobe Font Metrics (AFM)
values for the metric-compatible PostScript substitute fonts (Helvetica,
Times-Roman/Bold/Italic/BoldItalic) — stable, industry-standard data used
in every PDF library and PostScript RIP since 1985, a genuine improvement
over an earlier flat placeholder table. The one remaining honest caveat:
these are the *substitute* font's published metrics, applied as the best
available proxy for IBM's own FGID-named fonts — not a verified
byte-for-byte extraction of IBM's own FGID resource data (which this tool
has no access to), so don't treat this as guaranteed pixel-identical to
what a specific target printer actually renders. Extracting real metrics
from a live IBM i (TrueType files under
`/QIBM/ProdData/OS400/Fonts/TTFonts` for IBM-supplied fonts, or
`/QIBM/UserData/OS400/Fonts/TTFonts` for user-installed ones — verified
against IBM's own documentation — or FOCA font objects via host APIs) is a
promising direction for later; FOCA's specific API names haven't been
independently verified yet, so it's not implemented against unverified
specifics — see `docs/ROADMAP.md`.

## Building and testing

```
npm install
npm test        # compiles, builds the webview template, runs the test suite
npm run compile # compile + build webview template without running tests
```

## Known limitations (v1)

Each bullet below is tracked as a batch (or explicitly marked permanent) in
`docs/TASKS.md`'s "Known limitations → task mapping" section — see there for
dependencies and status; don't let this list and that mapping drift apart.
Anything already resolved (keyword editing coverage, `BARCODE` symbol
rendering, packaging, etc.) has been moved to Features above rather than
kept here.

- `LINE`/`BOX`/`BARCODE` parameters given as a program-to-system field
  (`&NAME`) can't be resolved to a real position/value without a live
  compile/run — shown at a default position, flagged in the preview.
  **Permanent by design**, not a task.
- AFP font metrics remain an approximation for the proportional families
  (Helvetica/Times New Roman): real, published Adobe AFM data for the
  metric-compatible *substitute* fonts, not a verified byte-for-byte
  extraction of IBM's own FGID resource data. `CDEFNT`, `FNTCHRSET`, and
  `FONTNAME` (host/IFS font references) aren't resolved at all — see "AFPDS
  font metrics" above. *(Batch L, mostly done)*
- Real pixel content for page segments (`PAGSEG`), overlays (`OVERLAY`),
  and other AFP resources isn't rendered — these show as labeled
  placeholder boxes (resource name + keyword), since the actual
  scanned-logo/form content lives in external IFS/host AFP objects this
  tool has no access to. *(Batch O, blocked — needs external resource file
  access; see `docs/REQUIREMENTS.md` §8)*
- `REF`/`REFFLD` live resolution over Code for i (both the single-field
  "Resolve Referenced Field" and the "Browse fields…" picker) is written
  and unit-tested wherever the logic is pure, but the actual DSPFFD/SQL
  network round-trip has not been exercised against a real connected IBM
  i. *(Batch H, part 2)*
- `CRTPRTF` can't compile directly from an IFS stream file — verified
  against IBM's own CRTPRTF parameter reference, there's no
  `SRCSTMF`-equivalent parameter (unlike CRTBNDRPG/CRTBNDCL, which have
  one). Opening one and compiling shows a clear error rather than guessing
  a library/source-file target for it. **Permanent by design**, a real IBM
  i command limitation, not a gap in I-RLU.
- Numeric edit-code/edit-word formatting is approximate-width only, with
  no live-system verification against a real `CRTPRTF` compile. **Explicit
  non-goal**, not a task — see Batch A's detail in `docs/TASKS.md`.

## License

Not yet chosen — add one before any public release.
