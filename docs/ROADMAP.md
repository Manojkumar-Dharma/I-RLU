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
- [x] **Batch S — Fixed wide-record-format panel layout.** A wide
      record format (e.g. `PAGSIZE(66 132)`) rendered a report preview
      wider than the panel viewport; since every section used to be one
      long vertical stack in plain block flow, this pushed the
      properties/keywords panels far below the fold instead of leaving
      them reachable alongside the report. Reworked the webview into two
      independently-scrollable columns — a left report-preview column
      (scrolls both ways) and a right, fixed-width properties/keywords
      column (scrolls vertically only) — modeled on I-SDA's own
      `aside`/`main`/`.props-panel` shell. See `docs/TASKS.md` Batch S for
      the full writeup. No existing test depended on the old DOM shape;
      full suite still 272 tests, all passing.

- [x] **Batch T — Fixed missing right-click "open designer" for
      `.pf`/`.prtf`/`.rlu` files.** Two compounding gaps: `package.json`
      had no `contributes.menus` entry at all for `i-rlu.openDesigner`
      (so it was only ever reachable via the Command Palette), and the
      command handler ignored any URI argument, reading only
      `vscode.window.activeTextEditor` — so it would've done nothing on
      an unfocused file even after adding a menu entry. Added
      `explorer/context`/`editor/title/context`/`editor/title` menu
      contributions scoped to the same three extensions the existing
      `customEditors` selector already covers, and updated the handler to
      use the passed-in URI when present. `activationEvents: []` was
      checked and ruled out — implicit activation from `contributes` has
      applied automatically since VS Code 1.74, well before this
      project's `^1.85.0` minimum. See `docs/TASKS.md` Batch T for the
      full root-cause writeup. No automated test coverage (this project
      has no `vscode`-module mock); full suite still 300 tests, all
      passing.

