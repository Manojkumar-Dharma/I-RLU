# I-RLU — Interactive Report Layout Utility
### Requirements & Architecture Draft (v0.1) — modeled on I-SDA

## 1. What this replaces

IBM i's `STRRLU` (Report Layout Utility) is the green-screen tool for designing
**printer file DDS** (`*PRTF` source, usually a `.rlu`/`.pf` member type):
placing fields and constants on a page grid, setting spacing/skip keywords,
drawing lines and boxes, and wiring up conditioning indicators — all in a
fixed-column source editor with a separate "design" screen you toggle to.

I-RLU's job is the same trade I-SDA made for SDA: keep the **DDS source as the
single source of truth**, but replace the STRRLU screen with a live,
click-and-drag **page preview** rendered in a VS Code webview, with edits
written straight back into the fixed-column source.

## 2. Core scope difference from I-SDA (DSPF → PRTF)

| Aspect | I-SDA (DSPF) | I-RLU (PRTF) |
|---|---|---|
| Canvas | 24x80 (or 27x132) interactive screen | Page grid — width/height driven by `PAGESIZE`/`PRTMAX`/measurements, printable in inches or characters |
| Primary keywords | `DSPATR`, `COLOR`, `WINDOW`, `SFL`/`SFLCTL`, `CHCCTL` | `SKIPB`/`SKIPA`, `SPACEB`/`SPACEA`, `OVERLAY`, `LINE`, `BOX`, `BARCODE`, `FONT`, `CPI`/`LPI`, `PAGSIZE`, `PRTQLTY` |
| Interactivity model | Live "what would the 5250 screen show" incl. indicator toggling | Live "what would the printed page look like" incl. indicator toggling and page-break/overflow behavior |
| Subfiles | Yes (`SFL`/`SFLCTL`) — major complexity driver | No subfiles in printer files — simpler in this respect |
| Windows | Yes (`WINDOW` keyword, placeholder geometry) | No windows |
| Companion "menu" artifact | MNUDDS + MNUCMD pair | None — PRTF is self-contained (no I-RLU equivalent of the menu designer) |
| Output paths | Single output (5250 display) | Two real output paths: SCS (line-printer, char-cell) and AFPDS (host/PC printer, supports fonts, page segments, overlays) — **needs an explicit scoping decision**, see §7 |
| Compile command | `CRTDSPF` | `CRTPRTF` |

## 3. Architecture (mirrors I-SDA's split)

| Piece | Suggested file | Responsibility |
|---|---|---|
| Parser | `src/prtfParser.ts` / `src/prtfModel.ts` | Fixed-column PRTF DDS source → structured model (records, fields, constants, keywords, conditioning indicators, continuation lines) |
| Resolver / renderer | `src/prtfEngine.js` | Model + active indicators + page geometry → resolved page layout → HTML/canvas grid (character-cell grid for SCS-style preview; optionally a "true to font" mode later for AFPDS) |
| Writer | `src/prtfWriter.js` | Edited field/constant/keyword data → regenerated fixed-column source lines, spliced back into the original text, everything else untouched |
| Extension host | `src/extension.ts` | `CustomTextEditorProvider` for the designer webview, syncing with the real document both directions via `WorkspaceEdit` — same pattern as I-SDA |
| Webview | `src/buildWebviewTemplate.js` → `src/webviewTemplate.ts` (generated) | Bakes engine/writer/parser into one self-contained webview HTML string |

No menu-webview equivalent is needed (PRTF has no MNUDDS/MNUCMD pairing), so
I-RLU should be structurally simpler than I-SDA overall — one designer, one
webview, no sibling-file bookkeeping.

## 4. Functional requirements (RLU parity checklist)

### 4.1 Parsing / model
- Full fixed-column PRTF DDS grammar: record-level entries, field entries,
  constant entries, keyword continuation lines, comment lines (`*` in
  position 7), conditioning indicators (positions 7–16, incl. `N` for
  negation).
- **Full keyword inventory gathered from RLU's own screens (file/record/field
  level pick-lists, 77 keywords across the three levels) plus IBM's DDS
  reference for the handful not individually photographed — see
  `docs/KEYWORD-INVENTORY.md` for the complete table, parameter ranges, and
  documented mutual-exclusion/restriction rules (e.g. `CPI` is only 10 or 15,
  not free-form; `LPI` is only 4/6/8/9/12; `HIGHLIGHT`/`CHRID` are silently
  ignored when `CDEFNT`/`FNTCHRSET` is also coded; `SKIPA`/`SKIPB` aren't
  allowed at the file level for `*AFPDS`).** The parser doesn't hardcode a
  keyword allow-list — any `NAME(params)` shape round-trips generically — but
  the engine/UI work in `docs/TASKS.md` is scoped against that inventory.
