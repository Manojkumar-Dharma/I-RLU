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
- [x] Placeholder AFP font-metrics module with a clear seam for real font
      data later.
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
- [x] Test suite (21 tests): parser correctness, round-trip fidelity,
      engine resolution (incl. indicator toggling, LINE/BOX geometry with
      hand-verified expected coordinates, BARCODE line-count and
      default-height cases, uom inch/cm conversion with hand-verified
      math), id stability, and edit-then-reparse round-trips for move/add
      field/add constant/delete/update.
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
- [ ] **Batch F — Print/finishing device keywords (no visual,
      validation-only):** `DUPLEX`, `FORCE`, `OUTBIN`, `ZFOLD`, `STAPLE`,
      `INVMMAP` — these don't affect the page-preview layout, just expose
      them in the properties panel and validate against IBM's documented
      restrictions (e.g. `ZFOLD`/`STAPLE`/`GDF` are PSF-only).
- [ ] **Batch G — Field-level data/edit keywords:** `ALIAS`, `BLKFOLD`,
      `CVTDTA`, `DLTEDT`, `FLTFIXDEC`, `FLTPCN`, `TRNSPY`, `TXTRTT`,
      `INDTXT` (ties into the indicator-toggle panel's text labels — port
      I-SDA's indicator-description UX).
- [ ] **Batch H — `REF`/`REFFLD` resolution via Code for i:** pull real
      type/length/decimals from the referenced physical file; also model
      RLU's own "Reference a field" / "Use referenced values" toggle pair
      confirmed in KEYWORD-INVENTORY §3, since that's the UI shape to match.
- [x] ~~Batch I — `UOM` (unit of measure) modeling~~ — **done**: see
      `i-rlu.unitOfMeasure` setting above. The remaining piece — validating
      that file-level `SKIPA`/`SKIPB` isn't allowed on `*AFPDS` files
      (KEYWORD-INVENTORY §1) — is still open; folded into Batch F's
      validation work rather than kept as its own batch.
- [ ] **Batch J — Compile command polish:** let the user pick
      library/source-file/member instead of assuming `*CURLIB/QDDSSRC`.
- [ ] **Batch K — Packaging:** `vsce package` and a first `.vsix` for manual
      install/testing.
- [ ] **Batch L — Real AFP font metrics**, once available (see README's
      "AFPDS font metrics" section) — the one open item from
      `docs/REQUIREMENTS.md` §9.

Each batch's keyword list, current model/parser/engine status
(modeled/rendered/UI), and IBM-documented gotchas are detailed in
`docs/KEYWORD-INVENTORY.md`; don't re-derive them from scratch per batch.

## Explicit open decision points (carried from REQUIREMENTS.md)

- Font resource access (§9) — still open; using placeholder metrics until
  real font data is supplied.
