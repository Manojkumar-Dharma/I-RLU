# I-RLU Roadmap

Tracks status against `docs/REQUIREMENTS.md`. Update this alongside any
significant change so it stays a trustworthy snapshot rather than aspirational.

## Done

- [x] Verified DDS column layout for printer files (positions 1-44) against
      IBM's DDS reference.
- [x] Parser: record formats, fields, constants, keywords (incl.
      continuation lines), conditioning indicators, comments. Every field/
      constant gets a stable `id` so edits can target it reliably even
      after its position changes.
- [x] Writer: regenerates fixed-column source from the model.
      Round-trip verified byte-for-byte on the test fixture.
- [x] Engine: page size resolution (`PAGSIZE`), sequential field placement
      via `SKIPB`/`SKIPA`/`SPACEB`/`SPACEA`, explicit `LINE`/`POSITION`
      placement, indicator-based conditioning/filtering, `LINE`/`BOX`
      geometry (record-level, AFPDS-only, converted from physical units to
      the character grid via CPI/LPI) — verified against IBM's DDS
      reference after an earlier draft used a fictitious `DRAW` keyword —
      and `BARCODE` (field-level, IPDS/AFPDS-only) resolved to a labeled
      placeholder with symbology id, direction, and line-count height.
- [x] `FONT`/FGID resolution: a verified FGID table (Courier/Gothic fixed
      families, Helvetica/Times New Roman proportional families,
      point-size-to-CPI conversion for scalable monospace fonts), sourced
      against IBM's own FGID/typeface documentation. Corrected an error
      from an earlier reference along the way (FGID 416 is Courier Roman
      Medium, not "Times Roman" as that reference had it — regression
      test guards this). Field-level `FONT` overrides record-level
      overrides file-level, matching DDS's own precedence.
- [x] Character grid now derived from the record's actual CPI/LPI via the
      standard 96dpi formula (`cellWidthPx = 96/CPI`, `cellHeightPx =
      96/LPI`) instead of hardcoded pixel constants.
- [x] Extension host: `CustomTextEditorProvider` registered for `.pf`/
      `.prtf`/`.rlu` (local, `member:`, and `streamfile:` schemes).
