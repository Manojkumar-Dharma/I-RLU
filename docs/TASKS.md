# I-RLU Task Board — for parallel sessions

This project is being built across multiple Claude sessions running in
parallel. To avoid collisions, **claim a batch before starting** (edit the
Status column below in the same commit as your first change) and keep each
batch's changes reasonably self-contained. If you're picking this up fresh,
read in this order:

1. `README.md` — project overview, current status.
2. `docs/REQUIREMENTS.md` — architecture and confirmed decisions.
3. `docs/KEYWORD-INVENTORY.md` — the full DDS keyword inventory this task
   board is scoped against, gathered from RLU's own screens + IBM's DDS
   reference.
4. This file — pick an unclaimed batch, or continue one marked
   "in progress" if you're resuming your own prior work.
5. `docs/ROADMAP.md` — tick off completed items there when you finish a batch.

**Before your first commit in a session**, set the git identity for this
repo (not global) so commits attribute correctly regardless of which
session/environment made them:

```
git config user.name "Manojkumar-dharma"
git config user.email "manojkumar.dharmalingam@gmail.com"
```


## How the codebase is organized (so batches don't collide)

| Area | File(s) | Touched by |
|---|---|---|
| Data model | `src/prtfModel.ts` | Rarely — model is already generic (keyword name + positional params). Only touch if a batch needs a genuinely new model concept (e.g. Batch B's literal-vs-P-field toggle may need a small model addition). |
| Parsing | `src/prtfParser.ts` | Same as above — rarely, unless a batch finds a real DDS construct the parser mishandles. |
| Writing | `src/prtfWriter.js` | Same. |
| Layout/rendering logic | `src/prtfEngine.js` | Most batches that add rendering (C, D, E, I). |
| Webview UI (properties panel, pickers) | `media/webviewClient.js`, `src/buildWebviewTemplate.js` | Most batches that add UI (A, B, C, F, G, H). |
| AFP font metrics | `src/afpFontMetrics.js` | Batch L only. |
| Extension host / compile command | `src/extension.ts` | Batch J for the compile-command work; Batch F added generic `setRecordKeyword`/`removeRecordKeyword` edit kinds here that A/B/G should reuse rather than adding parallel bespoke edit-kind handlers — check `applyEdit` before inventing a new one. |
| Tests | `test/` | Every batch adds its own test file(s) — don't edit another batch's test file. |

**To minimize merge conflicts across parallel sessions**, prefer adding new
functions/sections over editing shared dispatch code. If your batch needs to
add a case to a shared switch/dispatch (e.g. a keyword-name switch in the
engine or webview), add it as a narrow, additive change and say so plainly in
the commit message.

## Known limitations → task mapping

Every bullet in README.md's "Known limitations (v1)" section and
`docs/REQUIREMENTS.md` §6/§8/§9 is tracked here as either an actionable
batch (with a dependency) or an explicitly permanent constraint (not a
task — don't create one for it). Keep this mapping in sync: when a
limitation bullet in README/REQUIREMENTS changes, update the row here, and
vice versa.

| Limitation (README/REQUIREMENTS wording) | Status | Tracked as |
|---|---|---|
| Keyword-level editing missing for `EDTCDE`, `COLOR`, `LINE`/`BOX` params, etc. | Actionable | Batches **A, B, C, E, F, G** collectively (each owns a keyword subset — see Task board below) |
| LINE/BOX/BARCODE assume inches unless `i-rlu.unitOfMeasure` is set to `cm` | **Done** | Was Batch I (first half) |
| LINE/BOX params given as `&NAME` (program-to-system field) can't be resolved, shown at default position | **Permanent, by design** | Not a task — there's no static value to resolve without a live compile/run. Batch B's P-field toggle (UI for *entering* `&NAME`) explicitly preserves this flagged-default treatment rather than trying to eliminate it; see Batch B detail. |
| `BARCODE` renders as a labeled placeholder, not a real symbol | Actionable | Batch **D** (depends on **C**) |
| `BARCODE`'s mutual-exclusion rule (can't combine with `FONT`/`EDTCDE`/`EDTWRD`/`DATE`/`TIME`/`PAGNBR`/etc.) isn't validated — `CRTPRTF` still catches it, but not surfaced live in the designer | Actionable, previously untracked | New **Batch N** (depends on **C** — needs BARCODE's parameter surface to attach the check to) |
| Page segments/overlays render as nothing, not even a placeholder box | **Done** | Was Batch **E** |
| Real pixel content for page segments/overlays (actual scanned logos/forms, not a placeholder) | **Blocked**, needs external resource files supplied to the tool (§8's documented hard limit — these are IFS/host AFP objects, not DDS source text) | New **Batch O** (depends on **E** landing first as the fallback baseline; blocked the same way **L** is, on external data access) |
| AFPDS real font/graphics rendering broadly (vs. char-grid-with-keyword-labels) | **Permanent for v1, revisit only if scope changes** | Not a task on its own — the actionable slices of this are Batch **L** (font metrics) and Batch **O** (resource pixel content) above; true full-graphics AFPDS WYSIWYG beyond those two remains explicitly out of scope per REQUIREMENTS.md §6/§8. |
| Numeric edit-code/edit-word formatting is approximate-width only, no live-system verification | **Permanent, explicit non-goal** | Not a task — Batch A's detail section explicitly excludes building a full edit-code formatter, to avoid scope creep. |
| `REF`/`REFFLD` doesn't resolve real type/length/decimals from the referenced file | Part 1 done (UI shape + resolution logic); part 2 (live fetch) unverified, needs a real IBM i | Batch **H** |
| `CRTPRTF` assumes `*CURLIB/QDDSSRC`, no library/source-file/member picker | **Done** | Was Batch **J** |
| No packaging (`.vsix`) | Actionable | Batch **K** |
| Font resource access unresolved (§9) — real AFP font metrics vs. placeholder | **Mostly done** — FGID identification verified/resolved, proportional widths now use real Adobe AFM data for substitute fonts; CDEFNT/FNTCHRSET/FONTNAME resolution still blocked | Batch **L** |
| The record-format `<select>` dropdown (toolbar) only switches between record formats already present in the source — no way to add, rename, delete, or reorder a record format from the designer itself | Actionable, previously untracked (this isn't in README/REQUIREMENTS' Known-limitations lists at all — raised separately, added here for the same tracking discipline) | New **Batch P** (no dependency — the record `<select>` and `applyEdit`'s edit-kind dispatch already exist to build on) |
| The properties panel supports add/update/delete for fields and constants, but not copy/duplicate — cloning a field with its keywords intact (a common RLU/SEU-era workflow for building up repetitive detail-line layouts) requires manually re-entering every attribute and keyword on a new field | Actionable, previously untracked | New **Batch Q** (no dependency — sits directly next to the existing Delete button in `renderEditPanel`, and can reuse `addField`/`addConstant`'s edit-kind shape) |

## Task board


| Batch | Description | Keywords in scope | Status | Depends on |
|---|---|---|---|---|
| A | Properties-panel editing: general field/record keywords | `EDTCDE`, `EDTWRD`, `DATE`, `DATFMT`, `DATSEP`, `TIME`, `TIMFMT`, `TIMSEP`, `DFT`, `MSGCON`, `COLOR`, `HIGHLIGHT`, `UNDERLINE`, `PAGNBR`, `PRTQLTY`, `DRAWER`, `PAGRTT` | **Done** | none |
| B | Font/sizing keyword editing + shared P-field toggle component | `FONT`, `CDEFNT`, `FNTCHRSET`, `FONTNAME`, `CHRSIZ`, `CHRID`, `CCSID` | **Done** | none (but A and C benefit from B's P-field component if B lands first) |
| C | `BARCODE` full parameter surface (still placeholder render) | `BARCODE` | **Done** | none |
| D | `BARCODE` real symbol rendering | `BARCODE` | **Done** | **C** |
| E | AFP page-group / resource keyword placeholders | `OVERLAY` (record), `PAGSEG`, `STRPAGGRP`, `ENDPAGGRP`, `DOCIDXTAG`, `AFPRSC`, `DTASTMCMD` | **Done** | none |
| F | Print/finishing keywords, validation-only | `DUPLEX`, `FORCE`, `OUTBIN`, `ZFOLD`, `STAPLE`, `INVMMAP` | **Done** | none |
| G | Field-level data/edit keywords + indicator text | `ALIAS`, `BLKFOLD`, `CVTDTA`, `DLTEDT`, `FLTFIXDEC`, `FLTPCN`, `TRNSPY`, `TXTRTT`, `INDTXT` | **Done** | none |
| H | `REF`/`REFFLD` resolution via Code for i | `REF`, `REFFLD` | Part 1 (UI shape + pure resolution logic) **and the field/record-format picker done**; part 2 (live Code for i round-trip) written but unverified — needs a real connected IBM i | none (needs a live/mocked Code for i connection for full completion — can land the UI shape without it) |
| I | `UOM` modeling **done elsewhere** (see `i-rlu.unitOfMeasure` setting, `docs/ROADMAP.md`) + file-level SKIPA/SKIPB *AFPDS validation | `SKIPA`, `SKIPB` (validation only) | **Done** (validation landed as part of Batch F — see `prtfEngine.js`'s `validateFileLevelKeywords`) | none |
| J | Compile command: library/source-file/member picker | n/a (tooling) | **Done** | none |
| K | Packaging (`.vsix`) | n/a (tooling) | **Done** | ideally after A–I land, but can be prepped early |
| L | Real AFP font metrics | n/a (data) | Mostly done — FGID identification resolved; proportional widths now use real published Adobe AFM data (metric-compatible substitute fonts, not verified IBM FGID resource extraction); FONTNAME fully resolved (name/family/spacing offline, PLUS real per-character advance widths from real vendored substitute TrueType fonts — see "FONTNAME real advance widths" below), CDEFNT/FNTCHRSET honestly partially resolved (documented prefix + small verified table; full resolution needs a live IBM i, see REQUIREMENTS.md §9) | none |
| M | **Bug fix:** writer emits wrong continuation character when wrapping mid-token | n/a (parser/writer correctness) | **Done** | none |
| N | `BARCODE` mutual-exclusion validation | `BARCODE` (validation vs. `FONT`, `EDTCDE`, `EDTWRD`, `DATE`, `TIME`, `PAGNBR`, etc.) | **Done** | **C** |
| O | Real AFP resource rendering (actual pixel content for page segments/overlays) | `PAGSEG`, `OVERLAY` (record-level) | Blocked — needs external resource files, see REQUIREMENTS.md §8 | **E** |
| P | Add/rename/delete/reorder record formats from the designer | n/a (tooling/UI, not a keyword) | **Done** | none |
| Q | Copy/duplicate a field or constant | n/a (tooling/UI, not a keyword) | **Done** | none |
| R | **Bug fix:** `emitWithKeywords` collapses multiple consecutive internal spaces inside any quoted keyword literal | n/a (parser/writer correctness) | **Done** | none |
| S | **Bug fix:** wide record formats (e.g. 130/132-position) pushed the properties/keywords panels below the fold instead of alongside the report | n/a (webview UI/CSS, `media/webviewClient.js` + `src/buildWebviewTemplate.js`) | **Done** | none |
| T | **Bug fix:** no right-click "open designer" option for `.pf`/`.prtf`/`.rlu` files | n/a (packaging/activation, `package.json` + `src/extension.ts`) | **Done** | none |
| U | Hide Compile/Resolve/Browse-Referenced-Field UI when Code for i isn't connected + themed scrollbar on the properties column | n/a (webview UI + activation, `src/extension.ts`, `media/webviewClient.js`, `src/buildWebviewTemplate.js`, `package.json`) | **Done** | none |
| V | **Bug fix:** properties/keywords column (`.side-col`) still didn't actually scroll despite `overflow-y: auto` (Batch S) and a themed scrollbar (Batch U) — the height-constraint chain from `body` down to `.side-col` had a gap at `#root` | n/a (webview UI/CSS, `src/buildWebviewTemplate.js`) | **Done** | none |
| W | Configurable designer-open location (`i-rlu.designerOpenColumn` setting, mirroring I-SDA's `isda.designerOpenColumn`) | n/a (tooling/UI, not a keyword) | **Done** | none |
| X | Track source modifications (comment-out-and-tag changed lines instead of overwriting, mirroring I-SDA's `isda.trackSourceModifications`/`isda.modificationTag`) | n/a (writer/UI, not a keyword) | **Done** | none |
| Y | "Add fields from database file" — browse every field in a PF/LF via Code for i and add them as named fields (mirroring I-SDA's Task L14 `fetchDatabaseFileFields`), distinct from Batch H's single-field `REF`/`REFFLD` resolution | n/a (Code for i integration/UI, not a keyword) | **Done** | **H** (shared its Code-for-i-connection plumbing/UI conventions, didn't block on it) |
| Z | System-constant fields (`DATE`, `TIME`, `USER`, `SYSNAME`, `PAGNBR`) — parse as design-time placeholder text (mirroring I-SDA's `fieldDisplayText`) and add an "Add system constant" option alongside literal-text constants | `DATE`, `TIME`, `PAGNBR` (`USER`/`SYSNAME` dropped — see detail section: verified against IBM's DDS reference, neither is a valid printer-file keyword) | **Done** | none |
| AA | **Bug fix:** `regenerateSource` drops the optional column-6 form-type marker on every line, breaking Batch X's tracking | n/a (writer correctness, `src/prtfWriter.js`) | **Done** | **X** (re-verified against it as part of this batch) |
| BB | **Bug fix:** a constant's literal is only recognized when it's the first keyword-area token | n/a (parser correctness, `src/prtfParser.ts`) | **Done** | none |
| CC | **Bug fix:** conditioning indicators are only modeled per field/constant/record entry, not per KEYWORD — a real, common DDS/RLU technique (e.g. two mutually-exclusive `COLOR` keywords on one field, each conditioned on a different indicator, via an attached keyword-only continuation line) was silently misparsed as a bogus phantom constant entry, and even if it hadn't been, the writer had no way to round-trip per-keyword conditioning at all | n/a (model/parser/writer/layout correctness, not a keyword itself — affects every keyword that can appear on its own conditioned line) | **Done** | none |
| DD | Batch CC follow-up: thread indicator state through the record/file-level geometry keywords `resolveLayout` resolves once per call (`PAGSIZE`, `CPI`/`LPI`, `LINE`/`BOX`, `OVERLAY`/`PAGSEG`/`AFPRSC`, `STRPAGGRP`/`ENDPAGGRP`/`DOCIDXTAG`/`DTASTMCMD`) — Batch CC itself only reached the per-field/constant lookups | n/a (layout correctness, `src/prtfLayout.js`) | **Done** | **CC** (this is that batch's own explicitly-flagged remaining scope) |
| EE | Render `COLOR`/`DSPATR`/`UNDERLINE`/`HIGHLIGHT` visually in the design-time page preview — these are editable via the properties panel (Batch A) and now correctly conditioned per-keyword (Batch CC/DD), but the resolved value is never actually applied to the on-screen cell text at all today (no font color, no bold/reverse-image/underline styling in `media/webviewClient.js`'s cell rendering) — so toggling an indicator on a conditioned `COLOR` pair, or just setting `COLOR` at all, has no visible effect in the designer even though the model/layout resolve it correctly | `COLOR` (Named/`*RGB`, `*CMYK`/`*CIELAB` unverified — see Batch A), `DSPATR`, `UNDERLINE`, `HIGHLIGHT` | Open | none (needs `resolveLayout` to surface a resolved style per cell, then webview CSS/rendering to apply it — no model/parser/writer change expected) |
| FF | **Bug fix:** properties/keywords column rows inconsistent — checkboxes stretched to the value-input width, some rows put the checkbox before its label and others after, several rows had no row wrapper at all | n/a (webview UI/CSS, `media/webviewClient.js` + `src/buildWebviewTemplate.js`) | **Done** | none |
| GG | Field/constant overlap detection — no warning today when two fields' positions+lengths overlap, or a field extends past another, on the same line | n/a (layout correctness, not a keyword) | Open | none |
| HH | Sample/test data entry & preview — real RLU's `SD` sequence command lets a person type realistic per-field values shown in the design preview instead of a bare `{FIELDNAME}` placeholder | n/a (webview UI + model, not a keyword) | Open | none |
| II | Duplicate/clone an entire record format (all its fields/constants/keywords in one action) — Batch Q covers a single field, Batch P covers add/rename/delete/reorder of record formats, neither clones a whole one | n/a (tooling/UI, not a keyword) | **Done** | none |
| JJ | Multi-select fields for bulk move/copy/delete — real RLU's F14/F15 (Copy Fields/Move Fields) operate on several selected fields at once; today's click-to-place/drag is one-field-at-a-time only | n/a (webview UI, not a keyword) | Open | **Q** (bulk version of its single-field copy) |
| KK | Boundary shift-and-truncate (real RLU's `LT`/`RT`) — moving/resizing a field past the report's right edge has no validation at all today; a field can end up positioned off-page silently | n/a (layout correctness, not a keyword) | Open | **GG** (natural pairing — both are "is this field's position/length actually valid" checks) |
| LL | **Bug fix:** a field's `+n` relative-position notation (DDS positions 42-44) is read by `parseInt` as a plain absolute number, silently discarding the "this is relative, not absolute" semantic — round-tripping such a field relocates it to a fixed, usually-wrong absolute column | n/a (parser/model/writer correctness, `src/prtfParser.ts`/`src/prtfModel.ts`/`src/prtfWriter.js`) | Open | none |

## Batch detail

### Batch A — General properties-panel keywords [DONE]
- Field-only: `EDTCDE`, `EDTWRD`, `DATFMT`, `DATSEP`, `TIMFMT`, `TIMSEP`, `DFT`. Constant-only: `DATE`, `TIME`, `PAGNBR`, `MSGCON`. Both: `COLOR`, `HIGHLIGHT`, `UNDERLINE` — split verified against IBM's DDS reference.
- `PRTQLTY`/`DRAWER`/`PAGRTT` values verified against IBM's own reference (not RLU's screen-picklist numbering).
- New `quotedSelect` param kind for `DATSEP`/`TIMSEP` (quoted separator char or bare `*JOB`).
- `COLOR`'s `*RGB`/named forms verified; `*CMYK`/`*CIELAB` format NOT independently confirmed — plain text input, flagged in code.
- Found (logged as Batch R, not fixed here): `emitWithKeywords` collapses internal whitespace in quoted literals.
- Key files: `src/prtfEngine.js`, `media/webviewClient.js`, `test/prtfBatchA.test.ts`.

### Batch B — Font/sizing + shared P-field component [DONE]
- New shared `pFieldRow` component (literal vs. `&FIELDNAME` toggle) for every P-field-capable param across `FONT`, `CDEFNT`, `FNTCHRSET`, `FONTNAME`, `CHRID`. `CHRSIZ`/`CCSID` are plain numeric (not P-field-capable per KEYWORD-INVENTORY).
- Available at both record and field level; new `setFieldKeyword`/`removeFieldKeyword` edit kind in `src/extension.ts` (field-level counterpart to Batch F's record-level one).
- New `validateFontKeywords`: flags `HIGHLIGHT`/`CHRID` when `CDEFNT`/`FNTCHRSET` also coded (mutually exclusive per IBM); `CHRSIZ` gets an "IPDS-only" hint.
- Key files: `media/webviewClient.js` (`pFieldRow`), `src/extension.ts`, `src/prtfEngine.js` (`validateFontKeywords`), `test/prtfBatchB.test.ts` (15 tests).

### Batch C — BARCODE parameter surface [DONE]
- New module `src/prtfBarcodeParams.js`: full structured parse/build (`parseBarcodeParams`/`buildBarcodeParams`) + range-hint validator (`validateBarcodeParams`), exposing every RLU-screen BARCODE parameter (barcode-ID, height, bar format, HRI position, asterisk-on-CODE3OF9, modifier, narrow-bar width, wide:narrow ratio, 2D params).
- Fixed a real engine gap: `parseBarcodeGeometry` used to collapse `*HRI`/`*HRITOP` to one boolean; now tracks the three-way below/above/none value via `hriPosition`.
- New quote-aware tokenizer `groupTokens` (some BARCODE params are themselves parenthesized/nested).
- Unmodeled params (`*SWIDTH`, the four 2D symbologies' own sub-grammars) preserved verbatim via `unrecognizedRaw`/`extra2D`, not dropped.
- Properties panel: bespoke `renderBarcodeSection` (fields + constants), applied via existing `setFieldKeyword`/`removeFieldKeyword`.
- Key files: `src/prtfBarcodeParams.js`, `src/prtfLayout.js` (`parseBarcodeGeometry` delegation), `media/webviewClient.js`, `test/prtfBatchC.test.ts`.

### Batch D — BARCODE real rendering [DONE]
- Real rendered symbols (vendored JsBarcode) replacing the placeholder box, reading Batch C's parameter surface. Depends on Batch C.
- Key files: `test/prtfBatchD.test.ts` (pure-logic + jsdom-backed SVG-rendering integration test; `jsdom` added as a devDependency for this one file).

### Batch E — AFP page-group / resource placeholders [DONE]
- Positioned (placeholder box, `layout.resources`): `OVERLAY`, `PAGSEG`, `AFPRSC`. Non-positioned (badge list, `layout.pageGroupKeywords`): `STRPAGGRP`, `ENDPAGGRP`, `DOCIDXTAG`, `DTASTMCMD`.
- New module `src/prtfPageGroupKeywords.js` (parse/build pair per keyword, same shape as Batch C's). Reuses Batch C's quote-aware `groupTokens` (a first draft used plain `paramTokens` and broke on `DOCIDXTAG`'s quoted values with internal spaces).
- Unmodeled trailing params (`(*ROTATION n)`, `AFPRSC`'s params past the first four) preserved via a free-text `extra` field.
- `prtfLayout.js` adds `resolveResourcePlaceholders`/`collectPageGroupMetadata`, wired into `resolveLayout`.
- Properties panel: `renderPageGroupPanel`, applied via existing `setRecordKeyword`/`removeRecordKeyword`.
- Known simplification: editing only reaches the first occurrence of a given keyword name per record (rendering still handles multiple).
- Key files: `src/prtfPageGroupKeywords.js`, `src/prtfLayout.js`, `media/webviewClient.js`, `test/prtfBatchE.test.ts` (17 tests).

### Batch F — Print/finishing keywords (validation only) [DONE]
- `DUPLEX`, `FORCE`, `OUTBIN`, `ZFOLD`, `STAPLE`, `INVMMAP` — add/edit/remove via properties panel + validation hints only (no layout effect). `ZFOLD`/`STAPLE` flagged PSF-only.
- New `validateRecordKeywords`/`validateFileLevelKeywords` (the latter covers `*AFPDS` `SKIPA`/`SKIPB`, folded in from Batch I) in `src/prtfEngine.js` — validation-only, `CRTPRTF` remains the real enforcement point.
- New generic edit kinds `setRecordKeyword`/`removeRecordKeyword` in `extension.ts` — reused by later batches (A, B, G, ...).
- Key files: `src/prtfEngine.js`, `src/extension.ts`, `media/webviewClient.js` (`renderRecordKeywordsPanel`), `test/prtfBatchF.test.ts`.

### Batch G — Field-level data/edit keywords + indicator text [DONE]
- `ALIAS`, `BLKFOLD`, `CVTDTA`, `DLTEDT`, `FLTFIXDEC`, `FLTPCN`, `TRNSPY`, `TXTRTT` — simple enumerated/numeric properties-panel fields + `validateFieldKeywords` applicability warnings.
- `INDTXT` (indicator-number → free text) built from scratch (I-SDA had no direct equivalent to port) — `parseIndtxt`/`collectIndicatorDescriptions` merge file/record/field-level occurrences, most-specific-wins; indicator toggle panel now shows each indicator's INDTXT description.
- New edit kinds: `setFieldKeyword`/`removeFieldKeyword` (generic), `setIndicatorText`/`removeIndicatorText` in `src/extension.ts`.
- Not done: file-/field-level INDTXT are read but not editable (record-level only).
- Key files: `src/prtfEngine.js`, `src/extension.ts`, `media/webviewClient.js`, `test/prtfFieldEditKeywords.test.ts` (14 tests).

### Batch H — REF/REFFLD resolution [PART 1 + PICKER DONE; PART 2 WRITTEN, UNVERIFIED]
- Part 1 (UI shape, no Code for i needed) — done: `resolveReferenceTarget` (`src/prtfEngine.js`) works out field/library/file precedence (REFFLD overrides record-then-file `REF`; `*SRC`/no-reference both correctly unresolvable); `upsertReffldKeyword` (`src/prtfWriter.js`) builds/updates/removes `REFFLD`; properties panel gets the "Reference a field" toggle + inputs + "Use referenced values" toggle.
- Part 2 (live resolution via Code for i) — written, unverified against a real IBM i: `fetchReferencedFieldAttributes`/`handleResolveReferencedField` (`src/extension.ts`), DSPFFD-to-outfile + SQL read, same pattern as I-SDA and this project's own `CRTPRTF` compile command.
- Field/library/record-format/field picker — done: `fetchDatabaseFileFields` (ports I-SDA's own function), `groupDatabaseFileFieldRows` (`src/prtfReferenceField.js`, pure/testable), new "Browse fields… (Code for i)" button + `browseReferencedField` message kind. Library/file are still typed manually; browsing libraries/files themselves not attempted (no established pattern, I-SDA doesn't either).
- Key files: `src/prtfEngine.js`, `src/prtfWriter.js`, `src/extension.ts`, `src/prtfReferenceField.js`, `media/webviewClient.js`, `test/prtfReferenceField.test.ts`.

### Batch I — UOM modeling + AFPDS SKIPA/SKIPB file-level validation
- UOM half already landed separately (`i-rlu.unitOfMeasure` setting). SKIPA/SKIPB-at-file-level-with-`*AFPDS` validation landed as part of Batch F's `validateFileLevelKeywords`.
- Key files: `src/prtfEngine.js`.

### Batch J — Compile command polish [DONE]
- Added library/source-file/member picker for `CRTPRTF` (was hardcoded `*CURLIB/QDDSSRC`). `member:` URIs parsed directly (no prompt needed); local files prompted once and cached (`context.workspaceState`); new `i-rlu.setCompileTarget` command to change a cached target.
- Found and fixed 3 real compile-breaking bugs: `codeForI.exports.runCommand(...)` was never a valid call (fixed via `getCodeForIConnection` porting I-SDA's `getConnectedCodeForIBMi()` pattern); `&CURLIB` embedded literally in command text was a CL variable reference with no meaning there (fixed: `*CURLIB`); `REPLACE` was never specified, and CRTPRTF defaults to `REPLACE(*NO)` (fixed: explicit `REPLACE(*YES)`).
- `FILE`'s library default (`*CURLIB`) and `SRCFILE`'s (`*LIBL`) are NOT the same — `buildCrtprtfCommand` applies each correctly. `streamfile:` (IFS) sources get an explicit error (CRTPRTF has no `SRCSTMF`-equivalent parameter).
- New pure module `src/prtfCompileTarget.ts` (no `vscode` import) holds URI parsing/name derivation/`buildCrtprtfCommand`.
- Follow-up consolidation: `fetchReferencedFieldAttributes`/`fetchDatabaseFileFields` (Batch H) each had their own inline connection-lookup copy — both now call the shared `getCodeForIConnection()`.
- Key files: `src/extension.ts`, `src/prtfCompileTarget.ts`, `test/prtfCompileTarget.test.ts` (14 tests).

### Batch K — Packaging [DONE]
- `vsce package` producing a real `.vsix`. Added `.vscodeignore`, `@vscode/vsce` devDependency, `vscode:prepublish`/`package` npm scripts.
- Found and fixed a real activation-breaking bug: `package.json`'s `"main"` pointed at `./out/extension.js`, but `tsconfig.json`'s `rootDir` means it actually compiles to `./out/src/extension.js` — a packaged build would have failed to activate at all.
- `LICENSE` (MIT) and `images/icon.png` copied from the I-SDA repo (same publisher) at the repo owner's direction.
- Key files: `package.json`, `.vscodeignore`.

### Batch L — Real AFP font metrics [DONE]
- `FGID` (`FONT` keyword): `src/afpFontMetrics.js` resolves against a table verified against IBM's own FGID/typeface docs — Courier/Gothic fixed families, Helvetica/Times New Roman proportional families, OCR A/B, point-size-to-CPI conversion. Correction: FGID 416 is Courier Roman Medium, not "Times Roman" as an earlier reference had it (regression test guards this — real Times New Roman Medium is FGID 2308).
- Proportional-font advance widths use real published Adobe AFM data for metric-compatible PostScript substitutes (Helvetica, Times-Roman family) — real data, but a substitute's, not verified IBM FGID resource extraction.
- `FONTNAME` — fully resolved offline (its value already IS the real TrueType/OpenType name, per IBM's own docs). `CDEFNT`/`FNTCHRSET` — `X0`/`XZ`/`C0`/`CZ` raster-vs-outline prefix decoded + a small verified example table (`X0GT10`, `X0SHAD`); beyond that, honestly unresolved (IBM's own docs: no universal decode table, use `WRKFNTRSC`).
- New `src/afpCodedFontMetrics.js`: `resolveFontName`/`resolveCodedFont`/`resolveFontCharacterSet`, each returning a `resolutionNote` for anything still unknown.
- `src/prtfLayout.js`'s `resolveFont` rewritten to check all four font-selection keywords together at each level (field/record/file), not just `FONT` alone.
- Found and fixed: `FONTNAME`'s DDS-quoted value (can contain spaces, e.g. 'Courier New') was being mangled by a plain whitespace-split tokenizer in `prtfWebviewLogic.js` — fixed via `groupTokens`.
- **Follow-up — FONTNAME real advance widths:** new `src/afpTrueTypeMetrics.js`, a from-scratch sfnt (TrueType/OpenType) binary parser (table directory, `head`/`hhea`/`hmtx`/`cmap`), verified against `fontTools` across the full ASCII range on 3 real fonts — zero mismatches. Three real, SIL OFL 1.1-licensed fonts (Cousine/Tinos/PT Sans, from `google/fonts`) vendored at `resources/fonts/` (shipped runtime location, confirmed in `vsce ls`). `afpCodedFontMetrics.js` gained `getAdvanceWidth(name, ch)`, mapping a known `FONTNAME` bucket to a lazily-parsed substitute font's real widths. `resolveFontName`'s `isPlaceholderMetrics` flipped to `true` for known names (real substitute data now attached, honestly flagged).
- Key files: `src/afpFontMetrics.js`, `src/afpCodedFontMetrics.js`, `src/afpTrueTypeMetrics.js`, `src/prtfLayout.js`, `resources/fonts/`, `test/afpCodedFontMetrics.test.ts`, `test/afpTrueTypeMetrics.test.ts`, `test/prtfFontResolution.test.ts`.

### Batch M — Fix writer's continuation-character bug [DONE]
- Found by `test/prtfFixtures.test.ts`'s round-trip test against `sample-afpds.pf`. `emitWithKeywords` always emitted `+` continuation when wrapping keyword text — correct only for a split inside one token, but the wrapping loop only ever moves whole tokens, so `-` (implied space) was the only correct choice. `PAGSEG(COMPLOGO 0.5 0.5)` wrapped with `+` reparsed as `PAGSEG(COMPLOGO0.5 0.5)` — silent corruption.
- Fixed: `emitWithKeywords` now always emits `-`. Regenerated all three `.pf` fixtures.
- Known, separate, unfixed limitation: a single keyword token exceeding the 34-column keyword width gets silently truncated (no token boundary to wrap at, different bug).
- Key files: `src/prtfWriter.js`, `test/prtfWriter.test.ts`.

### Batch N — BARCODE mutual-exclusion validation [DONE]
- Confirmed the exact excluded-keyword list against IBM's DDS reference: `CHRSIZ`, `CHRID`, `CVTDTA`, `DATE`, `EDTCDE`, `EDTWRD`, `FONT`, `HIGHLIGHT`, `PAGNBR`, `TIME`, `UNDERLINE` — README's own list was missing several of these.
- New `BARCODE_EXCLUDED_KEYWORDS`/`validateBarcodeExclusions(keywords)` in `src/prtfBarcodeParams.js` (not the generic `validateFieldKeywords`, since it needs to work identically for constants too). Hint rendered in `renderBarcodeSection` (BARCODE's own form), not the conflicting keyword's panel.
- Key files: `src/prtfBarcodeParams.js`, `media/webviewClient.js`, `test/prtfBatchN.test.ts` (17 tests).

### Batch O — Real AFP resource rendering (page segments/overlays as actual images)
- Blocked, same shape as Batch L: page segments/overlays are external AFP resource objects (IOCA images / small AFP data streams) living on the IBM i's IFS/host, not in DDS source text — needs real (or realistic sample) resource files supplied to the tool before this can start. Depends on Batch E (upgrades its placeholder-box treatment, doesn't replace it wholesale).
- Confirm resource access hasn't already been resolved before assuming still blocked.

### Batch P — Add/rename/delete/reorder record formats from the designer [DONE]
- Four new `WebviewEdit` kinds (`src/webviewProtocol.ts`): `addRecord`, `renameRecord`, `deleteRecord`, `reorderRecord`, identified by record name. Model mutations in `src/prtfEdits.ts`'s `applyEditToModel`.
- `addRecord` inserts immediately after the currently-selected record (falls back to end-of-file). `renameRecord`: confirmed via IBM's DDS reference that REF/REFFLD never reference a record format's own name, so no dangling-reference fixup was needed (regression test added). `deleteRecord` removes from both `model.records` and `model.sequence`. `reorderRecord` swaps contiguous record "blocks"; trailing comments sweep with the earlier record.
- `STRPAGGRP`/`ENDPAGGRP` pairing: flagged (not protected against) via new `validatePageGroupOrder` in `src/prtfPageGroupKeywords.js`.
- UI: "+ Record"/"Rename"/"Delete" (inline forms, no native `prompt()`/`confirm()`) + ▲/▼ reorder buttons next to the record `<select>`.
- Key files: `src/webviewProtocol.ts`, `src/prtfEdits.ts`, `src/prtfPageGroupKeywords.js`, `media/webviewClient.js`, `test/prtfBatchP.test.ts` (25 tests).

### Batch Q — Copy/duplicate a field or constant [DONE]
- "Copy" button next to "Delete" in the properties panel — arms the existing click-to-place flow (`state.copySource`), pre-filling `state.pendingNew` with the source's attributes/keywords rather than mutating the model immediately.
- `addField`/`addConstant` gained an optional `sourceKeywords` field (name/params pairs) rather than a new `copyField`/`copyConstant` edit kind — minimally invasive to the existing payload shape.
- `suggestCopyName` appends the lowest available numeric suffix, scoped to the current record only (cross-record copy flagged as a v2 stretch goal, not built).
- Pure logic (`suggestCopyName`/`buildCopyPendingNew`) lives in `src/prtfWebviewLogic.js`, DOM-free.
- Key files: `src/prtfEdits.ts`, `src/prtfWebviewLogic.js`, `media/webviewClient.js`, `test/prtfBatchQ.test.ts` (16 tests).

### Batch R — Fix emitWithKeywords collapsing internal whitespace in quoted literals [DONE]
- Found by a Batch A round-trip test for `EDTWRD('  .  ')` — came back as `EDTWRD(' . ')`, one run of double spaces collapsed. `emitWithKeywords` tokenized with `keywordText.trim().split(/\s+/)`, no quote-awareness, so multi-space content inside any quoted literal got collapsed on regenerate.
- Fixed: new quote-aware `tokenizeKeywordText(text)` in `src/prtfWriter.js` — walks char-by-char, keeps an entire `'...'` span (respecting doubled-`''` escaping) as one token. `emitWithKeywords` now calls this instead of the plain split.
- Same known, separate, unfixed limitation as Batch M: a single quoted literal longer than ~34 columns still gets truncated, not wrapped.
- Key files: `src/prtfWriter.js`, `test/prtfWriter.test.ts` (10 new tests), `test/prtfBatchA.test.ts` (updated in place).

### Batch S — Fix wide-record-format panel layout [DONE]
- A wide record format (e.g. `PAGSIZE(66 132)`) grew the whole page taller than the viewport via browser page-level scroll, shoving properties panels below the fold. Fixed by splitting into two independently-scrollable columns (modeled on I-SDA's own three-column shell): `.canvas-col` (report preview) + `.side-col` (all properties/keywords panels), under a height-pinned `html, body { height: 100vh; overflow: hidden }`.
- `.main` gained `width: max-content` so `.canvas-col`'s horizontal scroll actually triggers instead of the report clipping.
- Verified via a standalone jsdom smoke check against the assembled webview script (no existing DOM-structure test depended on `render()`'s tree shape).
- Key files: `media/webviewClient.js`, `src/buildWebviewTemplate.js`.

### Batch T — Fix missing right-click "open designer" for .prtf files [DONE]
- Two compounding gaps: `package.json` had no `contributes.menus` entry at all for `i-rlu.openDesigner` (Command Palette only); the handler also ignored any passed-in URI, only ever reading `activeTextEditor` — so it would've done nothing on an unfocused file even after adding a menu entry.
- Fixed: added `explorer/context`/`editor/title/context`/`editor/title` menu contributions; handler now uses the passed-in URI when present, falling back to the active editor.
- Ruled out `activationEvents: []` as a cause — implicit activation from `contributes` applies automatically since VS Code 1.74.
- No automated test coverage (no `vscode`-module mock in this project); verified manually in a real Extension Development Host.
- Key files: `package.json`, `src/extension.ts`.

### Batch U — Hide Code-for-i-dependent UI when disconnected + themed scrollbar [DONE]
- New `getCodeForIStatus()` (`src/extension.ts`) returns `{installed, connected}`. Webview gets a connection badge (toolbar) + Browse/Resolve Referenced Field buttons only render when connected (otherwise a hint). Pushed on `ready`, after Code-for-i actions, on a 10s poll, and on `vscode.extensions.onDidChange`.
- `i-rlu.compilePrtf` (Command Palette only, no webview button) hidden via new global `i-rlu.codeForIConnected` context key (`watchCodeForIConnectedContext`).
- Themed scrollbar added to `.side-col` (turned out not to actually fix the real bug — see Batch V).
- No automated test coverage (no `vscode` mock in this project); verified manually.
- Key files: `src/extension.ts`, `media/webviewClient.js`, `src/buildWebviewTemplate.js`, `package.json`.

### Batch V — Bug fix: `.side-col` still didn't scroll ([DONE])
- Root cause: `#root` (the div `render()` rebuilds into, `body`'s only child) had no CSS rule at all — defaulted to sizing to content, so it was never actually bounded, and `.side-col`'s own `overflow-y: auto` never had a chance to engage. Batch S/U's fixes were CSS-correct but never verified against a real rendered webview.
- Fixed: `#root { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }` in `src/buildWebviewTemplate.js`.
- No real-browser verification possible in this sandbox (no headless browser available) — `test/webviewLayout.test.ts` locks in the CSS rules the fix depends on (a string check, not a real layout assertion). **Still needs verification in a real Extension Development Host.**
- Key files: `src/buildWebviewTemplate.js`, `test/webviewLayout.test.ts` (2 tests).

### Batch W — Configurable designer-open location ([DONE])
- New `i-rlu.designerOpenColumn` setting (`active`/`beside`/`newWindow`), mirroring I-SDA's equivalent. New `src/designerOpenMode.ts` (pure, unit-testable `normalizeDesignerOpenMode`). `openInDesigner()` in `extension.ts` maps the setting to a `ViewColumn` and (for `newWindow`) an additional `moveEditorToNewWindow` call.
- Deliberately not done: applying the setting to the `customEditors` selector path (double-click/"Reopen Editor With...") — I-SDA doesn't either, no public API for it.
- No automated coverage for the `vscode`-API-calling parts (same gap as Batches T/U/V) — **please verify all three enum values in a real Extension Development Host.**
- Key files: `package.json`, `src/designerOpenMode.ts`, `src/extension.ts`, `test/designerOpenMode.test.ts` (4 tests).

### Batch X — Track source modifications [DONE]
- Mirrors I-SDA's `trackSourceModifications`/`modificationTag`. New settings `i-rlu.trackSourceModifications`/`i-rlu.modificationTag` (session-only starting values; toolbar toggle never writes back).
- `src/prtfWriter.js` gained `commentOutLine`/`buildModTag`/`appendModTag`/`applyModificationTracking`, ported from I-SDA (including its Task L52 fix: comment out all old lines first, then append all new lines, never interleaved).
- `src/extension.ts`'s new `applyTrackedDocumentEdit` replaces three separate inline "regenerate → WorkspaceEdit" blocks with one shared choke point — every document-writing path gets tracking for free.
- Verified explicitly: a multi-line (continuation-wrapped) constant edit end-to-end — old lines commented, new lines tagged and kept adjacent, reparses correctly.
- Key files: `src/prtfWriter.js`, `src/extension.ts`, `src/webviewProtocol.ts`, `media/webviewClient.js`, `test/prtfWriter.test.ts` (12 new tests).

### Batch Y — Add fields from database file [DONE]
- Mirrors I-SDA's Task L14 scope only (browse → multi-select → stack as new fields), not its later L53 click-to-place refinement. Reuses Batch H's `fetchDatabaseFileFields` unchanged.
- `addField` edit kind gained optional `reference?: boolean` (position 29 'R' flag settable at creation, not just via `updateField`). New pure `nextAvailableFieldName(record, desiredName)` in `src/prtfEdits.ts` for de-duplication (checks the base name is free first, unlike I-SDA's own version which always appends a suffix).
- New `handleAddFieldsFromDatabase` in `src/extension.ts`: prompts library/file, fetches field list, multi-select QuickPick, each picked field added via `addField` (`reference: true` + a `REFFLD` `sourceKeywords` entry) against the same in-memory model, one `WorkspaceEdit` for the whole batch.
- New "+ Fields from DB…" toolbar button, hidden when disconnected (same treatment as Batch H's Browse/Resolve buttons).
- **Follow-up consolidation:** `handleBrowseReferencedField` (Batch H) and `handleAddFieldsFromDatabase` had duplicate "fetch → disambiguate → re-fetch → QuickPick" logic — extracted into shared `pickDatabaseFileFields(library, file, {canPickMany})`.
- Key files: `src/webviewProtocol.ts`, `src/prtfEdits.ts`, `src/extension.ts`, `media/webviewClient.js`, `test/prtfEdits.test.ts` (5 tests).

### Batch Z — System-constant fields [DONE]
- `USER`/`SYSNAME` verified against IBM's DDS Reference and found to not be valid printer-file keywords (display-file only) — dropped from scope, documented. `DATE`/`TIME`/`PAGNBR` placeholders implemented (`resolveConstantPlaceholder`), wired into display text/length. "Add system constant" UI added via optional `systemConstantKeyword` on `addConstant` (not a new edit kind).
- Found and fixed: `updateConstant`/`addConstant` wrote `literal: ""` for an empty Text field instead of `undefined` — would've regenerated a spurious `''` literal next to a system-constant's keyword.
- Key files: `src/prtfLayout.js`, `test/prtfBatchZ.test.ts` (7 tests). Full writeup: `docs/ROADMAP.md`, `docs/REQUIREMENTS.md` §10.

### Batch AA — Bug fix: `regenerateSource` drops the optional column-6 form-type marker on every line, breaking Batch X's tracking [DONE]
- Found reviewing real-world samples (`SCSPRT1.prtf`, `AFPPRT1.prtf`) using the common `A`-in-column-6 documentation convention.
- Root cause: `buildPositional`/the comment case in `regenerateSource` hardcoded column 6 to blank. Since `regenerateSource` rebuilds every line on every call, this blanked column 6 file-wide on any single edit — confirmed via repro: one `COLOR` keyword added to `SCSPRT1.prtf`, then run through Batch X's tracking, flagged **67 of 93 lines** as changed.
- Fixed: `BaseEntry` gained optional `formType?: string` (the raw column-6 char, captured by the parser at each entry-creation point). File-level entries capture it from only the first contributing line (several file-level lines merge into one entry). `buildPositional`/`emitWithKeywords` now emit it back, including on continuation lines. Freshly-added entries default to blank.
- Found and logged separately (not fixed here): the same real-file testing surfaced DDS's `+n` relative-position notation being silently absolutized — see Batch LL.
- Key files: `src/prtfModel.ts`, `src/prtfParser.ts`, `src/prtfWriter.js`, `test/prtfBatchAA.test.ts` (8 tests, including two end-to-end tests against real-world fixture files copied into `test/fixtures/`).

### Batch BB — Bug fix: a constant's literal is only recognized when it's the first keyword-area token [DONE]
- Found in the same real-world sample review as Batch AA — `SCSPRT1.prtf` has `SPACEB(1) 'CUSTOMER MASTER LISTING'` (a keyword before the literal), which is legal DDS.
- Root cause: `prtfParser.ts`'s literal-extraction regex (`/^\s*'((?:[^']|'')*)'/`) is anchored at the start of the keyword-area text — when a keyword comes first, it never matches, so `constant.literal` stays `undefined` and the text falls through as an ordinary keyword token.
- Not a source-corruption bug (round-trips fine) — a model-fidelity bug: the Properties panel reads `entry.literal` for the "Text" field, so it'd show blank for a constant with real display text, risking an unintentional wipe on save.
- Fixed: the constant branch now tokenizes the whole keyword-area text with the existing paren/quote-aware `splitKeywords` (already recognized a bare quoted literal as a `name: ""` token; the bug was the old anchored-regex approach never being replaced for this call site) and takes the first such token as `constant.literal`.
- One correction found while testing: regenerate is NOT byte-identical for the keyword-before-literal case specifically — `prtfWriter.js`'s constant case has always emitted the literal first (matching this codebase's own existing fixtures), so a keyword-before-literal source now normalizes to literal-first on regenerate. This is model-fidelity-correct (no data lost) but not byte-order-preserving for this one input shape; tests assert round-trip correctness (same literal + keyword set) rather than byte-identical text for this specific case. The common leading-literal case is unaffected.
- Key files: `src/prtfParser.ts`, `test/prtfParser.test.ts` (4 new tests).

### Batch CC — Per-keyword conditioning indicators [DONE]
- The gap: real DDS conditioning is per physical line, not just per field/constant/record — a separate attached line can carry one or more further keywords with their own independent conditioning (e.g. two mutually-exclusive `COLOR`s, one under indicator 05, the other under `N05`). `Keyword` had no `conditions` field; the parser misclassified an attached line as a bogus new constant.
- `prtfModel.ts`: `Keyword` gained optional `conditions`, independent of its owning entry's own. `prtfParser.ts`: a blank-name line with no positional columns and something to attach to is now merged into the preceding entry's keywords instead of becoming a phantom `ConstantEntry`.
- `prtfWriter.js`: new `groupKeywordsByConditions`/`emitEntryWithConditionedKeywords` — replaces the old flatten-everything-onto-one-line emission across all of `regenerateSource`'s cases.
- `prtfLayout.js`: new `activeKeywords`/`findActiveKeyword`/`findAllActiveKeywords`, applied to constant placeholders, SKIPB/SPACEB/SKIPA/SPACEA/BARCODE, and the font cascade — so toggling an indicator correctly switches a conditionally-attached keyword's effect.
- Deliberately not done: page-level geometry (`PAGSIZE`, `LINE`/`BOX`, `OVERLAY`/page-group keywords) doesn't thread `indicatorState` through yet — flagged as a follow-up. Separately, unrelated: `COLOR`/`DSPATR` still aren't rendered visually in the preview at all.
- Key files: `src/prtfModel.ts`, `src/prtfParser.ts`, `src/prtfWriter.js`, `src/prtfLayout.js`, `test/prtfConditionedKeywords.test.ts` (11 tests). Verified byte-identical round-trip against all three real fixture files.

### Batch DD — Batch CC follow-up: geometry keyword conditioning [DONE]
- Threads `indicatorState` through the record/file-level keyword lookups `resolveLayout` resolves once per call: `resolvePageSize`, `resolveCpiLpi`, `LINE`/`BOX`, `resolveResourcePlaceholders`, `collectPageGroupMetadata` — now use `findActiveKeyword`/`findAllActiveKeywords` instead of the condition-blind `findKeyword`/`findAllKeywords`.
- Found and fixed a real bug in Batch CC's own fix: `isAttachedKeywordLine` only ever attached to the most recent field/constant, never to the record format itself (a conditioned keyword-only line right after `R RECORDNAME`, before any field). Fixed by widening owner resolution to fall back to the record when it has no fields yet.
- Found and fixed a second gap: file-level keyword lines had their own conditioning parsed then discarded rather than attached.
- Found and fixed a real behavioral bug: `findActiveKeyword` used first-match-wins, which is wrong for "unconditioned default + conditioned override of the same keyword" (the override would never take effect) — changed to last-active-match-wins.
- Key files: `src/prtfParser.ts`, `src/prtfLayout.js`, `test/prtfConditionedKeywords.test.ts` (8 new tests). Verified byte-identical round-trip against all three real fixture files.

### Batch EE — Render COLOR/DSPATR/UNDERLINE/HIGHLIGHT visually [OPEN]
- The gap: `COLOR`/`DSPATR`/`UNDERLINE`/`HIGHLIGHT` are editable (Batch A) and correctly resolved per-keyword-conditioning (Batch CC/DD), but nothing applies the resolved value to rendered cell text — confirmed no rendering code touches these keywords at all today.
- What to do: `resolveLayout` should resolve a per-cell style object (same pattern as `resolveFont`/`resolveFontDisplay`), cascading record→file level. Map `COLOR`'s named-color set to CSS directly (`*RGB`/`*CMYK`/`*CIELAB` stay approximate per Batch A's own caveat). Map `DSPATR`'s `HI`/`RI`/`BL`/`ND`/`PC`/`UL` to CSS equivalents — confirm against IBM's DDS reference how `UL` and the standalone `UNDERLINE` keyword compose if both appear. `media/webviewClient.js`'s `renderPage` applies the resolved style to each cell's text node.
- No model/parser/writer change expected — pure "resolve + render," same shape as Batch L (continued)'s FONT work.

### Batch FF — Bug fix: properties-panel row layout consistency [DONE]
- Reported: checkboxes and text boxes improperly placed/uneven. Found 5 bugs, all via the shared `.prop-row` rule set:
  1. Checkboxes stretched to 140px wide (width rule had no `:not([type="checkbox"])` exclusion) — fixed with an exclusion + `width: auto`.
  2. Label columns didn't line up row-to-row (no fixed width) — fixed with shared `flex: 0 0 104px` on `.ind-label`/new `.prop-label`/`.pfield-label`; `labeledInput`/`labeledSelect` needed their bare text nodes wrapped in an actual `<span>` first.
  3. Multi-input rows overflowed (fixed 140px per input, no space-splitting) — changed to `flex: 1 1 70px`.
  4. Structural, not CSS: 3 standalone toggles built `[text, checkbox]` instead of the `.ind-label` convention's `[checkbox, text]` — restructured.
  5. Structural: 4 Batch E rows (`appendOverlayRow`/`appendPagsegRow`/`appendAfprscRow`/`appendDocidxtagRow`) had no `.prop-row` wrapper at all — fixed.
- No real-browser verification possible in this sandbox — **please verify in a real Extension Development Host.**
- Key files: `src/buildWebviewTemplate.js`, `media/webviewClient.js`, `test/webviewLayout.test.ts` (4 new tests).

### Batch GG — Field/constant overlap detection [OPEN]
- No overlap/collision logic exists today in `src/prtfLayout.js`/`src/prtfKeywordValidation.js` — two fields can occupy the same cells with zero warning.
- Reference: I-SDA's `dspfEngine.js` `resolveScreen` ("Position-sequence overlap resolution") sorts by (line, column), first field to claim a cell wins, later overlapping fields dropped from the resolved render (not the model) and recorded in a separate `overlaps` array for a UI warning banner.
- What to do: confirm real printer-file DDS behavior first (sequential top-to-bottom write, not an interactive screen redraw — verify against IBM's DDS reference rather than assuming display-file behavior transfers) before deciding drop-vs-warn-only. Add the resolution pass to `resolveLayout`, surface `overlaps`, add a warning banner.
- Test: two fields at identical/overlapping position, assert resolved behavior + `overlaps` reports both.

### Batch HH — Sample/test data entry & preview [OPEN]
- Real RLU's `SD` sequence command lets a person type realistic per-field values shown in the preview instead of `{FIELDNAME}`. No I-SDA equivalent (display-file has no analogous "prototype run" concept) — treat IBM RLU docs as the primary spec.
- What to do: optional per-field sample-value string on `FieldEntry` (`src/prtfModel.ts`) — design-time-only, not a DDS keyword. Check whether real RLU persists this across sessions (determines whether it needs writer support or can stay transient webview state) before choosing. New "Sample data" input in the properties panel; use it in place of `{FIELDNAME}` when present, respecting length/decimal formatting.
- Verification: unit tests for sample-data formatting; no writer/round-trip test needed if kept out of DDS source entirely.

### Batch II — Duplicate/clone an entire record format [DONE]
- Batch Q copies a single field; Batch P manages whole record formats but didn't clone one wholesale.
- Reference: I-SDA's `dspfWriter.js` `copyRecord` — simpler than Batch Q's per-field copy since DDS scopes field names per-record, so a copied record's fields keep their exact names with no collision risk; only the record's own name needs a fresh one.
- Correction found while implementing: no "reuse Batch P/Q's existing naming-collision helper" actually existed for record names — Batch Y's `nextAvailableFieldName` is scoped to one record's own fields, not file-wide record names. Added a new sibling, `nextAvailableRecordName` (`prtfEdits.ts`), same 10-char DDS name-limit and "already-free base name wins outright" behavior.
- Implemented: `duplicateRecord` `WebviewEdit` kind + `applyEditToModel` case — deep-clones the source record's conditions/keywords and every field/constant (names/lengths/types/positions/literals/keywords all byte-for-byte verbatim; only ids and the record's own name are fresh, via new `makeIdGenerator`). Inserted right after the source record in both `model.records`/`model.sequence`; the source's own trailing comment stays attached to the source rather than being swept into the duplicate.
- Documented consequence, not silently assumed: duplicating the same record twice in a row lands the second duplicate ahead of the first (e.g. `DETAIL3` before `DETAIL2`), since each insert lands right after the SOURCE, not after the most recent duplicate.
- UI: "Duplicate" toolbar button next to Delete — posts the edit directly, no confirmation/inline form (nothing to fill in). No `extension.ts` change needed (generic edit dispatch).
- Key files: `src/webviewProtocol.ts`, `src/prtfEdits.ts`, `media/webviewClient.js`, `test/prtfBatchII.test.ts` (10 tests: byte-for-byte cloning, fresh/distinct ids, deep-clone-not-shared-reference, placement + trailing-comment attachment, naming collision, empty-record duplicate, `nextAvailableRecordName` unit tests). Full suite 420/420. **Please verify the "Duplicate" button in a real Extension Development Host** (no headless browser in this sandbox).

**[DONE] — Implemented as follows:**
- **Correction to the task's own "reuse Batch P/Q's own non-colliding-name
  helper" instruction, found while implementing:** no such helper actually
  existed for RECORD names — Batch Y's `nextAvailableFieldName`
  (`prtfEdits.ts`) is scoped to one record's own FIELDS, and Batch P's
  `addRecord` only ever rejects a duplicate record name outright (no
  auto-suggestion). Added a new sibling, `nextAvailableRecordName(model,
  desiredName)`, scoped to `model.records` (record names are unique
  file-wide, not per-record like field names) with the same 10-character
  DDS name-column limit and the same "already-free base name wins
  outright, no forced suffix" behavior `nextAvailableFieldName` already
  has.
- New `WebviewEdit` kind `{ kind: "duplicateRecord"; name: string }`
  (`src/webviewProtocol.ts`), dispatched through the existing generic
  `applyEdit`/`applyEditToModel` plumbing — no `extension.ts` change
  needed, same as every other Batch P record-format operation.
- `prtfEdits.ts`'s new `"duplicateRecord"` case: finds the source record
  by name, computes the new name via `nextAvailableRecordName`, and
  deep-clones the record's own `conditions`/`keywords` plus every one of
  its fields/constants — field/constant NAMES, lengths, types, positions,
  literals, and keywords are copied **byte-for-byte verbatim, unchanged**
  (confirmed against I-SDA's own `copyRecord` reasoning: DDS scopes field
  names per record format, so there's no collision risk to solve here,
  unlike Batch Q's actual hard problem of copying a field INTO an existing
  record). Every cloned field/constant gets a fresh, distinct `id` via a
  new `makeIdGenerator(model)` helper (separate from `prtfParser.ts`'s own
  per-parse `nextId()` counter, which starts fresh at `"e0"` every parse
  and would very likely collide with real ids already present in an
  in-memory, already-parsed model) — deep-cloned, not shared by reference,
  so editing the clone's own keywords afterward can't mutate the source's
  (and vice versa; verified by a dedicated test that reaches in and
  mutates a cloned keyword's `params` directly).
- **Placement:** the new record is inserted immediately after the SOURCE
  record in `model.records` (matching `addRecord`'s own default placement
  convention), and its whole block — the record entry followed by every
  cloned field/constant, in original order — is spliced into
  `model.sequence` right after the SOURCE record's own block (itself plus
  everything up to, but not including, the next record-kind entry — the
  same block definition `reorderRecord`'s own `blockRange` already uses),
  so any trailing comment after the source's last field stays attached to
  the SOURCE, not swept into the duplicate. **A real, documented
  consequence of always inserting right after the SOURCE (not after the
  most recently created duplicate):** duplicating the same record twice in
  a row lands the second duplicate (e.g. `DETAIL3`) ahead of the first
  (`DETAIL2`), not appended after it — covered by its own test rather than
  silently assumed to read top-to-bottom in creation order.
- UI: a "Duplicate" button in the toolbar next to Delete
  (`media/webviewClient.js`) — posts the edit directly with no
  confirmation step or inline form, unlike Add/Rename/Delete's own pending-
  UI-state forms, since there's nothing to fill in or confirm
  (`nextAvailableRecordName` picks the new name itself, matching this
  batch's own framing of the action as non-destructive and immediate).
  Selection intentionally stays on the just-duplicated SOURCE record after
  the edit applies — same "don't auto-switch selection" behavior
  `addRecord`'s own button already has — rather than jumping the toolbar's
  `<select>` to the new duplicate.
- Tests: new `test/prtfBatchII.test.ts` — byte-for-byte field/constant/
  keyword cloning (names, lengths, types, positions, literals, keyword
  `raw` text), fresh-and-distinct cloned ids, the deep-clone-not-shared-
  reference guard, placement + trailing-comment-stays-with-source, the
  naming-collision case (duplicating "DETAIL" twice in a row →
  `DETAIL2`/`DETAIL3`, in the placement order described above), an unknown-
  name no-op rejection, an empty-record duplicate (no fields at all), and
  three direct `nextAvailableRecordName` unit tests (already-free base
  name, numeric-suffix collision, 10-character truncation).
- Full suite: 420 tests, all passing (410 prior + 10 new); `tsc --noEmit`
  and `npm run compile` both clean. **No real-browser verification was
  possible in this session** (same documented sandbox limitation as
  Batches V/FF/GG onward — no usable headless browser here); the new
  "Duplicate" button was checked only via `media/webviewClient.js`
  parsing/assembling cleanly (`webviewAssembly.test.ts`'s existing
  end-to-end script execution). **Please verify in a real Extension
  Development Host** that clicking "Duplicate" on a record with several
  fields/keywords produces a correctly-named clone selectable from the
  toolbar's `<select>`.

### Batch JJ — Multi-select fields for bulk move/copy/delete [OPEN]
- Real RLU's F14/F15 operate on several selected fields at once; today's click-to-place/drag is one field at a time (no `multiSelect`/`shiftKey` handling anywhere).
- Reference: I-SDA's shift/ctrl/cmd-click additive selection + `startGroupDrag` (moves the whole group together, clamps the GROUP's combined bounding box, not each field independently).
- What to do: modifier-key selection handling, a `startGroupDrag` equivalent, multi-target copy/delete. Pairs naturally with Batch KK — implement whichever lands first with an eye toward the other reusing its clamp math.
- Verification: no real automated coverage likely feasible (no headless browser in this sandbox) — unit-test any extracted pure clamp-math logic; flag for manual verification.

### Batch KK — Boundary shift-and-truncate [OPEN]
- Real RLU's `LT(N)`/`RT(N)` shift-and-truncate a field at the report boundary on an out-of-bounds move/resize. No equivalent today — a field can end up positioned off-page silently.
- Reference: I-SDA is only a partial match — its `startGroupDrag` clamps a group's bounding box during drag, but single-field hover-tracking deliberately does NOT clamp to max lines/columns (by design, so edge-hovering reads the true last row/column); whether single-field placement itself is bounds-checked elsewhere wasn't confirmed — check before assuming a complete equivalent exists.
- What to do: treat IBM RLU's own documented `LT`/`RT` behavior as the primary spec (what gets truncated, silent vs. prompted, which edges). Add validation wherever fields are placed/resized. Natural pairing with Batch GG — consider a shared validation pass once both are underway.
- Verification: unit tests for the boundary-clamp math against each edge.

### Batch LL — Bug fix: DDS's `+n` relative-position notation is silently absolutized [OPEN]
- Found during Batch AA's own real-world round-trip testing against `SCSPRT1.prtf` — a field's `+2` position (DDS positions 42-44, meaning "2 spaces after the previous field ends" per IBM's `RELPOS` reference) round-tripped as a plain absolute `2`.
- Root cause: `prtfParser.ts` reads the position field via `sub(line, 42, 44).trim()` then `parseInt(posRaw, 10)` — `parseInt("+2", 10)` returns `2`, silently discarding the relative-vs-absolute distinction. `buildPositional`/`padLeftNum` then write that number back as a plain absolute value with no `+`, relocating the field on any round-trip even without the person touching its line/position.
- What to do: thread a `relativePosition?: boolean` flag through `FieldEntry`/`ConstantEntry` (`src/prtfModel.ts`), captured by the parser instead of discarding the sign, re-emitted by `buildPositional`/`padLeftNum` as `+n` when set. Confirm against IBM's reference whether the *line* number field (39-41) allows the same `+n` marker — don't assume position-only. Check what the "move field" UI in `media/webviewClient.js` should do with this (does dragging silently convert to absolute — check I-SDA's handling of the same DDS convention on display files first). Add round-trip tests using the real-world fixtures (`scsprt1-realworld.prtf`/`afpprt1-realworld.prtf`, both already contain real `+n` fields), since those are what caught this.

## Adding a new batch

If you find scope this board doesn't cover, add a row to the table above and
a "Batch detail" section following the same shape, rather than silently
absorbing it into an existing batch — keeps the board an accurate map of
what's claimed vs. open for the next session.
