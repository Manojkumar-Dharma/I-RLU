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

## Building and testing

```
npm install
npm test        # compiles, builds the webview template, runs the test suite
npm run compile # compile + build webview template without running tests
```

## Known limitations (v1)

- Editing support in the webview currently covers drag-to-reposition only;
  adding/deleting fields, resizing, and editing keywords through the UI are
  not wired up yet (the writer/engine already support arbitrary model edits
  — only the UI for triggering them is missing).
- `LINE`/`BOX` geometry is converted from physical units (inches, per the
  printer file's unit of measure) into character-grid coordinates using
  CPI/LPI (default 10/6 if not coded) — this is a rendering approximation
  for preview purposes, not the actual sub-character-cell positioning AFPDS
  uses at print time. Parameters given as program-to-system fields (`&NAME`)
  can't be resolved without a live compile/run and are shown at a default
  position, flagged in the preview.
- `BARCODE` renders as a labeled placeholder box (symbology id + direction),
  not the actual bar symbol — real symbol rendering needs a barcode
  rendering library and is out of v1 scope. Height in whole print lines
  (the common case) is resolved exactly; a height given in inches/cm, or no
  height at all, falls back to a flagged default estimate. The tool doesn't
  currently validate DDS's rule that `BARCODE` can't be combined with
  `FONT`/`EDTCDE`/`EDTWRD`/`DATE`/`TIME`/`PAGNBR`/etc. on the same field —
  that's a compile-time check `CRTPRTF` will still catch.
- Page segments, overlays, and other external AFP resource objects render
  as nothing (not yet stubbed as placeholder boxes) — see
  `docs/REQUIREMENTS.md` §8 for why this is a hard limit regardless of
  priority.
- The `CRTPRTF` compile command assumes `*CURLIB/QDDSSRC` and derives the
  member name from the file name; it doesn't yet let you pick
  library/source-file/member explicitly.
- No packaging/publishing (`.vsix`) yet.

## License

Not yet chosen — add one before any public release.
