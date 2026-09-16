# Record-Level Keyword Audit

Second of three planned audits (file / record / field), cross-checking
I-RLU's record-level DDS keyword handling against
`docs/DDS-PRINTER-FILE-REFERENCE.txt`. Same method as
`docs/AUDIT-FILE-LEVEL.md`: locate each keyword's full section in the
reference, then check it against `src/prtfParser.ts`, `src/prtfLayout.js`,
`src/prtfWriter.js`, `src/prtfKeywordValidation.js`, and
`src/prtfPageGroupKeywords.js`.

## 1. `DEVTYPE` is a fabricated keyword — same problem as file-level `PAGSIZE`, and bigger

This is the headline finding of this pass. A full-text search of the
reference for `DEVTYPE` turns up **dozens** of hits, and every single one is
either "on the CRTPRTF command," "the DEVTYPE parameter," or "a file created
with DEVTYPE(*AFPDS)" — never a dedicated `DEVTYPE (...) keyword in printer
files` section like every real keyword gets. `DEVTYPE` is exclusively a
`CRTPRTF`/`CHGPRTF`/`OVRPRTF` **command** parameter. It cannot legally
appear inside DDS source at all.

I-RLU's `looksLikeAfpds()` (`src/prtfKeywordValidation.js`) does:
```js
const fileDevtype = findKeyword(model.fileLevel.keywords, "DEVTYPE");
if (fileDevtype) return /\*AFPDS/.test(fileDevtype.params);
const recordDevtype = model.records.map((r) => findKeyword(r.keywords, "DEVTYPE")).find(Boolean);
```
— treating `DEVTYPE(*AFPDS)` as something that can be parsed straight out of
the DDS keyword area, at both file and record level. All three test
fixtures reinforce this: `sample-afpds.pf:3` and `sample-scs.pf:3` both
write `DEVTYPE(*AFPDS)`/`DEVTYPE(*SCS)` right next to the equally-fabricated
`PAGSIZE(66 132)`.

The code comment already half-suspects this ("DEVTYPE itself is a
CRTPRTF/CHGPRTF/OVRPRTF command parameter, not DDS source text, so I-RLU can
never know for certain from the source alone") and correctly falls back to
the `AFPDS_INDICATOR_KEYWORDS` heuristic when no `DEVTYPE` is found — which,
given `DEVTYPE` can never legitimately be found, means **the heuristic path
is the only one that will ever actually fire on a real-world file.** The
`findKeyword(..., "DEVTYPE")` branch is effectively dead code outside of
this project's own (invalid) fixtures.

Recommendation, carried over from the file-level audit's `PAGSIZE`/`LPI`/
`CPI` finding: `PAGSIZE` and `DEVTYPE` should both move out of "things the
parser looks for in DDS keyword text" and into "external settings I-RLU
tracks the same way it already tracks `i-rlu.unitOfMeasure`" (a designer
setting, not a parsed keyword) — the fixtures should be corrected to match
once that lands, since they currently model an impossible DDS file.

## 2. Missing keyword: `GDF`

`GDF` (Graphic Data File) is a fully-documented, real record-level keyword
— `GDF(library-name graph-file graph-member position-down position-across
graph-depth graph-width graph-rotation)` — PSF-only, AFPDS-only, and part of
the same mutual-exclusion family as `OVERLAY`/`PAGSEG`/`AFPRSC` (see §4).
`docs/KEYWORD-INVENTORY.md` already flags it as "confirmed valid... but
absent from both the RLU screen captures and any menu entry," and
correctly notes it's low priority — but it's worth being explicit that,
unlike `OVERLAY`/`PAGSEG`/`AFPRSC`, `GDF` gets **no placeholder-box
rendering at all** in `src/prtfPageGroupKeywords.js` despite having the same
shape (a named resource with `position-down`/`position-across`, plus its
own `graph-depth`/`graph-width`). It's also missing from `PSF_ONLY_KEYWORDS`
(`["ZFOLD", "STAPLE"]`) even though the reference explicitly lists it
alongside them ("GDF (only supported for printing by PSF)").

`IGCCDEFNT`, `INVDTAMAP`, and `UNISCRIPT` remain generic pass-through only,
which is fine for now per the existing low-priority note — no change
recommended there.

## 3. Parameter/sub-parameter gap: `PAGSEG`'s `*SIZE` is parsed into `extra` but never used

`PAGSEG`'s optional `(*SIZE height width)` sub-parameter is real, sized in
the file's unit of measure, and — unlike the "no access to the resource
file" limitation that legitimately caps `OVERLAY`'s placeholder accuracy —
it's coded directly in the DDS source, so I-RLU could use it. Instead,
`parsePagseg()` in `src/prtfPageGroupKeywords.js` only extracts `t[0]`
(name), `t[1]`/`t[2]` (position), and dumps everything else — including
`(*SIZE height width)` — into the opaque `extra` field. `placeholderGeometry()`
then always draws the fixed `DEFAULT_RESOURCE_COLS`×`DEFAULT_RESOURCE_ROWS`
(20×3) box, even when the source specifies a real height and width. This is
a genuine, fixable accuracy gap, not an inherent tool limitation.

## 4. Constraint gaps confirmed (and widened) from the file-level audit

The file-level audit found that `SKIPA`/`SKIPB`/`SPACEA`/`SPACEB` are
invalid on any record that also carries `BOX`, `ENDPAGE`, `GDF`, `LINE`,
`OVERLAY`, `PAGSEG`, or `POSITION`, with nothing in I-RLU validating it.
Reading `ENDPAGE`'s own section confirms the same rule from the other
direction — **and adds two more `ENDPAGE`-specific rules that aren't
validated either:**
- `ENDPAGE` cannot be specified together with `SPACEA`, `SPACEB`, `SKIPA`,
  or `SKIPB` on the same record.
- An error is raised if a **constant field** is specified in a record
  format that also has `ENDPAGE`. (Separately, the reference's "Constant
  fields in printer files" section says a constant field *is* allowed
  alongside `BOX`/`GDF`/`LINE`/`OVERLAY`/`PAGSEG` — but only if that
  specific constant field also carries its own `POSITION` keyword. This is
  a field-level enforcement point even though it's triggered by
  record-level keywords, so it's cross-referenced here but will be tracked
  in the field-level audit.)
- `ENDPAGE` also needs `DEVTYPE(*AFPDS)` — ignored otherwise (same caveat
  as §1: this can only be checked heuristically, never authoritatively).

None of `ENDPAGE`'s rules appear anywhere in `prtfKeywordValidation.js`
today — the keyword isn't referenced in that file at all.

## 5. Round-trip metadata gap: `ENDPAGE` has no parameters but isn't in `VALUELESS_KEYWORDS`

Same class of issue flagged for `INDARA`/`RELPOS` in the file-level audit:
"`ENDPAGE`... has no parameters" per the reference, but `ENDPAGE` isn't
in `VALUELESS_KEYWORDS` (`["FORCE", "ZFOLD", "STAPLE"]`). Not a live bug
today (no properties panel writes `ENDPAGE` yet, and the writer's
raw-keyword fallback round-trips a parsed bare keyword fine either way) —
but it'll need to be added before any future batch adds an `ENDPAGE`
toggle, or it'll risk serializing as `ENDPAGE()`.

## 6. Conditioning indicators

Spot-checked against the reference for the record-level keywords not
already covered by the file-level audit's cross-cutting finding:
- `ENDPAGE`: option indicators **valid**.
- `GDF`, `OVERLAY`, `PAGSEG`, `AFPRSC`, `DOCIDXTAG`: all document
  program-to-system field (`&NAME`) support on their positional params,
  which I-RLU already models — no indicator-specific restriction found for
  any of these five.

No new "indicators not valid" record-level keywords beyond what's already
called out in the file-level audit's §5 recommendation (a single shared
lookup table, rather than scattered per-batch checks).

## Summary for tracking

| # | Finding | Severity |
|---|---|---|
| 1 | `DEVTYPE` is not a real DDS keyword; parsed at file *and* record level as if it were, baked into all 3 fixtures | High — same architectural issue as file-level `PAGSIZE`, larger blast radius (drives the AFPDS-detection heuristic's "authoritative" branch, which can never actually fire on real source) |
| 2 | `GDF` unmodeled: no placeholder rendering, missing from `PSF_ONLY_KEYWORDS` | Low-Medium |
| 3 | `PAGSEG`'s `(*SIZE height width)` parsed but discarded; placeholder box always fixed-size even when real dimensions are available | Medium — fixable accuracy gap, not a tool limitation |
| 4 | `ENDPAGE`'s three documented constraints (exclusion with SPACEA/SPACEB/SKIPA/SKIPB, constant-field error, DEVTYPE(*AFPDS) requirement) entirely unvalidated | Medium |
| 5 | `ENDPAGE` missing from `VALUELESS_KEYWORDS` | Low — latent |
| 6 | No new indicator-restriction gaps beyond the file-level audit's cross-cutting finding | — |

Field-level audit is next.
