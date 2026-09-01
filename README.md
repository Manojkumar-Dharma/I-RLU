# I-RLU — Interactive Report Layout Utility

A VS Code replacement for IBM i's `STRRLU` (Report Layout Utility): design
printer file (`*PRTF`) DDS visually, in a live page-grid preview, while the
fixed-column DDS source stays the single source of truth.

See [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) for the full requirements
and architecture write-up this project is being built against, and
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what's implemented vs. still open.

## Status

Early skeleton — parser, writer, layout engine, and a working (if basic)
webview designer are in place and tested. Not yet packaged or published;
see the roadmap for what's next.

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
`/QIBM/UserData/OS400/Fonts/TTF/`, or FOCA font objects via host APIs) is a
promising direction for later, but the specific paths/API names haven't
been independently verified yet, so it's not implemented against unverified
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

- Editing through the webview covers move (drag), add, update, and delete
  for fields and constants (via the properties panel), but not yet editing
  arbitrary keywords directly (`LINE`/`BOX` params, etc.) — the
  writer/engine already support arbitrary model edits, only the UI for
  triggering keyword-level edits is missing for whatever isn't yet covered
  by a landed batch. *(Batches A, B, C, E, F, G all done; remaining gaps
  are keyword-specific — see docs/TASKS.md)*
- `LINE`/`BOX`/`BARCODE` physical measurements are converted to the
  preview's character grid via CPI/LPI and a unit-of-measure assumption.
  **Important correction:** there is no `UOM` keyword in DDS source — unit
  of measure is a parameter on the `CRTPRTF` command that compiles the
  file, so I-RLU has no way to detect it by parsing source alone. It
  defaults to inches (CRTPRTF's own default); set the
  `i-rlu.unitOfMeasure` VS Code setting to `cm` if your shop's CRTPRTF
  actually specifies `UOM(*CM)`. Getting this wrong scales every LINE/BOX/
  BARCODE measurement by 2.54x in the wrong direction, so it's worth
  checking if your printer files use those keywords. *(Done)* Separately,
  LINE/BOX parameters given as program-to-system fields (`&NAME`) can't be
  resolved without a live compile/run and are shown at a default position,
  flagged in the preview. *(Permanent by design — not a task; see TASKS.md)*
- `BARCODE` renders as a labeled placeholder box (symbology id + direction),
  not the actual bar symbol — real symbol rendering needs a barcode
  rendering library and is out of v1 scope. Height in whole print lines
  (the common case) is resolved exactly; a height given in inches/cm, or no
  height at all, falls back to a flagged default estimate. *(Batch D, depends
  on Batch C)* The properties panel now flags BARCODE's mutual-exclusion
  rule — it can't be combined with `CHRSIZ`/`CHRID`/`CVTDTA`/`DATE`/
  `EDTCDE`/`EDTWRD`/`FONT`/`HIGHLIGHT`/`PAGNBR`/`TIME`/`UNDERLINE` on the
  same field — as a live-editor hint; `CRTPRTF` remains the actual
  enforcement point. *(Batch N, depends on Batch C — done)*
- Page segments (`PAGSEG`), overlays (`OVERLAY`), and AFP resources
  (`AFPRSC`) render as labeled placeholder boxes (resource name + keyword),
  not their real pixel content — see `docs/REQUIREMENTS.md` §8 for why
  that's a hard limit regardless of priority. `STRPAGGRP`/`ENDPAGGRP`/
  `DOCIDXTAG`/`DTASTMCMD` (no page position of their own) are editable via
  the same panel, summarized as a badge list. *(Batch E, done)* Real pixel
  content is Batch O, blocked pending resource-file access.
- The `CRTPRTF` compile command assumes `*CURLIB/QDDSSRC` and derives the
  member name from the file name; it doesn't yet let you pick
  library/source-file/member explicitly. *(Batch J)*
- No packaging/publishing (`.vsix`) yet. *(Batch K)*

## License

Not yet chosen — add one before any public release.
