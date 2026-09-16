# Field-Level Keyword Audit

Third and final of the planned audits (file / record / field), cross-checking
I-RLU's field-level DDS keyword handling against
`docs/DDS-PRINTER-FILE-REFERENCE.txt`. Same method as the other two audits.
This level is where most of I-RLU's mature, well-built functionality lives
(`BARCODE` via Batches C/D/N, `REFFLD`/`REF` via Batch H, date/time
keywords, floating-point keywords via Batch G) — most findings here are
smaller, targeted gaps rather than architectural ones.

## 1. Parameter-value bug: `TIMFMT` wrongly offers `*JOB`

`media/webviewClient.js`'s keyword panel lists `TIMFMT` options as
`["*ISO", "*USA", "*EUR", "*JIS", "*HMS", "*JOB"]`. The reference's `TIMFMT`
table has exactly five valid values — `*HMS`, `*ISO`, `*USA`, `*EUR`,
`*JIS` — and no `*JOB` row, no `TIMFMT(*JOB)` example anywhere in the
document, and no sentence describing it as a valid value. (Contrast with
`DATFMT`, whose table *does* have a "Job default `*JOB`" row, and whose
code-side option list correctly includes it.) `*JOB` is a real DDS value —
just for `TIMSEP`, not `TIMFMT`. This looks like the `DATFMT` option list
was copy-adapted for `TIMFMT` without dropping the one option that doesn't
carry over. Small, concrete, easy fix.

`DATFMT`, `DATSEP`, and `TIMSEP`'s own option lists were checked against
the reference and are all correct, including the "not valid with
*ISO/*USA/*EUR/*JIS" hint text already present for both separator
keywords.

## 2. Missing constraint: `EDTCDE`/`EDTWRD` vs. `DFT`

The reference states plainly: "The `EDTCDE` and `EDTWRD` keywords cannot be
specified with the `DFT` keyword." `DFT` isn't referenced anywhere in
`prtfKeywordValidation.js`, so nothing flags this combination today.

## 3. Missing constraint: `MSGCON`'s five-keyword exclusion set

`MSGCON` cannot be specified alongside `DATE`, `DFT`, `EDTCDE`, `EDTWRD`,
or `TIME` on the same field ("The `DFT` and `MSGCON` keywords are
functionally equivalent. If you specify the `DFT` and `MSGCON` keywords for
the same field, the `MSGCON` keyword is ignored and the file is not
created."). `MSGCON` doesn't appear in `prtfKeywordValidation.js` at all —
none of this is checked. `MSGCON`'s own parameter shape (`length message-ID
[library/]message-file`) matches what `docs/KEYWORD-INVENTORY.md` already
documents, so no parameter-modeling issue here, just the missing exclusion
check.

## 4. Conditioning-indicator gap: `ALIAS`, `REFFLD`, `MSGCON` join the "no indicators" list

Three more keywords confirmed as "option indicators are not valid for this
keyword" that weren't covered by the file/record-level audits: `ALIAS`,
`REFFLD`, `MSGCON`. `DATE`, `DATFMT`, `DATSEP`, `TIMFMT`, `TIMSEP` are also
in this category (each explicitly says indicators aren't valid *for the
keyword itself*, though — per the reference's own clarifying note repeated
for each — the *field* those keywords sit on can still be conditioned
normally via positions 7–16; only keyword-specific conditioning is
disallowed). This continues to reinforce the file-level audit's
recommendation: one shared "keywords with no indicators" table, consulted
everywhere a conditioning indicator can be attached, would resolve this
across all three levels in one place rather than requiring a per-batch
patch for each keyword discovered.

## 5. `ALIAS` uniqueness constraint unvalidated

"The alternative-name parameter must be different from all other
alternative names and from all DDS field names in the record format" — a
duplicate is a compile error. `ALIAS` isn't referenced in
`prtfKeywordValidation.js`; nothing checks this today. Same treatment as
everything else in this codebase (`CRTPRTF` remains the real enforcement
point) — worth a live designer hint given how easy it'd be to duplicate a
name across a large record format.

## 6. Minor / already correct

- **`BARCODE`'s 11-keyword mutual exclusion** (`CHRSIZ`, `CHRID`, `CVTDTA`,
  `DATE`, `EDTCDE`, `EDTWRD`, `FONT`, `HIGHLIGHT`, `PAGNBR`, `TIME`,
  `UNDERLINE`) matches the reference exactly and is already implemented and
  done (Batch N, per `docs/TASKS.md`). No finding here — confirmed correct.
- **`REFFLD`/`REF` resolution** (`src/prtfReferenceField.js`, Batch H) is
  solid: correctly implements the *SRC special case, the REFFLD-overrides-
  REF precedence, and record/field fallback chain described in "When to
  specify REF and REFFLD keywords for DDS files." One documented rule it
  doesn't (and arguably can't cheaply) check: "the field being referred to
  must precede the field being defined" when referencing within the same
  DDS source file — a field-ordering constraint. Low priority; flagged for
  completeness only.
- **`DATFMT`/`DATSEP`/`TIMSEP` option lists and mutual-exclusion hints**:
  correct, as noted in §1.
- **Floating-point (`FLTFIXDEC`/`FLTPCN`), `TRNSPY`, `TXTRTT`, `DLTEDT`
  data-type/reference restrictions**: already validated in
  `validateFieldKeywords()` and confirmed correct against the reference on
  spot-check.

## Summary for tracking

| # | Finding | Severity |
|---|---|---|
| 1 | `TIMFMT` panel wrongly offers `*JOB` (not a valid TIMFMT value; that's a TIMSEP value) | Low — easy fix |
| 2 | `EDTCDE`/`EDTWRD` vs. `DFT` mutual exclusion unvalidated | Medium |
| 3 | `MSGCON` vs. `DATE`/`DFT`/`EDTCDE`/`EDTWRD`/`TIME` exclusion unvalidated | Medium |
| 4 | `ALIAS`, `REFFLD`, `MSGCON` (plus date/time keywords) add to the cross-cutting "no indicators" gap | Medium — same fix as file/record audits |
| 5 | `ALIAS` name-uniqueness constraint unvalidated | Low-Medium |
| 6 | `BARCODE`, `REFFLD`/`REF`, date/time option lists (except §1), floating-point/TRNSPY/TXTRTT/DLTEDT checks all confirmed correct | — |

## Cross-audit rollup

Across all three passes (`docs/AUDIT-FILE-LEVEL.md`,
`docs/AUDIT-RECORD-LEVEL.md`, this document), the two findings worth
prioritizing first are:

1. **`PAGSIZE` and `DEVTYPE` are fabricated DDS keywords** parsed directly
   out of source text at file/record level, when both are actually
   `CRTPRTF`/`CHGPRTF`/`OVRPRTF` command parameters that can never
   legitimately appear in a DDS member. This affects the layout engine's
   page-size resolution and the AFPDS-detection heuristic, and is baked
   into all three test fixtures.
2. **No shared enforcement of "option indicators not valid for this
   keyword."** Across the three audits this affects at least 13 keywords
   (`REF`, `INDARA`, `RELPOS`, `INDTXT`, `CCSID`, `ALIAS`, `REFFLD`,
   `MSGCON`, `DATE`, `DATFMT`, `DATSEP`, `TIMFMT`, `TIMSEP`) and is a
   single, centralizable fix rather than 13 separate ones.

Everything else is a smaller, independently-actionable item suitable for
its own `docs/TASKS.md` batch.
