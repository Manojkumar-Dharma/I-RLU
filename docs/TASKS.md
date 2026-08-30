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

## Task board

| Batch | Description | Keywords in scope | Status | Depends on |
|---|---|---|---|---|
| A | Properties-panel editing: general field/record keywords | `EDTCDE`, `EDTWRD`, `DATE`, `DATFMT`, `DATSEP`, `TIME`, `TIMFMT`, `TIMSEP`, `DFT`, `MSGCON`, `COLOR`, `HIGHLIGHT`, `UNDERLINE`, `PAGNBR`, `PRTQLTY`, `DRAWER`, `PAGRTT` | Not started | none |
| B | Font/sizing keyword editing + shared P-field toggle component | `FONT`, `CDEFNT`, `FNTCHRSET`, `FONTNAME`, `CHRSIZ`, `CHRID`, `CCSID` | Not started | none (but A and C benefit from B's P-field component if B lands first) |
| C | `BARCODE` full parameter surface (still placeholder render) | `BARCODE` | Not started | none |
| D | `BARCODE` real symbol rendering | `BARCODE` | Not started | **C** |
| E | AFP page-group / resource keyword placeholders | `OVERLAY` (record), `PAGSEG`, `STRPAGGRP`, `ENDPAGGRP`, `DOCIDXTAG`, `AFPRSC`, `DTASTMCMD` | Not started | none |
| F | Print/finishing keywords, validation-only | `DUPLEX`, `FORCE`, `OUTBIN`, `ZFOLD`, `STAPLE`, `INVMMAP` | Not started | none |
| G | Field-level data/edit keywords + indicator text | `ALIAS`, `BLKFOLD`, `CVTDTA`, `DLTEDT`, `FLTFIXDEC`, `FLTPCN`, `TRNSPY`, `TXTRTT`, `INDTXT` | Not started | none |
| H | `REF`/`REFFLD` resolution via Code for i | `REF`, `REFFLD` | Not started | none (needs a live/mocked Code for i connection for full completion — can land the UI shape without it) |
| I | ~~`UOM` modeling~~ **done elsewhere** (see `i-rlu.unitOfMeasure` setting, `docs/ROADMAP.md`) + file-level SKIPA/SKIPB *AFPDS validation still open | `SKIPA`, `SKIPB` (validation only) | UOM done; validation not started | none |
| J | Compile command: library/source-file/member picker | n/a (tooling) | Not started | none |
| K | Packaging (`.vsix`) | n/a (tooling) | Not started | ideally after A–I land, but can be prepped early |
| L | Real AFP font metrics | n/a (data) | Blocked — needs font resource data, see REQUIREMENTS.md §9 | none |
| M | **Bug fix:** writer emits wrong continuation character when wrapping mid-token | n/a (parser/writer correctness) | Not started — logged below, not yet fixed | none |

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

### Batch F — Print/finishing keywords (validation only)
**Goal:** these don't change the page layout at all — they affect physical
printer behavior. Just: (1) let them be added/edited/removed through the
properties panel like any other keyword, (2) add validation warnings per
IBM's documented restrictions — `ZFOLD`, `STAPLE`, and `GDF` (if later added)
are PSF-only; surfacing "this requires PSF printing" as a hint is enough,
don't try to detect the target printer's actual capabilities.
- Tests: round-trip only; no rendering test needed.

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

### Batch L — Real AFP font metrics
**Blocked** pending font resource data per `docs/REQUIREMENTS.md` §9 — no
action until that's resolved. Don't start this batch without first checking
whether that open question has been answered in a more recent conversation/
commit than this task board.

### Batch M — Fix writer's continuation-character bug
**Found by:** `test/prtfFixtures.test.ts`'s round-trip test against
`sample-afpds.pf` (added alongside `docs/KEYWORD-INVENTORY.md`), which
failed 2/26 tests on first run.

**The bug:** `src/prtfWriter.js` always emits `+` continuation when wrapping
a record/field's keyword area onto a following line, regardless of whether
the wrap point falls between two tokens that need a space preserved between
them. Real DDS distinguishes `+` (no implied space at the join — used when
wrapping mid-token, e.g. splitting a long name or literal) from `-` (implied
single space at the join — used when wrapping between two space-separated
tokens). Concretely:

```
PAGSEG(COMPLOGO 0.5 0.5)
```
wrapped by the writer at column 80 becomes:
```
PAGSEG(COMPLOGO +
0.5 0.5)
```
(`+` continuation), which the parser correctly interprets as "no space at
the join" per real DDS semantics — reparsing this reconstructs
`PAGSEG(COMPLOGO0.5 0.5)`, silently corrupting the token. The writer should
have chosen `-` continuation here, since the wrap point sits between
`COMPLOGO` and `0.5` where a space belongs.

**Why this went undetected until now:** the original `sample1.pf` fixture
never happened to produce a keyword area that both (a) exceeds the line
width and (b) wraps exactly at a space-separated token boundary. `PAGSEG`'s
longer parameter list in `sample-afpds.pf` did.

**What's already confirmed correct:** the parser's `keywordAreaOf` /
continuation-join logic (`src/prtfParser.ts`) already handles `+` vs `-`
correctly on read — this is purely a write-side bug in the continuation
character *choice*, not in how either character is interpreted.

**Scope for whoever picks this up:**
1. In `src/prtfWriter.js`, find where the keyword-area line-wrapping decides
   the trailing continuation character (currently hardcoded to `+`) and make
   it choose `-` when the wrap point falls immediately after a space in the
   source keyword text (i.e. the next token would otherwise lose its
   leading space), `+` otherwise (mid-token wraps, which should remain rare
   given DDS keyword syntax but are valid for things like long literal
   constants).
2. Re-run `test/prtfFixtures.test.ts` — both currently-failing round-trip
   assertions (`sample-afpds.pf`'s full round-trip, and the `STRPAGGRP`/
   `PAGSEG`/`OVERLAY` content assertion that depends on it) should pass
   without any fixture changes.
3. Add a small, narrow regression test — e.g. force-wrap a keyword area at a
   known space boundary and assert `-` continuation is chosen — rather than
   relying solely on the AFPDS fixture happening to still exercise this path
   if it's edited later.
4. Do **not** touch `src/prtfParser.ts` for this batch — it's already
   correct; changing it would risk masking the actual writer bug.


## Adding a new batch

If you find scope this board doesn't cover, add a row to the table above and
a "Batch detail" section following the same shape, rather than silently
absorbing it into an existing batch — keeps the board an accurate map of
what's claimed vs. open for the next session.
