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

## [0.0.24] - Batch ZZ

### Fixed
- `TIMFMT`'s properties-panel option list no longer offers `*JOB` — that's
  a valid `TIMSEP` value only, not a valid `TIMFMT` value per the
  reference (the list had apparently been copy-adapted from `DATFMT`'s,
  which legitimately includes `*JOB`, without dropping the one option
  that doesn't carry over).

### Added
- `EDTCDE`/`EDTWRD` vs. `DFT` constraint validation: either is flagged
  when `DFT` is also specified on the same field.
- `MSGCON`'s five-keyword exclusion set (`DATE`/`DFT`/`EDTCDE`/`EDTWRD`/
  `TIME`) validated — `MSGCON` wasn't referenced in
  `prtfKeywordValidation.js` at all before this.
- `ALIAS` uniqueness validation: a new record-scoped
  `validateAliasUniqueness()` flags an `ALIAS` value that duplicates
  another field's `ALIAS` value, or any DDS field name in the record
  format (including its own field's name — the reference doesn't exempt
  that case), folded into `validateFieldKeywords` via its existing
  optional `record` parameter.

## [0.0.23] - Batch YY

### Added
- `ENDPAGE` constraint validation, folded into `validateRecordKeywords`:
  flagged when specified together with `SPACEA`/`SPACEB`/`SKIPA`/`SKIPB`
  on the same record (the reverse side of Batch VV's exclusion check —
  `ENDPAGE` was already in that shared exclusion-set constant, so this
  adds `ENDPAGE`'s own direction); flagged when a constant field is
  present anywhere in a record that also has `ENDPAGE` (no escape hatch,
  unlike `BOX`/`GDF`/`LINE`/`OVERLAY`/`PAGSEG`'s "OK if that constant also
  has its own `POSITION`" rule); and flagged (heuristically) when no
  `*AFPDS`-typical keyword is present in the file, same caveat as every
  other `DEVTYPE(*AFPDS)` check.
- `ENDPAGE` added to `VALUELESS_KEYWORDS` — it takes no parameters, same
  round-trip-safety reasoning as Batch UU's `RELPOS` fix.

## [0.0.22] - Batch XX

### Added
- `PAGSEG`'s optional `(*SIZE height width)` sub-parameter now sizes its
  placeholder box for real, instead of always using the fixed 20×3
  default (reusing Batch WW's `resolveResourceBoxSize` helper). A
  `&field`-reference height/width still falls back to the fixed default
  (flagged approximate), and the expression itself is still preserved
  verbatim for round-trip — this only reads its numbers out for sizing.

## [0.0.21] - Batch WW

### Added
- `GDF` (Graphic Data File) is now modeled: parsed/built with a dedicated
  `parseGdf`/`buildGdfParams` pair, and rendered as a placeholder box on
  the page like its `OVERLAY`/`PAGSEG`/`AFPRSC` siblings. Unlike those
  three (which use a fixed placeholder size, having no access to their
  resource's real pixel dimensions), `GDF`'s box is sized exactly from its
  own mandatory `graph-depth`/`graph-width` parameters. New bespoke row in
  the properties panel to add/edit/remove it.
- `GDF` added to `PSF_ONLY_KEYWORDS` (ignored under Host Print Transform,
  matching `ZFOLD`/`STAPLE`) and to the AFPDS-typical-keyword heuristic
  used by the file-level `SKIPA`/`SKIPB`/`RELPOS` warnings.

## [0.0.20] - Batch VV

### Added
- `SKIPA`/`SKIPB`/`SPACEA`/`SPACEB` constraint validation: all four
  keywords are now flagged when specified alongside `BOX`/`ENDPAGE`/
  `GDF`/`LINE`/`OVERLAY`/`PAGSEG` (record level) or `POSITION` (any field
  in the record), or on a record format where one or more fields carry an
  explicit Location line number (columns 39-41). Cardinality is also
  checked (once at file/record level, once per field), and file-level
  `SKIPA`/`SKIPB` now requires at least one option indicator (previously
  only the `*AFPDS` file-level restriction was checked).
- `resolveLayout()` bug fix: record- and file-level `SKIPB` previously had
  zero effect on the preview (it always started at line 1 regardless).
  The preview's starting cursor line is now resolved from a record-level
  `SKIPB` first, falling back to file-level `SKIPB`, matching what's
  documented as already "rendered" in `docs/KEYWORD-INVENTORY.md`.

## [0.0.19] - Batch UU

### Added
- `RELPOS` (file-level) is now recognized as a real DDS keyword: parses
  and round-trips correctly, is registered as taking no parameters, and
  is flagged with a validation warning when present in a file that
  doesn't otherwise look like it targets `*AFPDS` (its documented
  requirement — otherwise it's silently ignored, with a warning message
  at print time).

### Investigated, no change needed
- Whether the existing `+n` relative-field-positioning math needs to be
  gated on `RELPOS`'s presence, since IBM's reference distinguishes
  "relative to the end of the previous field" (with `RELPOS`) from
  "relative to the beginning of the line" (without). Confirmed via the
  reference's own worked example that both produce the identical result
  for a monospace, DBCS-free character grid — the only kind of model
  I-RLU has — so no code change was needed here. See `docs/TASKS.md`
  Batch UU for the full analysis.

## [0.0.18] - Batch TT

### Added
- Centralized "option indicators not valid for this keyword" validation.
  13 keywords (`REF`, `INDARA`, `RELPOS`, `INDTXT`, `CCSID`, `ALIAS`,
  `REFFLD`, `MSGCON`, `DATE`, `DATFMT`, `DATSEP`, `TIMFMT`, `TIMSEP`) are
  explicitly documented as never accepting their own conditioning
  indicators, even though the field/record/constant they sit on can still
  be conditioned normally — nothing in I-RLU checked for this before now.
  A new shared `NO_INDICATOR_KEYWORDS` table and `validateKeywordIndicators()`
  function are consulted from the existing file/record/field validators, so
  the properties panel now surfaces a warning if one of these keywords is
  ever given its own attached conditioning line.

## [0.0.17] - Batch SS

### Fixed
- `PAGSIZE` and `DEVTYPE` were parsed and trusted as if they were real DDS
  keywords, at file and record level — neither exists in IBM's DDS
  reference for printer files; both are exclusively `CRTPRTF`/`CHGPRTF`/
  `OVRPRTF` command parameters and can never legally appear in DDS source.
  Page size is now a pure external assumption sourced from a new
  `i-rlu.pageSize` VS Code setting (same treatment as the existing
  `i-rlu.unitOfMeasure`), falling back to CRTPRTF's own real 66x132
  default — never read from parsed source. `DEVTYPE` is no longer trusted
  at all; AFPDS-vs-SCS detection relies solely on the existing
  AFPDS-typical-keyword heuristic. All three bundled test fixtures, which
  previously modeled an impossible DDS file, were regenerated without the
  fabricated keywords.

### Added
- `i-rlu.pageSize` setting: page size (lines columns) to assume for the
  Report Designer's preview grid and the field/constant right-edge
  boundary check, defaulting to `"66 132"` (CRTPRTF's own default). A
  matching "Page size: N x M (assumed...)" hint now appears in the
  designer toolbar, mirroring the existing unit-of-measure hint.

## [0.0.16] - Batch RR

### Fixed
- In the Font & sizing properties panel, checking `FONT` then `CCSID` and
  then unchecking `CCSID` also unchecked `FONT`. Checking a checkbox only
  revealed its inputs without saving anything until a separate "Apply"
  button was clicked, while unchecking committed immediately and forced a
  full panel rebuild — so a checked-but-never-applied keyword would
  silently revert the moment any sibling keyword's change triggered that
  rebuild. Every input in this panel now auto-commits as soon as it loses
  focus, matching how the rest of the app's keyword checkboxes already
  behave.

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

[Unreleased]: https://github.com/Manojkumar-Dharma/I-RLU/compare/v0.0.16...HEAD
[0.0.16]: https://github.com/Manojkumar-Dharma/I-RLU/compare/v0.0.15...v0.0.16
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