- [x] Webview: page-grid rendering, record-format switcher, indicator
      toggle panel, drag-to-reposition with edits written back through the
      real writer/model (single `WorkspaceEdit`, so undo/redo works
      normally), real `LINE`/`BOX` geometry rendering (flagged when a
      program-to-system field parameter can't be resolved statically), and
      a striped placeholder for `BARCODE` fields.
- [x] Webview properties panel: click a field/constant to edit name,
      length, data type, decimals, usage, line/position (fields) or text +
      line/position (constants), or delete it.
- [x] "+ Field" / "+ Constant" click-to-place: arm placement mode, click a
      spot on the page, fill in a form, and the new entry is inserted into
      the source right after the record's last existing entry.
- [x] `CRTPRTF` compile command via Code for i's `runCommand` API.
- [x] Test suite (30 tests): parser correctness, round-trip fidelity,
      engine resolution (incl. indicator toggling, LINE/BOX geometry with
      hand-verified expected coordinates, BARCODE line-count and
      default-height cases, uom inch/cm conversion with hand-verified
      math, FONT/FGID resolution and precedence, the FGID-416 regression
      check, and CPI/LPI-to-pixel grid math), id stability, and
      edit-then-reparse round-trips for move/add field/add constant/
      delete/update.
- [x] `i-rlu.unitOfMeasure` VS Code setting (inch/cm, default inch) so
      LINE/BOX/BARCODE measurements convert correctly for shops that
      compile with `CRTPRTF UOM(*CM)`. Important correction to an earlier
      roadmap note: there is no `UOM` keyword in DDS source — it's a
      CRTPRTF command parameter, so the tool can't detect it from source
      alone and this has to be a user setting, not something parsed.
- [x] Fixed a writer bug (Batch M) where `prtfWriter.js` always emitted `+`
      continuation when wrapping a keyword area, even at a space boundary
      where `-` is needed to preserve the space — corrupted tokens like
      `PAGSEG(COMPLOGO 0.5 0.5)` on round-trip. Caught by the
      `sample-afpds.pf` fixture; see `docs/TASKS.md` Batch M for the full
      root-cause writeup. Test suite now 33 tests, all passing.
- [x] Fixed a second writer bug (Batch R) in the same function:
      `emitWithKeywords`'s tokenizer split on ANY whitespace with no concept
      of quote boundaries, so multiple internal spaces inside a quoted
      keyword literal (e.g. `EDTWRD('  .  ')`) silently collapsed to a
      single space on round-trip (`EDTWRD(' . ')`) — a different symptom
      than Batch M's continuation-character bug, in the same function.
      Fixed with a new quote-aware `tokenizeKeywordText` that keeps an
      entire single-quoted span (including its internal spaces, and DDS's
      doubled-`''` escaping) as one indivisible token. Found via Batch A's
      tests; see `docs/TASKS.md` Batch R for the full root-cause writeup.
- [x] **Batch P — Add/rename/delete/reorder record formats from the
      designer — done.** Four new `applyEdit` kinds (`addRecord`/
      `renameRecord`/`deleteRecord`/`reorderRecord`), identified by record
      name since `RecordFormatEntry` has no stable `id` the way fields/
      constants do. New records insert right after the currently-selected
      one (not always at the end), matching the more intuitive
      header/detail/footer workflow. Investigated (not assumed) whether
      renaming could dangle a `REF`/`REFFLD` reference elsewhere in the
      file — confirmed against IBM's DDS reference that it can't, since
      neither keyword ever names a record format within the file being
      compiled. Reordering swaps each record's whole contiguous block in
      the source (sweeping up any trailing comments with it, a documented
      and tested decision) and added `validatePageGroupOrder` — a
      whole-model check that flags broken `STRPAGGRP`/`ENDPAGGRP` pairing
      regardless of what caused it, reordering being the most direct way.
      New "+ Record"/"Rename"/"Delete"/▲▼ toolbar controls, all via inline
      forms rather than native browser dialogs, matching this codebase's
      existing add-field/add-constant UX. 25 new tests
      (`test/prtfBatchP.test.ts`).

## Next up

As of the RLU screen-capture review (`docs/KEYWORD-INVENTORY.md`), the
remaining work is re-organized into the parallel-session task batches in
`docs/TASKS.md` — each batch is scoped to be pickable up independently
without stepping on another in-progress session. Summary (see TASKS.md for
full detail, acceptance criteria, and file-level ownership per batch):

- [x] **Batch A — general properties-panel keywords — done.**
      `EDTCDE`/`EDTWRD`/`DATFMT`/`DATSEP`/`TIMFMT`/`TIMSEP`/`DFT`
      (field-only, verified against IBM's DDS date/time field example);
      `DATE`/`TIME`/`PAGNBR`/`MSGCON` (constant-only, verified against IBM's
      DDS syntax overview); `COLOR` (Named/`*RGB` verified against this
      project's own `sample-afpds.pf` fixture, `*CMYK`/`*CIELAB` flagged as
      unverified format); `HIGHLIGHT`/`UNDERLINE` (shared — `HIGHLIGHT`'s
      validation already existed via Batch B's `validateFontKeywords`, not
      duplicated); `PRTQLTY`/`DRAWER`/`PAGRTT` (record-level, values
      verified against IBM's reference rather than RLU's own screen
      picklist numbering). New `quotedSelect` kind added for `DATSEP`/
      `TIMSEP`'s quoted-or-bare-`*JOB` shape. See `docs/TASKS.md` Batch A
      for the full writeup. Found (and later fixed as Batch R) a
      pre-existing writer bug — `emitWithKeywords` collapses multiple
      consecutive internal spaces inside quoted keyword literals.
- [x] **Batch B — Font/character-sizing keyword editing incl. P-field
      indirection — done.** Built the generic literal-vs-P-field toggle
      component (`pFieldRow`) once and reused it across `FONT`, `CDEFNT`,
      `FNTCHRSET`, `FONTNAME`, and `CHRID`; `CHRSIZ`/`CCSID` are plain
      numeric per KEYWORD-INVENTORY, so they skip the toggle. Editable at
      both record level (new panel next to Batch F's) and field level (new
      `setFieldKeyword`/`removeFieldKeyword` edit kinds, extending Batch
      F's `setRecordKeyword` pattern to target by id). Added
      `validateFontKeywords` for the documented `HIGHLIGHT`/`CHRID`
      mutual-exclusion-with-`CDEFNT`/`FNTCHRSET` warnings and `CHRSIZ`'s
      "requires IPDS, no effect under HPT" note. 15 new tests
      (`test/prtfBatchB.test.ts`) cover literal/P-field round-trips for
      every keyword at both record and field level, plus all four
      validation cases. No `prtfModel.ts` change was needed — confirmed
      the raw-params-text model already represents `&NAME` vs. a literal
      identically either way, as this batch's own task description
      anticipated might be true.
- [x] **Batch C — Real `BARCODE` parameter surface (still placeholder
      rendering) — done.** New `src/prtfBarcodeParams.js` module
      (`parseBarcodeParams`/`buildBarcodeParams`/`validateBarcodeParams`)
      exposes every parameter confirmed in KEYWORD-INVENTORY §3 —
      symbology id, height-in-lines-or-UOM, bar format, HRI position,
      asterisk-on-CODE3OF9, modifier, narrow bar width, wide:narrow ratio,
      and a free-text field for the 2D symbologies' own parameter groups
      (PDF417/Data Matrix/Maxicode/QR Code) — in a new properties-panel
      section for both fields and constants. Fixed the known gap flagged
      in `docs/TASKS.md`: HRI is now a three-way below/above/none value
      (`hriPosition`) rather than the boolean `parseBarcodeGeometry` used
      to collapse it to; that function now delegates to the new module so
      the two can't drift, while keeping the old boolean for existing
      callers. Anything the parser doesn't specifically model (e.g. IBM's
      `(*SWIDTH n)`, not on RLU's own screen) round-trips verbatim via an
      `unrecognizedRaw` catch-all rather than being silently dropped when
      a field is edited. Rendering is still the existing placeholder box
      — real symbol rendering is Batch D. 10 new tests
      (`test/prtfBatchC.test.ts`).
- [x] **Batch D — Real `BARCODE` symbol rendering — done.** Real bars via
      the vendored JsBarcode (MIT, `media/vendor/jsbarcode/`) for the 13
      linear symbologies it implements and IBM's DDS BARCODE keyword
      documents (MSI, UPCA, UPCE, UPC2, UPC5, EAN8, EAN13, EAN2, EAN5,
      CODEABAR, CODE128, CODE3OF9, INTERL2OF5), reading from Batch C's
      parameters. The remaining documented bar-code-IDs JsBarcode doesn't
      implement (INDUST2OF5, MATRIX2OF5, POSTNET, RM4SCC, AP4SCC,
      DUTCHKIX, JPBC, PDF417, MAXICODE, DATAMATRIX, QRCODE) keep the
      existing placeholder box — a deliberate "don't over-build" scope
      decision (see `docs/TASKS.md`), not a gap. Since I-RLU has no live
      compile/run, rendering uses deterministic, symbology-appropriate
      design-time sample data rather than real field values. New
      `src/prtfBarcodeRender.js` plus a jsdom-backed integration test
      (`test/prtfBatchD.test.ts`) that actually exercises the vendored
      library end to end — which is how a UPCE sample-length mismatch
      against IBM's own documented field length was caught and fixed
      before it shipped.
- [x] **Batch N — `BARCODE` mutual-exclusion validation — done.** Confirmed
      the exact excluded-keyword list against IBM's DDS reference for
      BARCODE — "Do not specify BARCODE in the same field with the
      CHRSIZ, CHRID, CVTDTA, DATE, EDTCDE, EDTWRD, FONT, HIGHLIGHT,
      PAGNBR, TIME, or UNDERLINE keywords" — a superset of README's own
      shorthand list, which was missing CHRSIZ/CHRID/CVTDTA/HIGHLIGHT/
      UNDERLINE. New `validateBarcodeExclusions` in
      `src/prtfBarcodeParams.js` surfaces one live-editor hint per
      conflicting keyword found, rendered directly in BARCODE's own
      properties-panel section (not the conflicting keyword's own panel —
      unlike `HIGHLIGHT`+`CDEFNT`/`FNTCHRSET`, this batch's own task
      description called for attaching it to BARCODE's form specifically).
      17 new tests (`test/prtfBatchN.test.ts`), including a parametrized
      check over the full eleven-keyword list, not just the subset README
      originally named.
- [x] **Batch E — AFP page-group / resource keyword placeholders — done.**
      New `src/prtfPageGroupKeywords.js` module (parse/build pair per
      keyword, following the same shape as Batch C's
      `prtfBarcodeParams.js`) covers all seven keywords confirmed
      record-level against `docs/KEYWORD-INVENTORY.md` §2's own menu-grid
      listing: `OVERLAY`, `PAGSEG`, and `AFPRSC` carry their own page
      position, so each renders as a labeled placeholder box on the page
      (`prtfLayout.js`'s new `resolveResourcePlaceholders`, exposed as
      `layout.resources`) — same honest "can't show real pixel content
      without the resource file itself" treatment as `BARCODE`'s own
      placeholder, per `docs/REQUIREMENTS.md` §8's documented hard limit.
      `STRPAGGRP`/`ENDPAGGRP`/`DOCIDXTAG`/`DTASTMCMD` have no page position
      of their own (a page group is a logical grouping of whole pages, not
      a place on one), so they're surfaced instead as a non-positioned
      badge list (`resolvePageGroupMetadata`, `layout.pageGroupKeywords`).
      Verified each keyword's exact parameter shape and quoting rule
      against IBM's DDS reference: `OVERLAY`/`PAGSEG`'s resource name is an
      **object name** (unquoted, matching this project's own
      `sample-afpds.pf` fixture's `PAGSEG(COMPLOGO 0.5 0.5)`), while
      `AFPRSC`'s resource name and `STRPAGGRP`'s group-name/`DOCIDXTAG`'s
      attribute-name/attribute-value/`DTASTMCMD`'s text are **character
      values** (quoted) — any of the above may instead be an unquoted
      `&field` program-to-system-field reference. Anything beyond each
      keyword's modeled positional params (e.g. `OVERLAY`/`PAGSEG`'s
      optional `(*ROTATION n)`, `AFPRSC`'s `(*SIZE ...)`/mapping-option/
      color-profile) is preserved verbatim in an `extra` field and
      re-appended on build, the same "don't silently drop what isn't
      modeled" treatment Batch C's `unrecognizedRaw` established. New
      properties panel (`renderPageGroupPanel`, `media/webviewClient.js`)
      reuses `setRecordKeyword`/`removeRecordKeyword` (Batch F's edit
      kinds) for all seven; a record coding the same one of these keywords
      more than once (e.g. two `OVERLAY`s for front/back) is fully
      rendered (every instance, via `findAllKeywords` same as `LINE`/`BOX`)
      but only the first is reachable for editing from the panel — noted
      inline in the panel's own doc comment as a known, accepted
      simplification consistent with every other record-keyword panel in
      this codebase. Reused Batch C's quote-aware `groupTokens` tokenizer
      (rather than the plain `paramTokens`) for parsing, since
      `DOCIDXTAG`'s quoted attribute values can contain internal spaces
      (`'Policy Number'`) the same way `EDTWRD` could (Batch R's bug fix)
      — caught by a first draft's test failure before landing. 17 new
      tests (`test/prtfBatchE.test.ts`): round-trip for all seven keywords,
      parse/build for each keyword's own shape (including the optional-pair
      offset rule for `PAGSEG`, quoting rules, and `&field` handling), and
      `resolveLayout` surfacing both `layout.resources` and
      `layout.pageGroupKeywords` correctly, including a record with two
      `OVERLAY`s.
- [x] **Batch F — Print/finishing device keywords (no visual,
      validation-only):** `DUPLEX`, `FORCE`, `OUTBIN`, `ZFOLD`, `STAPLE`,
      `INVMMAP` — these don't affect the page-preview layout; exposed in
      their own always-visible per-record properties panel, with
      validation hints against IBM's documented restrictions
      (`ZFOLD`/`STAPLE` are PSF-only). Also lands the file-level
      `SKIPA`/`SKIPB` `*AFPDS` check folded in from Batch I below. See
      `docs/TASKS.md` Batch F for implementation notes.
- [x] **Batch G — Field-level data/edit keywords:** `ALIAS`, `BLKFOLD`,
      `CVTDTA`, `DLTEDT`, `FLTFIXDEC`, `FLTPCN`, `TRNSPY`, `TXTRTT` land as
      an always-visible "Data/edit keywords" section in the field
      properties panel, with the same applicability-warning approach as
      Batch F (`PrtfEngine.validateFieldKeywords`). `INDTXT` feeds indicator
      descriptions into the existing indicator-toggle panel (tooltip + text
      next to each checkbox) with a small record-level editor alongside it
      — I-SDA turned out not to have a directly portable INDTXT UX to copy
      (see `docs/TASKS.md` Batch G's own note), so this was built fresh
      against IBM's DDS reference instead.
- [x]/[ ] **Batch H — `REF`/`REFFLD` resolution via Code for i — part 1
      done, part 2 blocked without a live IBM i.** Part 1 (UI shape, fully
      testable): `PrtfEngine.resolveReferenceTarget` works out which
      field/library/file a reference field (position 29 'R') resolves
      against, following REFFLD-overrides-REF/`*SRC`-is-unresolvable
      precedence from IBM's DDS reference; the properties panel now has the
      "Reference a field" / "Use referenced values" toggle pair from
      KEYWORD-INVENTORY §3, wired to a REFFLD keyword upsert
      (`PrtfWriter.upsertReffldKeyword`). Part 2 (the actual DSPFFD + SQL
      round-trip over Code for i, in `extension.ts`'s
      `fetchReferencedFieldAttributes`/`handleResolveReferencedField`) is
      written following I-SDA's own integration pattern but — like I-SDA's
      equivalent — can only be exercised against a real connected IBM i, not
      in this environment.
- [x] ~~Batch I — `UOM` (unit of measure) modeling~~ — **done**: see
      `i-rlu.unitOfMeasure` setting above. The remaining piece — validating
      that file-level `SKIPA`/`SKIPB` isn't allowed on `*AFPDS` files
      (KEYWORD-INVENTORY §1) — is now **also done**, folded into Batch F's
      validation work above rather than kept as its own batch.
- [ ] **Batch J — Compile command polish:** let the user pick
      library/source-file/member instead of assuming `*CURLIB/QDDSSRC`.
- [x] **Batch K — Packaging:** `vsce package` producing a real `.vsix`
- [x] **Batch K — Packaging:** `vsce package` producing a real `.vsix`
      (verified: `i-rlu-0.0.1.vsix`, 427.66 KB, no warnings). Along the
      way, found and fixed a real bug: `package.json`'s `"main"` pointed at
      a path that didn't exist after `tsc` compiled (`./out/extension.js`
      vs. the actual `./out/src/extension.js`), which would have made any
      packaged/installed build fail to activate. `LICENSE` and
      `images/icon.png` were copied over from the I-SDA repo (same
      publisher) at the repo owner's direction. See `docs/TASKS.md` Batch K
      for the rest (`.vscodeignore`, `vsce` scripts).
- [x]/[ ] **Batch L — Real AFP font metrics — mostly done.** `FONT`/FGID
      *identification* is resolved: a verified FGID table (Courier/
      Gothic fixed families, Helvetica/Times New Roman proportional
      families, point-size-to-CPI conversion for scalable monospace fonts),
      sourced against IBM's own FGID/typeface documentation, with
      field-over-record-over-file precedence matching DDS's own rules.
      Caught and corrected an error from an earlier reference along the way
      (FGID 416 is Courier Roman Medium, not "Times Roman" as that
      reference had it — regression test guards this). Proportional-font
      per-glyph advance widths (Helvetica/Times New Roman) now use the
      real published Adobe Font Metrics (AFM) values for the
      metric-compatible PostScript substitute fonts (Helvetica,
      Times-Roman/Bold/Italic/BoldItalic) — genuine, stable, industry-
      standard data (used in every PDF library and PostScript RIP since
      1985), not an invented approximation, replacing the earlier flat
      placeholder table. **Still open:** the one honest caveat on the
      above — these are the *substitute* font's published metrics, applied
      as the best available proxy for IBM's own FGID-named fonts, not a
      verified byte-for-byte extraction of IBM's own FGID resource data
      (this tool has no access to that). Also still unresolved:
      `CDEFNT`/`FNTCHRSET`/`FONTNAME` resolution, which reference host/IFS
      font objects that `FONT`/FGID doesn't touch at all (these overlap
      with Batch B's scope for the DDS-editing side, but the actual
      metric/resource data behind them is Batch L's remaining blocker). A
      promising direction raised for closing this gap: extracting real
      font data from a connected IBM i (TrueType files under
      `/QIBM/UserData/OS400/Fonts/TTF/`, or FOCA font character-set
      metrics via host APIs) — worth pursuing, but the specific paths/API
      names haven't been independently verified yet, so nothing's been
      built against them. See `src/afpFontMetrics.js` for the full tables
      and sourcing notes, and `docs/TASKS.md` Batch L for the canonical
      status (update that file too if you pick this back up).
- [ ] **Batch Q — Copy/duplicate a field or constant:** add/update/delete
      already exist for fields and constants, but not copy — cloning one
      with its keywords intact currently means re-entering everything by
      hand. No dependency — sits next to the existing Delete button and
      reuses the add-field edit-kind shape. See `docs/TASKS.md` Batch Q.

Each batch's keyword list, current model/parser/engine status
(modeled/rendered/UI), and IBM-documented gotchas are detailed in
`docs/KEYWORD-INVENTORY.md`; don't re-derive them from scratch per batch.

## Explicit open decision points (carried from REQUIREMENTS.md)

- Font resource access (§9) — partially resolved. FGID identification
  (which font family/spacing a `FONT` keyword refers to) is now backed by
  a verified table. Real per-glyph metrics for proportional fonts, and any
  resolution of `CDEFNT`/`FNTCHRSET`/`FONTNAME`, are still open — see the
  two items directly above.
