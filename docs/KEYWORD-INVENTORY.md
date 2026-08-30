# I-RLU Keyword Inventory

Source: STRRLU screen captures (`Printer_file_RLU.docx`, 61 screens covering the
file/record/field "Work with ... Keywords" pick-lists and their "Specify ..."
parameter panels) cross-checked against IBM's DDS Reference for printer files
(`rzakd` — "DDS for printer files", all currently-supported releases carry the
same keyword set). This supersedes the partial keyword list in
`REQUIREMENTS.md` §4.1, which was written before the screen captures were
available.

Status column legend:
- **modeled** — the parser/writer already round-trip it generically as a
  keyword+params bag (true for anything syntactically valid — the parser
  doesn't hardcode a keyword allow-list).
- **rendered** — `prtfEngine.js` gives it real layout/visual meaning in the
  preview today.
- **UI** — the webview properties panel exposes it for editing today.

Per `docs/ROADMAP.md`, today only `BARCODE, BOX, CPI, FONT, LINE, LPI,
PAGSIZE, SKIPA, SKIPB, SPACEA, SPACEB` are **rendered**, and none have
dedicated **UI** beyond the field/constant positional attributes. Everything
else round-trips correctly (**modeled**) but is invisible/inert in the
preview and unreachable in the UI — that gap is what `docs/TASKS.md` splits
up.

## 1. File-level keywords

Screens: file1–file8 (`image1.png`–`image8.png`).

| Keyword | Params seen on screen | Notes |
|---|---|---|
| `DFNCHR` | Code point, dot-matrix pattern, up to 3 option indicators | Rarely used — defines a custom dot-matrix character. Low priority. |
| `FNTCHRSET` | Font char set name (or P-field), library, code page name (or P-field), library, point-size height/width (or P-field), option indicators | The "P-field" (program-to-system field, i.e. `&FIELDNAME`) indirection recurs on almost every AFPDS sizing/naming parameter — see §5. |
| `INDARA` | (menu entry only, no dedicated screen captured — standard `INDARA(fieldname)`) | Names an indicator-array field for outboard indicator setting. |
| `INDTXT` | Repeating list: indicator + free-text description | Documentation-only keyword (no compile effect) — records what each indicator *means* in the designer, valuable for the properties panel's indicator picker (show text next to indicator checkboxes, mirroring I-SDA's indicator UX). |
| `REF` | Database file, library, record format | Same shape at file/record/field level (`REFFLD` at field level, §3). |
| `SKIPB` / `SKIPA` | Line number 1–255, option indicators | Already **rendered**. Confirmed: IBM doc notes these are **not allowed at the file level for *AFPDS** spooled files — worth a validation warning in the designer when file-level SKIPB/SKIPA is used with an AFPDS-targeted file. |
| `FONTNAME` | (menu entry only) | AFPDS keyword; distinct from `FONT`/`CDEFNT`/`FNTCHRSET` — specifies a font by resource name string rather than coded-font number or char-set/code-page pair. |
| `CCSID` | (menu entry only) | Sets the coded character set ID for the file/record/field's text. |

## 2. Record-level keywords

Screen: image9.png ("Work with Record Keywords") lists all 33 in one grid;
images 10–28 give parameter screens for the ones RLU exposes a dedicated
panel for.

Full list from the menu screen:
```
BOX       LPI       DOCIDXTAG
CDEFNT    OVERLAY   DTASTMCMD
CHRSIZ    PAGRTT    INVMMAP
CPI       PAGSEG    DUPLEX
DFNCHR    PRTQLTY   FORCE
DRAWER    SKIPA     OUTBIN
ENDPAGE   SKIPB     ZFOLD
FNTCHRSET SPACEA    AFPRSC
FONT      SPACEB    STAPLE
HIGHLIGHT TEXT      FONTNAME
INDTXT    STRPAGGRP CCSID
LINE      ENDPAGGRP
```

Parameter detail captured from the screens (not previously in
`REQUIREMENTS.md`):

