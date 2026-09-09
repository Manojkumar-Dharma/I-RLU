# Changelog

All notable changes to the "I-RLU" extension are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/) in the
`0.0.x` pre-1.0 range while still stabilizing.

Every entry below corresponds to a named batch/bug-fix tracked in
[`docs/TASKS.md`](docs/TASKS.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md),
which remain the authoritative source for full write-ups, caveats, and
test-coverage notes. This file summarizes what shipped in each version;
it does not replace those two documents.

## [Unreleased]

Nothing yet — see `docs/TASKS.md` for what's currently in flight or filed
for a future batch.

## [0.0.15] - Batch QQ

### Fixed
- Properties/side panel was resetting — losing any in-progress unsaved
  input and jumping back to the top of the panel — roughly every 10
  seconds while the designer was open. Root cause: the "IBM i:
  Connected/Not connected" status poll posted a message to the webview on
  every tick regardless of whether the connection state had actually
  changed, and the webview's handler triggered a full destructive
  re-render on every such message. The handler now only re-renders when
  the connection status actually changes.

## [0.0.14] - Batch H (follow-up) / Batch PP

### Fixed
- `REF`/`REFFLD`'s "add fields from database file" lookup used the wrong
  IBM i system-catalog column name (`WHFLDO` instead of `WHFOBO`),
  breaking the live field browse against a real IBM i. Verified end-to-end
  against a real system.
- Editing or adding a single keyword could disturb unrelated, untouched
  physical lines elsewhere in the same entry's keyword block — the
  regenerated source no longer preserves original line/wrap boundaries
  for keywords nobody touched. A related latent bug was also found and
  fixed: a keyword could be silently split mid-parameter if a wrap point
  fell inside it (e.g. `PAGSEG(COMPLOGO 0.5 0.5)`).

## [0.0.12] - Batch NN / Batch OO

### Added
- An "Open iRLU" CodeLens above the first line of a printer-file source,
  matching I-SDA's own "Open Screen Design" CodeLens for display files —
  a one-click shortcut alongside the existing right-click menu/editor-title
  button/Command Palette entry.
- A properties-panel UI for `LINE`/`BOX` record-level keywords: add, copy,
  edit, and delete, plus interactive drag-to-move and drag-to-resize
  directly on the design canvas. `LINE`/`BOX` had rendered on the canvas
  since early versions but had no panel surface of their own until now.

## [0.0.11] - Batch EE, GG–MM

### Added
- Visual rendering of `COLOR`, `HIGHLIGHT`, and `UNDERLINE` in the design
  preview — these were already editable via the properties panel but had
  no visible effect on-screen until now.
- Field/constant overlap detection (warn-only): flags when two fields'
  positions/lengths overlap or a field extends past another on the same
  line, since a real printer would overprint that ink.
- Sample/test data entry & preview (design-time only, not written back to
  the DDS source) — type realistic per-field values to see them in the
  design preview instead of a bare `{FIELDNAME}` placeholder.
- Duplicate/clone an entire record format (all its fields, constants, and
  keywords) in one action.
- Multi-select fields for bulk move/copy/delete via Ctrl/Cmd-click.
- Boundary shift-and-truncate when moving/resizing a field past the
  report's right edge, instead of silently allowing an off-page position.

### Fixed
- Conditioning indicators were only modeled per field/constant/record
  entry, not per individual keyword — a common real DDS/RLU technique
  (e.g. two mutually-exclusive `COLOR` keywords on one field, each
  conditioned on a different indicator) was silently misparsed.
- A constant's literal was only recognized when it was the first
  keyword-area token.
- A field's `+n` relative-position notation (DDS columns 42-44) was read
  as a plain absolute number, discarding the "relative, not absolute"
  semantic and silently relocating the field on round-trip.
- A constant's literal split onto its own "attached keyword" continuation
  line rendered as an empty cell with no error.

## [0.0.10] - Batch U–Z, AA–DD

### Added
- Hide Code-for-i-dependent UI (Resolve/Browse Referenced Field, database
  field browse) when there's no live connection, instead of leaving it
  visible and guaranteed to fail if clicked.
- A configurable designer-open location (`i-rlu.designerOpenColumn`
  setting): active column, beside, or a new window.
- Design-time rendering and add-UI for system-constant fields (`DATE`,
  `TIME`, `PAGNBR`).
- Add fields directly from a database file via a live Code for i
  connection.