- Recurring **"program-to-system field" (`&NAME`) indirection** on most
  AFPDS sizing/naming parameters (font, library, code page, point sizes) —
  see `docs/KEYWORD-INVENTORY.md` §5. Already flagged as a known limitation
  below; the inventory doc confirms it's pervasive rather than rare.
- Round-trip guarantee: parse → model → regenerate must reproduce byte-identical
  source when nothing was edited (same test discipline I-SDA used against
  IBM's published DDS examples).

### 4.2 Rendering / preview
- Page-grid preview at the record-format's resolved `PAGSIZE`, with visible
  margins and a ruler (row/column) like RLU's own design screen.
- Field and constant placement, drag-to-reposition, click to select/edit
  properties (position, length, type, edit code/word, referenced field).
- `SKIPB`/`SKIPA`/`SPACEB`/`SPACEA` reflected as vertical whitespace/page
  advance in preview, since these are RLU's primary layout mechanism
  (no direct DSPF equivalent).
- `LINE`/`BOX` (record-level, AFPDS-only) rendered as actual lines/boxes on
  the page grid, converted from the physical units they're specified in
  (inches, per unit of measure) to the character grid via CPI/LPI — this is
  a commonly used RLU feature and was prioritized accordingly. Note: there
  is no `DRAW` keyword in real DDS — an earlier draft of this document used
  that name in error before the actual `LINE`/`BOX` syntax was verified
  against IBM's DDS reference; corrected here and throughout the codebase.
- Conditioning-indicator toggling in the preview (same UX as I-SDA: check
  boxes to flip indicators on/off and see the record re-resolve).
- Overflow-record handling: distinguish the normal detail record(s) from the
  `OVERFLOW`-triggered record, and let the designer preview both.
- Multiple record formats per source member, with a format switcher (same
  as I-SDA's "compare mode" concept, adapted — read-only compare view showing
  overlay stacking order for `OVERLAY` records).

### 4.3 Editing / writer
- All the above properties editable through property panels, writing back
  to exact fixed-column positions without disturbing untouched lines —
  identical discipline to `dspfWriter.js`.
- "+ Field" / "+ Constant" click-to-place, matching I-SDA's field-placement UX.
- Copy field/constant, whole-record create/copy/delete (ported directly from
  I-SDA's existing implementation — same operations apply here).
- Rename-with-reference-fix for named fields; delete-with-reference-warning
  for fields still referenced by keywords elsewhere in the record.

### 4.4 Compile / Code for i integration
- **"Compile Printer File (CRTPRTF)"** command via `code-for-ibmi.runCommand`,
  mirroring I-SDA's "Compile Menu (CRTMNU)" command — requires a real,
  connected IBM i member, same limitation I-SDA documents for CRTMNU.
- Support the same three source locations I-SDA supports: remote IBM i
  source member (`member:` scheme via Code for i), local file, and IFS
  streamfile (`streamfile:` scheme via Code for i).

## 5. Non-functional / carried-over engineering decisions from I-SDA
- TypeScript for the parser (compiled to CommonJS for Node/tests, bundled to
  a browser IIFE via esbuild for the webview); engine/writer as
  dependency-free plain JS so identical code runs in Node (tests) and the
  webview (no bundler needed there).
- Round-trip tests as the primary correctness gate: edit → regenerate source
  lines → re-parse → confirm nothing else changed.
- `CustomTextEditorProvider`, not a separate webview panel disconnected from
  the document — keeps VS Code's undo stack, save, and diffing all working
  normally on the real file.

## 6. Explicit known gaps to carry into a "Known limitations" section (draft)
Each of these is tracked as a batch or explicit permanent constraint in
`docs/TASKS.md`'s "Known limitations → task mapping" section.
- AFPDS-specific rendering (real fonts, page segments, overlays as actual
  graphics) is a much bigger lift than SCS char-grid rendering — likely
  out of scope for an initial release; render AFPDS records in char-grid
  mode with keyword values shown, not true WYSIWYG. *(Permanent for v1; the
  actionable slices are Batch L — font metrics — and Batch O — resource
  pixel content, both blocked pending external data access)*
- `BARCODE` rendering as an actual scannable barcode graphic vs. a labeled
  placeholder box — placeholder is the pragmatic v1 choice. *(Batch D,
  depends on Batch C)*
- Numeric edit-code/edit-word formatting: same caveat I-SDA documents for
  DSPF — approximate width only, no live-system verification. *(Permanent,
  explicit non-goal — see Batch A's detail in TASKS.md)*
- Referenced-field resolution (`REF`/`REFFLD` pulling real type/length/decimals
  from a physical file) — I-SDA lists "Resolve Referenced Field via Code for
  i" as planned-not-built; I-RLU should plan for it from the start since PRTF
  makes heavy use of `REF`. *(Batch H)*

## 7. Decisions (confirmed)
- **AFPDS is in scope from day one**, not deferred behind SCS. This changes
  §3/§6 materially — see §8 below for what that adds to the architecture.
- **Clean-room build.** No reuse of I-SDA's `dspfParser.ts`/`dspfEngine.js`
  source. The DDS grammar knowledge and round-trip testing discipline carry
  over conceptually, but the code is written fresh against PRTF's own
  grammar rather than adapted from the DSPF parser.
- **GitHub push**: you'll provide a personal access token when we're ready
  to push. When you do, paste it directly to me and I'll use it once via git
  from the sandboxed environment (`git remote add origin
  https://<token>@github.com/Manojkumar-Dharma/I-RLU.git`, push, then drop the
  remote) — I won't echo it back or store it anywhere persistent. Recommend a
  **fine-grained token scoped only to the `I-RLU` repo, with contents
  read/write and a short expiration**, and revoke/rotate it once the initial
  push is done — no need to leave a long-lived token active for this.

## 8. Added scope: AFPDS from day one

Committing to AFPDS up front pulls in real complexity that plain SCS
character-grid rendering avoids. This needs to be designed in from the
start rather than bolted on later:

| Piece | Suggested file | Responsibility |
|---|---|---|
| AFP font metrics | `src/afpFontMetrics.ts` | Coded-font → per-character advance-width table, so field/constant text lays out at real proportional widths instead of assuming monospace. Needs a bundled table of IBM's standard coded fonts (the common `FONT(nnn)` numeric values) at minimum. |
| Resource resolver | `src/afpResourceResolver.ts` | Handles `PAGSEG`, `OVERLAY`(resource-type usage, distinct from the record-level `OVERLAY` keyword), and image/page-segment references — renders a labeled placeholder box when the actual resource file isn't available to the parser (it usually won't be, since those are IFS/host objects, not part of the DDS source itself). |
| Unit-of-measure handling | (in `prtfEngine.js`) | AFPDS records can specify `PAGSIZE`/positions in inches or millimeters via `UOM`, not just character rows/cols — the resolver needs to convert consistently for layout math. |

**Hard limit that doesn't go away regardless of priority:** actual page
segments and overlay graphics (scanned logos, pre-printed form images) are
external AFP resource objects, not DDS source text. Even with AFPDS as a
first-class target, I-RLU can position and size their bounding box correctly
but can't render their real pixel content unless those resource files are
also supplied to the tool. Worth flagging in the README's "Known
limitations" section from the first release rather than presenting AFPDS
support as fully WYSIWYG.

## 9. Font resource access — update

**Resolved (in part):** `FONT`/FGID identification is now backed by a
table verified against IBM's own FGID/typeface documentation (Printer
Device Programming, the AFP Font Collection reference, IBM support pages
on font substitution). It correctly distinguishes fixed-pitch families
(Courier, Gothic, OCR A/B) from proportional ones (Helvetica, Times New
Roman), including the scalable-but-still-monospace Courier FGIDs
(416/420/424/428), and converts *POINTSIZE for scalable monospace fonts to
an equivalent CPI. One correction made along the way: an earlier version of
this table (mislabeling FGID 416 as "Times Roman") was checked against IBM
docs and fixed — real Times New Roman Medium is FGID 2308. See
`src/afpFontMetrics.js` for the full table and sourcing notes.

**Still open:** real per-glyph advance widths for the proportional
(Helvetica/Times New Roman) families — the current implementation uses a
rough placeholder table, not IBM's actual font character-set/code-page
width data, so proportional text still lays out approximately, not
precisely. Also still unresolved: `CDEFNT` (coded font), `FNTCHRSET` (host
font character set + code page), and `FONTNAME` (TrueType/OpenType by
name) — these reference host/IFS font objects that `FONT`/FGID doesn't
touch at all, and none of the three are parsed for font resolution yet. A
promising direction raised for closing this gap: extracting real font data
from a connected IBM i (TrueType files under
`/QIBM/UserData/OS400/Fonts/TTF/`, or FOCA font character-set metrics via
host APIs) — worth pursuing, but the specific paths/API names for that
haven't been independently verified yet, so nothing has been built against
them.
