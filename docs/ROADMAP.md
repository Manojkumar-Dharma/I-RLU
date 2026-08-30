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

## Next up

As of the RLU screen-capture review (`docs/KEYWORD-INVENTORY.md`), the
remaining work is re-organized into the parallel-session task batches in
`docs/TASKS.md` — each batch is scoped to be pickable up independently
without stepping on another in-progress session. Summary (see TASKS.md for
full detail, acceptance criteria, and file-level ownership per batch):

- [ ] **Batch A — Properties-panel keyword editing, non-AFP-resource set:**
      `EDTCDE`, `EDTWRD`, `DATE`/`DATFMT`/`DATSEP`, `TIME`/`TIMFMT`/`TIMSEP`,
      `DFT`, `MSGCON`, `COLOR` (all 5 color models), `HIGHLIGHT`,
      `UNDERLINE`, `PAGNBR`, `PRTQLTY`, `DRAWER`, `PAGRTT`.
- [ ] **Batch B — Font/character-sizing keyword editing incl. P-field
      indirection:** `FONT`, `CDEFNT`, `FNTCHRSET`, `FONTNAME`, `CHRSIZ`,
      `CHRID`, `CCSID`, plus the generic literal-vs-P-field toggle component
      these all share (see KEYWORD-INVENTORY §5) — build the toggle once,
      reuse across this whole batch.
- [ ] **Batch C — Real `BARCODE` parameter surface (still placeholder
      rendering):** expose the full parameter set now confirmed in
      KEYWORD-INVENTORY §3 (symbology id, height-in-lines-or-UOM, bar format,
      HRI position, modifier, narrow bar width, wide:narrow ratio, 2D params)
      in the properties panel, even before real symbol rendering exists.
- [ ] **Batch D — Real `BARCODE` symbol rendering:** actual bars via a
      barcode-generation library, once Batch C's parameters are wired up to
      read from.
- [ ] **Batch E — AFP page-group / resource keyword support:** `OVERLAY`
      (record-level), `PAGSEG`, `STRPAGGRP`/`ENDPAGGRP`, `DOCIDXTAG`,
      `AFPRSC`, `DTASTMCMD` — render as labeled placeholder boxes per
      `docs/REQUIREMENTS.md` §8's documented hard limit (no real resource
      pixel content), but make them visible/editable instead of silently
      inert.
- [x] **Batch F — Print/finishing device keywords (no visual,
      validation-only):** `DUPLEX`, `FORCE`, `OUTBIN`, `ZFOLD`, `STAPLE`,
      `INVMMAP` — these don't affect the page-preview layout; exposed in
      their own always-visible per-record properties panel, with
      validation hints against IBM's documented restrictions
      (`ZFOLD`/`STAPLE` are PSF-only). Also lands the file-level
      `SKIPA`/`SKIPB` `*AFPDS` check folded in from Batch I below. See
      `docs/TASKS.md` Batch F for implementation notes.
- [ ] **Batch G — Field-level data/edit keywords:** `ALIAS`, `BLKFOLD`,
      `CVTDTA`, `DLTEDT`, `FLTFIXDEC`, `FLTPCN`, `TRNSPY`, `TXTRTT`,
      `INDTXT` (ties into the indicator-toggle panel's text labels — port
      I-SDA's indicator-description UX).
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
      (verified: `i-rlu-0.0.1.vsix`, 43.96 KB). Along the way, found and
      fixed a real bug: `package.json`'s `"main"` pointed at a path that
      didn't exist after `tsc` compiled (`./out/extension.js` vs. the
      actual `./out/src/extension.js`), which would have made any
      packaged/installed build fail to activate. See `docs/TASKS.md`
      Batch K for the rest (`.vscodeignore`, `vsce` scripts, and the one
      thing deliberately left open — no `LICENSE` file yet, since that's
      the repo owner's call).
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
- [ ] **Batch P — Add/rename/delete/reorder record formats from the
      designer:** the toolbar's record-format dropdown only switches
      between record formats already in the source; there's no way to
      create, rename, delete, or reorder one without editing raw DDS text.
      No dependency — builds directly on the existing `<select>` and
      `applyEdit` edit-kind pattern. See `docs/TASKS.md` Batch P.
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
