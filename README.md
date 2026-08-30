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

## AFPDS font metrics — placeholder pending real font data

Per project decision, AFPDS is in scope from day one rather than deferred
behind SCS. However, genuinely accurate AFP text layout needs IBM's real
font character-set/code-page resource data, which isn't available yet.
`src/afpFontMetrics.js` currently uses a monospace default plus a rough
proportional stand-in table, clearly marked as a placeholder. Swap in real
font metrics there once that data is available — nothing else in the engine
needs to change, since it only calls `getAdvanceWidth(fontId, char)`.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `i-rlu.unitOfMeasure` | `inch` | Unit of measure I-RLU assumes when converting `LINE`/`BOX`/`BARCODE` physical measurements to the preview's character grid. There is no `UOM` DDS keyword — this is a `CRTPRTF` command parameter the tool can't see from source, so set this to match what your shop actually compiles with. |

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
  arbitrary keywords directly (`EDTCDE`, `COLOR`, `LINE`/`BOX` params,
  etc.) — the writer/engine already support arbitrary model edits, only the
  UI for triggering keyword-level edits is missing. *(Batches A, B, C, E, F, G)*
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
  on Batch C)* The tool doesn't currently validate DDS's rule that `BARCODE`
  can't be combined with `FONT`/`EDTCDE`/`EDTWRD`/`DATE`/`TIME`/`PAGNBR`/etc.
  on the same field — that's a compile-time check `CRTPRTF` will still
  catch. *(Batch N, depends on Batch C)*
- Page segments, overlays, and other external AFP resource objects render
  as nothing (not yet stubbed as placeholder boxes) — see
  `docs/REQUIREMENTS.md` §8 for why this is a hard limit regardless of
  priority. *(Batch E for placeholder boxes; Batch O for real pixel content,
  blocked pending resource-file access, depends on Batch E)*
- The `CRTPRTF` compile command assumes `*CURLIB/QDDSSRC` and derives the
  member name from the file name; it doesn't yet let you pick
  library/source-file/member explicitly. *(Batch J)*
- No packaging/publishing (`.vsix`) yet. *(Batch K)*

## License

Not yet chosen — add one before any public release.
