# File-Level Keyword Audit

Cross-checks I-RLU's handling of **file-level** DDS keywords against the
full-text IBM reference at `docs/DDS-PRINTER-FILE-REFERENCE.txt` (see that
file's header for provenance). This is the first of three planned audits
(file / record / field level), split per session-owner request.

Method: every keyword whose reference-doc description says it can be
specified at the **file level** was located and read in full, then checked
against the corresponding logic in `src/prtfParser.ts`, `src/prtfLayout.js`,
`src/prtfWriter.js`, `src/prtfKeywordValidation.js`, and the properties-panel
code in `media/webviewClient.js` / `src/prtfWebviewLogic.js`.

## 1. The genuine file-level keyword set

Confirmed by exact wording ("You use this file-level keyword...", "This
file-, record-, or field-level keyword...", etc.) in the reference doc:

| Keyword | Levels (per IBM) | Option indicators | I-RLU status |
|---|---|---|---|
| `REF` | File only | Not valid | Modeled (round-trip only), not surfaced in any panel |
| `INDARA` | File only | Not valid | Modeled only |
| `RELPOS` | File only | Not valid | **Not modeled — see §2** |
| `DFNCHR` | File or record | Valid | Modeled only |
| `SKIPA` | File, record, or field | Valid (**mandatory** at file level) | Rendered at field level only — see §3 |
| `SKIPB` | File, record, or field | Valid (**mandatory** at file level) | Rendered at field level only — see §3 |
| `FNTCHRSET` | File, record, or field | Valid | Modeled + panel support (font group) |
| `FONTNAME` | File, record, or field | Valid | Modeled + panel support (font group) |
| `INDTXT` | File, record, or field | Not valid | Modeled + panel support |
| `CCSID` | File, record, or field | Not valid | Modeled only |

`SPACEA`/`SPACEB` are **not** file-level (record/field only) — correctly
absent from any file-level handling.

## 2. Missing keyword: `RELPOS`

`RELPOS` doesn't appear anywhere in `docs/KEYWORD-INVENTORY.md`'s file-level
list, and there's no code that looks for it. That matters beyond
completeness bookkeeping: the reference doc says `+n` relative field
positioning means "relative to the end of the previous field" **only when
`RELPOS` is declared at the file level**; without it, `+n` is relative to
the start of the line. `src/prtfLayout.js`'s field-positioning code applies
the "relative to end of previous field" math unconditionally, for every
file, regardless of whether `RELPOS` is present. Net effect: the preview is
built as if every file declared `RELPOS`, which is wrong for any file that
doesn't.

Also worth noting for whoever picks this up: IBM's doc ties `RELPOS` to
`DEVTYPE(*AFPDS)` — it's only meaningful for AFPDS files, so the fix likely
belongs alongside the existing AFPDS-specific logic in `prtfLayout.js`
rather than as a standalone toggle.

## 3. Invalid / fabricated keywords

**`PAGSIZE` is not a DDS keyword.** Full-text search of the reference
confirms it: `PAGESIZE` exists only as a parameter on the `CRTPRTF` /
`CHGPRTF` / `OVRPRTF` **commands**, never as something coded in DDS source.
I-RLU's parser, layout engine (`resolvePageSize`), and writer all treat
`PAGSIZE(66 132)` as legitimate file-level DDS syntax, and it's baked into
every test fixture (`test/fixtures/sample1.pf:3`, `sample-afpds.pf:3`,
`sample-scs.pf:3`). A real IBM i compiler would reject this if it ever
appeared in generated output. The practical blast radius today looks
contained — the 66×132 fallback used when the keyword is absent happens to
match CRTPRTF's real default, and nothing in `media/webviewClient.js`
currently offers `PAGSIZE` as an addable keyword — but the underlying model
is wrong and should be corrected (page dimensions need to be sourced the
same way `DEVTYPE` already is: as an out-of-band setting, not a parsed DDS
keyword) before more layout logic gets built on top of it.

**`LPI` and `CPI` file-level fallbacks are also unsupported by the spec.**
`prtfLayout.js` does:
```js
const cpiKw = findActiveKeyword(record.keywords, "CPI", ...) || findActiveKeyword(fileLevel.keywords, "CPI", ...);
const lpiKw = findActiveKeyword(record.keywords, "LPI", ...) || findActiveKeyword(fileLevel.keywords, "LPI", ...);
```
But per the reference: `CPI` is record- or field-level only, and `LPI` is
**record-level only** — its file-wide default comes from the `CRTPRTF`
command's own `LPI` parameter, not a DDS keyword. Same category of mistake
as `PAGSIZE`. This path isn't exercised by any current fixture (no fixture
places `CPI`/`LPI` at file level), so it's latent rather than actively
wrong today, but it should be removed or re-justified.

## 4. Constraint / rule gaps

None of the following documented rules are validated anywhere in
`prtfKeywordValidation.js` or elsewhere:

- **`SKIPA`/`SKIPB` at file level require at least one option indicator.**
  Only the *AFPDS file-level restriction (`SKIPA`/`SKIPB` not allowed at
  file level at all under *AFPDS) is currently checked; the plain
  non-AFPDS "must have an indicator" rule is not.
- **`SKIPA`, `SKIPB`, `SPACEA`, `SPACEB` are all invalid on a record that
  also has `BOX`, `ENDPAGE`, `GDF`, `LINE`, `OVERLAY`, `PAGSEG`, or
  `POSITION`** — at either record or field level. This is the same rule for
  all four keywords, worded identically for each in the reference. Existing
  code/memory only captures a narrower AFPDS-specific variant of this (BOX
  with LINE, plus SPACEB), not the full 7-keyword exclusion list, and not
  for `SKIPA`/`SPACEA`.
- **`SKIPA`, `SKIPB`, `SPACEA`, `SPACEB` are invalid on a record with a
  positional line number** (columns 39–41 of the field/record spec).
- **Cardinality**: each of `SKIPA`/`SKIPB`/`SPACEA`/`SPACEB` may be
  specified at most once at record level and once per field (`SKIPA`/
  `SKIPB` additionally once at file level).
- Separately from validation: **file-level and record-level `SKIPA`/
  `SKIPB` have no layout effect at all.** `resolveLayout()` in
  `prtfLayout.js` initializes `cursorLine = 1` unconditionally and only
  ever reads `SKIPB`/`SKIPA` off individual field entries — never off
  `record.keywords` or `fileLevel.keywords`. `docs/KEYWORD-INVENTORY.md`
  and `docs/ROADMAP.md` both list `SKIPA`/`SKIPB` as "rendered," which is
  only true at the field level; record- and file-level instances are
  silently inert in the preview.

## 5. Conditioning indicators

No keyword anywhere in I-RLU — file-level or otherwise — is currently
prevented from having option indicators attached, even where IBM's
reference explicitly states indicators are invalid. At file level alone,
five keywords fall in that category: `REF`, `INDARA`, `RELPOS`, `INDTXT`,
`CCSID`. This is a systemic gap rather than a file-level-specific one (it
will recur in the record- and field-level audits), so the right fix is
probably a single shared "keywords with no indicators allowed" table
consulted everywhere a conditioning indicator can be attached, rather than
a per-panel patch. Note this is a **separate list** from the existing
`VALUELESS_KEYWORDS`/`FIELD_LEVEL_VALUELESS_KEYWORDS` — a keyword can take
parameters and still disallow indicators (`REF`, `CCSID`) or take no
parameters and still allow them (`DFNCHR`... N/A, actually see below).

Minor/non-urgent: `INDARA` and `RELPOS` both take no parameters ("this
keyword has no parameters") but aren't in `VALUELESS_KEYWORDS` or
`FIELD_LEVEL_VALUELESS_KEYWORDS`. Not a live bug today — neither keyword
has a properties-panel entry yet, and the writer's fallback
(`kw.name + (kw.params || "")`) round-trips a parsed bare keyword correctly
regardless. It only becomes a real bug if a future batch adds a panel for
either one without registering it with `kind: "flag"`.

## Summary for tracking

| # | Finding | Severity |
|---|---|---|
| 1 | `RELPOS` unmodeled; `+n` positioning always assumes it's present | Medium — visibly wrong preview for non-AFPDS or RELPOS-less files |
| 2 | `PAGSIZE` is not a real DDS keyword; parsed/written as if it were | High — architecturally wrong, though currently contained |
| 3 | File-level `LPI`/`CPI` fallback has no basis in the spec | Low — latent, no fixture exercises it |
| 4 | `SKIPA`/`SKIPB` mandatory-indicator rule at file level unchecked | Low-Medium |
| 5 | `SKIPA`/`SKIPB`/`SPACEA`/`SPACEB` 7-keyword exclusion + line-number + cardinality rules unchecked | Medium |
| 6 | Record-/file-level `SKIPA`/`SKIPB` don't affect layout, contradicting "rendered" status in docs | Medium |
| 7 | No shared enforcement of "indicators not valid for this keyword" | Medium — cross-cutting, will recur at record/field level |

Record-level and field-level audits are tracked separately (next up).