- [x] **Batch U — Hide Code-for-i-dependent UI when disconnected +
      themed properties-column scrollbar.** Prompted by comparing against
      a matching fix in I-SDA (sibling project): the runCommand-race half
      of that fix was already independently present in I-RLU
      (`getCodeForIConnection()` already calls `connection.runCommand()`
      directly, not `vscode.commands.executeCommand`), but the
      hide-Compile/lookup-UI-when-disconnected half had no I-RLU
      equivalent. Added a `getCodeForIStatus()`-driven connection badge
      plus hidden Browse/Resolve Referenced Field buttons in the designer
      webview (mirrors I-SDA's Task L18), and a global
      `i-rlu.codeForIConnected` context key gating `i-rlu.compilePrtf`'s
      Command Palette entry (I-RLU's Compile command isn't a webview
      button like I-SDA's, so it needed a VS Code-wide toggle instead of
      a per-panel one). Also gave the properties/keywords column an
      explicit, VS Code-themed scrollbar (`scrollbar-width`/-`color` +
      `::-webkit-scrollbar` rules), believing at the time it already
      scrolled (Batch S) and just needed to be more visible — **this
      premise turned out to be wrong, see Batch V below.** See
      `docs/TASKS.md` Batch U for the full writeup. No automated test
      coverage for the new behavior itself (same documented gap as Batch
      T); full suite still 334 tests, all passing.

- [x] **Batch V — Bug fix: properties/keywords column still didn't
      scroll.** Reported after installing the Batch U build. Root cause
      was one level up from where Batch S/U looked: `#root` (the div
      `render()` in `media/webviewClient.js` actually populates) had no
      CSS sizing rule at all, so as a flex child of `body` it sized to
      its own content instead of being capped at `body`'s fixed
      `100vh` — breaking the height-constraint chain `.side-col`'s
      `overflow-y: auto` depends on before it ever reached `.side-col`.
      Added `#root { display: flex; flex-direction: column; flex: 1;
      min-height: 0; overflow: hidden; }`. See `docs/TASKS.md` Batch V
      for the full root-cause writeup, including why I-SDA's own
      similar-looking column shell never hit this (no intermediate
      `#root`-equivalent wrapper there). No real-browser verification
      was possible in the fixing session (sandbox has no usable headless
      browser); `test/webviewLayout.test.ts` added instead to lock in the
      specific CSS rules the fix depends on. **Please verify in a real
      Extension Development Host.** Full suite now 336 tests, all
      passing.

- [x] **Batch W — Configurable designer-open location.** Added
      `i-rlu.designerOpenColumn` setting (`active`/`beside`/`newWindow`,
      default `active`), mirroring I-SDA's `isda.designerOpenColumn`
      almost exactly. New `src/designerOpenMode.ts` holds the pure
      value-normalization logic (unit-tested, no `vscode` import — same
      "pure logic module `extension.ts` calls into" split this project
      already uses for `prtfCompileTarget.ts`); `extension.ts`'s
      `getDesignerOpenMode()`/`openInDesigner()` do the actual
      `vscode.workspace.getConfiguration`/`vscode.commands.executeCommand`
      work and have no automated coverage (same documented gap as
      Batches T/U/V). The existing `i-rlu.openDesigner` command (Batch T)
      now delegates to `openInDesigner()` instead of always opening in
      `vscode.ViewColumn.Active` with no way to configure that.
      Deliberately does NOT apply to the `customEditors` `priority:
      "option"` double-click-in-Explorer path — matches I-SDA's own
      scope, which has the same limitation (no public VS Code API to
      influence that path's column). See `docs/TASKS.md` Batch W for
      the full writeup. **Please verify all three enum values in a real
      Extension Development Host.** Full suite now 340 tests, all
      passing.

- [x] **Batch X — Track source modifications.** Added
      `i-rlu.trackSourceModifications`/`i-rlu.modificationTag` settings
      and the comment-out-and-tag behavior they drive, mirroring I-SDA's
      `isda.trackSourceModifications`/`isda.modificationTag` closely —
      `src/prtfWriter.js` gained `commentOutLine`/`buildModTag`/
      `appendModTag`/`applyModificationTracking` ported from I-SDA's
      `dspfWriter.js` (same shapes, including its Task L52 grouping fix:
      old lines commented out together, then new lines tagged together,
      never interleaved, so a continuation chain between two new lines
      is never split apart by an unrelated old-line comment landing
      between them). `extension.ts` gained one shared choke point,
      `applyTrackedDocumentEdit`, replacing separate inline
      regenerate-then-WorkspaceEdit blocks, so every document-writing
      path (a plain edit, both REF/REFFLD resolution handlers, and
      Batch Y's "Add fields from database file" below) gets tracking for
      free. A toolbar checkbox + 10-char tag input
      (`media/webviewClient.js`) drives per-session state via a new
      `"setModTracking"` message — plain controls rather than the
      P-field-style toggle component, since a P-field toggle is for
      "literal vs. `&FIELD`" on one keyword parameter, a different shape
      than an on/off flag plus a free-text tag. The multi-line-constant
      interaction this task's own notes flagged (given Batch M/R's
      continuation-character/tokenization history) was verified
      explicitly with an end-to-end parse → edit → regenerate → track →
      reparse test against a continuation-wrapped constant. See
      `docs/TASKS.md` Batch X for the full writeup. **Merged with
      upstream Batch Y/Z work (already done by the time this batch's
      writer/settings/message-protocol pieces were ready to push) —
      both REF/REFFLD-picker write paths were reconciled so
      `handleAddFieldsFromDatabase`'s own write also goes through the
      new `applyTrackedDocumentEdit` choke point rather than a bare
      `WorkspaceEdit`.** Full suite now 352 tests, all passing.
- [x] **Batch Y — Add fields from database file.** Browse every field in a
      PF/LF via Code for i and add several as new named fields in one go —
      distinct from Batch H's own "Browse fields…" (which sets `REFFLD` on
      ONE already-existing field), though it reuses that same batch's
      `fetchDatabaseFileFields` unchanged. New "+ Fields from DB…" toolbar
      button (hidden with a warning hint while disconnected, same treatment
      as Batch H's own buttons) prompts for library/file, fetches the field
      list, and shows a multi-select QuickPick; each pick becomes a new
      field (auto-`REFFLD`'d, position 29 'R' set via a new `reference`
      flag on the `addField` edit kind) stacked one row below the previous.
      Deliberately scoped to I-SDA's Task L14 only, not its later Task L53
      click-to-place refinement — see `docs/TASKS.md` Batch Y for why that
      line was drawn. New `nextAvailableFieldName` helper in
      `prtfEdits.ts` de-duplicates field names across the batch. No
      automated coverage for the host-side handler itself (same
      no-`vscode`-mock gap Batches T/U/V/W already document); the pure
      model-mutation and name-deduplication logic got 5 new unit tests, and
      the toolbar button's hide/show/message-posting behavior was verified
      with a jsdom smoke check. **Please verify against a real, connected
      IBM i in a real Extension Development Host.** Full suite now 345
      tests, all passing.
- [x] **Follow-up consolidation (Batch H + Batch Y) — done.** Reported by
      Manojkumar-dharma: Batch H's `handleBrowseReferencedField` and
      Batch Y's `handleAddFieldsFromDatabase` (above) each carried their
      own copy of the identical "fetch → disambiguate multi-format file →
      show a QuickPick of the resulting fields" sequence, and Batch Y's
      added fields are indeed just REFFLD references under the hood —
      same mechanism Batch H already uses, confirming the report.
      Extracted the shared sequence into `pickDatabaseFileFields()`
      (`src/extension.ts`); both handlers now call it instead of
      duplicating it. The two remain separate commands/buttons (resolve
      REFFLD on one existing field vs. bulk-add several new ones are
      still genuinely different actions from the person's perspective) —
      only the shared internal picker logic was merged, not the features
      themselves. Pure refactor, no behavior change; full suite still
      352/352.
- [x] **Batch Z — System-constant fields (`DATE`/`TIME`/`PAGNBR`) —
      done.** Design-time placeholder text for constants defined purely
      via keyword (no literal) — mirrors I-SDA's `fieldDisplayText`:
      `DATE` → current date, `TIME` → current time, `PAGNBR` → `"1"` (see
      `src/prtfLayout.js`'s `resolveConstantPlaceholder`), wired into both
      the rendered text AND the display length (previously a
      system-constant field always measured `entry.length || 1`, wrong
      once real placeholder text is shown instead of blank). New
      "Constant type" selector on the "+ Constant" properties panel
      (`media/webviewClient.js`) lets a system constant be added directly,
      alongside the existing literal-text flow — a new optional
      `systemConstantKeyword` field on the `addConstant` edit kind
      (`src/webviewProtocol.ts`/`src/prtfEdits.ts`), rather than a whole
      new edit kind, following this codebase's established
      "extend, don't duplicate" pattern for `addField`/`addConstant`.
      **Correction found during this batch** (see
      `docs/REQUIREMENTS.md` §10 for the full writeup): the task as
      originally filed named `USER`/`SYSNAME` alongside `DATE`/`TIME`/
      `PAGNBR`, mirroring I-SDA's own five-keyword `fieldDisplayText` —
      but verification against IBM's DDS Reference: Printer Files found
      `USER`/`SYSNAME` aren't valid printer-file keywords at all
      (display-file only). Deliberately not implemented; same
      honesty-over-silent-scope-drop treatment as the earlier fictitious
      `DRAW` keyword correction. **Bug fixed along the way:** saving an
      existing constant's properties panel with the Text field left blank
      used to write `literal: ""` unconditionally (`updateConstant`),
      which for a system-constant field turned "no literal" into an
      explicit empty one — regenerating a spurious `''` token next to the
      keyword on next write-back. Both `updateConstant` and
      `addConstant` now treat an empty Text field as "no literal"
      (`undefined`), matching what the parser itself produces for a
      freshly-parsed system-constant. 7 new tests
      (`test/prtfBatchZ.test.ts`); full suite now 347 tests, all passing.

- [x] **Batch CC — Per-keyword conditioning indicators.** Real DDS/RLU
      lets a keyword-only continuation line (blank name/type/position,
      just its own conditioning) attach ADDITIONAL, independently-
      conditioned keyword(s) to an existing field/constant — e.g. two
      mutually-exclusive `COLOR` keywords on one field, each active under
      a different indicator. `Keyword` had no `conditions` field at all,
      and the parser was misparsing every such line as a bogus phantom
      constant. `Keyword.conditions` added (independent of the owning
      entry's own conditions), parser now correctly attaches these lines
      to the preceding entry, and the writer (`groupKeywordsByConditions`/
      `emitEntryWithConditionedKeywords`) now round-trips per-keyword
      conditioning instead of silently flattening/losing it. Indicator
      toggling in the toolbar now also correctly switches `DATE`/`TIME`/
      `PAGNBR`, `SKIPB`/`SPACEB`/`SKIPA`/`SPACEA`/`BARCODE`, and the FONT
      cascade when conditioned this way. NOT yet done: threading indicator
      state through `PAGSIZE`/`LINE`/`BOX`/`OVERLAY`/`PAGSEG`/`AFPRSC`/
      page-group geometry, and — separately, pre-existing — `COLOR`/
      `DSPATR` still aren't visually rendered in the preview at all. See
      `docs/TASKS.md` Batch CC for the full writeup. 11 new tests; full
      suite now 375, all passing.
- [x] **Batch AA — Bug fix: `regenerateSource` dropped the optional
      column-6 form-type marker on every line, breaking Batch X's
      tracking.** Found reviewing two real-world sample files supplied for
      keyword-usage reference (both use `A` in column 6 throughout, a
      common, IBM-documented-as-optional convention). `regenerateSource`
      rebuilds every line fresh on every call, and previously hardcoded
      column 6 to blank — so on real source written in this style, a
      single one-field edit combined with Batch X's tracking flagged 67 of
      93 lines as "changed." `BaseEntry` (`src/prtfModel.ts`) gained an
      optional `formType`; `prtfParser.ts` captures it per entry (comment/
      record/field/constant, plus the file-level entry's first
      contributing line); `prtfWriter.js`'s `buildPositional`/
      `emitWithKeywords` reproduce it — including on continuation lines,
      not just an entry's first physical line — instead of hardcoding
      blank. New `test/prtfBatchAA.test.ts`; the two real-world files are
      now `test/fixtures/scsprt1-realworld.prtf`/`afpprt1-realworld.prtf`.
      **Merged with the concurrently-landed Batch CC above** — its new
      `emitEntryWithConditionedKeywords` also needed `formType` threaded
      through, including onto each attached conditioned-keyword line's own
      separate physical line(s), not just an entry's header line. Full
      suite now 377 tests, all passing. **Found along the way, logged
      separately as Batch LL rather than folded in:** DDS's `+n`
      relative-position notation (columns 42-44) is silently read as a
      plain absolute number — a distinct, differently-scoped bug.

- [x] **Batch DD — Batch CC follow-up: geometry keyword conditioning.**
      Threaded indicator state through the record/file-level lookups
      `resolveLayout` resolves once per call — `PAGSIZE`, `CPI`/`LPI`,
      `LINE`/`BOX`, `OVERLAY`/`PAGSEG`/`AFPRSC`, and `STRPAGGRP`/
      `ENDPAGGRP`/`DOCIDXTAG`/`DTASTMCMD` — completing what Batch CC left
      as its own explicitly-flagged remaining scope. Found and fixed two
      real bugs along the way, not just plumbing: Batch CC's own attached-
      keyword-line detection had no path to attach a conditioned line to
      the RECORD FORMAT ITSELF (only ever to a field/constant), which
      matters a lot here since PAGSIZE/CPI/LINE/etc. are record-level
      keywords; and `findActiveKeyword` used first-match-wins semantics,
      which silently defeats the common "unconditioned default + a
      conditioned override of the same keyword" authoring pattern (fixed
      to last-active-match-wins). Also captured file-level keywords' own
      conditioning, previously computed and discarded. See `docs/TASKS.md`
      Batch DD for the full writeup. 8 new tests; full suite now 394, all
      passing; byte-identical round-trip re-verified against all three
      real fixture files.

- [x] **Batch FF — Bug fix: properties-panel row layout consistency.**
      Reported: "check box and text box are improperly placed... Range
      them in a way it is easy and uniform." Three independent CSS bugs
      in the shared `.prop-row` rule set — checkboxes stretched to 140px
      wide (an un-scoped width rule matched them too), label columns
      that didn't line up row-to-row (`.ind-label`/`.pfield-label` had
      no fixed width), and multi-input rows overflowing/wrapping
      unevenly (every input independently claimed a fixed 140px instead
      of sharing available space) — plus two structural bugs no CSS fix
      could touch: three Y/N toggles (barcode Asterisk, "Reference a
      field", "Use referenced values") built their checkbox+label in the
      reverse order from every other toggle, and four AFP-resource rows
      (`appendOverlayRow`/`appendPagsegRow`/`appendAfprscRow`/
      `appendDocidxtagRow`) appended their value inputs with no row
      wrapper at all. See `docs/TASKS.md` Batch FF for the full
      root-cause writeup. `test/webviewLayout.test.ts` extended with 4
      new tests (CSS rule shape + a source-text structural check for the
      four bare-appendChild rows); full suite now 368 tests at the time
      (394 after Batch CC/DD landed on top), all passing.
      **Please verify in a real Extension Development Host**
      (no headless browser available in this sandbox) — ideally against
      a row with several different keyword types checked at once so the
      alignment is visible across every row shape together.

- [x] **Batch BB — Bug fix: a constant's literal is only recognized when
      it's the first keyword-area token.** Found in the same real-world
      sample-file review as Batch AA/LL: `SCSPRT1.prtf` has constants like
      `SPACEB(1) 'CUSTOMER MASTER LISTING'` — a keyword before the
      constant's own display text, which is legal DDS (a constant's
      literal can appear anywhere among its keywords) but not handled by
      `prtfParser.ts`'s old literal-extraction regex, which was anchored
      with `^` and only ever matched a LEADING literal. When a keyword
      came first instead, `constant.literal` stayed `undefined` and the
      quoted text silently fell through as an ordinary nameless keyword
      token — a model-fidelity bug, not a source-corruption one (the old,
      buggy behavior happened to round-trip byte-identical by accident):
      the Properties panel reads `entry.literal` for a constant's "Text"
      field, so a constant hit by this case showed blank Text for a field
      that actually has real, compiled display text. **Fix:** the
      constant branch now tokenizes the whole keyword-area text with the
      existing `splitKeywords` (already quote/paren-aware, and already
      recognized a bare quoted literal as a `name: ""` token from
      anywhere in the text — no new tokenizer needed) instead of an
      anchored regex, and takes the FIRST such token anywhere as the
      literal, leaving every other token as an ordinary keyword in
      original order. **A real trade-off found while testing, not
      silently accepted:** the writer has always emitted a constant's
      literal BEFORE its keywords (`emitEntryWithConditionedKeywords`'s
      `litToken` parameter — the same convention `sample1.pf`'s own
      `'Invoice Date:' SPACEB(1)` already follows), so once the literal
      is correctly recognized as such, a keyword-before-literal SOURCE no
      longer round-trips byte-for-byte on regenerate — it's normalized to
      literal-first, same as every other constant already is. This is
      DDS-equivalent and loses no information, just isn't literal-order-
      preserving for this one input shape; tests assert a parse →
      regenerate → reparse round trip reproduces the same literal/keyword
      set rather than byte-identical text for that specific case, while
      confirming the already-common leading-literal case is still
      byte-identical as before. See `docs/TASKS.md` Batch BB for the full
      writeup. 4 new tests in `test/prtfParser.test.ts` (the exact
      `SCSPRT1.prtf` patterns, a regression guard for the pre-existing
      leading-literal case, and a direct check against the real
      `scsprt1-realworld.prtf` fixture); full suite now 410, all passing.

- [x] **Batch II — Duplicate/clone an entire record format.** Batch Q
      covers copying a single field/constant; Batch P covers add/rename/
      delete/reorder of whole record formats — neither cloned an entire
      record format (header + every field/constant/keyword) in one action.
      Modeled on I-SDA's own `copyRecord`: a record's fields are copied
      **byte-for-byte verbatim** (DDS scopes field names per record
      format, so there's no collision risk to solve, unlike Batch Q's own
      copy-a-field-into-an-existing-record problem) — only the record's
      own NAME needs a fresh one. **Correction found while implementing:**
      no existing "non-colliding record name" helper actually existed to
      reuse (Batch Y's `nextAvailableFieldName` is scoped to one record's
      fields, not file-wide record names) — added a new sibling,
      `nextAvailableRecordName`, plus `makeIdGenerator` so cloned fields
      get fresh ids that can't collide with the model's existing ones.
      New `duplicateRecord` `WebviewEdit` kind dispatched through the
      existing generic edit-application plumbing (no `extension.ts`
      change needed); a "Duplicate" toolbar button posts it directly, no
      confirmation step, since there's nothing to fill in. Placement:
      right after the source record, with the source's own trailing
      comment staying attached to the source rather than being swept into
      the duplicate. See `docs/TASKS.md` Batch II for the full writeup.
      10 new tests in `test/prtfBatchII.test.ts` (byte-for-byte cloning,
      fresh/distinct ids, deep-clone-not-shared-reference, placement +
      trailing-comment attachment, naming collision on repeated
      duplication, an empty-record duplicate, and direct
      `nextAvailableRecordName` unit tests); full suite now 420, all
      passing. **Please verify in a real Extension Development Host**
      (no headless browser in this sandbox) that the "Duplicate" button
      produces a correctly-named, selectable clone.

- [x] **Batch EE — Render `COLOR`/`HIGHLIGHT`/`UNDERLINE` visually in the
      design-time preview.** These were editable via the properties panel
      (Batch A) and correctly resolved per-keyword-conditioning (Batch
      CC/DD), but nothing ever applied the resolved value to rendered cell
      text — toggling an indicator on a conditioned `COLOR` pair had no
      visible effect at all. **Scope correction found while implementing:**
      `DSPATR` was dropped from scope — verified against IBM's DDS
      reference for printer files (the full "the following keywords are
      valid for printer files" enumeration) and confirmed it's NOT a valid
      printer-file keyword at all (display-file only), the same kind of
      finding Batch Z made for `USER`/`SYSNAME`. Also confirmed each
      keyword's actual cascade rules against IBM's own keyword
      descriptions rather than assuming a FONT-like cascade: `COLOR` and
      `UNDERLINE` are field-level-only (no record/file cascade);
      `HIGHLIGHT` is record-level OR field-level with OR semantics ("if
      both the record- and field-level HIGHLIGHT keywords are specified
      and either indicator condition is met, HIGHLIGHT is used") rather
      than resolveFont's nearest-wins-and-stops. New `resolveColorStyle`/
      `resolveStyle` (`src/prtfLayout.js`) mirror the `resolveFont`/
      `resolveFontDisplay` split already established for FONT (Batch L
      continued): named colors and `*RGB`'s three literal 0-255 tokens
      resolve to an exact CSS color; `*CMYK`/`*CIELAB` stay flagged
      `approximate` with no guessed color, per Batch A's own documented
      caveat about their unconfirmed numeric ranges (docs/TASKS.md's own
      Batch EE wording overstated this by lumping `*RGB` in with the
      approximate ones — Batch A's actual comment confirms `*RGB` against
      the project's own `sample-afpds.pf` fixture). `resolveLayout` now
      carries a `style` object per cell alongside the existing `font`;
      `media/webviewClient.js`'s `renderPage` applies it (text color,
      `font-weight:bold` for HIGHLIGHT, `text-decoration:underline`), plus
      a tooltip note when a COLOR model isn't rendered. Not attempted:
      HIGHLIGHT's existing "ignored if CDEFNT/FNTCHRSET also coded"
      conflict (already surfaced as a `fieldWarnings` message) isn't
      cross-checked here to suppress the bold styling — kept out to stay
      "resolve + render" only, no model/parser/writer change, matching the
      task's own stated scope. See `docs/TASKS.md` Batch EE for the full
      writeup. 10 new tests in `test/prtfBatchEE.test.ts`; full suite now
      430, all passing. **No real-browser verification possible in this
      sandbox — please verify visually in a real Extension Development
      Host.**

- [x] **Batch GG — Field/constant overlap detection.** No overlap/
      collision logic existed at all — two fields could occupy the same
      cells with zero warning. Modeled on I-SDA's `dspfEngine.js`
      `resolveScreen` (same (line, column)-sorted, first-claim-wins
      bookkeeping), but **confirmed real printer-file DDS behavior
      differs from display files before reusing I-SDA's drop-the-loser
      approach**: IBM's own DDS reference for printer files states
      plainly, "If fields overlap, the printer overprints" — there's no
      dropped field at print time, unlike an interactive 5250 screen
      which can only show one thing per cell. So this is warn-only:
      `resolveLayout` (`src/prtfLayout.js`) gains a new `detectFieldOverlaps`
      pass and an `overlaps` array on its return value, but nothing is
      removed from the existing `cells` array — every field/constant
      renders exactly as before. A new warning banner in
      `media/webviewClient.js` (`.note.warning`, reusing the same warning
      color as the existing `.hint.warning` field-panel messages) lists
      each overlap as "`FIELD` over `BLOCKEDBY` (line L, pos P)". Scope
      boundary: overlap is checked against the CURRENTLY active indicator
      toggle state only (matching every other indicator-conditioned
      resolution already in this project), not every possible indicator
      combination at once — IBM's own reference notes the real compiler
      diagnoses overlap treating conditioned fields "as if they were
      selected," but this tool is a live, indicator-togglable design-time
      preview rather than a static compile-time analyzer; toggling
      indicators and re-checking is how a person exercises other
      combinations. See `docs/TASKS.md` Batch GG for the full writeup. 6
      new tests in `test/prtfBatchGG.test.ts` (disjoint fields report no
      overlap, two fields relocated onto the same range report each
      other with correct line/position and the losing field stays
      rendered, a constant-vs-constant overlap reports using literal
      text, indicator-toggle scoping, and two direct `detectFieldOverlaps`
      unit tests); full suite now 436, all passing. **No real-browser
      verification possible in this sandbox — please verify the warning
      banner visually in a real Extension Development Host.**

- [x] **Batch HH — Sample/test data entry & preview.** Real RLU's `SD`
      sequence command lets a person type realistic per-field values shown
      in the design preview instead of a bare `{FIELDNAME}` placeholder —
      no I-SDA equivalent (display files have no analogous "prototype run"
      concept), so IBM's own RLU docs were treated as the primary spec.
      **Persistence check made before choosing, per this task's own
      instruction:** RLU's own screen model tracks a "Sample line" as one
      of exactly four line types (Report/Filler/Field/Sample) embedded
      directly in the design screen, suggesting real RLU does carry sample
      data across STRRLU sessions — but no reference was found confirming
      the actual raw-source encoding RLU uses to store it. Rather than
      invent an unverified persistence format inside this project's own
      DDS source (risking text a real compiler or another tool could
      mishandle), sample data is kept **in-memory only**
      (`FieldEntry.sampleValue`, `src/prtfModel.ts`), lost on re-parsing
      the file — the fallback this task's own entry explicitly allowed.
      `src/prtfParser.ts`/`src/prtfWriter.js` are untouched. New
      `setFieldSampleValue` `WebviewEdit` kind (field-only — a constant
      already shows its own literal text), dispatched through the existing
      generic edit plumbing, empty string clearing it back to the
      placeholder. New `formatSampleValue` (`src/prtfLayout.js`) respects
      the field's own length (truncates, never overflows) and decimal
      positions (numeric S/P/B/F types get a literal decimal point and are
      right-justified; character types are left-justified, unpadded),
      without attempting full EDTCDE/EDTWRD emulation. `resolveLayout` now
      carries `sampleValue`/`sampleDisplay` per field cell;
      `media/webviewClient.js` shows the formatted value in place of
      `{FIELDNAME}`, with a new "Sample data" input in the properties
      panel applying immediately on change. See `docs/TASKS.md` Batch HH
      for the full writeup. 10 new tests in `test/prtfBatchHH.test.ts`
      (formatting truncation/justification/decimal-insertion/non-numeric
      fallback, edit set/clear/reject-constant, and layout wiring for
      present/absent sample values); full suite now 446, all passing.
      **No real-browser verification possible in this sandbox — please
      verify the "Sample data" input and its effect on the preview
      visually in a real Extension Development Host.**

- [x] **Batch KK — Boundary shift-and-truncate.** No validation existed
      anywhere a field/constant's position or length is set, so a
      drag/resize/add could silently push a field's data past the
      report's right edge. Verified against IBM's own AS/400 "Report
      Layout Guide" first, per this task's own instruction: real RLU's
      `RT(N)`/`LT(N)` sequence commands "shift and truncate data on the
      Right/Left Side if crossing the Boundaries" — i.e. the position is
      kept as requested and the DATA is clipped at the boundary, not
      silently allowed to overflow or the whole move rejected. I-RLU has
      no sequence-command area to reproduce `LT(N)`/`RT(N)` verbatim, so
      this applies the same principle to the paths I-RLU actually has:
      `move` (drag), `updateField`'s length (resize via the properties
      panel), and `addField`/`addConstant` (placing something new).
      Deliberately scoped to the horizontal (column) boundary only, not
      the bottom of the page — a printer file just continues onto a later
      page past `PAGSIZE`'s line count (same as SKIPB/SPACEB already do),
      so there's nothing to truncate vertically, matching real RLU's own
      `LT`/`RT` being explicitly horizontal-only commands. New
      `reportWidthCols`/`clampToReportWidth` (fields — truncates `length`)
      /`clampConstantToReportWidth` (constants have no `length`
      attribute, so this trims characters off the end of the literal text
      itself) in `src/prtfEdits.ts`, all exported directly for isolated
      unit testing (same convention Batch GG's `detectFieldOverlaps`
      established); `resolvePageSize` newly exported from
      `src/prtfLayout.js` so the edit layer can find the report's own
      width without duplicating `PAGSIZE`-resolution logic. See
      `docs/TASKS.md` Batch KK for the full writeup. 22 new tests in
      `test/prtfBatchKK.test.ts` (pure clamp-math unit tests covering
      within-bounds/right-edge-truncation/left-edge-clamp/degenerate/
      undefined-length cases, plus `applyEditToModel` integration tests
      for move/resize/add on both fields and constants); full suite now
      468, all passing.

- [x] **Batch JJ — Multi-select fields for bulk move/copy/delete.** Real
      RLU's F13/F14/F15 mark a rectangular screen area and copy/move it as
      a block; this tool's own selection model (established from Batch Q
      onward) is click-a-cell, not mark-a-rectangle, so this implements
      multi-select via Ctrl/Cmd-click instead — same reference point
      I-SDA's own shift/ctrl/cmd-click additive selection uses — while
      keeping RLU's core "the group moves/copies together, preserving
      relative layout" behavior: every selected id shifts by the SAME
      delta. **Landed after Batch KK/LL**, exactly the pairing this
      batch's own original filing anticipated — `bulkMove`/`bulkCopy`
      reuse Batch KK's `reportWidthCols`/`clampToReportWidth`/
      `clampConstantToReportWidth` and Batch LL's `relativePosition:
      false` fix directly, rather than re-deriving either (a bulk drag/
      copy is just as capable of pushing a field off-page, or of
      stranding a stale "this is still relative" flag, as a single move
      already was before those two batches fixed it). New
      `state.multiSelectIds` in `media/webviewClient.js` (a `Set`,
      deliberately kept separate from the existing `state.selectedId`
      rather than folding single-select into "a set of size 1" — avoids
      touching the already-heavily-tested single-cell properties panel at
      all); Ctrl/Cmd-click toggles membership, a plain click always
      clears it. Dragging a cell that's part of the selection drags the
      WHOLE group (offsets preserved via a JSON `dataTransfer` payload);
      dragging any other cell is an unrelated plain single-cell move,
      unchanged from before. New bulk-actions panel ("Copy group"/"Delete
      group"/"Clear selection") shown in place of the single-cell
      properties panel whenever the selection set is non-empty. Three new
      edit kinds in `src/webviewProtocol.ts`/`src/prtfEdits.ts`:
      `bulkMove`/`bulkDelete` (dangling ids skipped rather than failing
      the whole batch) and `bulkCopy` (same-record-only for v1, same
      scope boundary Batch Q's own single-field copy already draws;
      auto-assigns each clone's name via the existing
      `nextAvailableFieldName` rather than a per-field confirmation form,
      the same "auto-name several at once" precedent Batch Y's "Add
      fields from database file" already established). See
      `docs/TASKS.md` Batch JJ for the full writeup. 24 new tests in
      `test/prtfBatchJJ.test.ts` plus two source-text/CSS shape checks in
      `test/webviewLayout.test.ts`; full suite now 497, all passing.
      **No real-browser verification possible in this sandbox for the
      actual Ctrl/Cmd-click and group-drag interactions — please verify
      visually in a real Extension Development Host.**

- [x] **Batch MM — Bug fix: constant literal on its own attached-keyword
      line renders empty.** Reported directly by the person against a
      real-world fixture — `RPTHEAD`/`RPTCOLHD` rendered with every field
      showing empty text. Root cause: a constant's own literal is very
      commonly split across two physical lines in real-world PRTF source
      — a "header" line carrying just LINE/POSITION (which, having no
      name either, is what actually creates the constant), followed by an
      attached-keyword-only line (every positional column blank) carrying
      nothing but the quoted literal. `src/prtfParser.ts`'s
      `isAttachedKeywordLine` branch always pushed that second line's
      tokens straight onto the owning entry's `keywords` array — correct
      for a genuine additional keyword, but for a still-literal-less
      constant this left `entry.literal` permanently undefined, and
      `resolveLayout` renders a constant's cell text from `entry.literal`
      — so the field silently rendered empty, with no error anywhere.
      Fixed by extracting Batch BB's existing literal-detection logic into
      a shared helper and applying it in the `isAttachedKeywordLine`
      branch too, guarded to only fire when the owner is a constant that
      doesn't already have a literal (so a genuine second keyword, or a
      stray unexpected second bare-quoted token, is never silently
      dropped or overwritten). See `docs/TASKS.md` Batch MM for the full
      writeup. 5 new tests in `test/prtfParser.test.ts`, including the
      exact reported fixture saved as
      `test/fixtures/rpthead-attached-literal-realworld.prtf`; full suite
      now 502, all passing.

- [x] **Batch NN — "Open iRLU" CodeLens above printer-file source.**
      Requested directly against a real-world screenshot of a remote Code
      for i member (`MANOJKUMAR/QDDSSRC/ARRPT01.PRTF`) already showing
      I-SDA's own equivalent CodeLens for display files; I-RLU had no
      CodeLens at all before this, only the right-click menu/editor-title
      button/Command Palette entry — none as discoverable as a link
      sitting right above the source. New `src/prtfCodeLens.ts`'s
      `isLikelyPrintFilePath` is a pure-logic filter (same
      extracted-for-testability pattern as `designerOpenMode.ts`/
      `prtfCompileTarget.ts`) that checks a document's URI path extension
      directly rather than VS Code's own `resourceExtname` context key,
      which I-SDA's own `extension.ts` already documents as unreliable
      for `member:`/`streamfile:` scheme URIs — scoped to the exact same
      extension set `package.json`'s `customEditors`/`menus` already
      recognize (`.pf`/`.prtf`/`.rlu`, case-insensitive), not a new,
      inconsistent surface. New `PRTF_LANGUAGE_SELECTOR` and a
      `registerCodeLensProvider` call in `extension.ts`'s `activate()`
      reuse the existing `i-rlu.openDesigner` command — no new command
      needed — and pass `document.uri` explicitly, a small robustness
      improvement over I-SDA's own implicit reliance on
      `activeTextEditor`. See `docs/TASKS.md` Batch NN for the full
      writeup. 6 new tests in `test/prtfCodeLens.test.ts` (every
      recognized extension, the exact reported member: path, streamfile:
      paths, rejection of unrelated/legacy extensions, and the
      extension-must-be-at-the-end edge case); full suite now 508, all
      passing. **No real-browser/EDH verification possible in this
      sandbox** for the actual CodeLens rendering and click-through —
      please verify visually in a real Extension Development Host,
      ideally against the exact remote member from the reported
      screenshot.

- [x] **Batch OO — LINE/BOX properties-panel UI (add/copy/edit/delete +
      drag/resize).** `LINE`/`BOX` (record-level, AFPDS-only) have
      rendered on the design canvas since Batch I, but had no
      properties-panel surface at all — no way to add, edit, copy, or
      delete one, and no interactive drag-to-move/drag-to-resize the way
      fields/constants already have. Flagged directly by Manoj after
      noticing the gap; confirmed by inspecting every batch that ever
      built keyword-editing UI (A/B/C/E/F/G) — none of their scoped
      keyword lists actually included `LINE`/`BOX`, despite
      `docs/TASKS.md`'s own Known-Limitations table previously
      (incorrectly) implying they did. New edit kinds `addDrawKeyword`/
      `updateDrawKeyword`/`removeDrawKeyword`/`copyDrawKeyword`
      (`webviewProtocol.ts`/`prtfEdits.ts`), scoped by `keywordIndex` — a
      `LINE`/`BOX` instance's position within `record.keywords` — since
      neither keyword has a name-based way to pick out one instance among
      several repeats, unlike fields/constants (stable `id`) or
      single-instance record keywords. `src/prtfLayout.js` gained
      `resolveDrawsWithKeywordIndex` to tag every resolved draw with that
      index. New `src/prtfWebviewLogic.js` holds the pure, unit-tested
      parse/build/grid↔physical-unit helpers the panel and drag/resize
      handlers both need. `media/webviewClient.js` gained an always-visible
      "Lines & Boxes" side panel per record (Edit/Copy/Delete plus "+
      Line"/"+ Box" add forms), draggable canvas shapes (whole-shape move)
      and a resize handle (plain mouse events, since resize needs
      continuous tracking a drag-and-drop handler doesn't give). See
      `docs/TASKS.md` Batch OO for the full writeup. 33 new tests in
      `test/prtfBatchOO.test.ts` (parse/build round-trips, grid↔physical
      conversions, moved/resized param builders, `resolveDrawsWithKeywordIndex`
      including indicator-conditioned instances, and all four new edit
      kinds including negative/out-of-range cases); full suite now 541,
      all passing. **No real-browser verification possible in this
      sandbox** for the actual drag/resize DOM interaction — verified
      instead via `tsc`, the full unit-test suite, a syntax check of the
      assembled webview script, and manual review of the DOM/event-wiring
      code. Please verify the drag-to-move/drag-to-resize interactions
      visually in a real Extension Development Host.

- [x] **Batch PP — bug fix: keyword regeneration disturbed unrelated,
      untouched physical lines.** Flagged directly by Manoj: editing or
      adding one keyword changed lines that had nothing to do with the
      edit. Root cause: `regenerateSource` (`src/prtfWriter.js`) rebuilt an
      entry's ENTIRE keyword-line block from scratch on every regenerate,
      discarding original wrap points even for untouched keywords — the
      exact mechanism behind Batch AA's own repro (one `COLOR` add flagged
      67/93 lines as changed). Checked I-SDA's own `dspfWriter.js` for the
      equivalent problem: architected completely differently there
      (targeted line-array splice per field, never a whole-file
      regenerate) — adopting that wholesale would be a much larger rewrite
      than this batch's scope, so instead this brings the same "leave what
      wasn't touched alone" principle one level deeper into I-RLU's own
      whole-model-regenerate architecture, down to individual keyword-
      bearing physical lines within a changed entry. New
      `emitGroupKeywordLines` compares each conditions-group's original
      continuation-run text (reconstructed from `ParsedSource.rawLines`
      via new `originalRunRange`/`originalRunKeywordText`, mirroring
      `prtfParser.ts`'s own column/continuation conventions) against the
      current keyword set for that run — an exact match means those
      original physical lines are spliced back byte-for-byte; anything
      new/edited/removed falls through to new `packKeywordsPreservingLines`,
      which packs using each keyword's own raw text as an atomic unit
      (never re-tokenizing by whitespace, which would otherwise split a
      multi-parameter keyword like `LINE`/`BOX`/`FNTCHRSET` mid-parameter —
      a real, separate latent bug found and fixed along the way, confirmed
      against real hand-authored source where `PAGSEG(COMPLOGO 0.5 0.5)`
      legitimately wraps mid-keyword). Also found and fixed: real DDS
      source can legitimately place a keyword BEFORE a constant's own
      literal (confirmed verbatim in `test/fixtures/scsprt1-realworld.prtf`),
      so the verbatim comparison tries both orderings before giving up.
      See `docs/TASKS.md` Batch PP for the full writeup. 13 new tests in
      `test/prtfBatchPP.test.ts`; full suite now 567, all passing.

- [x] **Batch QQ — bug fix: side panel resets/loses in-progress input every
      ~10s.** Reported directly by Manoj: entering a properties-panel
      sub-field value (e.g. typing a `CCSID` value) before applying it gets
      silently wiped and the panel jumps back to the top, every 10 seconds
      while the designer is open. Root cause: `src/extension.ts`'s
      `sendCodeForIStatus` poll (`setInterval(..., 10000)`, driving the
      "IBM i: Connected/Not connected" badge) posts a `codeForIStatus`
      message unconditionally on every tick, whether or not the connection
      state actually changed — and `media/webviewClient.js`'s handler
      responded to every such message with the fully destructive `render()`
      (`root.innerHTML = ""` + total rebuild of every panel), wiping
      whatever was mid-typed and resetting scroll position regardless of
      whether anything about the connection had changed. Fixed on the
      webview side: the handler now compares the incoming
      `installed`/`connected` values against current state before updating
      it and calling `render()`, so an unchanged poll tick is a no-op while
      a genuine connect/disconnect still updates the badge immediately. See
      `docs/TASKS.md` Batch QQ for the full writeup. 1 new test in
      `test/webviewLayout.test.ts`; full suite now 569, all passing.

- [x] **Batch RR — bug fix: Font & sizing panel lost checked-but-unapplied
      keywords on a sibling's change.** Reported directly by Manoj:
      checking FONT, then checking CCSID, then unchecking CCSID also
      unchecked FONT. Root cause: unlike every other keyword-checkbox
      panel in the app, checking a Font & sizing checkbox only revealed
      its inputs without committing anything — only a separate "Apply"
      button did that — while unchecking committed immediately and
      triggered the webview's own full destructive `render()`. A checked-
      but-never-applied FONT would then correctly (if confusingly) revert
      the moment a sibling keyword's own change forced that rebuild, since
      the real document never had FONT saved in the first place. Fixed by
      having every Font & sizing input auto-commit on its own `change`
      (blur) event via a shared submit function also used by the Apply
      button, matching the "commit as soon as there's a value" convention
      the rest of the app's keyword-checkbox panels already use. See
      `docs/TASKS.md` Batch RR for the full writeup. 1 new test in
      `test/webviewLayout.test.ts`; full suite now 570, all passing.

- [x] **Batch O — real AFP resource rendering (page segments/overlays as
      actual images) — done for the common image-content case.** Real
      Apache-2.0-licensed AFP resource fixtures from Apache FOP's own test
      suite (`test/fixtures/afp/`) unblocked this after it sat blocked for
      several sessions. New `src/afpResourceDecoder.js` (MO:DCA structured-
      field scanning → IOCA Function Set 10 content parsing → raster
      decode → real PNG encoding via Node's built-in `zlib`) plus
      `src/afpCcittDecoder.js`, a vendored real ITU-T T.6 (G4/MMR) decoder
      ported from Mozilla pdf.js (Apache-2.0), independently verified
      against a Pillow/libtiff-generated G4 test vector — 100% pixel-exact
      match. Wired into the properties panel as a "Preview resource
      image…" button on `OVERLAY`/`PAGSEG`/`AFPRSC`'s own rows (a local
      file picker, since no Code-for-i-based IFS browser exists to fetch
      one automatically). Three real bugs found and fixed via the real-
      fixture testing itself: an IOCA COMPRID table misreading (`0x03` is
      "No compression", not G4), AFP resource names being EBCDIC- not
      ASCII-encoded, and a nested `BOG`/`EOG` inside the image content
      silently overwriting the real resource name. See `docs/TASKS.md`
      Batch O for the full writeup. Genuinely still out of scope: PTOCA/
      GOCA (text/graphics) overlay content and non-FS10 IOCA — both fail
      with a specific, honest error rather than a guess.

## Next up

As of the RLU screen-capture review (`docs/KEYWORD-INVENTORY.md`), the
remaining work is re-organized into the parallel-session task batches in
`docs/TASKS.md` — each batch is scoped to be pickable up independently
without stepping on another in-progress session. Batches W–Z were filed
after comparing against I-SDA's own designer: configurable open-location
setting (W, done), source-modification tracking (X, done), "add fields
from database file" via Code for i (Y, done), and system-constant
(`DATE`/`TIME`/`PAGNBR`) design-time rendering + add-UI (Z, done — see
`docs/REQUIREMENTS.md` §10 for why `USER`/`SYSNAME` were dropped from the
original five-keyword scope) — see `docs/TASKS.md`'s Batch W/X/Y/Z detail
sections for the full I-SDA-reference writeups. Batches AA/BB/LL were
filed from reviewing two real-world sample PRTF files supplied for
keyword-usage reference: the column-6 form-type/Batch-X interaction above
(AA, done), a constant literal not recognized when preceded by a keyword
(BB, done), and DDS's `+n` relative-position notation being silently
absolutized (LL, done — renumbered twice over two concurrent-session
letter collisions, first CC→DD, then DD→LL, as other sessions' own work
claimed each letter first; see the git history around this commit if the
renaming itself is ever confusing) — see `docs/TASKS.md`'s Batch AA/BB/LL
sections. Batch LL is also done as of this session — `relativePosition`
threaded through the model/parser/writer, plus `resolveLayout` resolving
a `+n` field's real preview column against the running cursor.
Summary of everything else (see TASKS.md for full detail,
acceptance criteria, and file-level
ownership per batch):

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
- [x] **Batch H — `REF`/`REFFLD` resolution via Code for i — done, verified
      end-to-end against a real IBM i.** Part 1 (UI shape, fully testable):
      `PrtfEngine.resolveReferenceTarget` works out which field/library/
      file a reference field (position 29 'R') resolves against, following
      REFFLD-overrides-REF/`*SRC`-is-unresolvable precedence from IBM's DDS
      reference; the properties panel has the "Reference a field" / "Use
      referenced values" toggle pair from KEYWORD-INVENTORY §3, wired to a
      REFFLD keyword upsert (`PrtfWriter.upsertReffldKeyword`). The
      **picker** (previously left open — "not done, left for a future
      batch/session"): a "Browse fields… (Code for i)" button that lists a
      referenced file's actual fields (and, if it has more than one,
      prompts to pick a record format first) via a native VS Code
      QuickPick rather than typing a field name blind, following I-SDA's
      own Task L14 (`fetchDatabaseFileFields`) as the closest existing
      pattern — same DSPFFD OUTFILE approach, same field mapping, with the
      format-disambiguation step pulled into its own pure, unit-tested
      function (`groupDatabaseFileFieldRows`) unlike I-SDA's inline
      version. Library/file are still typed manually, same as part 2
      already requires — only the record format and field itself are
      picked from a live list. Part 2 (the actual DSPFFD + SQL round-trip
      resolving one already-named field's attributes, in `extension.ts`'s
      `fetchReferencedFieldAttributes`/`handleResolveReferencedField`) was
      written following I-SDA's own integration pattern and — after a real
      bug found via that live testing (`fetchDatabaseFileFields`'s SQL
      ordered by a nonexistent `WHFLDO` column instead of the real
      `WHFOBO`, fixed with the same explanation I-SDA's own code already
      carries for this exact past mistake — see `docs/TASKS.md` Batch H)
      — **confirmed working end-to-end against a real connected IBM i.**
- [x] ~~Batch I — `UOM` (unit of measure) modeling~~ — **done**: see
      `i-rlu.unitOfMeasure` setting above. The remaining piece — validating
      that file-level `SKIPA`/`SKIPB` isn't allowed on `*AFPDS` files
      (KEYWORD-INVENTORY §1) — is now **also done**, folded into Batch F's
      validation work above rather than kept as its own batch.
- [x] **Batch J — Compile command polish — done.** Library/source-file/
      member picker for `CRTPRTF`, replacing the old assumed
      `*CURLIB/QDDSSRC`. Two real, compile-breaking bugs found and fixed
      along the way (see `docs/TASKS.md` Batch J for the full writeup):
      `codeForI.exports.runCommand(...)` was never a valid call — the
      actual API (confirmed against Code for i's own docs and I-SDA's
      `getConnectedCodeForIBMi()`) is
      `exports.instance.getConnection().runCommand(...)`, so compiling was
      broken outright before this batch, not just missing a picker; and
      the command embedded `&CURLIB` (a CL variable reference, meaningless
      in a raw command string) where `*CURLIB` (the real special value)
      was needed. Also added `REPLACE(*YES)` — its absence meant every
      *second* compile of the same file would have failed with CPF7302,
      since CRTPRTF's own default is `REPLACE(*NO)`. A `member:` URI
      (opened directly from Code for i) needs no prompt — its own path
      already names the exact library/source-file/member (ported from
      I-SDA's `parseMemberUri`); a local file is prompted once
      (`showInputBox`es, matching I-SDA's own `createRemoteMember` shape)
      and cached per document (`context.workspaceState`) so repeat
      compiles don't re-prompt, with a new `i-rlu.setCompileTarget`
      command to change it. `streamfile:` (IFS) sources get an explicit
      "CRTPRTF has no SRCSTMF-equivalent" error (verified against IBM's
      full CRTPRTF parameter table) rather than a guessed target. All the
      actual decision logic lives in a new `vscode`-free module,
      `src/prtfCompileTarget.ts` — unit-testable without a real VS Code
      host, the same split this project already uses for `prtfEdits.ts`.
      14 new tests (`test/prtfCompileTarget.test.ts`).
- [x] **Batch K — Packaging:** `vsce package` producing a real `.vsix`
      (verified: `i-rlu-0.0.1.vsix`, 427.66 KB, no warnings). Along the
      way, found and fixed a real bug: `package.json`'s `"main"` pointed at
      a path that didn't exist after `tsc` compiled (`./out/extension.js`
      vs. the actual `./out/src/extension.js`), which would have made any
      packaged/installed build fail to activate. `LICENSE` and
      `images/icon.png` were copied over from the I-SDA repo (same
      publisher) at the repo owner's direction. See `docs/TASKS.md` Batch K
      for the rest (`.vscodeignore`, `vsce` scripts).
- [x] **Batch L — Real AFP font metrics — done.** `FONT`/FGID
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
      placeholder table. One honest caveat remains: these are the
      *substitute* font's published metrics, applied as the best available
      proxy for IBM's own FGID-named fonts, not a verified byte-for-byte
      extraction of IBM's own FGID resource data (this tool has no access
      to that). **Follow-up:** `FONTNAME` (which references an actual
      TrueType/OpenType font by name, a well-documented public binary
      format unlike CDEFNT/FNTCHRSET's IBM-internal resource data) now
      also gets real per-character advance widths — a from-scratch sfnt
      binary parser (`src/afpTrueTypeMetrics.js`, verified against
      `fontTools` across the full ASCII range with zero mismatches) reads
      three real, SIL OFL-licensed substitute fonts vendored at
      `resources/fonts/` (Cousine/Tinos/PT Sans — see that directory's
      `NOTICE.md`). Same honesty convention as the AFM tables above:
      flagged as a real substitute's real data, not a verified match for
      the exact named font. See `docs/TASKS.md` Batch L's
      "FONTNAME real advance widths" subsection for the full writeup.
      **`CDEFNT`/`FNTCHRSET`/`FONTNAME` resolution — also now done,** on
      investigation turning out to need a much smaller lift than the
      TTF-fetch-from-a-live-IBM-i direction earlier versions of this note
      proposed: tracing through `resolveLayout`'s actual consumers showed
      the glyph-width math (`getAdvanceWidth`) that plan was aimed at
      feeding isn't called anywhere in the codebase — only a renderable
      font *identity* (family/weight/style/name) is ever needed. `FONTNAME`
      resolves completely offline (its value already IS the real font
      name); `CDEFNT`/`FNTCHRSET` resolve their documented `X0`/`XZ`/`C0`/
      `CZ` raster-vs-outline naming prefix plus a small number of
      IBM-verified example names, with an honest note (not a guess) for
      anything else — IBM's own documentation states plainly that a coded
      font's real typeface is per-system data with no universal decode
      table (`WRKFNTRSC` is the only way to know for certain, a
      live-connection lookup not implemented here). Found and fixed a real,
      separate pre-existing bug along the way: FONTNAME's DDS-quoted value
      (routinely containing spaces, e.g. 'Courier New') was being mangled
      by a whitespace-only tokenizer in Batch B's own properties-panel
      code. 34 new tests across three files. See `src/afpCodedFontMetrics.js`
      and `docs/TASKS.md` Batch L for the full sourcing notes and
      implementation writeup.
- [x] **Batch Q — Copy/duplicate a field or constant — done.** New "Copy"
      button next to "Delete" (`renderEditPanel`) arms the same
      click-to-place flow `+ Field`/`+ Constant` already use, landing on a
      pre-filled `pendingNew` form (values AND keywords carried over —
      `addField`/`addConstant` gained one new optional field,
      `sourceKeywords`, rather than a whole new edit kind) so nothing is
      written to the model until the person confirms a position. Fields get
      a suggested non-colliding name (source name + lowest available
      numeric suffix, truncated to DDS's 10-char limit) rather than
      defaulting to the exact source name. Same-record copy only for v1;
      cross-record copy flagged as a follow-up, not built (see
      `docs/TASKS.md` Batch Q for why). Decision logic
      (`suggestCopyName`/`buildCopyPendingNew`) lives in
      `src/prtfWebviewLogic.js`, unit-testable without a DOM, alongside
      this codebase's other pure webview helpers. 16 new tests
      (`test/prtfBatchQ.test.ts`), including an explicit check that copying
      never mutates the source entry (the "copy silently moves instead of
      duplicates" failure mode this batch's own task description called
      out to guard against).

Each batch's keyword list, current model/parser/engine status
(modeled/rendered/UI), and IBM-documented gotchas are detailed in
`docs/KEYWORD-INVENTORY.md`; don't re-derive them from scratch per batch.

## Explicit open decision points (carried from REQUIREMENTS.md)

- Font resource access (§9) — mostly resolved. FGID identification (which
  font family/spacing a `FONT` keyword refers to) is backed by a verified
  table, and `FONTNAME`/`CDEFNT`/`FNTCHRSET` are now resolved too — see
  `docs/TASKS.md` Batch L for the full writeup. What's genuinely still
  open: real per-glyph metrics for proportional fonts remain the
  *substitute* font's published AFM data rather than IBM's own FGID
  resource data (this tool has no access to that), and a specific
  `CDEFNT`/`FNTCHRSET` value's exact typeface is, by IBM's own documented
  design, per-system data (`WRKFNTRSC`) that only a live IBM i connection
  could resolve fully — not a research gap, a live-connection dependency.