- "Track source modifications" (comment-out-and-tag changed lines),
  mirroring I-SDA's own equivalent feature.

### Fixed
- `.side-col`'s scrollbar had no effect in a real VS Code webview — `#root`
  was missing the height-bounding flex rule the rest of the scroll chain
  depended on.
- Properties-panel row layout was inconsistent: checkboxes stretched to
  the value-input's width, some rows placed the checkbox before its label
  and others after, and several rows had no row wrapper at all.
- The physical column-6 form-type marker was being hardcoded to blank
  instead of preserved on round-trip.

## [0.0.7] - Batch X, Y

### Added
- "Track source modifications" groundwork and the database-field-picker
  logic later shared between the REF/REFFLD lookup and the add-from-
  database-file feature.

## [0.0.6] - Batch Y

### Added
- Add fields from a database file via Code for i (initial version).

## [0.0.5] - Batch V, W, Z

### Added
- Configurable designer-open location.
- System-constant field rendering and add-UI (`DATE`/`TIME`/`PAGNBR`).

### Fixed
- `.side-col` scroll chain (see 0.0.10 entry above — first landed here).

## [0.0.4] - Batch U

### Added
- Hide Code-for-i-dependent UI when disconnected; themed the
  properties-column scrollbar.

## [0.0.3] - Batch A–T (initial designer feature set)

The first several months of development, bringing the designer from an
empty shell to a genuinely usable RLU replacement. Highlights:

### Added
- The core visual designer: a `CustomTextEditorProvider`-based webview
  that parses printer-file DDS source into a model, renders it on an
  interactive character-grid canvas, and writes edits back to the source.
- General properties-panel keyword editing (Batch A); font/sizing keyword
  editing for `FONT`/`CDEFNT`/`FNTCHRSET`/`FONTNAME`/`CHRID`/`CHRSIZ`/
  `CCSID` (Batch B); `BARCODE`'s full parameter surface and real symbol
  rendering (Batches C, D); AFP page-group/resource keyword placeholders
  (Batch E); field-level data/edit keywords plus `INDTXT` indicator text
  (Batch G); `REF`/`REFFLD` field/record-format resolution, including a
  live Code for i-backed picker (Batch H); print/finishing keywords
  (Batch F); `BARCODE` mutual-exclusion validation against IBM's DDS
  reference (Batch N).
- Real published Adobe AFM font metrics replacing placeholder proportional
  -font widths, plus a verified FGID identification table and CPI/LPI
  -driven pixel grid (Batch L).
- Add/rename/delete/reorder record formats (Batch P); copy/duplicate a
  single field or constant (Batch Q).
- A compile command (`i-rlu.compilePrtf`, `CRTPRTF`) with a library/source
  -file/member picker (Batch J), and a "Set Compile Target" command.
- Packaging groundwork: `.vscodeignore`, `vsce` scripts, and a corrected
  extension entry point (Batch K); MIT `LICENSE` and extension icon.

### Fixed
- The writer's DDS continuation-character bug (Batch M).
- `emitWithKeywords` collapsing internal whitespace inside quoted literals
  such as `EDTWRD('  .  ')` (Batch R).
- The right-click "open designer" menu entry not appearing for
  `.pf`/`.prtf`/`.rlu` files (Batch T).
- Wide record-format panel layout, made two-column and independently
  scrollable (Batch S).

[Unreleased]: https://github.com/Manojkumar-Dharma/I-RLU/compare/v0.0.15...HEAD
[0.0.15]: https://github.com/Manojkumar-Dharma/I-RLU/compare/v0.0.14...v0.0.15
[0.0.14]: https://github.com/Manojkumar-Dharma/I-RLU/compare/v0.0.12...v0.0.14
[0.0.12]: https://github.com/Manojkumar-Dharma/I-RLU/compare/v0.0.11...v0.0.12
[0.0.11]: https://github.com/Manojkumar-Dharma/I-RLU/compare/v0.0.10...v0.0.11
[0.0.10]: https://github.com/Manojkumar-Dharma/I-RLU/compare/v0.0.7...v0.0.10
[0.0.7]: https://github.com/Manojkumar-Dharma/I-RLU/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/Manojkumar-Dharma/I-RLU/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/Manojkumar-Dharma/I-RLU/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/Manojkumar-Dharma/I-RLU/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/Manojkumar-Dharma/I-RLU/releases/tag/v0.0.3
