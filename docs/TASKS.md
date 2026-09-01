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
| `CRTPRTF` assumes `*CURLIB/QDDSSRC`, no library/source-file/member picker | Actionable | Batch **J** |
| No packaging (`.vsix`) | Actionable | Batch **K** |
| Font resource access unresolved (§9) — real AFP font metrics vs. placeholder | **Mostly done** — FGID identification verified/resolved, proportional widths now use real Adobe AFM data for substitute fonts; CDEFNT/FNTCHRSET/FONTNAME resolution still blocked | Batch **L** |
| The record-format `<select>` dropdown (toolbar) only switches between record formats already present in the source — no way to add, rename, delete, or reorder a record format from the designer itself | Actionable, previously untracked (this isn't in README/REQUIREMENTS' Known-limitations lists at all — raised separately, added here for the same tracking discipline) | New **Batch P** (no dependency — the record `<select>` and `applyEdit`'s edit-kind dispatch already exist to build on) |
| The properties panel supports add/update/delete for fields and constants, but not copy/duplicate — cloning a field with its keywords intact (a common RLU/SEU-era workflow for building up repetitive detail-line layouts) requires manually re-entering every attribute and keyword on a new field | Actionable, previously untracked | New **Batch Q** (no dependency — sits directly next to the existing Delete button in `renderEditPanel`, and can reuse `addField`/`addConstant`'s edit-kind shape) |

## Task board


| Batch | Description | Keywords in scope | Status | Depends on |
|---|---|---|---|---|
| A | ~~Properties-panel editing: general field/record keywords~~ | `EDTCDE`, `EDTWRD`, `DATE`, `DATFMT`, `DATSEP`, `TIME`, `TIMFMT`, `TIMSEP`, `DFT`, `MSGCON`, `COLOR`, `HIGHLIGHT`, `UNDERLINE`, `PAGNBR`, `PRTQLTY`, `DRAWER`, `PAGRTT` | **Done** | none |
| B | Font/sizing keyword editing + shared P-field toggle component | `FONT`, `CDEFNT`, `FNTCHRSET`, `FONTNAME`, `CHRSIZ`, `CHRID`, `CCSID` | **Done** | none (but A and C benefit from B's P-field component if B lands first) |
| C | `BARCODE` full parameter surface (still placeholder render) | `BARCODE` | **Done** | none |
| D | `BARCODE` real symbol rendering | `BARCODE` | **Done** | **C** |
| E | ~~AFP page-group / resource keyword placeholders~~ | `OVERLAY` (record), `PAGSEG`, `STRPAGGRP`, `ENDPAGGRP`, `DOCIDXTAG`, `AFPRSC`, `DTASTMCMD` | **Done** | none |
| F | Print/finishing keywords, validation-only | `DUPLEX`, `FORCE`, `OUTBIN`, `ZFOLD`, `STAPLE`, `INVMMAP` | **Done** | none |
| G | Field-level data/edit keywords + indicator text | `ALIAS`, `BLKFOLD`, `CVTDTA`, `DLTEDT`, `FLTFIXDEC`, `FLTPCN`, `TRNSPY`, `TXTRTT`, `INDTXT` | **Done** | none |
| H | `REF`/`REFFLD` resolution via Code for i | `REF`, `REFFLD` | Part 1 (UI shape + pure resolution logic) **and the field/record-format picker done**; part 2 (live Code for i round-trip) written but unverified — needs a real connected IBM i | none (needs a live/mocked Code for i connection for full completion — can land the UI shape without it) |
| I | ~~`UOM` modeling~~ **done elsewhere** (see `i-rlu.unitOfMeasure` setting, `docs/ROADMAP.md`) + file-level SKIPA/SKIPB *AFPDS validation | `SKIPA`, `SKIPB` (validation only) | **Done** (validation landed as part of Batch F — see `prtfEngine.js`'s `validateFileLevelKeywords`) | none |
| J | Compile command: library/source-file/member picker | n/a (tooling) | Not started | none |
| K | Packaging (`.vsix`) | n/a (tooling) | **Done** | ideally after A–I land, but can be prepped early |
| L | Real AFP font metrics | n/a (data) | Mostly done — FGID identification resolved; proportional widths now use real published Adobe AFM data (metric-compatible substitute fonts, not verified IBM FGID resource extraction); CDEFNT/FNTCHRSET/FONTNAME still unresolved, see REQUIREMENTS.md §9 | none |
| M | ~~**Bug fix:** writer emits wrong continuation character when wrapping mid-token~~ | n/a (parser/writer correctness) | **Done** | none |
| N | ~~`BARCODE` mutual-exclusion validation~~ | `BARCODE` (validation vs. `FONT`, `EDTCDE`, `EDTWRD`, `DATE`, `TIME`, `PAGNBR`, etc.) | **Done** | **C** |
| O | Real AFP resource rendering (actual pixel content for page segments/overlays) | `PAGSEG`, `OVERLAY` (record-level) | Blocked — needs external resource files, see REQUIREMENTS.md §8 | **E** |
| P | ~~Add/rename/delete/reorder record formats from the designer~~ | n/a (tooling/UI, not a keyword) | **Done** | none |
| Q | Copy/duplicate a field or constant | n/a (tooling/UI, not a keyword) | Not started | none |
| R | ~~**Bug fix:** `emitWithKeywords` collapses multiple consecutive internal spaces inside any quoted keyword literal~~ | n/a (parser/writer correctness) | **Done** | none |

## Batch detail

### Batch A — General properties-panel keywords [DONE]
**Implemented following the codebase's established per-batch convention**
(each batch owns its own `BATCH_X_KEYWORDS` array + section-render
function — see Batch F's `renderRecordKeywordsPanel`/Batch G's
`renderFieldKeywordsSection` — rather than a shared generic abstraction;
an earlier draft of this batch built a generic `renderKeywordDefsPanel`
before Batches B/G/H landed independently and established this
per-batch pattern as the de facto convention, so it was rewritten to match
before merging). Decisions worth recording for anyone extending this
batch's keyword set later:

- **Split field-only vs. constant-only vs. shared**, verified against IBM's
  DDS reference rather than treating all 17 keywords as interchangeable
  across field/constant: `EDTCDE`/`EDTWRD`/`DATFMT`/`DATSEP`/`TIMFMT`/
  `TIMSEP`/`DFT` attach to a **named field** (confirmed by IBM's own "DDS
  File With Date, Time, and Timestamp Fields" example, which uses them on
  named `L`/`T`-type fields); `DATE`/`TIME`/`PAGNBR`/`MSGCON` attach to a
  **constant (unnamed) field** (confirmed by IBM's DDS syntax overview:
  "Constant (unnamed) fields require only a location and a keyword, as
  described in the DATE, DFT, PAGNBR, TIME, and MSGCON keyword
  descriptions"); `COLOR`/`HIGHLIGHT`/`UNDERLINE` apply to both. `DFT` was
  deliberately kept field-only (not also offered on constants) since a
  constant already carries its value via the literal-text input.
- **`PRTQLTY`/`DRAWER`/`PAGRTT` values verified against IBM's reference**,
  not just RLU's own screen labels: `PRTQLTY` is
  `*STD`/`*DRAFT`/`*NLQ`/`*FASTDRAFT` (RLU's "1=Standard" etc. is its own
  picklist numbering, not the literal DDS value); `DRAWER` is a plain
  `1`–`4`; `PAGRTT` is `0`/`90`/`180`/`270` as KEYWORD-INVENTORY already had
  it.
- **`DATSEP`/`TIMSEP` needed a new "quotedSelect" kind**, added to the
  shared `paramsToText`/`paramsInnerText` helpers (backward-compatible —
  existing "select"/"text"/"flag" call sites unaffected): these take either
  a single quoted separator character (`DATSEP('-')`) or the bare special
  value `*JOB` — never both quoted. A live client-side hint documents (but
  doesn't hard-block) IBM's rule that `DATSEP`/`TIMSEP` can't be combined
  with a fixed-separator `DATFMT`/`TIMFMT` (`*ISO`/`*USA`/`*EUR`/`*JIS`).
- **`COLOR`'s `*RGB` and named-color forms are verified** (matching this
  project's own `sample-afpds.pf` fixture, which already used
  `COLOR(*BLU)` and `COLOR(*RGB 0 0 0)`); **`*CMYK`/`*CIELAB`'s exact
  parameter format is NOT independently confirmed** against IBM's
  reference — implemented as a plain space-separated text input rather than
  false-precision numeric range inputs, with the uncertainty flagged in a
  code comment. Worth a follow-up verification pass by whoever next touches
  `COLOR`.
- **`HIGHLIGHT`'s mutual-exclusion validation already existed** by the time
  this batch landed — Batch B's `validateFontKeywords` (generic over any
  keyword array, so it already covers both record- and field-level
  `HIGHLIGHT`) was implemented independently in parallel and converged on
  the same rule this batch would otherwise have added. No duplicate
  validation was added; the general-record-keywords panel and the new
  field/constant section both rely on Batch B's Font & sizing panel already
  surfacing that warning, rather than re-showing it.
- **No preview-rendering changes** — exactly as scoped, `EDTCDE`/`EDTWRD`
  don't attempt real numeric-formatting preview (explicit non-goal, see
  `docs/REQUIREMENTS.md` §6).
- **Bug found while testing, logged separately rather than fixed here**:
  `emitWithKeywords` (the shared line-wrapping function, also the site of
  Batch M's earlier fix) collapses multiple consecutive internal spaces in
  any quoted keyword literal — e.g. `EDTWRD('  .  ')` round-trips as
  `EDTWRD(' . ')`. Logged as **Batch R** with full root-cause detail; not
  fixed as part of this batch since it's a pre-existing, cross-cutting
  writer defect unrelated to Batch A's own scope.
- Tests: `test/prtfBatchA.test.ts` — round-trip for every keyword's exact
  parameter shape (the two-part `EDTCDE`, quoted vs. bare `DATSEP`/
  `TIMSEP`, all three implemented `COLOR` models, record- and
  constant-level keywords using `sample1.pf`'s existing entries), plus the
  dedicated Batch R bug-documentation test.

### Batch B — Font/sizing + shared P-field component [DONE]
**Delivered:** a shared, reusable "literal or program-to-system field"
input component (`pFieldRow` in `media/webviewClient.js`) — a small toggle
switching between a literal value box and a `&FIELDNAME` box, returning
whichever text should be spliced into the keyword's DDS params. Used for
every P-field-capable parameter across `FONT` (FGID + *POINTSIZE height/
width), `CDEFNT` (name, library, *POINTSIZE), `FNTCHRSET` (char-set name +
library, code-page name + library, *POINTSIZE), `FONTNAME` (resource
name), and `CHRID` (character set, code page). `CHRSIZ` (width/height
multipliers) and `CCSID` (a single CCSID number) are plain-numeric per
KEYWORD-INVENTORY §2/§3 (neither is documented as P-field-capable there),
so they get simple numeric inputs rather than being forced through the
P-field toggle.

**Model consideration, resolved:** no `prtfModel.ts` change was needed — a
keyword's raw params text already represents a literal or a `&NAME`
reference identically either way (confirmed by round-tripping both forms
through parse → regenerate → reparse in `test/prtfBatchB.test.ts`), exactly
as this batch's own task description predicted might be the case.

**Available at both record and field level**, reusing/extending the exact
`setRecordKeyword`/`removeRecordKeyword` edit-kind pattern Batch F
established (per the file-ownership table's explicit instruction to reuse
it) — plus a new field-level counterpart, `setFieldKeyword`/
`removeFieldKeyword` in `src/extension.ts`, targeting by the field/
constant's stable `id` the same way `updateField`/`updateConstant`/
`delete` already do. Record-level keywords render in a new panel appended
next to Batch F's print/finishing panel; field-level keywords render
inside the existing click-a-cell properties panel (`renderEditPanel`),
gated on the layout cell now also carrying its entry's raw `keywords`
array (a small `src/prtfEngine.js` addition — cells didn't expose that
before this batch).

**Validation added** (`validateFontKeywords` in `src/prtfEngine.js`, IBM
DDS reference-sourced): `HIGHLIGHT` and `CHRID` are each flagged when
`CDEFNT` or `FNTCHRSET` is also coded on the same record/field (both are
genuinely ignored by the compiler in that case, per IBM's own mutual-
exclusion documentation); `CHRSIZ` always gets a heads-up that it requires
an IPDS printer and has no effect under Host Print Transform.

**Test coverage:** `test/prtfBatchB.test.ts`, 15 tests — literal and
P-field round-trips (parse → regenerate → reparse) for every keyword in
scope, all four validation-warning cases, and a field-level (not just
record-level) round-trip to confirm the shared code path actually works
identically at both levels rather than just being copy-pasted and hoped
to match.

### Batch C — BARCODE parameter surface [DONE]
**Current state, precisely** (checked against `src/prtfEngine.js`'s
`parseBarcodeGeometry`, added in the BARCODE placeholder commit before this
task board existed): the engine already **parses** bar-code-ID, direction
(`*HRZ`/`*VRT`), an HRI on/off flag (`*HRI`/`*NOHRI` — see gap below), and
height (plain line count 1–9, or a `(height *UOM)` physical measurement) —
enough to size and label the placeholder box. None of this is editable in
the properties panel today (that's this batch); and several parameters
aren't parsed by the engine at all yet, not just unexposed in the UI:
`*AST`/`*NOAST` (asterisk on CODE3OF9), the modifier hex byte, narrow bar
width, wide:narrow ratio, and additional 2D parameters.

**Known gap to fix as part of this batch, not carry forward:** the engine
currently collapses `*HRI` and `*HRITOP` to the same boolean ("HRI is on"),
losing the below-vs-above distinction RLU's own "Specify Bar Code" screen
exposes as separate choices (1=Below/2=Above/3=None — KEYWORD-INVENTORY
§3). Since this batch is adding the properties-panel form for HRI position
anyway, fix `parseBarcodeGeometry` to track the three-way value at the same
time, rather than leaving the engine's simplified boolean in place under a
richer-looking UI that can't actually reflect what it saves.

**Goal:** expose every parameter IBM's RLU screen shows (barcode-ID, height
in lines or UOM, bar format, HRI position, asterisk-on-CODE3OF9, modifier,
narrow bar width, wide:narrow ratio, additional 2D params — full list in
KEYWORD-INVENTORY §3) in the properties panel, parsing the ones the engine
doesn't yet (listed above) so they at least round-trip correctly even
before Batch D gives them visual meaning. Rendering stays the existing
labeled placeholder box; this batch is UI/model/parsing, not rendering.
- Validate ranges as shown on the RLU screen (e.g. ratio 2.00–3.00, narrow
  bar width 0.007–0.208) client-side in the webview form.
- Tests: round-trip full BARCODE parameter set; a specific test for the
  HRI three-way value (below/above/none) surviving edit-then-reparse.

**Implementation notes:**
- New module `src/prtfBarcodeParams.js` owns the full structured parse
  (`parseBarcodeParams`), the inverse builder (`buildBarcodeParams`), and
  the range-hint validator (`validateBarcodeParams`) — kept separate from
  `prtfLayout.js` since it's a parse/build pair the properties panel calls
  directly, not geometry math. Re-exported through `prtfEngine.js` (as
  `parseBarcodeParams`/`buildBarcodeParams`/`validateBarcodeParams`) and
  added to `buildWebviewTemplate.js`'s `WEBVIEW_MODULE_FILES` list (before
  `prtfLayout.js`, which now depends on it).
- Added a small paren-aware tokenizer (`groupTokens`) rather than reusing
  `prtfKeywordHelpers.js`'s `paramTokens`, which only splits on bare
  whitespace — not enough here since `*WIDTH`/`*RATIO`/the 2D-data
  parameter are themselves parenthesized (and the 2D-data parameter can
  itself contain nested parens, e.g. `(*QRCODE 4 1 *CONVERT(1) *TRIM)`).
- **HRI gap fixed as planned:** `parseBarcodeGeometry` (prtfLayout.js) now
  delegates to `parseBarcodeParams` instead of parsing independently, and
  exposes the three-way `hriPosition` ("below"/"above"/"none") on
  `cell.barcode`. The old `hri` boolean is kept too (derived: `hriPosition
  !== "none"`) since existing tests and the placeholder-box render still
  use it for "is HRI showing at all" — no reason to force those call
  sites to switch just because the richer value now also exists.
- `resolveLayout` also attaches the full structured parse as
  `cell.barcodeParams` (separate from the existing rendering-only
  `cell.barcode` geometry object) so the webview's BARCODE form can
  prefill without a second round trip to the extension host.
- **Round-trip safety for parameters this batch doesn't give a dedicated
  form field to:** RLU's own screen (and this batch's form) doesn't cover
  IBM's `(*SWIDTH n)` "requested symbol width" parameter. Rather than
  silently dropping it if present in hand-written source and the field
  gets edited through this form, any token `parseBarcodeParams` doesn't
  specifically recognize is preserved verbatim in `unrecognizedRaw` and
  re-emitted by `buildBarcodeParams`. Same treatment for anything else not
  modeled here.
- The single "additional 2D parameters" field is deliberately free text
  (`extra2D`) covering the whole `(*PDF417 ...)`/`(*MAXICODE ...)`/
  `(*DATAMATRIX ...)`/`(*QRCODE ...)` group verbatim — modeling each of
  those four symbologies' own sub-grammar (PDF417's row-size/rows/
  security/..., QR Code's version/error-correction/..., etc.) individually
  was judged out of scope for this batch; RLU's screen doesn't expose them
  as separate fields either.
- Properties panel: bespoke `renderBarcodeSection` in
  `media/webviewClient.js` (same "hand-written section" approach as
  `appendColorRow`/`appendMsgconRow`, not `appendKeywordRows`, since
  BARCODE's shape doesn't fit that helper's one-value-per-keyword model).
  Wired into `renderEditPanel` for both fields and constants (DDS allows
  BARCODE on constants too, restricted to CODEABAR/CODE128/CODE3OF9 +
  DFT — surfaced as a hint, not enforced, matching every other
  validation's "live-editor hint only" treatment in this codebase).
  Applies via the existing generic `setFieldKeyword`/`removeFieldKeyword`
  edit kinds (Batch F/G/B's shared plumbing) — no `extension.ts` changes
  needed.
- Tests: `test/prtfBatchC.test.ts` — full-parameter-set parse, `(height
  *UOM)` vs. line-count height, documented defaults when params are
  omitted, `unrecognizedRaw` preservation, build→parse round-trip of the
  full structured object, the HRI three-way-survives-edit-then-reparse
  test called for above, `parseBarcodeGeometry`'s `hriPosition`/`hri`
  coexistence (via `resolveLayout`, not calling the internal parser
  directly — same convention `prtfLayoutGeometry.test.ts` already uses),
  and validation-hint tests for in- and out-of-range values.


### Batch D — BARCODE real rendering [DONE]
**Goal:** replace the placeholder box with an actual rendered symbol, reading
from the parameters Batch C exposes. Needs a barcode-generation library
(check what's available/bundleable for a webview context — likely a small
pure-JS symbology library rather than anything with native deps, since this
runs inside a VS Code webview). Scope to the symbologies IBM's DDS BARCODE
keyword actually supports; don't over-build.
- **Depends on Batch C** landing first (needs its parameter surface).

- Tests: `test/prtfBatchD.test.ts` — pure-logic coverage for the
  RENDERABLE/not-RENDERABLE split, sample-data shape per symbology
  (including the INTERL2OF5 even-length and CODEABAR start/end-letter
  rules), and the options-mapping logic, **plus** a jsdom-backed
  integration test that actually loads the vendored JsBarcode and confirms
  it renders real SVG bars (not just "doesn't throw") for every RENDERABLE
  symbology using this module's own sample data — the layer that actually
  caught the UPCE bug above. `jsdom` added as a devDependency for that one
  test file (not used elsewhere in the suite, which otherwise avoids DOM
  dependencies — see that test file's own header for why `displayValue` is
  forced `false` there specifically, a jsdom-only limitation around
  canvas-based text measurement, not a real-webview one).


### Batch E — AFP page-group / resource placeholders [DONE]
**Delivered exactly per the goal below**, split into two treatments rather
than one, since not all seven keywords actually have a page position to
place a box at:

- **Positioned (get a placeholder box, `layout.resources`):** `OVERLAY`
  (record-level, verified format `OVERLAY([library/]overlay-name
  position-down position-across [(*ROTATION rotation)])` — the MC Press
  "May the AFP Overlay Forms Be with You" writeup and IBM's own reference
  agree), `PAGSEG` (`PAGSEG(page-segment-name [vertical-offset
  horizontal-offset] [(*ROTATION rotation)])` — offsets are an **optional
  pair**, confirmed against this project's own `sample-afpds.pf` fixture
  which already used the name-only form on one record and the
  name+offsets form on another), `AFPRSC` (`AFPRSC('resource-name'
  object-type position-down position-across [(*SIZE...)] ...)` — only the
  first four positional params get dedicated fields, everything after is
  preserved verbatim, see below).
- **Non-positioned (badge list, `layout.pageGroupKeywords`):** `STRPAGGRP`
  (`STRPAGGRP(group-name)`), `ENDPAGGRP` (no params — a bare flag),
  `DOCIDXTAG` (`DOCIDXTAG(attribute-name attribute-value tag-level)`,
  tag-level is `GROUP` or `PAGE`), `DTASTMCMD` (`DTASTMCMD(text)`). None of
  these place anything on the printed page — a page group is a logical
  grouping of whole pages, not a location — so a positioned box would have
  been fabricated geometry with no source to justify it.

**Quoting, verified per-keyword against IBM's DDS reference rather than
assumed uniform:** `OVERLAY`/`PAGSEG`'s resource name is an **object name**
(unquoted — `PAGSEG(COMPLOGO 0.5 0.5)`, matching the existing fixture) but
`AFPRSC`'s resource name and `STRPAGGRP`'s group-name/`DOCIDXTAG`'s
attribute-name/attribute-value/`DTASTMCMD`'s text are **character values**
(quoted). `DOCIDXTAG`'s tag-level and `AFPRSC`'s object-type are unquoted
special/enumerated values. Any of the above may be an unquoted `&field`
program-to-system-field reference instead — never quoted regardless of
which case it replaces.

**Implementation notes:**
- New module `src/prtfPageGroupKeywords.js` — parse/build pair per
  keyword (same shape as Batch C's `prtfBarcodeParams.js`), re-exported
  through `prtfEngine.js`, added to `buildWebviewTemplate.js`'s
  `WEBVIEW_MODULE_FILES` (after `prtfBarcodeParams.js` — see below).
- **Unmodeled optional params preserved, not dropped:** `OVERLAY`/
  `PAGSEG`'s trailing `(*ROTATION n)` and anything in `AFPRSC` past its
  first four positional params (`(*SIZE...)`, mapping-option,
  color-profile, ...) round-trip via a free-text `extra` field, re-appended
  on build — same treatment as Batch C's `unrecognizedRaw`/`extra2D`.
- **Reused Batch C's `groupTokens`, not the plain `paramTokens`:** a first
  draft used `prtfKeywordHelpers.js`'s plain whitespace-splitting
  `paramTokens` and a test caught it immediately —
  `DOCIDXTAG('Policy Number' '43127' GROUP)`'s quoted attribute value has
  an internal space, which plain `paramTokens` split into two tokens (the
  exact same class of bug Batch R fixed in the writer's own tokenizer).
  Switched to `prtfBarcodeParams.js`'s quote-aware `groupTokens` (adapted
  to this file's `paramTokens(kw)` call shape via a small wrapper) instead
  of re-solving the same problem a third time.
- `prtfLayout.js` adds `resolveResourcePlaceholders` (the three positioned
  keywords, using `findAllKeywords` so a record with two `OVERLAY`s — e.g.
  front/back — renders both) and `collectPageGroupMetadata` (the four
  non-positioned ones), both wired into `resolveLayout`'s return value as
  `resources`/`pageGroupKeywords`. Placeholder sizing uses the same fixed
  default (20 cols × 3 rows) `BARCODE`'s own placeholder-height default
  established — flagged, not guessed, since none of these three keywords
  carry real dimensions the way `BARCODE`'s height parameter does.
- Properties panel: `renderPageGroupPanel` in `media/webviewClient.js`.
  `STRPAGGRP`/`ENDPAGGRP`/`DTASTMCMD` reuse `appendKeywordRows` (they fit
  its single-value "flag"/"quotedText" shape directly); `OVERLAY`/
  `PAGSEG`/`AFPRSC`/`DOCIDXTAG` get bespoke rows (same "hand-written
  section" approach as `appendColorRow`/`appendMsgconRow`/Batch C's
  `renderBarcodeSection`, since none of their shapes fit
  `appendKeywordRows`'s one-value-per-keyword model). All seven apply via
  the existing `setRecordKeyword`/`removeRecordKeyword` edit kinds (Batch
  F's shared plumbing) — no `extension.ts`/`prtfEdits.ts` changes needed.
  A badge list below the form summarizes `layout.pageGroupKeywords` for
  the current record.
- **Known, accepted simplification (documented inline, not a follow-up
  task):** `setRecordKeyword` is "one keyword per name, replace whichever's
  there" (established by Batch F) — for a record coding the same one of
  these seven keywords more than once, the panel only edits the first
  occurrence by name. Every occurrence still renders correctly (rendering
  uses `findAllKeywords`, not `findKeyword`) and round-trips correctly
  whether or not it's ever touched from the panel — the limitation is
  edit-reachability for a 2nd+ instance via the UI, not correctness.
- Tests: `test/prtfBatchE.test.ts`, 17 tests — round-trip for all seven
  keywords together, parse/build for each keyword's own shape (including
  `PAGSEG`'s optional-offset-pair rule, every quoting rule above, and
  `&field` handling for each), and `resolveLayout` producing correct
  `layout.resources`/`layout.pageGroupKeywords` including the two-`OVERLAY`
  case.

### Batch F — Print/finishing keywords (validation only) [DONE]
**Goal:** these don't change the page layout at all — they affect physical
printer behavior. Just: (1) let them be added/edited/removed through the
properties panel like any other keyword, (2) add validation warnings per
IBM's documented restrictions — `ZFOLD`, `STAPLE`, and `GDF` (if later added)
are PSF-only; surfacing "this requires PSF printing" as a hint is enough,
don't try to detect the target printer's actual capabilities.
- Tests: round-trip only; no rendering test needed.

**Implementation notes:**
- `DUPLEX` takes `*NO`/`*YES`/`*TUMBLE`; `OUTBIN` takes `1`–`65535` or
  `*DEVD`; `INVMMAP` takes a medium-map name. `FORCE`, `ZFOLD`, and `STAPLE`
  take no parameters at all and must be emitted bare (`ZFOLD`, not
  `ZFOLD()`) — confirmed against IBM's DDS reference before implementing.
- `src/prtfEngine.js` adds `validateRecordKeywords(record)` (the
  `ZFOLD`/`STAPLE` PSF-only hint) and `validateFileLevelKeywords(model)`
  (the file-level `*AFPDS` `SKIPA`/`SKIPB` restriction, folded in from
  Batch I per the row above). Both are validation-only — nothing here
  blocks an edit; `CRTPRTF` remains the real enforcement point.
- The `*AFPDS` check can't always know the target device type for certain
  (`DEVTYPE` is usually a `CRTPRTF`/`CHGPRTF`/`OVRPRTF` command parameter,
  not DDS source), *but* `DEVTYPE` is also a real optional DDS keyword —
  when it's coded (file- or record-level) that's authoritative; only when
  it's absent does the check fall back to an AFPDS-typical-keyword
  heuristic (same "can't know for sure, best-effort" spirit as the
  `i-rlu.unitOfMeasure` setting already uses for LINE/BOX/BARCODE).
- Properties panel: since none of these six keywords affect the rendered
  page, they get their own small always-visible per-record panel (checkbox
  to add/remove + a value input where one applies) rather than living in
  the click-a-cell panel used for fields/constants — see
  `renderRecordKeywordsPanel` in `media/webviewClient.js`.
- New edit kinds `setRecordKeyword`/`removeRecordKeyword` were added to
  `extension.ts`'s `applyEdit` — generic enough that later keyword-panel
  batches (A, B, G, etc.) can reuse them instead of adding their own.
- Tests: `test/prtfBatchF.test.ts`.

### Batch G — Field-level data/edit keywords + indicator text [DONE]
**Goal:** `ALIAS` (simple rename field), `BLKFOLD`/`CVTDTA`/`DLTEDT`/
`FLTFIXDEC`/`FLTPCN`/`TRNSPY`/`TXTRTT` (simple enumerated/numeric forms per
KEYWORD-INVENTORY §3/§4), and `INDTXT` — the last one is the interesting
one: it's a documentation-only keyword (indicator number → free text) that
should feed into the **existing indicator-toggle panel** so indicators show
their human-readable meaning next to the checkbox, matching the UX I-SDA
already has for the same concept on DSPF. Check I-SDA's implementation
(`I-SDA/src/dspfEngine.js` / webview client) for the pattern before building
this from scratch.
- **Note:** I-SDA turned out not to have a direct INDTXT-equivalent to copy
  (`I-SDA/src/dspfEngine.js` has no indicator-text concept — its closest
  relative is `resolveFunctionKeyLegend`'s CA/CF key labels, which is a
  different keyword entirely). Built the panel from scratch instead, per
  IBM's own DDS reference for `INDTXT`'s file/record/field-level shape.
- `src/prtfEngine.js`: `validateFieldKeywords(field)` — applicability
  warnings (DLTEDT needs "Reference a field" on; FLTFIXDEC/FLTPCN need data
  type F; TRNSPY needs data type A; TXTRTT's degrees must be 0/90/180/270;
  FLTPCN's own parameter must be `*SINGLE`/`*DOUBLE`). `parseIndtxt`/
  `collectIndicatorDescriptions(model, record)` — parses `INDTXT(nn 'text')`
  and merges file-, record-, and field-level occurrences, most-specific-
  scope-wins (same convention as REF/REFFLD's precedence).
- `media/webviewClient.js`: field properties panel gets a "Data/edit
  keywords" section (checkboxes for the valueless ones, selects for
  FLTPCN/TXTRTT, a text box for ALIAS), applied immediately via the new
  `setFieldKeyword`/`removeFieldKeyword` edit kinds — same "changes apply
  immediately, no separate Save" UX as Batch F's record-keyword panel,
  since these are independent of the base positional-attribute Save
  button. The indicator toolbar panel now shows each indicator's INDTXT
  description as a tooltip + inline text next to its checkbox; a new
  per-record "Indicator text (INDTXT)" panel lets the text be added/edited/
  cleared (record-level scope only — file/field-level INDTXT are still
  read and shown, just not editable from this panel; see the panel's own
  comment for why).
- `src/extension.ts`: generic `setFieldKeyword`/`removeFieldKeyword` edit
  kinds (mirroring Batch F's `setRecordKeyword`/`removeRecordKeyword`, per
  the reuse pointer left in the codebase-organization table) plus
  `setIndicatorText`/`removeIndicatorText`, which — unlike the generic
  by-name setters — has to find the specific INDTXT entry for one
  indicator among possibly several, via `PrtfEngine.parseIndtxt`.
- Tests (`test/prtfFieldEditKeywords.test.ts`, 14 tests): every
  `validateFieldKeywords` applicability rule, `parseIndtxt`'s quote-
  escaping, `collectIndicatorDescriptions`' three-level precedence, and a
  write → reparse round trip (plus idempotence) for a field carrying
  several of these keywords plus a record-level `INDTXT` at once.
- **Not done, left for a future batch/session:** file- and field-level
  INDTXT are read but not editable from the UI (only record-level); adding
  that would mean either a second, smaller "file-level INDTXT" panel or
  folding INDTXT editing into the field properties panel too, for
  documenting an indicator a specific field's own conditions reference.

### Batch H — REF/REFFLD resolution [PART 1 + PICKER DONE; PART 2 WRITTEN, UNVERIFIED]
**Goal:** two parts, can be split further if needed:
1. **UI shape** (no Code for i needed) — **done.** `resolveReferenceTarget`
   in `src/prtfEngine.js` works out which field/library/file a position-29
   'R' field resolves against (REFFLD's own field/file overrides
   record-then-file-level `REF`; `*SRC` and no-reference-anywhere both
   correctly return unresolvable), mirroring I-SDA's own
   `DspfEngine.resolveReferenceTarget`. `src/prtfWriter.js`'s
   `upsertReffldKeyword` builds/updates/removes the `REFFLD` keyword. The
   properties panel (`media/webviewClient.js`) now shows the "Reference a
   field" Y/N toggle plus manually-entered field/library/file inputs and a
   "Use referenced values" Y/N toggle, per KEYWORD-INVENTORY §3's confirmed
   RLU UI shape.
2. **Live resolution** (needs Code for i) — **written, unverified.**
   `fetchReferencedFieldAttributes`/`handleResolveReferencedField` in
   `src/extension.ts` query the referenced physical file's field definition
   via Code for i's API (DSPFFD to a `QTEMP` outfile + an SQL read), same
   integration pattern as I-SDA's own `fetchReferencedFieldAttributes` and
   as the existing `CRTPRTF` compile command already in this file. The "Use
   referenced values" toggle (`msg.useReferencedValues`) governs whether a
   successful resolve overwrites the field's current length/type/decimals
   outright or only fills them in where blank. This part is legitimately
   blocked without a connected test environment — compiles and follows
   I-SDA's proven pattern, but has not been exercised against a real IBM i.
- Tests (`test/prtfReferenceField.test.ts`): parts 1 and the picker's pure
  half are fully covered — every precedence rule in
  `resolveReferenceTarget`'s doc comment, the `upsertReffldKeyword`
  add/replace/remove cases, a parse → regenerate round trip for a field
  carrying `REFFLD`, `mapDspffdRowToAttributes`'s char-vs-numeric mapping,
  and `groupDatabaseFileFieldRows`'s single-format/multi-format/error
  cases (see the picker section below). Part 2 (and the picker's own
  DSPFFD/SQL/QuickPick I/O) has no test — same reasoning as the roadmap
  entry: it needs either a live IBM i in CI (unlikely available) or a
  mocked Code for i client, and I-SDA's own test suite doesn't mock its
  Code for i integration either, so there's no established pattern here to
  follow.

**Remaining piece — file/library/record-format/field picker — done.** What
was previously "not done, left for a future batch/session": a real picker
(currently direct text entry) needing Code for i's own object-browsing
API, following I-SDA's own Task L14 (`fetchDatabaseFileFields`/
`listDatabaseFields`) as the closest existing pattern.
- **Scope, precisely**: library and file are still typed manually (same as
  part 2 above already requires them known — I-SDA's own Task L14 also
  requires library/file already specified, it doesn't browse libraries or
  files themselves, only lists a given file's fields). What's new is the
  record format (when a file has more than one) and the field itself,
  which are now picked from a live list via Code for i rather than typed
  blind.
- `src/extension.ts`'s `fetchDatabaseFileFields` ports I-SDA's own
  function of the same name closely — same DSPFFD OUTFILE approach, same
  activation/connection handling, same `mapDspffdRowToAttributes` field
  mapping. One structural difference: the "does this file have more than
  one record format, and if so which fields belong to which" grouping
  step that I-SDA does inline was pulled out as a pure function,
  `groupDatabaseFileFieldRows` (`src/prtfReferenceField.js`, re-exported
  through `prtfEngine.js`), so it's unit-testable without a live
  connection — the same "pure logic vs. I/O" split
  `resolveReferenceTarget`/`fetchReferencedFieldAttributes` already follow
  in this codebase. `mapDspffdRowToAttributes` itself moved from
  `extension.ts` into `prtfReferenceField.js` at the same time, once this
  second caller needed the same mapping — one shared copy instead of two.
- UI: a new "Browse fields… (Code for i)" button next to REFFLD's "Ref.
  field name" input (`media/webviewClient.js`), reading the SAME
  already-saved library/file `resolveReferenceTarget` resolves for the
  "Resolve Referenced Field" button beside it (deliberately not whatever's
  currently typed into the — possibly unsaved — library/file inputs).
  Clicking it: fetches the field list; if `fetchDatabaseFileFields` comes
  back with `{formats: [...]}` (more than one record format), shows a
  native `vscode.window.showQuickPick` to disambiguate first; then shows a
  QuickPick of the field list itself (name as the label, the field's DSPFFD
  text as the description, type/length/decimals as the detail). On a
  pick, writes straight to the document via `upsertReffldKeyword` and
  applies immediately — no separate Save click needed, consistent with how
  "Resolve Referenced Field" itself already applies immediately.
- New message kind `browseReferencedField` added to `WebviewMessage`
  (`src/webviewProtocol.ts`) and handled in `extension.ts`'s
  `handleBrowseReferencedField`, parallel to `resolveReferencedField`'s own
  handling.
- Not attempted: browsing libraries or files themselves (there'd be no
  established pattern to follow for that — I-SDA's own Task L14 doesn't do
  it either), or letting the picker also disambiguate WHICH `REF` (file-
  vs. record-level) supplied the library/file being browsed (that's
  already `resolveReferenceTarget`'s own precedence logic, unchanged and
  out of scope here).

### Batch I — UOM modeling + AFPDS SKIPA/SKIPB file-level validation
**Update:** the UOM half of this batch has already landed on `main`
(`i-rlu.unitOfMeasure` setting — see `docs/ROADMAP.md`'s "Done" section) via
a parallel session. Only the second piece below is still open:

**Goal:** add a validation warning when `SKIPA`/`SKIPB` is coded at the
**file** level on a file targeting `*AFPDS` — IBM's DDS reference states this
combination isn't allowed (KEYWORD-INVENTORY §1/§2).
- Test: a validation test for the file-level SKIPA/SKIPB + AFPDS case.

### Batch J — Compile command polish
**Goal:** let the user pick library/source-file/member for `CRTPRTF` instead
of assuming `*CURLIB/QDDSSRC` derived from the file name. Straightforward
`src/extension.ts` change plus whatever quick-pick UI matches the pattern
already used for the compile command's other prompts (check I-SDA's
`CRTMNU` command implementation for the equivalent picker pattern, since
`docs/REQUIREMENTS.md` explicitly models this compile command on I-SDA's).

### Batch K — Packaging [DONE]
**Goal:** `vsce package` producing a real `.vsix`. Mostly checking
`package.json` metadata (icon, categories, publisher, repository fields all
already partially present per `package.json`), adding a `.vscodeignore` if
missing (I-SDA has one — copy its shape, adjust for I-RLU's actual file
list), and confirming `npm run compile` output is what gets packaged.
Low-risk to do early even if other batches aren't finished — packaging an
incomplete-but-working extension is fine for internal testing.

**Implementation notes:**
- **Found and fixed a real activation-breaking bug while confirming
  "`npm run compile` output is what gets packaged":** `package.json`'s
  `"main"` pointed at `./out/extension.js`, but `tsconfig.json`'s
  `rootDir: "."` means `src/extension.ts` actually compiles to
  `./out/src/extension.js` — the old path didn't exist. A packaged/installed
  build would have failed to activate at all. Fixed by correcting `"main"`
  to `./out/src/extension.js`; verified against the real `.vsix` manifest
  (`unzip -p i-rlu-*.vsix extension/package.json`) rather than just the
  source `package.json`, in case packaging rewrites paths.
- Added `.vscodeignore` (following standard `vsce` convention: ship
  `out/**/*.js` plus `package.json`/`README.md`, exclude `src/`, `media/`,
  `test/`, `docs/`, source maps, and `node_modules/` since there are no
  runtime `dependencies`) — written before I-SDA's own `.vscodeignore` was
  checked; I-SDA's `LICENSE`/icon were reachable via `git clone` in the
  Batch K follow-up below, so its `.vscodeignore` shape could be
  cross-checked too, but this one's already working and wasn't revisited.
- Added `@vscode/vsce` as a devDependency, plus `vscode:prepublish` (runs
  `npm run compile` — `vsce` invokes this automatically before packaging)
  and `package` (`vsce package`) npm scripts.
- Verified end-to-end: `npm run package` produces `i-rlu-0.0.1.vsix`
  (427.66 KB, 14 files) with the corrected `main` entry point, LICENSE, and
  icon all included; `npm test` still passes (50/50) afterward. No
  remaining `vsce package` warnings.
- **License and icon:** copied from the I-SDA repo (same author/publisher,
  `Manojkumar-Dharma`) at the repo owner's direction rather than choosing
  independently — `LICENSE` (MIT, Manojkumar Dharmalingam) and
  `images/icon.png`, with matching `"license": "MIT"` and
  `"icon": "images/icon.png"` added to `package.json`.

### Batch L — Real AFP font metrics [MOSTLY DONE]
**FGID identification: done.** `src/afpFontMetrics.js` now resolves the
`FONT` keyword's FGID parameter against a table verified against IBM's own
FGID/typeface documentation (Printer Device Programming, the AFP Font
Collection reference, IBM support pages on font substitution) — covers the
Courier/Gothic fixed-pitch families, the Helvetica/Times New Roman
proportional families, OCR A/B, and point-size-to-CPI conversion for
scalable monospace fonts (12pt = 10 CPI, per IBM's documented reference
point). `src/prtfEngine.js`'s `resolveFont`/`resolveLayout` apply
field-over-record-over-file `FONT` precedence, matching DDS's own rules,
and expose the resolved font (family/weight/style/spacing/pointSize) on
each layout cell for the webview to render with real CSS font-family
instead of a flat monospace assumption. The character grid itself is also
now derived from CPI/LPI via the standard 96dpi formula
(`cellWidthPx = 96/CPI`, `cellHeightPx = 96/LPI`) rather than hardcoded
pixel constants.

**Correction made along the way, worth flagging if you build on this:** an
earlier reference this project drew on mislabeled FGID 416 as "Times
Roman" — checked against IBM's own typeface/FGID table and found to
actually be Courier Roman Medium (fixed/monospace, despite being
scalable). Real Times New Roman Medium is FGID 2308. There's a regression
test (`FGID 416 correctly resolves to Courier Roman Medium...` in
`test/prtfParser.test.ts`) guarding against that resurfacing — don't
remove or "fix" it back the other way without re-checking the source.

**Still blocked, still needs font resource data or live IBM i access:**
real per-glyph advance widths for the proportional (Helvetica/Times New
Roman) families now use the actual published Adobe AFM widths for the
metric-compatible PostScript substitute fonts (Helvetica, Times-Roman/
Bold/Italic/BoldItalic) — real, stable, industry-standard data, a genuine
improvement over the earlier flat placeholder table. The honest caveat
that remains: these are the substitute font's published metrics, not a
verified extraction of IBM's own FGID resource data (which this tool has
no access to) — don't treat this as guaranteed pixel-identical to a
specific target printer's actual rendering. Also still unresolved:
`CDEFNT` (coded font), `FNTCHRSET` (host font character set + code page),
and `FONTNAME` (TrueType/OpenType by name) — none of these three are
parsed for font resolution at all yet; they reference host/IFS font
objects this tool has no access to. One direction raised for closing this
gap: extracting real font data from a connected IBM i (TrueType files
under `/QIBM/ProdData/OS400/Fonts/TTFonts` for IBM-supplied fonts, or
`/QIBM/UserData/OS400/Fonts/TTFonts` for user-installed ones, accessible
via Code for i's IFS browsing/file-read API; or FOCA font character-set
metrics via host APIs) — worth pursuing. The TrueType path above is now
independently verified (IBM's own documentation, corroborated by a
working `FONTNAME` example from a real IBM i shop), correcting an earlier
version of this note that had the wrong base directory and directory name
(`/QIBM/UserData/OS400/Fonts/TTF/` — both wrong: missing the `ProdData`
half entirely, and `TTF` rather than `TTFonts`). One nuance to keep in
mind when actually implementing this: `FONTNAME` references a TrueType
font by its full font name, not its filename, so resolving it to real
glyph metrics means fetching the matching `.ttf` file's bytes and parsing
its own `name` table to find the right one — filename matching alone
won't reliably work. FOCA's own API names/paths still haven't been
independently verified, so don't build against those specifically without
checking first (same discipline that caught the FGID 416 error, and that
caught this TTF path error too).

Batch B's `FONT`/`CDEFNT`/`FNTCHRSET`/`FONTNAME` properties-panel editing
work is unaffected by this and can proceed independently — it's about
letting the user *set* these keywords' values through the UI, not about
resolving their real metrics for rendering.

### Batch M — Fix writer's continuation-character bug [DONE]
**Found by:** `test/prtfFixtures.test.ts`'s round-trip test against
`sample-afpds.pf` (added alongside `docs/KEYWORD-INVENTORY.md`), which
failed 2/26 tests on first run.

**The bug:** `src/prtfWriter.js` always emitted `+` continuation when
wrapping a record/field's keyword area onto a following line, regardless of
whether the wrap point fell between two tokens that need a space preserved
between them. Real DDS distinguishes `+` (no implied space at the join —
correct only for a split strictly inside one token) from `-` (implied single
space at the join — correct between two separate tokens). Concretely,
`PAGSEG(COMPLOGO 0.5 0.5)` wrapped after `COMPLOGO` with `+` continuation
reparsed back as `PAGSEG(COMPLOGO0.5 0.5)` — silently corrupting the token.

**Root cause, once traced:** `emitWithKeywords`'s wrapping loop only ever
moves whole whitespace-delimited tokens to the next line — it never splits
inside a single token. That means every wrap point it can produce sits
between two tokens that were space-separated in the original keyword text,
so `-` (implied space) is the only continuation character this function
should ever emit; there was no case where `+` was actually correct.

**Fix applied:** `emitWithKeywords` in `src/prtfWriter.js` now emits `-`
instead of `+` for every continued line. Comment above the function updated
to explain why '-' is unconditionally correct given how the wrapping loop
actually works (see the comment in the source for the full reasoning).

**Regenerated fixtures:** all three `.pf` fixtures (`sample1.pf`,
`sample-scs.pf`, `sample-afpds.pf`) were saved-to-disk output of the old
buggy writer, so they needed regenerating via their `generate-*.js` scripts
once the writer was fixed — `git diff` on `sample1.pf` confirms only the two
continuation characters changed, nothing else.

**Tests added:** `test/prtfWriter.test.ts` — unit tests against
`emitWithKeywords` directly (isolated from the parser), including a pinned
regression test that a wrap between two space-separated tokens must use `-`,
and a reassembly test that mirrors the parser's own join semantics. All 33
tests pass (`test/prtfParser.test.ts` + `test/prtfFixtures.test.ts` +
`test/prtfWriter.test.ts`).

**Known, separate, out-of-scope limitation left as-is:** if a single
keyword token itself exceeds the 34-column keyword width (e.g. an unusually
long literal constant), `emitWithKeywords` doesn't split it mid-token — it
gets silently truncated by `padRight`'s slice. This is a real gap but a
different bug from Batch M (no continuation-character choice is involved
since there's no token boundary to wrap at); flag as a new batch if a
real-world source member surfaces this.

### Batch N — BARCODE mutual-exclusion validation [DONE]
**Source:** README.md's "Known limitations" section — `BARCODE` can't be
combined with `FONT`/`EDTCDE`/`EDTWRD`/`DATE`/`TIME`/`PAGNBR`/etc. on the
same field per IBM's DDS reference; today the tool doesn't check this at
all, silently letting the designer create source that `CRTPRTF` will reject.

**Depends on Batch C**: this validation needs to attach to BARCODE's full
parameter surface (Batch C) in the properties panel — build it as part of,
or immediately after, Batch C's form, not as a standalone check bolted onto
the current placeholder.

**Goal:** when a field has `BARCODE` plus any of the excluded keywords,
surface a validation hint in the properties panel (matching the style
already used for `HIGHLIGHT`+`CDEFNT`/`FNTCHRSET` in Batch A, and the
`*AFPDS` file-level `SKIPA`/`SKIPB` check folded into Batch F) — this is a
live-editor hint, not a hard block; `CRTPRTF` remains the actual
enforcement point. Confirm the exact excluded-keyword list against IBM's DDS
reference before implementing (README's list is the starting point, not
necessarily exhaustive).
- Tests: a field with `BARCODE` + `FONT` (or another excluded keyword)
  triggers the validation hint; a field with `BARCODE` alone, or with
  non-conflicting keywords, doesn't.

**[DONE] — Fixed as follows:**
- Confirmed the exact excluded-keyword list against IBM's DDS reference for
  BARCODE (https://www.ibm.com/docs/en/i/7.3.0?topic=b-barcode), which
  states verbatim: "Do not specify BARCODE in the same field with the
  CHRSIZ, CHRID, CVTDTA, DATE, EDTCDE, EDTWRD, FONT, HIGHLIGHT, PAGNBR,
  TIME, or UNDERLINE keywords." README's own list
  (FONT/EDTCDE/EDTWRD/DATE/TIME/PAGNBR/etc.) was indeed not exhaustive, as
  warned above — missing CHRSIZ, CHRID, CVTDTA, HIGHLIGHT, and UNDERLINE.
  README.md's own "Known limitations" entry updated to reflect the full
  list and that this is now done.
- Added `BARCODE_EXCLUDED_KEYWORDS` and `validateBarcodeExclusions(keywords)`
  to `src/prtfBarcodeParams.js` (BARCODE's own module, alongside the
  existing `validateBarcodeParams` range-hint function from Batch C) rather
  than to `prtfKeywordValidation.js`'s generic `validateFieldKeywords` —
  operates on a plain keyword array so it works for both fields and
  constants (BARCODE is valid on both per Batch C), and DATE/TIME/PAGNBR are
  checked even though they're conventionally constant-only in this tool's
  own Batch A panel, since this operates on whatever's actually in the
  parsed model (e.g. hand-edited raw DDS source), not just what this UI can
  currently create. Returns `[]` (no hints) when BARCODE isn't present at
  all, or when it's present with no conflicting keyword. Re-exported from
  `prtfEngine.js`'s `mod` alongside Batch C's other BARCODE functions.
- **Placement decision**: unlike `HIGHLIGHT`+`CDEFNT`/`FNTCHRSET` (which
  surfaces its hint in the FONT panel — the "cause" — rather than next to
  HIGHLIGHT's own checkbox), this batch's own instructions above explicitly
  say to attach the check to BARCODE's own form (Batch C), not to whichever
  of the up to eleven possible conflicting keywords' panels happens to be
  the other side of a given conflict. Implemented in
  `renderBarcodeSection` (`media/webviewClient.js`), rendered first inside
  the form (before the bar-code-ID input), so it's the most prominent thing
  a person sees when a conflict exists.
- `test/prtfBatchN.test.ts`: BARCODE alone produces no hints; an excluded
  keyword present without BARCODE produces no hints; BARCODE+FONT produces
  exactly one hint naming FONT; a parametrized test over the full
  eleven-keyword list (not just README's originally-named subset) confirms
  each one individually triggers its own correctly-named hint;
  non-conflicting keywords (COLOR, DFT) alongside BARCODE produce no hints;
  multiple simultaneous conflicts each produce their own hint; confirmed
  re-exported correctly from `PrtfEngine`'s public shape.
- Verified end-to-end in the assembled webview script (see Batch R-adjacent
  `test/webviewAssembly.test.ts` infrastructure) that
  `window.PrtfEngine.validateBarcodeExclusions` resolves and works
  correctly through the real inlined-module dependency chain, not just in
  Node via `require()`.
- Full suite: 212 tests, all passing (195 prior + 17 new); `tsc --noEmit`
  clean.

### Batch O — Real AFP resource rendering (page segments/overlays as actual images)
**Source:** `docs/REQUIREMENTS.md` §8's documented hard limit — page
segments and overlays (scanned logos, pre-printed form images) are external
AFP resource objects living on the IBM i's IFS/host, not part of the DDS
source text itself. I-RLU can position and size their bounding box
correctly (that's what Batch E's placeholder gives you) but can't show real
pixel content without those resource files being supplied to the tool some
other way.

**Blocked, same shape as Batch L:** this isn't a coding task waiting to be
picked up — it needs either (a) a way to export/fetch the actual page
segment/overlay resource files from an IBM i (analogous to how Batch H
needs Code for i for `REF`/`REFFLD`), or (b) sample resource files supplied
directly for local rendering. Don't start this batch without first
confirming resource access the same way Batch L is gated on font resource
access — check whether that's been resolved more recently than this task
board before assuming it's still blocked.

**Depends on Batch E**: Batch E's placeholder-box treatment is the fallback
this batch upgrades from — build real rendering as an enhancement layered on
top of (or clearly seamed to replace) Batch E's existing labeled box, not as
a parallel rendering path, so the tool degrades gracefully back to a
placeholder when a given resource file genuinely isn't available even after
this batch lands.

**Goal once unblocked:** decode the AFP resource format (page segments are
IOCA-based images; overlays are themselves small AFP data streams) and
render the actual image/graphic at the position/size Batch E already
computes.
- Tests: will need real (or realistic sample) resource files as fixtures —
  can't be meaningfully tested with synthetic data alone.

### Batch P — Add/rename/delete/reorder record formats from the designer [DONE]
**Source:** raised directly (not from README/REQUIREMENTS' existing Known
limitations lists) — the toolbar's record-format `<select>` dropdown
(`media/webviewClient.js`, present since the very first webview build) only
lets you *switch between* record formats that already exist in the parsed
source. There's currently no way to create a new record format, rename one,
delete one, or change the order they appear in the source, from the
designer itself — you'd have to drop into the raw DDS text editor for any
of that, which somewhat defeats the point of a WYSIWYG designer for a file
type where most real printer files have several record formats (header/
detail/footer being the minimum common case).

**No dependency**: unlike most other batches, this doesn't build on
anything unfinished. The pieces it needs already exist:
- `state.model.records` (an ordered array, per `src/prtfModel.ts`'s
  `RecordFormatEntry[]`) is exactly the array a reorder operation would
  splice, and exactly what the toolbar `<select>` already renders from.
- `applyEdit`'s edit-kind dispatch in `src/extension.ts` (`move`,
  `updateField`, `updateConstant`, `delete`, `setRecordKeyword`,
  `removeRecordKeyword`, `addField`, `addConstant`) is the established
  pattern to extend — add `addRecord`, `renameRecord`, `deleteRecord`, and
  `reorderRecord` alongside these, not a parallel mechanism.

**Goal:**
1. **Add record format**: a "+ Record" affordance next to the toolbar's
   `<select>` (matching the existing "+ Field"/"+ Constant" button style)
   that prompts for a record-format name (validate: 1–10 chars, DDS name
   rules — same validation the field-name input already applies, reuse it)
   and inserts a new, empty `RecordFormatEntry` into `model.records`.
   Decide and document where it's inserted (end of the file is the simplest
   default; inserting after the currently-selected record is more
   intuitive for building up a header/detail/footer sequence one at a time
   — pick one and note the reasoning in the PR/commit, don't leave it
   ambiguous).
2. **Rename**: an edit affordance on the currently-selected record (a
   pencil icon next to the `<select>`, or an editable-on-click label — match
   whatever pattern feels most consistent with the existing field/constant
   properties panel's own inline-edit conventions). Renaming a record format
   must also update any `REF`/`REFFLD` keywords elsewhere in the *same*
   model that reference the old name by name, or at minimum flag them as
   now-dangling references rather than silently leaving them pointing at a
   name that no longer exists — check how `REF`/`REFFLD` are modeled today
   (Batch H hasn't landed real resolution yet, but the keyword text itself
   still needs to stay consistent).
3. **Delete**: remove a record format from `model.records` entirely (not
   just clear its fields) with a confirmation step, since this is
   destructive and, unlike deleting a single field/constant, can't be
   trivially undone by re-adding — match VS Code's own undo/redo (the text
   document edit should go through the normal edit application path so
   `Ctrl+Z` in the underlying text editor still works, the same way
   existing field/constant edits already do).
4. **Reorder**: since DDS record-format order in the source can matter
   (some shops rely on RLU's original top-to-bottom convention for
   readability, and `STRPAGGRP`/`ENDPAGGRP` bracketing — KEYWORD-INVENTORY
   §2 — is inherently order-sensitive), add up/down reordering (buttons, or
   drag-to-reorder in whatever list view holds record names, if one exists
   by the time this batch is picked up — otherwise simple up/down buttons
   next to the `<select>` are enough for v1).

**Scope note:** this batch is about the record-format *container* itself —
it doesn't touch how fields/constants within a record are added or edited,
which is already covered by existing UI. Don't let this batch creep into
re-doing the field/constant properties panel.
- Tests: round-trip add/rename/delete/reorder through the model and writer,
  same pattern as the existing `addField`/`addConstant` tests; confirm
  `STRPAGGRP`/`ENDPAGGRP` pairing survives a reorder (or is flagged if
  broken by one — decide which, and test for that decision explicitly);
  confirm the toolbar `<select>` and `state.recordName` fallback logic
  (already handles a record disappearing out from under the current
  selection, per the empty-file guard) still behaves correctly after a
  delete or reorder.

**[DONE] — Implemented as follows:**
- Four new `WebviewEdit` kinds in `src/webviewProtocol.ts`: `addRecord`,
  `renameRecord`, `deleteRecord`, `reorderRecord` — all identified by
  record NAME (not the stable `id` field/constant edits use, since
  `RecordFormatEntry` has no such id in `prtfModel.ts`).
- Model mutations added to `src/prtfEdits.ts`'s existing `applyEditToModel`
  switch, following the file's established pattern exactly (pure, no
  vscode dependency, unit tested directly):
  - `addRecord`: rejects an empty or already-used name. Inserted
    **immediately after the currently-selected record** (`afterRecordName`,
    sent by the webview as `state.recordName`) rather than always at the
    end of the file — chosen because it's the more intuitive default for
    building up a header/detail/footer sequence one record at a time,
    matching this batch's own stated reasoning; falls back to appending at
    the end when `afterRecordName` is omitted or doesn't match (e.g. an
    empty file).
  - `renameRecord`: rejects an empty new name or one already used by
    another record; renaming to the record's own current name is treated
    as a successful no-op, not a false "duplicate" rejection.
    **REF/REFFLD investigation**: confirmed against IBM's DDS reference
    ("When to specify REF and REFFLD keywords for DDS files") that
    REFFLD's parameters are always `[field-name, *SRC-or-external-database-file]`
    — `*SRC` means "search the whole file being defined" **by field name**,
    never scoped to a particular record format name, and REF/REFFLD never
    name a record format within the file being compiled at all (only an
    external database file, or optionally that external file's OWN record
    format when it has more than one — a different file's structure, not
    this one's). So there is no in-model reference to a record format's own
    name that a rename could dangle — verified with a dedicated regression
    test rather than left as an assumption, and no fixup/flagging logic was
    needed for this part of the original goal.
  - `deleteRecord`: removes the record from `model.records` AND removes
    its own entry plus every one of its fields/constants from
    `model.sequence` (not just clearing `record.fields`), so
    `regenerateSource` doesn't still walk and re-emit them.
  - `reorderRecord`: computes each record's contiguous "block" in
    `model.sequence` — from its own entry up to (but not including) the
    next record-kind entry, or the end of the sequence — and swaps the two
    adjacent blocks for the target record and its up/down neighbor,
    relying on the invariant (already preserved by every other mutation in
    this file) that `model.records` and `model.sequence` stay in the same
    relative order. **Decision on trailing comments**: a block sweeps up
    any trailing comments/blank lines after a record's last field, since
    there's no way to know whether such a comment was meant as a trailing
    note for that record or a leading one for the next — tested explicitly
    (a comment placed between two records moves with the earlier one when
    reordered). No-op (returns `false`) at either edge of the array.
- **STRPAGGRP/ENDPAGGRP pairing**: decided to **flag, not protect against**
  — added `validatePageGroupOrder(model)` to `src/prtfPageGroupKeywords.js`
  (Batch E's own module), which walks `model.records` in their current
  order and reports any `STRPAGGRP` with no later `ENDPAGGRP`, any
  `ENDPAGGRP` with no preceding `STRPAGGRP`, or nested `STRPAGGRP`s — a
  general model-state check (matching this project's existing live-editor-
  hint philosophy — see `validateFileLevelKeywords`'s cross-record AFPDS
  heuristic for the same "operates on the whole model, not the deciding
  factor of why" shape) that doesn't need to know reordering specifically
  caused the break; it would just as correctly catch one introduced by
  hand-editing raw DDS text. Rendered in `renderPageGroupPanel`
  (`media/webviewClient.js`), scoped to warnings naming the currently
  displayed record. A dedicated test reorders a valid `STRPAGGRP`/
  `ENDPAGGRP` pair past each other and confirms the check catches it.
- Webview UI (`media/webviewClient.js`): "+ Record" (inline name-entry
  form, matching the existing add-field/add-constant panel style rather
  than a native `prompt()`, which this codebase avoids entirely), "Rename"
  (inline form, defaults to the current name), "Delete" (inline
  confirmation row rather than a native `confirm()`, since this is
  destructive), and ▲/▼ reorder buttons next to the record `<select>`,
  disabled at whichever edge of the record list is currently at that end.
  A new `clearPendingUiState()` helper keeps all of these mutually
  exclusive with each other and with the existing field/constant
  placement/editing state, reusing the existing "post the edit and let the
  `setModel` round trip redraw everything" pattern (no direct `render()`
  call after a real edit; `render()` only for Cancel, which has nothing to
  wait for).
- `test/prtfBatchP.test.ts`: 25 new tests covering every edit kind's happy
  path, empty/duplicate/unknown-name rejections, both reorder edge no-ops,
  the REF/REFFLD non-issue (regression guard, not just documentation), the
  trailing-comment block-sweep decision, and `validatePageGroupOrder`'s
  balanced/unclosed/orphaned-end/nested cases plus the reorder-breaks-a-
  valid-pairing scenario end to end.
- Verified end-to-end in the assembled webview script (same `vm`-context
  technique as `test/webviewAssembly.test.ts`) that
  `window.PrtfEngine.validatePageGroupOrder` resolves correctly through
  the real inlined-module dependency chain.
- Full suite: 263 tests, all passing (238 prior + 25 new in
  `test/prtfBatchP.test.ts`); `tsc --noEmit` clean.

### Batch Q — Copy/duplicate a field or constant
**Source:** raised directly, same as Batch P — not from README/REQUIREMENTS'
existing Known limitations lists. Add/update/delete already exist for
fields and constants (`addField`, `addConstant`, `updateField`,
`updateConstant`, `delete` in `src/extension.ts`'s `applyEdit`), but there's
no copy/duplicate. This is a real gap for the common case of building up a
detail line with several similarly-formatted fields (e.g. a row of
right-justified numeric columns all sharing the same `EDTCDE`/`COLOR`/
`FONT` keywords) — today that means re-entering every attribute and
re-adding every keyword by hand for each one, when 90% of it is identical to
a field that already exists.

**No dependency**: the natural home for this is right next to the existing
"Delete" button in `renderEditPanel` (`media/webviewClient.js`), and the
edit it sends can reuse `addField`'s/`addConstant`'s existing shape almost
exactly — this doesn't need any other batch to land first.

**Goal:**
1. Add a "Copy" button next to "Delete" in the field/constant properties
   panel (`renderEditPanel`). Clicking it should **not** immediately mutate
   the model — route it through the same "pending new entry" flow
   `state.pendingNew` already uses for add (see `renderPropsPanel`/
   `renderNewEntryPanel`), pre-filled with the source entry's values
   (length, data type, decimals, usage, literal text) so the user picks a
   new line/position (and, for fields, confirms/changes the name, since DDS
   field names must be unique per record) rather than the copy landing
   silently on top of the original.
2. **Keywords must come along with the copy** — this is the actual point
   of the feature, not just duplicating position/type. A copy that drops
   the source field's `EDTCDE`/`COLOR`/`FONT`/etc. keywords isn't saving
   any real work over "+ Field". Extend the `addField`/`addConstant` edit
   payload (or add a `copyField`/`copyConstant` edit kind, if that proves
   cleaner than overloading `addField` with an optional source-keywords
   array — decide based on how invasive the plain-`addField` payload change
   would be) to carry the source entry's `keywords` array through.
3. **Name collision**: for fields specifically, since DDS requires unique
   field names within a record, the pre-filled name in the pending-new form
   should not be the exact source name — default to something like the
   source name with a numeric suffix (truncated to fit the 10-char DDS name
   limit) and let the user override it, rather than silently failing or
   silently renaming without telling them.
4. **Scope for v1**: same-record copy only (copy `CUSTNBR` from `DETAIL`
   to a new field also in `DETAIL`). Cross-record copy (copy a field from
   `HEADER` into `DETAIL`) is a reasonable stretch goal once same-record
   copy works, but don't block v1 on it — flag it as a follow-up note in
   whichever commit lands this, rather than scope-creeping this batch.
- Tests: round-trip a copied field/constant through the model/writer and
  confirm its keywords match the source; confirm the pre-filled name
  suggestion avoids colliding with the source name; confirm copying doesn't
  mutate the source entry itself (a bug where copy silently *moves* instead
  of duplicates is the obvious failure mode to guard against explicitly).

### Batch R — Fix emitWithKeywords collapsing internal whitespace in quoted literals [DONE]
**Found by:** `test/prtfBatchA.test.ts`, while adding a round-trip test for
`EDTWRD('  .  ')` (a realistic edit-word mask — multiple internal spaces are
common in real masks, e.g. for currency column alignment). The test failed:
the value came back as `EDTWRD(' . ')` — one of the two runs of double
spaces silently collapsed to a single space.

**The bug:** `emitWithKeywords` in `src/prtfWriter.js` tokenizes the entire
keyword-area text for a line with `keywordText.trim().split(/\s+/)`, then
rejoins kept tokens with a single space (`current + " " + tok`) when
deciding how to wrap them across physical lines. This tokenizer has no
concept of quote boundaries — it treats a run of spaces *inside* a quoted
DDS literal exactly the same as the spaces *between* separate keywords, so
any deliberate multi-space content inside a quoted parameter (`EDTWRD`,
`DFT`, `MSGCON`'s message id, or any other quoted keyword value) gets
collapsed to single spaces on regenerate, silently corrupting the literal.

**Same class of bug as Batch M, different symptom:** Batch M (already
fixed) was about `emitWithKeywords` choosing the wrong continuation
character at a wrap point; this is the same function's tokenizer corrupting
content that was never even near a wrap point, because it isn't
quote-aware at all. Fixing Batch M's continuation-character choice didn't
touch this — they're independent problems in the same function.

**Why this went undetected until now:** none of the existing fixtures
(`sample1.pf`, `sample-scs.pf`, `sample-afpds.pf`) or prior batches' tests
happened to use a quoted keyword literal containing more than one
consecutive internal space. Batch A's `EDTWRD` test was the first to.

**Scope for whoever picks this up:**
1. In `src/prtfWriter.js`, `emitWithKeywords` needs a quote-aware
   tokenizer: split on whitespace *outside* single-quoted spans, but treat
   an entire `'...'` span (including any spaces inside it, and respecting
   DDS's doubled-`''`-means-a-literal-quote escaping) as one indivisible
   token for wrapping purposes.
2. A quoted literal that's itself very long (longer than the ~34-column
   keyword width) still can't be split — same pre-existing, separate
   limitation already noted in Batch M's writeup (long single tokens get
   truncated by `padRight`, not wrapped). Don't try to solve that here;
   just don't make it worse.
3. Re-run `test/prtfBatchA.test.ts` — the "KNOWN BUG" test documenting this
   is written to assert the *current* (broken) behavior; once fixed, that
   assertion should be updated to expect the correct
   `params === "('  .  ')"` and the test's name/comment updated to drop the
   "KNOWN BUG" framing.
4. Add a regression test in `test/prtfWriter.test.ts` (unit-level, against
   `emitWithKeywords` directly, matching that file's existing style)
   alongside the fixture-level one, so this doesn't regress silently again.

**[DONE] — Fixed as follows:**
- `src/prtfWriter.js` gained a new `tokenizeKeywordText(text)` function: a
  quote-aware tokenizer that walks the text character by character,
  tracking whether it's inside a single-quoted span. Outside a quote,
  whitespace splits tokens as before. Inside a quote, everything (including
  spaces) is appended to the current token; a doubled `''` is recognized as
  DDS's escaped-literal-quote convention and kept inside the span rather
  than ending it early; a single `'` not followed by another `'` closes the
  span. `emitWithKeywords` now calls this instead of
  `keywordText.trim().split(/\s+/)`. Exported alongside the existing
  functions in `module.exports` for direct unit testing.
- **Deliberately NOT changed:** the token-rejoining logic inside
  `emitWithKeywords` (`current + " " + tok`, and the `KEYWORD_WIDTH`
  overflow check) — these already only ever operate on whole tokens (now
  including whole quoted-literal tokens), so no change was needed there;
  the fix is entirely in how the text gets split into tokens in the first
  place.
- **Confirmed no interaction with Batch M's fix**: Batch M's
  continuation-character logic (`-` vs `+`) depends only on whether a wrap
  point falls between two tokens — a quoted-literal token is still just one
  token from that logic's point of view, so `-` remains correct at a wrap
  point adjacent to a quoted literal (verified by the new
  "wraps correctly at the NEXT token boundary, not inside the literal"
  test, which pairs a quoted literal with a following keyword forcing a
  real wrap).
- **Same known, separate, out-of-scope limitation as Batch M still
  applies**: a single quoted literal longer than the ~34-column
  `KEYWORD_WIDTH` still can't be split (there's no token boundary inside it
  to wrap at) — it gets truncated by `padRight`, same pre-existing gap
  Batch M's writeup already flagged. Not addressed here, per the batch's
  own scope note.
- Fixtures checked, none needed regenerating (unlike Batch M) — none of
  `sample1.pf`/`sample-scs.pf`/`sample-afpds.pf` contain a quoted literal
  with multiple consecutive internal spaces.
- `test/prtfBatchA.test.ts`'s "KNOWN BUG" test (which pinned the broken
  behavior) was updated in place to assert the correct, fixed
  `EDTWRD` params (`"('  .  ')"`, not `"(' . ')"`) and renamed to drop the
  "KNOWN BUG" framing, per this batch's own instructions above.
- `test/prtfWriter.test.ts` gained 8 new unit tests directly against
  `tokenizeKeywordText` (multi-space literal stays one token; normal
  keyword-to-keyword whitespace still splits; a quoted literal followed by
  another keyword splits at the right boundary; doubled `''` escaping
  doesn't end the span early; multiple quoted literals in one keyword text
  are each kept whole; leading/trailing whitespace doesn't produce empty
  tokens; empty input) plus 2 end-to-end tests against `emitWithKeywords`
  itself (the literal survives regeneration intact; a quoted literal next
  to another keyword still wraps at the correct token boundary, not inside
  the literal).
- Full suite: 186 tests, all passing (177 prior + 9 net new — 8 new
  `tokenizeKeywordText`/`emitWithKeywords` unit tests, plus the existing
  Batch A test fixed in place rather than added as a new one).

## Adding a new batch

If you find scope this board doesn't cover, add a row to the table above and
a "Batch detail" section following the same shape, rather than silently
absorbing it into an existing batch — keeps the board an accurate map of
what's claimed vs. open for the next session.
