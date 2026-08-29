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
      placement, indicator-based conditioning/filtering, and `LINE`/`BOX`
      geometry (record-level, AFPDS-only, converted from physical units to
      the character grid via CPI/LPI) — verified against IBM's DDS
      reference after an earlier draft used a fictitious `DRAW` keyword.
- [x] Placeholder AFP font-metrics module with a clear seam for real font
      data later.
- [x] Extension host: `CustomTextEditorProvider` registered for `.pf`/
      `.prtf`/`.rlu` (local, `member:`, and `streamfile:` schemes).
- [x] Webview: page-grid rendering, record-format switcher, indicator
      toggle panel, drag-to-reposition with edits written back through the
      real writer/model (single `WorkspaceEdit`, so undo/redo works
      normally), and real `LINE`/`BOX` geometry rendering (flagged when a
      program-to-system field parameter can't be resolved statically).
- [x] Webview properties panel: click a field/constant to edit name,
      length, data type, decimals, usage, line/position (fields) or text +
      line/position (constants), or delete it.
- [x] "+ Field" / "+ Constant" click-to-place: arm placement mode, click a
      spot on the page, fill in a form, and the new entry is inserted into
      the source right after the record's last existing entry.
- [x] `CRTPRTF` compile command via Code for i's `runCommand` API.
- [x] Test suite (17 tests): parser correctness, round-trip fidelity,
      engine resolution (incl. indicator toggling, LINE/BOX geometry with
      hand-verified expected coordinates), id stability, and
      edit-then-reparse round-trips for move/add field/add constant/
      delete/update.

## Next up (not started)

- [ ] `BARCODE` rendering (placeholder box acceptable for v1, per
      requirements doc).
- [ ] Page segment / overlay resource placeholders (labeled boxes) once a
      resource-resolution strategy is decided.
- [ ] Keyword-level editing in the properties panel (currently only the
      positional attributes and one literal/name field are editable;
      arbitrary keywords like `EDTCDE`, `COLOR`, `LINE`, `BOX` params
      aren't exposed in the UI yet, though the writer/model already
      support them).
- [ ] `UOM` (unit of measure) isn't modeled yet — LINE/BOX conversion
      currently assumes inches; needs to read the actual UOM keyword/
      CRTPRTF setting once that's wired up.
- [ ] `REF`/`REFFLD` resolution via Code for i (pull real type/length/
      decimals from the referenced physical file) — flagged in the
      requirements doc as something I-SDA also left as future work.
- [ ] Compile command: let the user pick library/source-file/member
      instead of assuming `*CURLIB/QDDSSRC`.
- [ ] Packaging (`vsce package`) and a first `.vsix` for manual install/testing.
- [ ] Real AFP font metrics, once available (see README's "AFPDS font
      metrics" section) — this is the one open item from
      `docs/REQUIREMENTS.md` §9.

## Explicit open decision points (carried from REQUIREMENTS.md)

- Font resource access (§9) — still open; using placeholder metrics until
  real font data is supplied.
