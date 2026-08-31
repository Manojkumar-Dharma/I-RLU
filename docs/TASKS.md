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
| Page segments/overlays render as nothing, not even a placeholder box | Actionable | Batch **E** |
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
| A | Properties-panel editing: general field/record keywords | `EDTCDE`, `EDTWRD`, `DATE`, `DATFMT`, `DATSEP`, `TIME`, `TIMFMT`, `TIMSEP`, `DFT`, `MSGCON`, `COLOR`, `HIGHLIGHT`, `UNDERLINE`, `PAGNBR`, `PRTQLTY`, `DRAWER`, `PAGRTT` | **In progress** | none |
| B | Font/sizing keyword editing + shared P-field toggle component | `FONT`, `CDEFNT`, `FNTCHRSET`, `FONTNAME`, `CHRSIZ`, `CHRID`, `CCSID` | Not started | none (but A and C benefit from B's P-field component if B lands first) |
| C | `BARCODE` full parameter surface (still placeholder render) | `BARCODE` | Not started | none |
| D | `BARCODE` real symbol rendering | `BARCODE` | Not started | **C** |
| E | AFP page-group / resource keyword placeholders | `OVERLAY` (record), `PAGSEG`, `STRPAGGRP`, `ENDPAGGRP`, `DOCIDXTAG`, `AFPRSC`, `DTASTMCMD` | Not started | none |
| F | Print/finishing keywords, validation-only | `DUPLEX`, `FORCE`, `OUTBIN`, `ZFOLD`, `STAPLE`, `INVMMAP` | **Done** | none |
| G | Field-level data/edit keywords + indicator text | `ALIAS`, `BLKFOLD`, `CVTDTA`, `DLTEDT`, `FLTFIXDEC`, `FLTPCN`, `TRNSPY`, `TXTRTT`, `INDTXT` | **Done** | none |
| H | `REF`/`REFFLD` resolution via Code for i | `REF`, `REFFLD` | Part 1 (UI shape + pure resolution logic) done; part 2 (live Code for i round-trip) written but unverified — needs a real connected IBM i | none (needs a live/mocked Code for i connection for full completion — can land the UI shape without it) |
| I | ~~`UOM` modeling~~ **done elsewhere** (see `i-rlu.unitOfMeasure` setting, `docs/ROADMAP.md`) + file-level SKIPA/SKIPB *AFPDS validation | `SKIPA`, `SKIPB` (validation only) | **Done** (validation landed as part of Batch F — see `prtfEngine.js`'s `validateFileLevelKeywords`) | none |
| J | Compile command: library/source-file/member picker | n/a (tooling) | Not started | none |
| K | Packaging (`.vsix`) | n/a (tooling) | **Done** | ideally after A–I land, but can be prepped early |
| L | Real AFP font metrics | n/a (data) | Mostly done — FGID identification resolved; proportional widths now use real published Adobe AFM data (metric-compatible substitute fonts, not verified IBM FGID resource extraction); CDEFNT/FNTCHRSET/FONTNAME still unresolved, see REQUIREMENTS.md §9 | none |
| M | ~~**Bug fix:** writer emits wrong continuation character when wrapping mid-token~~ | n/a (parser/writer correctness) | **Done** | none |
| N | `BARCODE` mutual-exclusion validation | `BARCODE` (validation vs. `FONT`, `EDTCDE`, `EDTWRD`, `DATE`, `TIME`, `PAGNBR`, etc.) | Not started | **C** |
| O | Real AFP resource rendering (actual pixel content for page segments/overlays) | `PAGSEG`, `OVERLAY` (record-level) | Blocked — needs external resource files, see REQUIREMENTS.md §8 | **E** |
| P | Add/rename/delete/reorder record formats from the designer | n/a (tooling/UI, not a keyword) | Not started | none |
| Q | Copy/duplicate a field or constant | n/a (tooling/UI, not a keyword) | Not started | none |

## Batch detail

### Batch A — General properties-panel keywords
**Goal:** each keyword gets a form section in the properties panel (mirroring
the RLU "Specify ..." screens in `docs/KEYWORD-INVENTORY.md` §2/§3) that
reads/writes through the existing generic keyword model — no new engine
rendering required except where noted.
- `EDTCDE`/`EDTWRD`: text/dropdown inputs; **no preview rendering change**
  needed beyond what the field already shows (edit codes affect numeric
  display formatting in real DDS, but exact-format preview is explicitly
  out of scope per `docs/REQUIREMENTS.md` §6's "approximate width only"
  caveat — don't scope-creep into a full edit-code formatter here).
- `DATE`/`DATFMT`/`DATSEP`, `TIME`/`TIMFMT`/`TIMSEP`: dropdowns matching the
  RLU screen's exact choice lists (KEYWORD-INVENTORY §3).
- `DFT`: literal text input.
- `MSGCON`: message length/id/file/library form; no need to actually resolve
  message text from a message file (that would need Code for i) — just
  round-trip the keyword params.
- `COLOR`: build a proper model picker (named / RGB / CMYK / CIELAB /
  HIGHLIGHT), not a flat dropdown — KEYWORD-INVENTORY §3 has the exact
  choice sets from both "Work with Colors" screens.
- `HIGHLIGHT`, `UNDERLINE`: boolean-ish (option-indicators-only) — simple
  toggle + indicator picker. **Add a live validation hint** when `HIGHLIGHT`
  is set alongside `CDEFNT`/`FNTCHRSET` on the same record/field (IBM docs:
  silently ignored otherwise — surfacing this beats silent failure).
- `PAGNBR`, `PRTQLTY`, `DRAWER`, `PAGRTT`: simple enumerated/numeric inputs
  per the exact ranges in KEYWORD-INVENTORY §2.
- Tests: `test/propertiesPanelBatchA.test.ts` (or `.js`, match existing test
  runner convention) — round-trip each keyword through add/edit/remove.

### Batch B — Font/sizing + shared P-field component
**Goal:** build one reusable "literal or program-to-system field" input
component and use it for every parameter in `FONT`, `CDEFNT`, `FNTCHRSET`,
`FONTNAME`, `CHRSIZ`, `CHRID`, `CCSID`. This is worth building once, well,
since KEYWORD-INVENTORY §5 shows the same pattern recurring across nearly
every AFPDS sizing/naming parameter — other batches (A, C) may want to reuse
it once it exists.
- Component behavior: a toggle or paired fields — literal value entry, or a
  "P-field" entry that accepts a field name and renders as `&FIELDNAME` in
  the generated DDS. When a P-field is used, the preview should render the
  existing "flagged default position" treatment already used for other
  program-to-system fields (per `docs/REQUIREMENTS.md`'s known limitations),
  not attempt to resolve it.
- Model consideration: check whether `prtfModel.ts` needs any addition to
  distinguish "this param is a P-field reference" cleanly, or whether it's
  already representable as-is (the DDS text itself, `&NAME` vs a literal, may
  already round-trip fine through the generic model — confirm before adding
  new model surface).
- Tests: round-trip literal and P-field variants of each keyword.

### Batch C — BARCODE parameter surface
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

### Batch D — BARCODE real rendering
**Goal:** replace the placeholder box with an actual rendered symbol, reading
from the parameters Batch C exposes. Needs a barcode-generation library
(check what's available/bundleable for a webview context — likely a small
pure-JS symbology library rather than anything with native deps, since this
runs inside a VS Code webview). Scope to the symbologies IBM's DDS BARCODE
keyword actually supports; don't over-build.
- **Depends on Batch C** landing first (needs its parameter surface).

### Batch E — AFP page-group / resource placeholders
**Goal:** per `docs/REQUIREMENTS.md` §8's documented hard limit, these can
never show real resource pixel content without the resource files
themselves — but today they're **completely invisible** in the preview,
which is worse than a labeled placeholder. Render each as a labeled box
(resource name + keyword) similar to the existing PAGSEG-adjacent treatment
mentioned in the roadmap, and make the keyword's params editable.
- `OVERLAY` (record-level): 3-param form (`&NAME`/name, vertical offset,
  horizontal offset) — note this is a *different* keyword shape from field-
  level considerations; don't confuse with any other same-named construct.
- `PAGSEG`, `STRPAGGRP`/`ENDPAGGRP`, `DOCIDXTAG`, `AFPRSC`, `DTASTMCMD`: see
  KEYWORD-INVENTORY §2 for each one's purpose; most just need a name/path
  field and don't need deep parameter modeling.
- Tests: round-trip + confirm placeholder box appears in engine output.

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

### Batch H — REF/REFFLD resolution [PART 1 DONE]
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
   RLU UI shape — no live file/library/record-format/field *picker* yet
   (that would need Code for i's own browsing API), just direct text entry,
   which is enough for the toggle pair's own semantics and for round-trip
   correctness.
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
- Tests (`test/prtfReferenceField.test.ts`): part 1 is fully covered —
  every precedence rule in `resolveReferenceTarget`'s doc comment, the
  `upsertReffldKeyword` add/replace/remove cases, and a parse → regenerate
  round trip for a field carrying `REFFLD`. Part 2 has no test — same
  reasoning as the roadmap entry: it needs either a live IBM i in CI
  (unlikely available) or a mocked Code for i client, and I-SDA's own test
  suite doesn't mock its Code for i integration either, so there's no
  established pattern here to follow.
- **Not done, left for a future batch/session:** a real file/library/
  record-format/field *picker* (currently direct text entry) — this needs
  Code for i's own object-browsing API, a separate integration from the
  DSPFFD resolution built here, and IS-DA's own Task L14
  (`fetchDatabaseFileFields`/`listDatabaseFields`) is the closest existing
  pattern to follow for it.

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
- Added `.vscodeignore` (I-SDA wasn't reachable to copy its shape from — it
  doesn't appear to be a public repo — so this follows standard `vsce`
  convention instead: ship `out/**/*.js` plus `package.json`/`README.md`,
  exclude `src/`, `media/`, `test/`, `docs/`, source maps, and
  `node_modules/` since there are no runtime `dependencies`).
- Added `@vscode/vsce` as a devDependency, plus `vscode:prepublish` (runs
  `npm run compile` — `vsce` invokes this automatically before packaging)
  and `package` (`vsce package`) npm scripts.
- Verified end-to-end: `npm run package` produces `i-rlu-0.0.1.vsix`
  (43.96 KB, 12 files) with the corrected `main` entry point; `npm test`
  still passes (50/50) afterward.
- **Not done, flagged rather than guessed at:** `vsce package` warns that
  no `LICENSE`/`LICENSE.md`/`LICENSE.txt` is present. Not fixed here since
  choosing a license is the repo owner's call, not a packaging-mechanics
  decision — add one (and a matching `"license"` field in `package.json`)
  whenever that's decided. No `icon` was added either, for the same
  "needs a real decision, not a default" reason — `vsce` packages fine
  without one, VS Code just shows a generic icon in the Marketplace/Extensions
  view until it's set.

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
under `/QIBM/UserData/OS400/Fonts/TTF/`, or FOCA font character-set
metrics via host APIs) — worth pursuing, but those specific paths/API
names haven't been independently verified, so don't build against them
without checking first (same discipline that caught the FGID 416 error).

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

### Batch N — BARCODE mutual-exclusion validation
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

### Batch P — Add/rename/delete/reorder record formats from the designer
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


## Adding a new batch

If you find scope this board doesn't cover, add a row to the table above and
a "Batch detail" section following the same shape, rather than silently
absorbing it into an existing batch — keeps the board an accurate map of
what's claimed vs. open for the next session.
