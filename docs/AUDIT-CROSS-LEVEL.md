# Cross-Level Keyword Applicability Audit

A fourth pass, requested directly by Manoj: confirm that *every* keyword the
DDS printer-file reference documents (`docs/DDS-PRINTER-FILE-REFERENCE.txt`)
is accounted for at *every* level it's genuinely valid at — file, record,
and/or field — not just at one level in isolation. The three prior audits
(`docs/AUDIT-FILE-LEVEL.md`, `docs/AUDIT-RECORD-LEVEL.md`,
`docs/AUDIT-FIELD-LEVEL.md`) each scoped themselves to one level at a time;
this audit's whole point is the seam between them — a keyword valid at two
or three levels that I-RLU only actually handles at one.

Method: every real keyword section in the reference (`NAME (...) keyword in
printer files`, plus `CCSID` which is titled slightly differently) was
located — 65 in total — and its own applicability sentence ("You use this
file-level/record-level/field-level keyword...") extracted to build a
definitive level matrix (below). Parsing itself turned out to be a
non-issue: `src/prtfParser.ts` captures whatever keyword text appears
wherever it appears, with no per-level allowlist (confirmed by reading
every `.keywords.push(...)` call site) — so "is a keyword available"
resolves to two narrower, more useful questions per level: does the
properties-panel UI (`media/webviewClient.js`) expose it there, and does
`src/prtfKeywordValidation.js`/`src/prtfLayout.js` validate/render it
there. Findings below are every place those two questions' answers
diverged from the matrix.

## The level matrix

| Levels | Keywords |
|---|---|
| File only (3) | `REF`, `RELPOS`, `INDARA` |
| Record only (20) | `AFPRSC`, `BOX`, `DOCIDXTAG`, `DRAWER`, `DUPLEX`, `ENDPAGE`, `ENDPAGGRP`, `FORCE`, `GDF`, `INVDTAMAP`, `INVMMAP`, `LINE`, `LPI`, `OUTBIN`, `OVERLAY`, `PAGRTT`, `PAGSEG`, `STAPLE`, `STRPAGGRP`, `ZFOLD` |
| Field only (26) | `ALIAS`, `BARCODE`, `BLKFOLD`, `CHRID`, `COLOR`, `CVTDTA`, `DATE`, `DATFMT`, `DATSEP`, `DFT`, `DLTEDT`, `EDTCDE`, `EDTWRD`, `FLTFIXDEC`, `FLTPCN`, `MSGCON`, `PAGNBR`, `POSITION`, `REFFLD`, `TIME`, `TIMFMT`, `TIMSEP`, `TRNSPY`, `TXTRTT`, `UNDERLINE`, `UNISCRIPT` |
| Record + Field (10) | `CDEFNT`, `CHRSIZ`, `CPI`, `DTASTMCMD`, `FONT`, `HIGHLIGHT`, `PRTQLTY`, `SPACEA`, `SPACEB`, `TEXT` |
| File + Record (1) | `DFNCHR` |
| File + Record + Field (6) | `CCSID`, `FNTCHRSET`, `FONTNAME`, `INDTXT`, `SKIPA`, `SKIPB` |

`SKIPA`/`SKIPB` (Batch VV) are the one multi-level family already fully
correct at every level they're valid at — confirmed here as a sanity check
on the method, not a new finding. Everything below is new.

## 1. `CPI`/`LPI` resolved against a file-level keyword that doesn't exist

`CPI` is record-level-or-field-level only; `LPI` is record-level only —
neither has a file-level DDS keyword form. Both sections instead say "if
you do not specify \[CPI/LPI\] ... the density/value is set by the
\[CPI/LPI\] parameter on the CRTPRTF, CHGPRTF, or OVRPRTF command" — a
*command parameter* default, not a file-level keyword, the same
category of mistake `PAGSIZE`/`DEVTYPE` were before Batch SS fixed them.

`src/prtfLayout.js`'s `resolveCpiLpi(record, fileLevel, indicatorState)`
does exactly this conflation:

```js
const cpiKw = findActiveKeyword(record.keywords, "CPI", indicatorState) || findActiveKeyword(fileLevel.keywords, "CPI", indicatorState);
const lpiKw = findActiveKeyword(record.keywords, "LPI", indicatorState) || findActiveKeyword(fileLevel.keywords, "LPI", indicatorState);
```

Falling back to `fileLevel.keywords` for either is checking a DDS source
position where a real `CPI`/`LPI` keyword line can never legitimately
appear — harmless in practice only because no one would ever place one
there, but wrong the same way the pre-SS `PAGSIZE`/`DEVTYPE` file-level
reads were wrong.

Separately, and more impactful: `resolveCpiLpi` takes no field/entry
parameter and is called exactly once per record
(`src/prtfLayout.js:673`), so **`CPI`'s documented field-level override has
zero effect on the rendered preview.** Per the reference: "If you specify
CPI at the field level, you can specify different densities for fields
printed on the same line." Today, every field in a record renders at the
same record-resolved CPI regardless of any field-level `CPI` keyword
present.

## 2. No file-level properties panel exists in the webview at all

`model.fileLevel` is never referenced anywhere in `media/webviewClient.js`
except the one `PrtfEngine.validateFileLevelKeywords(state.model)` warnings
call. There is no panel — no function analogous to the record-level or
field-level properties panels — that lets the person view or edit a single
file-level keyword. This means every keyword genuinely valid at the file
level (`REF`, `RELPOS`, `INDARA`, `DFNCHR`, and the file-level slice of
`CCSID`/`FNTCHRSET`/`FONTNAME`/`INDTXT`/`SKIPA`/`SKIPB`) is unexposed for
editing — round-trip-safe only if hand-typed into the DDS source (parsing
is level-agnostic, per the Method note above), and, for the ones
`validateFileLevelKeywords` already checks (`RELPOS`, `SKIPA`, `SKIPB`),
validated with no UI surface the person could act on the warning from —
`docs/KEYWORD-INVENTORY.md`'s own §1 table is effectively describing a
captured-but-unbuilt STRRLU screen reference, not a shipped I-RLU panel.

This is a materially bigger initiative than the rest of this audit's
findings — building a first file-level properties panel from scratch —
not a small fix, and is called out as such in the batch table below.

## 3. `CCSID`/`FNTCHRSET`/`FONTNAME` missing file-level UI (once a panel exists)

Narrower than #2: these three are the ones that already have *working*
record+field editing via the shared `FONT_SIZING_SPECS` array
(`renderFontSizingPanel`, called at `media/webviewClient.js:242` for
records and `:2236` for fields) and `INDTXT`'s own small record-level
panel — confirmed genuinely file-level too by their own reference
sections' first sentence, e.g. `CCSID`'s: "you can specify \[it\] at the
file, record, or field level." Once #2 exists, wiring these three's
file-level slice into it is comparatively surgical.

## 4. `CHRID` over-exposed at the record level

`CHRID` is field-level only (confirmed both by its own section and by
`BARCODE`'s field-level exclusion list, "Do not specify BARCODE in the
same field with the CHRSIZ, CHRID, ..."), but it's a member of the same
`FONT_SIZING_SPECS` array `renderFontSizingPanel` uses identically for
both its record-level and field-level call sites — so the UI currently
lets a person add `CHRID` to a *record*, which isn't valid DDS, with no
warning from `validateFontKeywords` (which only checks `CHRID` against
`CDEFNT`/`FNTCHRSET` mutual exclusion, not keyword-level validity).

## 5. `DTASTMCMD` missing field-level UI

Record-level-or-field-level per the reference, but `BATCH_E_SIMPLE_KEYWORDS`
(which contains it) is wired only to the record-level panel
(`media/webviewClient.js:2879`), and `src/prtfLayout.js:489`'s
`DTASTMCMD` summary-list rendering only ever reads `record.keywords`,
never a field/constant entry's own keywords.

## 6. `PRTQLTY` missing field-level UI, plus an unvalidated dependency

Record-level-or-field-level per the reference, but only wired into the
record-level panel. Also unvalidated: "The `PRTQLTY` keyword is allowed
only on records or fields for which a `CHRSIZ` or `BARCODE` keyword
applies" — `PRTQLTY` isn't cross-checked against either anywhere in
`src/prtfKeywordValidation.js`.

## 7. `TEXT` keyword entirely unmodeled

Record-level-or-field-level, `TEXT('description')`, a simple
program-documentation comment (first 50 characters used if longer;
"Option indicators are not valid for this keyword"). Zero references
anywhere in `src/` or `media/` — it only round-trips generically via the
parser, with no dedicated UI at either of its two valid levels and no
`NO_INDICATOR_KEYWORDS` entry (see #8).

## 8. `NO_INDICATOR_KEYWORDS` is missing 15 of 28 documented keywords

A full-text sweep of every "Option indicators are not valid for this
keyword" occurrence in the reference, mapped back to its enclosing keyword
section, found **28** keywords total:

`ALIAS`, `BARCODE`, `BLKFOLD`, `CCSID`, `CHRID`, `CHRSIZ`, `CVTDTA`,
`DATE`, `DATFMT`, `DATSEP`, `DFT`, `DLTEDT`, `EDTCDE`, `EDTWRD`,
`FLTFIXDEC`, `FLTPCN`, `INDARA`, `INDTXT`, `LPI`, `MSGCON`, `REF`,
`REFFLD`, `RELPOS`, `TEXT`, `TIME`, `TIMFMT`, `TIMSEP`, `TRNSPY`

`NO_INDICATOR_KEYWORDS` (`src/prtfKeywordValidation.js`, Batch TT) only
has 13 of these: `REF`, `INDARA`, `RELPOS`, `INDTXT`, `CCSID`, `ALIAS`,
`REFFLD`, `MSGCON`, `DATE`, `DATFMT`, `DATSEP`, `TIMFMT`, `TIMSEP`.
**Missing 15:** `BARCODE`, `BLKFOLD`, `CHRID`, `CHRSIZ`, `CVTDTA`, `DFT`,
`DLTEDT`, `EDTCDE`, `EDTWRD`, `FLTFIXDEC`, `FLTPCN`, `LPI`, `TEXT`,
`TIME`, `TRNSPY`.

Batch TT's own two source audits (file-level §5, field-level §4) picked up
keywords whose intro sentence explicitly says "...field-level keyword..."
right next to the indicator note; most of the missing 15 state the
restriction in a separate sentence further down their section instead, so
the original read-through missed them. `LPI` is the only record-level one
in the missing set — the record-level audit didn't check for this pattern
at all, since it wasn't yet a known cross-cutting rule at the time that
audit was written.

(A few of the 28 add the caveat "however, option indicators can be used to
condition the \[whole field/entry\]" — that's already correctly handled:
`validateKeywordIndicators` only flags a keyword-specific *attached-line*
conditioning, never the owning entry's own conditioning, so this caveat
needs no special-casing.)

## 9. `BARCODE`'s additional record-level exclusions are unvalidated

`src/prtfBarcodeParams.js`'s `BARCODE_EXCLUDED_KEYWORDS` already checks
the field-level exclusion set ("Do not specify `BARCODE` in the same field
with the `CHRSIZ`, `CHRID`, `CVTDTA`, `DATE`, `EDTCDE`, `EDTWRD`, `FONT`,
`HIGHLIGHT`, `PAGNBR`, `TIME`, or `UNDERLINE` keywords"). Two further,
separate constraints in the same section are unchecked anywhere:

- "You cannot specify `BARCODE` on the same record format with `BLKFOLD`,
  `CPI`, or `DFNCHR`."
- "If you specify `CHRSIZ` at the record level... if you specify `BARCODE`
  in one of those fields, the `BARCODE` keyword is not allowed."

## Summary for tracking

| # | Finding | Severity |
|---|---|---|
| 1 | `CPI`/`LPI` resolved against a nonexistent file-level keyword; `CPI`'s field-level override has zero effect on the rendered preview | High — affects the rendered preview, not just validation |
| 2 | No file-level properties panel exists in the webview at all | High — large initiative, not a small fix |
| 3 | `CCSID`/`FNTCHRSET`/`FONTNAME` missing file-level UI (depends on #2) | Medium |
| 4 | `CHRID` over-exposed at the record level (invalid DDS, no warning) | Medium |
| 5 | `DTASTMCMD` missing field-level UI | Low-Medium |
| 6 | `PRTQLTY` missing field-level UI, plus an unvalidated `CHRSIZ`/`BARCODE` dependency | Low-Medium |
| 7 | `TEXT` keyword entirely unmodeled | Low-Medium |
| 8 | `NO_INDICATOR_KEYWORDS` missing 15 of 28 documented keywords | Medium — same centralizable fix shape as Batch TT |
| 9 | `BARCODE`'s two additional record-level exclusions unvalidated | Low |
| — | `SKIPA`/`SKIPB` (Batch VV) confirmed fully correct at all 3 levels — sanity check on the method, not a finding | — |

## Cross-audit rollup

Combined with the three prior audits, the recurring pattern across all
four is the same one Batch SS first named: **a real command-parameter
default gets conflated with a file-level DDS keyword that doesn't
actually exist** (`PAGSIZE`/`DEVTYPE` before Batch SS; `CPI`/`LPI` here).
The second recurring pattern is **a centralizable cross-cutting rule
implemented from an incomplete read-through** (Batch TT's original 13 of
what's actually 28 "no indicators" keywords). Neither is specific to one
level — both are exactly the kind of gap a single-level audit pass
structurally can't catch, which is what this fourth audit was for.

Everything else here is a smaller, independently-actionable item suitable
for its own `docs/TASKS.md` batch — see that file for the batches filed
from this audit (naming continues as `AAA`, `BBB`, ... since `A`–`Z` and
`AA`–`ZZ` are both now fully used).
