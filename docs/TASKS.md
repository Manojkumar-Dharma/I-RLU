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
| Extension host / compile command | `src/extension.ts` | Batch J only. |
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
| `REF`/`REFFLD` doesn't resolve real type/length/decimals from the referenced file | Actionable | Batch **H** |
| `CRTPRTF` assumes `*CURLIB/QDDSSRC`, no library/source-file/member picker | Actionable | Batch **J** |
| No packaging (`.vsix`) | Actionable | Batch **K** |
| Font resource access unresolved (§9) — real AFP font metrics vs. placeholder | **Partially done** — FGID identification verified/resolved; per-glyph proportional metrics and CDEFNT/FNTCHRSET/FONTNAME resolution still blocked | Batch **L** |

## Task board


| Batch | Description | Keywords in scope | Status | Depends on |
|---|---|---|---|---|
| A | Properties-panel editing: general field/record keywords | `EDTCDE`, `EDTWRD`, `DATE`, `DATFMT`, `DATSEP`, `TIME`, `TIMFMT`, `TIMSEP`, `DFT`, `MSGCON`, `COLOR`, `HIGHLIGHT`, `UNDERLINE`, `PAGNBR`, `PRTQLTY`, `DRAWER`, `PAGRTT` | Not started | none |
| B | Font/sizing keyword editing + shared P-field toggle component | `FONT`, `CDEFNT`, `FNTCHRSET`, `FONTNAME`, `CHRSIZ`, `CHRID`, `CCSID` | Not started | none (but A and C benefit from B's P-field component if B lands first) |
| C | `BARCODE` full parameter surface (still placeholder render) | `BARCODE` | Not started | none |
| D | `BARCODE` real symbol rendering | `BARCODE` | Not started | **C** |
| E | AFP page-group / resource keyword placeholders | `OVERLAY` (record), `PAGSEG`, `STRPAGGRP`, `ENDPAGGRP`, `DOCIDXTAG`, `AFPRSC`, `DTASTMCMD` | Not started | none |
| F | Print/finishing keywords, validation-only | `DUPLEX`, `FORCE`, `OUTBIN`, `ZFOLD`, `STAPLE`, `INVMMAP` | **Done** | none |
| G | Field-level data/edit keywords + indicator text | `ALIAS`, `BLKFOLD`, `CVTDTA`, `DLTEDT`, `FLTFIXDEC`, `FLTPCN`, `TRNSPY`, `TXTRTT`, `INDTXT` | Not started | none |
| H | `REF`/`REFFLD` resolution via Code for i | `REF`, `REFFLD` | Not started | none (needs a live/mocked Code for i connection for full completion — can land the UI shape without it) |
| I | ~~`UOM` modeling~~ **done elsewhere** (see `i-rlu.unitOfMeasure` setting, `docs/ROADMAP.md`) + file-level SKIPA/SKIPB *AFPDS validation | `SKIPA`, `SKIPB` (validation only) | **Done** (validation landed as part of Batch F — see `prtfEngine.js`'s `validateFileLevelKeywords`) | none |
| J | Compile command: library/source-file/member picker | n/a (tooling) | Not started | none |
| K | Packaging (`.vsix`) | n/a (tooling) | Not started | ideally after A–I land, but can be prepped early |
| L | Real AFP font metrics | n/a (data) | Partially done — FGID identification resolved; per-glyph proportional metrics + CDEFNT/FNTCHRSET/FONTNAME still blocked, see REQUIREMENTS.md §9 | none |
| M | ~~**Bug fix:** writer emits wrong continuation character when wrapping mid-token~~ | n/a (parser/writer correctness) | **Done** | none |
| N | `BARCODE` mutual-exclusion validation | `BARCODE` (validation vs. `FONT`, `EDTCDE`, `EDTWRD`, `DATE`, `TIME`, `PAGNBR`, etc.) | Not started | **C** |
| O | Real AFP resource rendering (actual pixel content for page segments/overlays) | `PAGSEG`, `OVERLAY` (record-level) | Blocked — needs external resource files, see REQUIREMENTS.md §8 | **E** |

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
**Goal:** expose every parameter IBM's RLU screen shows (barcode-ID, height
in lines or UOM, bar format, HRI position, asterisk-on-CODE3OF9, modifier,
narrow bar width, wide:narrow ratio, additional 2D params — full list in
KEYWORD-INVENTORY §3) in the properties panel. Rendering stays the existing
labeled placeholder box; this batch is UI/model only.
- Validate ranges as shown on the RLU screen (e.g. ratio 2.00–3.00, narrow
  bar width 0.007–0.208) client-side in the webview form.
- Tests: round-trip full BARCODE parameter set.

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

### Batch G — Field-level data/edit keywords + indicator text
**Goal:** `ALIAS` (simple rename field), `BLKFOLD`/`CVTDTA`/`DLTEDT`/
`FLTFIXDEC`/`FLTPCN`/`TRNSPY`/`TXTRTT` (simple enumerated/numeric forms per
KEYWORD-INVENTORY §3/§4), and `INDTXT` — the last one is the interesting
one: it's a documentation-only keyword (indicator number → free text) that
should feed into the **existing indicator-toggle panel** so indicators show
their human-readable meaning next to the checkbox, matching the UX I-SDA
already has for the same concept on DSPF. Check I-SDA's implementation
(`I-SDA/src/dspfEngine.js` / webview client) for the pattern before building
this from scratch.
- Tests: round-trip for the simple keywords; a specific test that `INDTXT`
  text shows up correctly attached to the right indicator in the resolved
  model passed to the webview.

### Batch H — REF/REFFLD resolution
**Goal:** two parts, can be split further if needed:
1. **UI shape** (no Code for i needed): replicate RLU's own field-property
   pattern confirmed in KEYWORD-INVENTORY §3 — a "Reference a field" Y/N
   toggle that opens a file/library/record-format/field picker, plus a
   separate "Use referenced values" Y/N toggle governing whether the
   referenced field's length/type/decimals are pulled in verbatim vs. only
   defaulted. This can be built and tested against manually-entered
   type/length/decimals without a live IBM i.
2. **Live resolution** (needs Code for i): actually query the referenced
   physical file's field definition via Code for i's API, same integration
   pattern as the existing `CRTPRTF` compile command in `src/extension.ts`.
   This part is legitimately blocked without a connected test environment —
   land part 1 first regardless.
- Tests: part 1 fully testable with mocked reference data; part 2 needs
  either a live IBM i in CI (unlikely available) or a mocked Code for i
  client — follow whatever mocking pattern I-SDA's tests use for its
  Code for i integration, if any.

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

### Batch K — Packaging
**Goal:** `vsce package` producing a real `.vsix`. Mostly checking
`package.json` metadata (icon, categories, publisher, repository fields all
already partially present per `package.json`), adding a `.vscodeignore` if
missing (I-SDA has one — copy its shape, adjust for I-RLU's actual file
list), and confirming `npm run compile` output is what gets packaged.
Low-risk to do early even if other batches aren't finished — packaging an
incomplete-but-working extension is fine for internal testing.

### Batch L — Real AFP font metrics [PARTIALLY DONE]
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
Roman) families — current implementation uses a rough Helvetica-shaped
placeholder table, not IBM's actual font character-set/code-page width
data, so proportional text layout is still approximate. Also unresolved:
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


## Adding a new batch

If you find scope this board doesn't cover, add a row to the table above and
a "Batch detail" section following the same shape, rather than silently
absorbing it into an existing batch — keeps the board an accurate map of
what's claimed vs. open for the next session.