| Keyword | Parameters | Notes |
|---|---|---|
| `BOX` | `BOX(first-corner-down first-corner-across diagonal-corner-down diagonal-corner-across line-width [color] [shading])`, e.g. `BOX(0 0 2 2 *MEDIUM)` | **No dedicated RLU screen captured in this docx** (menu-grid entry only, same gap as the AFP resource/page-group cluster below) — parameters here are from IBM's DDS reference directly, cross-checked when an earlier draft of the engine used a fictitious `DRAW` keyword and was corrected (`e3693aa`, pre-dating this inventory). **Already the most mature keyword in the codebase**: real geometry rendering (not a placeholder), record-level, AFPDS-only, position/size in the compile's unit of measure (`i-rlu.unitOfMeasure`), `&NAME` parameters flagged approximate. |
| `CDEFNT` | Coded font name/number (or P-field) + library, point-size height/width (or P-field), option indicators | Same "Specify Coded Font" panel shape used at record and field level. |
| `CHRSIZ` | Width multiplier 1.0–20.0, height multiplier 1.0–20.0 | Expands character size; IBM's own doc says this **requires an IPDS printer and is one of the few keywords not supported under Host Print Transform** — worth a designer warning. |
| `CPI` | **10 or 15 only** | Not a free-form number as the current requirements doc implied — confirmed fixed choice list on the RLU screen. |
| `DRAWER` | 1–4 (Forms drawer) | Simple enumerated choice. |
| `FONT` | Font name/number (or P-field), point-size height/width (or P-field), option indicators | |
| `HIGHLIGHT` | Option indicators only (no data param — it's a boolean-style keyword) | **Mutual exclusion** (from IBM doc, not visible on the RLU screen itself): ignored with a warning message if `CDEFNT` or `FNTCHRSET` is also coded on the same record/field — worth surfacing as a live validation in the designer. |
| `LINE` | `LINE(position-down position-across line-length line-direction line-width [line-pad] [color])`, e.g. `LINE(4 3 5 *HRZ .01)` | Same situation as `BOX` above — no dedicated RLU screen in this docx, parameters verified against IBM's DDS reference. Already real-rendered (not a placeholder), record-level, AFPDS-only. |
| `LPI` | **4, 6, 8, 9, or 12 only** | Fixed choice list, not free-form. |
| `PAGRTT` | 0, 90, 180, or 270 | Page rotation in degrees. |
| `PRTQLTY` | 1=Standard, 2=Draft, 3=Near letter, 4=Fast draft | |
| `SKIPA`/`SKIPB`/`SPACEA`/`SPACEB` | Line number (1–255) or line count (0–255) + option indicators | Already rendered; screens confirm the exact ranges. |
| `TEXT` | Free-text comment, no keyword-specific structure | Documentation only. |

The following record-level keywords appear on the menu grid but have **no
screen capture** in this document (the doc's author flagged this explicitly:
*"we have to fetch details of those using IBM I RLU document... to design and
fill them"*) — I pulled their definitions from IBM's DDS reference instead:

| Keyword | Purpose (IBM DDS reference) |
|---|---|
| `ENDPAGE` | Marks the last record format printed on a page — used with page groups. |
| `OVERLAY` (record-level) | Names an AFP overlay resource + vertical/horizontal offset — `OVERLAY(&NAME &VOFF &HOFF)`, all three positional params can be program-to-system fields. |
| `PAGSEG` | Places an AFP page segment (image) resource at a given offset. |
| `STRPAGGRP` / `ENDPAGGRP` | Bracket a set of pages into a named "page group" (used for AFP document indexing / bookmarking). |
| `DOCIDXTAG` | Attaches a document index tag (name + value, optionally from a field) to a page group — used by PSF's AFP document indexing feature for viewers like PDF bookmarks. |
| `DTASTMCMD` | Embeds a raw AFP data-stream "structured field" command — effectively an escape hatch. |
| `INVMMAP` | Invokes a page-segment/medium-map resource mapping — niche. |
| `DUPLEX` | `*NO`/`*YES`/`*TUMBLE` double-sided printing. |
| `FORCE` | Forces the current page out even if not full (page-eject control). |
| `OUTBIN` | Selects an output bin (1–65535 or `*DEVD`) — matches `OVRPRTF OUTBIN` semantics. |
| `ZFOLD` | Z-fold finishing option — **PSF-only**, per IBM doc. |
| `AFPRSC` | Names an arbitrary AFP or non-AFP resource by IFS path (fonts/overlays/page segments/form defs are explicitly **excluded** — those go through their own dedicated keywords). |
| `STAPLE` | Staple finishing — **PSF-only**, per IBM doc. |

Also present in IBM's official keyword list but absent from **both** the RLU
screen captures and any menu entry in this doc — flagged so a future session
doesn't assume they're out of scope, just under-documented here: `GDF`
(Graphics Data Format resource — **PSF-only**), `IGCCDEFNT` (DBCS/IGC coded
font, a variant of `CDEFNT`), `INVDTAMAP`, `UNISCRIPT`. Low priority; add if
real-world source members turn up using them.

## 3. Field-level keywords

Screens: image29.png + image30.png ("Work with Field Keywords", 2 pages) list
all 36; images 31–61 give parameter panels (many identical in shape to the
record-level version of the same keyword — `CDEFNT`, `CHRSIZ`, `CPI`, `FONT`,
`FNTCHRSET`, `SKIPA`, `SKIPB`, `TEXT` all repeat the record-level UI verbatim,
just scoped to a field instead of a record).

Full list from the two menu screens:
```
ALIAS     DFT        PRTQLTY
BARCODE   DLTEDT     REFFLD
BLKFOLD   EDTCDE     SKIPA
CDEFNT    EDTWRD     SKIPB
CHRID     FLTFIXDEC  SPACEA
CHRSIZ    FLTPCN     SPACEB
COLOR     FNTCHRSET  TEXT
CPI       FONT       TIME
CVTDTA    HIGHLIGHT  TIMFMT
DATE      INDTXT     TIMSEP
DATFMT    MSGCON     TRNSPY
DATSEP    PAGNBR     TXTRTT
                      UNDERLINE
                      DTASTMCMD
                      FONTNAME
                      CCSID
```

Field-level parameter detail worth calling out specifically:

| Keyword | Parameters | Notes |
|---|---|---|
| `ALIAS` | Alternative name for the field (a second `Name`) | Simple rename-alias, distinct from the field's DDS name — matters for HLL field references. |
| `BARCODE` | Barcode-ID (name/numeric symbology id), height in lines (1–9) **or** height in UOM (0.25–254.00 cm / 0.10–010.00 in), bar format (1=Horizontal/2=Vertical), human-readable interpretation (1=Below/2=Above/3=None), asterisk-on-CODE3OF9 (Y/N), modifier (00–FE hex), narrow bar width (0.007–0.208), ratio of wide:narrow bar (2.00–3.00), additional 2D parameters (free text) | **Partially rendered already**: `prtfEngine.js`'s `parseBarcodeGeometry` parses bar-code-ID, direction, an HRI on/off flag, and height (line count or UOM) to size/label the placeholder box — but collapses `*HRI`/`*HRITOP` to one boolean instead of the three-way below/above/none the RLU screen exposes, and doesn't parse `*AST`/`*NOAST`, modifier, narrow bar width, ratio, or 2D params at all yet. None of it is editable in the properties panel. See `docs/TASKS.md` Batch C for the precise gap list and fix, Batch D for real symbology rendering, Batch N for the `BARCODE` mutual-exclusion validation. |
| `COLOR` | Named color (Black/Blue/Brown/Green/Pink/Red/Turquoise/Yellow) **or** RGB **or** CMYK **or** CIELAB **or** `HIGHLIGHT`-model, each with up to 3 option indicators | More color models than a simple named-color enum — worth a proper color-model picker in the UI rather than a flat list. |
| `DATE` | Date source: 1=Job / 2=System; Year option: 1=2-digit / 2=4-digit | |
| `DFT` | Literal constant text (e.g. `'X'`) | Default value for the field. |
| `EDTCDE` | Edit code 1–9, A–D, J–Q, W–Z; fill character (`*` or currency symbol) | |
| `EDTWRD` | Free-form edit-word mask string | |
| `FLTPCN` | 1=Single / 2=Double | Floating-point precision. |
| `MSGCON` | Message length 1–132, message identifier (or `*LIST`), message file + library | Pulls constant text from a message file member. |
| `PAGNBR` | Option indicators only | Places the current page number; no other params. |
| `REFFLD` | Field name, record format name, file name, library | Same shape as file-level `REF`; this is the one flagged as high-priority in `REQUIREMENTS.md` §6 for "Resolve Referenced Field via Code for i." |
| `UNDERLINE` | Option indicators only | IBM doc flags: **do not use on AFPDS spooled files distributed to System z** — prints incorrectly there. Worth a designer hint, not a hard block. |

Also confirmed on the generic "Specify Field Information" screens
(image60/61 — these aren't a *keyword* panel, they're RLU's base field
property sheet): data type choices are **1=Character, 2=Zoned, 3=Floating
point, 6=Date, 7=Time, 8=Time stamp** (RLU's own numbering, distinct from the
raw DDS data-type letters `A`/`P`/`S`/`F`/`L`/`T`/`Z` etc. the parser already
reads) — plus a **"Reference a field" Y/N + "Use referenced values" Y/N**
pair of toggles, which is RLU's UI for wiring up `REF`/`REFFLD` on a field:
selecting "reference a field" opens the same file/library/record-format/field
picker as `REFFLD`, and "use referenced values" governs whether the
referenced field's length/type/decimals get pulled in verbatim vs. only used
as a default. This is the concrete UI shape the "Resolve Referenced Field"
open item in the roadmap should replicate.

## 4. Keywords with no RLU screen but confirmed valid (from IBM reference only)

Field-level, no screen captured: `BLKFOLD`, `CHRID`, `CVTDTA`, `DATFMT`,
`DATSEP`, `DLTEDT`, `FLTFIXDEC`, `TIMFMT`, `TIMSEP`, `TRNSPY`, `TXTRTT`,
`DTASTMCMD`, `FONTNAME`, `CCSID` — all appear only on the field-level menu
grid (image29/30) with no dedicated "Specify..." screen photographed. Pulled
from IBM's DDS reference:

| Keyword | Purpose |
|---|---|
| `BLKFOLD` | Blank/fold handling for character data that doesn't fit the field width. |
| `CHRID` | Selects the graphic character set/code page for a printer-resident font. **Mutual exclusion**: ignored (with a message) if `CDEFNT` or `FNTCHRSET` is also coded. |
| `CVTDTA` | Data conversion option for the field's output. |
| `DATFMT` / `DATSEP` | Date format (`*MDY`, `*JUL`, `*ISO`, etc.) and separator character, pairs with `DATE`. |
| `DLTEDT` | Suppresses trailing zero/blank editing on a subset of positions. |
| `FLTFIXDEC` | Converts a floating-point value to fixed-decimal for display, with a specified number of decimal positions. |
| `TIMFMT` / `TIMSEP` | Time format/separator, pairs with `TIME`. |
| `TRNSPY` | Transparency — controls whether the field's background is opaque or see-through over an underlying overlay/page segment. |
| `TXTRTT` | Text rotation — independent of the record-level `PAGRTT` page rotation. |

## 5. Cross-cutting pattern: "P-field" indirection

Almost every AFPDS sizing/naming parameter on these screens (font name,
library, code page, point-size height, point-size width, and more) has a
paired **"... P-field"** entry directly beneath it. This is RLU's UI for
DDS's **program-to-system field** substitution — the actual DDS syntax is
`&FIELDNAME` in place of a literal, meaning the value is supplied by the HLL
program at runtime rather than fixed at compile time.

This is **already a known gap**, called out in `docs/REQUIREMENTS.md` §"Known
limitations" ("Parameters given as program-to-system fields (`&NAME`) can't
be resolved without a live compile/run and are shown at a default position,
flagged in the preview") — but the screen captures make clear this isn't a
rare edge case, it's a first-class alternate input mode on nearly every
AFPDS parameter screen in RLU. The properties-panel work in `docs/TASKS.md`
should give every parameter that supports it a literal-vs-P-field toggle,
consistently, rather than treating it as a one-off.

## 6. Sources
- `Printer_file_RLU.docx` (61 screen captures, this session).
- IBM i DDS Reference: Printer Files (`rzakd` topic collection, all
  currently-documented releases 7.1–7.6 carry an identical keyword list) —
  used for keywords present on the menu grids but not individually
  photographed, and for the mutual-exclusion/PSF-only/AFPDS-restriction
  notes called out above.
