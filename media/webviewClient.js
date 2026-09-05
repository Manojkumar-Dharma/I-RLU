"use strict";
/**
 * Runs inside the webview. Relies on PrtfEngine, AfpFontMetrics, and
 * PrtfWebviewLogic (this file's own pure keyword-text/pixel-math helpers,
 * pulled out into src/prtfWebviewLogic.js so they're unit testable — see
 * docs/TASKS.md review comment #6) being present as globals (inlined ahead
 * of this script by buildWebviewTemplate.js), and on `vscode` being the
 * value of `acquireVsCodeApi()`.
 *
 * Responsibilities:
 *  - Render the resolved layout for the selected record format as an HTML
 *    page grid (one <div> cell per character row, absolutely positioned
 *    fields/constants inside it).
 *  - Let the user toggle conditioning indicators and switch record formats.
 *  - Let the user click a field/constant to select it and edit its
 *    properties (name/length/type/usage/line/position, or literal text for
 *    constants) in a side panel, or drag it to a new line/position.
 *  - Let the user place new fields/constants by clicking "+ Field"/
 *    "+ Constant" and then clicking a spot on the page.
 *  - Let the user delete the selected field/constant.
 *  - Post `edit` messages back to the extension host describing what
 *    changed; the host applies them to the real model and re-parses/
 *    re-sends the layout (round trip, same discipline as I-SDA).
 *
 * Edit message kinds sent to the host: "move", "updateField",
 * "updateConstant", "addField", "addConstant", "delete". All except
 * "addField"/"addConstant" reference an existing entry by its stable `id`
 * (assigned by the parser) rather than by name/position, since position is
 * exactly the thing that can change out from under a name+position match.
 *
 * A separate (non-"edit") message, "resolveReferencedField" (Batch H, see
 * docs/TASKS.md), asks the host to fetch a REF/REFFLD field's real
 * length/type/decimals from a connected IBM i via Code for i and apply them
 * directly — this one is NOT applied locally first the way "edit" messages
 * are, since it needs a network round-trip before there's anything to
 * apply. "browseReferencedField" (Batch H "remaining" piece) is the same
 * kind of host round-trip, but for picking the REFFLD field/record-format
 * itself via Code for i rather than resolving an already-named field's
 * attributes.
 */
(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    model: null,
    recordName: null,
    indicators: {},
    uom: "inch", // set from the extension host's i-rlu.unitOfMeasure setting; see setModel handler
    // Code for i connection badge — mirrors I-SDA's Task L18: pushed by
    // extension.ts's sendCodeForIStatus on "ready", after every Code-for-i-
    // dependent action, and on its own poll/extension-change watchers (see
    // that file). "installed: false" until the very first codeForIStatus
    // message arrives, so the badge (and any buttons gated on `connected`)
    // start in the safe "not usable yet" state rather than assuming a
    // connection that hasn't been confirmed.
    codeForI: { installed: false, connected: false },
    selectedId: null, // id of the currently selected cell, if any
    placing: null, // null | "field" | "constant" — armed "click to place" mode
    pendingNew: null, // { kind, line, position } — set right after a placement click, before Save
    // Batch P — record-format container operations, mutually exclusive
    // with each other and with placing/pendingNew/selectedId (see each
    // toolbar button's click handler).
    pendingNewRecord: false, // true: showing the inline "new record format" form
    renamingRecord: false, // true: showing the inline rename form for state.recordName
    confirmDeleteRecord: false, // true: showing the delete-confirmation row for state.recordName
    // Batch Q — the source cell (a layout.cells entry) being copied, set
    // by renderEditPanel's "Copy" button, armed together with `placing`
    // (reusing the same "click to place" flow add already uses) and
    // consumed by the page click handler once a placement is picked.
    copySource: null,
  };

  let CELL_W = 8; // px per character column — recomputed per record from CPI via layout.grid (96/CPI); see render()
  let CELL_H = 18; // px per line row — recomputed per record from LPI via layout.grid (96/LPI)

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") e.className = attrs[k];
      else if (k === "style") e.style.cssText = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach((c) => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return e;
  }

  function currentLayout() {
    if (!state.model || !state.recordName) return null;
    return PrtfEngine.resolveLayout(state.model, state.recordName, state.indicators, state.uom);
  }

  /**
   * Layout shell: a full-width toolbar on top, then a two-column
   * "workspace" row below it — a left .canvas-col holding the ruler+page
   * report preview (independently HORIZONTALLY scrollable, since a wide
   * record format — e.g. 130-position — can be much wider than the
   * viewport) and a right, fixed-width .side-col holding every
   * properties/keywords panel stacked one after another (independently
   * VERTICALLY scrollable), same split I-SDA uses for its own
   * aside/main/.props-panel three-column shell (see that project's
   * src/buildWebviewTemplate.js) — just two columns here rather than
   * three, since I-RLU has no separate left-hand palette to show. Before
   * this, every panel below the toolbar (report preview AND every
   * props/keywords panel) was appended to #root as one long vertical
   * stack in normal block flow, so a wide report pushed the properties
   * panels far below the fold instead of leaving them reachable
   * alongside it. See the accompanying CSS in src/buildWebviewTemplate.js
   * (.workspace/.canvas-col/.side-col) for the actual scroll containment —
   * same "constrain the column's height, THEN overflow-y:auto on it
   * actually works" fix I-SDA's own buildWebviewTemplate.js documents.
   */
  function render() {
    const root = document.getElementById("root");
    root.innerHTML = "";
    if (!state.model || state.model.records.length === 0) {
      root.appendChild(el("div", { class: "empty" }, ["No record formats found in this printer file yet."]));
      return;
    }
    if (!state.recordName) state.recordName = state.model.records[0].name;

    root.appendChild(renderToolbar());

    const workspace = el("div", { class: "workspace" });
    const canvasCol = el("div", { class: "canvas-col" });
    const sideCol = el("div", { class: "side-col" });

    const recordMgmtPanel = renderRecordManagementPanel();
    if (recordMgmtPanel) canvasCol.appendChild(recordMgmtPanel);

    const layout = currentLayout();
    if (layout.grid) {
      CELL_W = layout.grid.cellWidthPx;
      CELL_H = layout.grid.cellHeightPx;
    }
    const main = el("div", { class: "main" });
    main.appendChild(renderRuler(layout));
    main.appendChild(renderPage(layout));
    canvasCol.appendChild(main);

    if (layout.skippedByIndicator && layout.skippedByIndicator.length) {
      canvasCol.appendChild(
        el("div", { class: "note" }, ["Hidden by indicator state: " + layout.skippedByIndicator.join(", ")])
      );
    }
    if ((layout.draws || []).some((d) => d.approximate)) {
      canvasCol.appendChild(
        el("div", { class: "note" }, [
          "One or more LINE/BOX positions depend on a program-to-system field and are shown at their default position — actual placement is set at print time.",
        ])
      );
    }
    if ((layout.resources || []).some((r) => r.approximate)) {
      canvasCol.appendChild(
        el("div", { class: "note" }, [
          "One or more OVERLAY/PAGSEG/AFPRSC positions depend on a program-to-system field and are shown at their default position — actual placement is set at print time.",
        ])
      );
    }

    const panel = renderPropsPanel(layout);
    if (panel) sideCol.appendChild(panel);

    const record = state.model.records.find((r) => r.name === state.recordName);
    sideCol.appendChild(renderRecordKeywordsPanel(record));
    sideCol.appendChild(renderGeneralRecordKeywordsPanel(record));
    const indTextPanel = renderIndicatorTextPanel(record);
    if (indTextPanel) sideCol.appendChild(indTextPanel);
    sideCol.appendChild(
      renderFontSizingPanel(
        record.keywords,
        (name, params) => vscode.postMessage({ type: "edit", edit: { kind: "setRecordKeyword", recordName: record.name, name, params } }),
        (name) => vscode.postMessage({ type: "edit", edit: { kind: "removeRecordKeyword", recordName: record.name, name } }),
        record.name + " (record)"
      )
    );
    sideCol.appendChild(renderPageGroupPanel(record, layout));

    workspace.appendChild(canvasCol);
    workspace.appendChild(sideCol);
    root.appendChild(workspace);
  }

  /**
   * Resets every toolbar "pending action" flag to its closed/off state —
   * used by every toolbar button's click handler (field/constant placement,
   * and Batch P's record add/rename/delete) so opening one of these
   * mutually-exclusive inline forms always closes any other one that might
   * already be open, rather than stacking several at once.
   */
  function clearPendingUiState() {
    state.placing = null;
    state.pendingNew = null;
    state.selectedId = null;
    state.pendingNewRecord = false;
    state.renamingRecord = false;
    state.confirmDeleteRecord = false;
    // Batch Q (docs/TASKS.md) — the field/constant being copied, set by
    // renderEditPanel's "Copy" button and consumed by the page click
    // handler once the person picks where to place the copy (see
    // renderPage). Cleared here alongside `placing`/`pendingNew` so
    // switching to any other toolbar action (or reselecting a cell)
    // cancels a copy-in-progress the same way it cancels a plain add.
    state.copySource = null;
  }

  function renderToolbar() {
    const record = state.model.records.find((r) => r.name === state.recordName);
    const toolbar = el("div", { class: "toolbar" });

    const select = el("select", { id: "recordSelect" });
    state.model.records.forEach((r) => {
      const opt = el("option", { value: r.name }, [r.name]);
      if (r.name === state.recordName) opt.setAttribute("selected", "selected");
      select.appendChild(opt);
    });
    select.addEventListener("change", (e) => {
      state.recordName = e.target.value;
      clearPendingUiState();
      render();
    });
    toolbar.appendChild(el("label", {}, ["Record: ", select]));

    // Code for i connection badge (see state.codeForI's own comment above).
    // Text matches I-SDA's three-state Task L18 badge: "Not installed"
    // when the extension itself isn't present, "Not connected" when it's
    // present but has no live connection yet, "Connected" once one does —
    // the two disconnected states get the same warning-style hint styling
    // (.hint.warning) I-SDA uses for its own equivalent badge.
    const badgeText = !state.codeForI.installed
      ? "IBM i: Not installed"
      : state.codeForI.connected
        ? "IBM i: Connected"
        : "IBM i: Not connected";
    const badgeClass = state.codeForI.connected ? "hint" : "hint warning";
    toolbar.appendChild(el("span", { class: badgeClass, title: "Status of the Code for IBM i (halcyontechltd.code-for-ibmi) extension \u2014 needed for Resolve/Browse Referenced Field and Compile." }, [badgeText]));

    // Batch P — reorder buttons act on the currently-selected record
    // format; simple up/down (rather than drag-to-reorder) per this
    // batch's own "enough for v1" scope note, since there's no dedicated
    // record-list view to drag within (just this single-select dropdown).
    const recordIdx = state.model.records.findIndex((r) => r.name === state.recordName);
    const upBtn = el("button", { class: "btn", title: "Move this record format earlier in the source" }, ["\u25b2"]);
    if (recordIdx <= 0) upBtn.setAttribute("disabled", "disabled");
    upBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "edit", edit: { kind: "reorderRecord", name: state.recordName, direction: "up" } });
    });
    const downBtn = el("button", { class: "btn", title: "Move this record format later in the source" }, ["\u25bc"]);
    if (recordIdx === -1 || recordIdx >= state.model.records.length - 1) downBtn.setAttribute("disabled", "disabled");
    downBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "edit", edit: { kind: "reorderRecord", name: state.recordName, direction: "down" } });
    });
    toolbar.appendChild(upBtn);
    toolbar.appendChild(downBtn);

    const addRecordBtn = el("button", { class: "btn" + (state.pendingNewRecord ? " active" : "") }, ["+ Record"]);
    addRecordBtn.addEventListener("click", () => {
      const opening = !state.pendingNewRecord;
      clearPendingUiState();
      state.pendingNewRecord = opening;
      render();
    });
    const renameRecordBtn = el("button", { class: "btn" + (state.renamingRecord ? " active" : "") }, ["Rename"]);
    renameRecordBtn.addEventListener("click", () => {
      const opening = !state.renamingRecord;
      clearPendingUiState();
      state.renamingRecord = opening;
      render();
    });
    const deleteRecordBtn = el("button", { class: "btn" + (state.confirmDeleteRecord ? " active" : "") }, ["Delete"]);
    deleteRecordBtn.addEventListener("click", () => {
      const opening = !state.confirmDeleteRecord;
      clearPendingUiState();
      state.confirmDeleteRecord = opening;
      render();
    });
    toolbar.appendChild(addRecordBtn);
    toolbar.appendChild(renameRecordBtn);
    toolbar.appendChild(deleteRecordBtn);

    const addFieldBtn = el(
      "button",
      { class: "btn" + (state.placing === "field" ? " active" : "") },
      ["+ Field"]
    );
    addFieldBtn.addEventListener("click", () => {
      const nextPlacing = state.placing === "field" ? null : "field";
      clearPendingUiState();
      state.placing = nextPlacing;
      render();
    });
    const addConstBtn = el(
      "button",
      { class: "btn" + (state.placing === "constant" ? " active" : "") },
      ["+ Constant"]
    );
    addConstBtn.addEventListener("click", () => {
      const nextPlacing = state.placing === "constant" ? null : "constant";
      clearPendingUiState();
      state.placing = nextPlacing;
      render();
    });
    toolbar.appendChild(addFieldBtn);
    toolbar.appendChild(addConstBtn);
    if (state.placing) {
      const what = state.copySource ? "the copy" : "the new " + state.placing;
      toolbar.appendChild(el("span", { class: "hint" }, ["Click on the page to place " + what + "."]));
    }

    // Batch Y (docs/TASKS.md) — "Add fields from database file". Unlike
    // "+ Field"/"+ Constant" above, this doesn't use the click-to-place
    // flow at all: the extension host prompts for library/file and which
    // fields to add via native VS Code UI (showInputBox/showQuickPick)
    // and applies the result directly, so this button's only job is to
    // fire the request — see extension.ts's handleAddFieldsFromDatabase.
    // Same hide-when-disconnected treatment as "Browse fields…"/"Resolve
    // Referenced Field" in renderFieldKeywordsSection below (state.codeForI
    // reappears the moment a connection is (re)established — no reload
    // needed, render() rebuilds the toolbar from state every time).
    if (state.codeForI.connected) {
      const addDbFieldsBtn = el("button", { class: "btn" }, ["+ Fields from DB…"]);
      addDbFieldsBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "addFieldsFromDatabase", recordName: state.recordName });
      });
      toolbar.appendChild(addDbFieldsBtn);
    } else {
      toolbar.appendChild(
        el("span", { class: "hint warning" }, ["Add Fields from DB needs a live Code for i connection."])
      );
    }

    const indicators = PrtfEngine.collectIndicators(record);
    if (indicators.length) {
      // Batch G (docs/TASKS.md) — INDTXT (documentation-only, no compile
      // effect) feeds indicator descriptions into this same panel, so
      // indicators show their human-readable meaning next to the
      // checkbox, matching the UX I-SDA has for the same concept on DSPF.
      // Editing is scoped to the record level (see extension.ts's
      // "setIndicatorText"/"removeIndicatorText" edit kinds) even though
      // INDTXT can also appear at file/field level — those are still READ
      // here (collectIndicatorDescriptions checks all three), just not
      // editable from this per-record panel.
      const descriptions = PrtfEngine.collectIndicatorDescriptions(state.model, record);
      const indPanel = el("span", { class: "indicators" });
      indicators.forEach((ind) => {
        const id = "ind-" + ind;
        const cb = el("input", { type: "checkbox", id });
        if (state.indicators[ind]) cb.setAttribute("checked", "checked");
        cb.addEventListener("change", (e) => {
          state.indicators[ind] = e.target.checked;
          render();
        });
        const label = el("label", { class: "ind-label", for: id }, [cb, " " + ind]);
        const text = descriptions[ind];
        if (text) {
          label.setAttribute("title", text);
          label.appendChild(el("span", { class: "ind-text" }, [" (" + text + ")"]));
        }
        indPanel.appendChild(label);
      });
      toolbar.appendChild(el("span", { class: "indicators-wrap" }, ["Indicators: ", indPanel]));
    }

    const hasGeometryKeywords =
      PrtfEngine.findAllKeywords(record.keywords, "LINE").length > 0 ||
      PrtfEngine.findAllKeywords(record.keywords, "BOX").length > 0 ||
      record.fields.some((f) => (f.keywords || []).some((k) => k.name === "BARCODE"));
    if (hasGeometryKeywords) {
      toolbar.appendChild(
        el("span", { class: "hint", title: "Set via the i-rlu.unitOfMeasure VS Code setting — I-RLU can't detect this from DDS source, since UOM is a CRTPRTF command parameter, not a DDS keyword." }, [
          "Unit of measure: " + state.uom + " (assumed — set i-rlu.unitOfMeasure to match your CRTPRTF)",
        ])
      );
    }

    return toolbar;
  }

  function renderRuler(layout) {
    const ruler = el("div", { class: "ruler", style: `width:${layout.pageCols * CELL_W}px;` });
    for (let c = 10; c <= layout.pageCols; c += 10) {
      ruler.appendChild(el("span", { style: `position:absolute;left:${(c - 1) * CELL_W}px;` }, [String(c)]));
    }
    return ruler;
  }

  function lineColFromEvent(ev, containerEl) {
    const rect = containerEl.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    // Pure pixel->line/col math lives in PrtfWebviewLogic (see
    // src/prtfWebviewLogic.js) so it's unit testable without a DOM.
    return PrtfWebviewLogic.pixelToLineCol(x, y, CELL_W, CELL_H);
  }

  /**
   * Batch D (docs/TASKS.md) — actual rendered symbol via the vendored
   * JsBarcode (window.JsBarcode, media/vendor/jsbarcode/), for the
   * symbologies src/prtfBarcodeRender.js's RENDERABLE table covers.
   * Returns a DOM node to use as the cell's content, or null if this
   * bar-code-ID isn't one of them (caller falls back to the existing
   * labeled placeholder box unchanged).
   *
   * `w`/`h` are the cell's final on-page box dimensions in px (already
   * swapped for vertical barcodes by the caller — see isVerticalBarcode
   * above). JsBarcode has no native vertical-orientation option, so for
   * vertical fields this renders normally into a (h × w) wrapper (i.e.
   * un-swapped — natural horizontal orientation) and rotates that wrapper
   * 90° about its own center inside the (w × h) box, which is exactly
   * what a 90°-rotated (h × w) box's bounding box works out to.
   */
  function renderBarcodeSymbol(cell, w, h, isVertical) {
    if (typeof window.JsBarcode !== "function" || !PrtfBarcodeRender.isBarcodeRenderable(cell.barcode.barCodeId)) return null;

    const params = cell.barcodeParams || { barCodeId: cell.barcode.barCodeId, hriPosition: cell.barcode.hriPosition };
    const naturalW = isVertical ? h : w;
    const naturalH = isVertical ? w : h;
    const data = PrtfBarcodeRender.sampleBarcodeData(params.barCodeId, cell.length);
    const options = PrtfBarcodeRender.renderBarcodeOptions(params, naturalH);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    let ok = true;
    options.valid = (v) => {
      ok = ok && v;
    };
    try {
      window.JsBarcode(svg, data, options);
    } catch (e) {
      ok = false;
    }
    if (!ok) return null;

    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    if (!isVertical) {
      svg.style.display = "block";
      return svg;
    }

    const wrap = el("div", {
      style: `position:absolute;top:50%;left:50%;width:${naturalW}px;height:${naturalH}px;transform:translate(-50%,-50%) rotate(90deg);`,
    });
    wrap.appendChild(svg);
    return wrap;
  }

  function renderPage(layout) {
    const page = el("div", {
      class: "page",
      style: `position:relative;width:${layout.pageCols * CELL_W}px;height:${Math.min(layout.pageLines, 70) * CELL_H}px;`,
    });

    layout.cells.forEach((cell) => {
      const isVerticalBarcode = cell.barcode && cell.barcode.direction === "vertical";
      const w = (isVerticalBarcode ? cell.barcode.heightLines : cell.length) * CELL_W;
      const h = (isVerticalBarcode ? cell.length : cell.barcode ? cell.barcode.heightLines : 1) * CELL_H;
      const barcodeSymbol = cell.barcode ? renderBarcodeSymbol(cell, w, h, isVerticalBarcode) : null;
      const fontCss = cell.font
        ? `font-family:${cell.font.family};` +
          (cell.font.weight ? `font-weight:${cell.font.weight};` : "") +
          (cell.font.style ? `font-style:${cell.font.style};` : "")
        : "";
      // Batch L (continued): cell.font.fgid is only set when the font was
      // resolved via FONT/FGID — CDEFNT/FNTCHRSET/FONTNAME resolutions
      // (see prtfLayout.js's resolveFontDisplay) have no FGID at all, and
      // carry their own resolutionNote instead of the FGID-specific
      // isPlaceholderMetrics wording. This tooltip is written to read
      // sensibly for either shape rather than assuming FGID is present.
      const fontTitle =
        cell.font && !cell.barcode
          ? "Font: " +
            cell.font.name +
            (cell.font.fgid !== undefined ? " (FGID " + cell.font.fgid + (cell.font.spacing ? ", " + cell.font.spacing : "") + ")" : cell.font.spacing ? " (" + cell.font.spacing + ")" : "") +
            (cell.font.resolutionNote ? " " + cell.font.resolutionNote : "") +
            (cell.font.isPlaceholderMetrics && !cell.font.resolutionNote ? " — proportional widths are an approximation, not verified font metrics." : "") +
            (cell.font.approximate ? " Font is set by a program-to-system field; shown using the default font." : "")
          : "";
      const div = el(
        "div",
        {
          class:
            "cell" +
            (cell.kind === "constant" ? " constant" : " field") +
            (cell.barcode ? (barcodeSymbol ? " barcode rendered" : " barcode") : "") +
            (cell.id === state.selectedId ? " selected" : ""),
          style: `position:absolute;left:${(cell.position - 1) * CELL_W}px;top:${(cell.line - 1) * CELL_H}px;width:${w}px;height:${h}px;${fontCss}`,
          title: cell.barcode
            ? (barcodeSymbol
                ? "Barcode preview — " + cell.barcode.barCodeId + " (" + cell.barcode.direction + "). Rendered with placeholder sample data; actual bars depend on the field's runtime value, which I-RLU can't know at design time."
                : "Barcode placeholder — " +
                  cell.barcode.barCodeId +
                  " (" +
                  cell.barcode.direction +
                  "). Actual bar symbol not rendered — this bar-code-ID isn't one of the symbologies I-RLU can preview (see src/prtfBarcodeRender.js).") +
              (cell.barcode.approximateHeight ? " Height shown is a default estimate." : "")
            : fontTitle,
          draggable: "true",
        },
        cell.barcode
          ? barcodeSymbol
            ? [barcodeSymbol]
            : [el("span", { class: "barcode-label" }, [cell.barcode.barCodeId || "BARCODE"])]
          : [cell.kind === "constant" ? cell.text : "{" + cell.name + "}"]
      );
      div.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.selectedId = cell.id;
        state.pendingNew = null;
        state.placing = null;
        render();
      });
      div.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", cell.id);
      });
      page.appendChild(div);
    });

    (layout.draws || []).forEach((d) => {
      if (d.type === "box") {
        const top = Math.min(d.row1, d.row2);
        const left = Math.min(d.col1, d.col2);
        const h = Math.max(1, Math.abs(d.row2 - d.row1)) * CELL_H;
        const w = Math.max(1, Math.abs(d.col2 - d.col1)) * CELL_W;
        page.appendChild(
          el("div", {
            class: "draw-box" + (d.approximate ? " approximate" : ""),
            style: `position:absolute;left:${(left - 1) * CELL_W}px;top:${(top - 1) * CELL_H}px;width:${w}px;height:${h}px;`,
            title: d.approximate ? "Position depends on a program-to-system field value; shown at its default (0)." : "",
          })
        );
      } else if (d.type === "line") {
        const horizontal = d.direction === "horizontal";
        const top = Math.min(d.row1, d.row2);
        const left = Math.min(d.col1, d.col2);
        const w = horizontal ? Math.max(1, Math.abs(d.col2 - d.col1)) * CELL_W : 1;
        const h = horizontal ? 1 : Math.max(1, Math.abs(d.row2 - d.row1)) * CELL_H;
        page.appendChild(
          el("div", {
            class: "draw-line" + (d.approximate ? " approximate" : ""),
            style: `position:absolute;left:${(left - 1) * CELL_W}px;top:${(top - 1) * CELL_H}px;width:${w}px;height:${h}px;`,
            title: d.approximate ? "Position depends on a program-to-system field value; shown at its default (0)." : "",
          })
        );
      }
    });

    // Batch E (docs/TASKS.md) — OVERLAY/PAGSEG/AFPRSC labeled placeholder
    // boxes. These name external AFP resources this tool has no pixel
    // content for (docs/REQUIREMENTS.md §8) — same "honest placeholder,
    // not a guess" treatment as the BARCODE cells above, just at a fixed
    // default size since these keywords don't carry their own dimensions
    // the way BARCODE's height parameter does.
    (layout.resources || []).forEach((r) => {
      page.appendChild(
        el(
          "div",
          {
            class: "resource-placeholder" + (r.approximate ? " approximate" : ""),
            style: `position:absolute;left:${(r.col - 1) * CELL_W}px;top:${(r.row - 1) * CELL_H}px;width:${r.widthCols * CELL_W}px;height:${r.heightRows * CELL_H}px;`,
            title:
              r.keyword +
              " placeholder — " +
              (r.name || "(unnamed)") +
              ". Real resource content not rendered (needs the AFP resource file itself)." +
              (r.approximate ? " Position depends on a program-to-system field value; shown at its default (0)." : ""),
          },
          [el("span", { class: "resource-placeholder-label" }, [r.keyword + (r.name ? ": " + r.name : "")])]
        )
      );
    });

    page.addEventListener("click", (ev) => {
      if (state.placing) {
        const { line, position } = lineColFromEvent(ev, page);
        state.pendingNew = state.copySource
          ? buildCopyPendingNew(state.placing, line, position, state.copySource, layout)
          : { kind: state.placing, line, position };
        state.placing = null;
        state.copySource = null;
        state.selectedId = null;
        render();
      } else {
        state.selectedId = null;
        state.pendingNew = null;
        render();
      }
    });

    page.addEventListener("dragover", (ev) => ev.preventDefault());
    page.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const id = ev.dataTransfer.getData("text/plain");
      const { line, position } = lineColFromEvent(ev, page);
      vscode.postMessage({ type: "edit", edit: { kind: "move", recordName: state.recordName, id, line, position } });
    });

    return page;
  }

  function labeledInput(labelText, inputAttrs) {
    const input = el("input", inputAttrs);
    return { row: el("label", { class: "prop-row" }, [labelText, input]), input };
  }

  // ---------------------------------------------------------------------
  // Batch B: shared "literal or program-to-system field" (P-field) input.
  // DDS's &FIELDNAME substitution recurs across nearly every AFPDS
  // sizing/naming parameter (KEYWORD-INVENTORY §5) — this is one component
  // built once and reused for FONT/CDEFNT/FNTCHRSET/FONTNAME/CHRID below,
  // and available to other batches (A, C) that need the same pattern.
  // When a P-field is in use, no attempt is made to resolve its runtime
  // value — same "flagged default" treatment already used elsewhere for
  // program-to-system fields (see docs/REQUIREMENTS.md's known
  // limitations, and the LINE/BOX "approximate" note above).
  // ---------------------------------------------------------------------
  function pFieldRow(labelText, opts) {
    opts = opts || {};
    const wrap = el("div", { class: "prop-row pfield-row" });
    wrap.appendChild(el("span", { class: "pfield-label" }, [labelText]));
    let isPField = !!opts.initialIsPField;
    const literalInput = el("input", {
      type: opts.numeric ? "number" : "text",
      value: isPField ? "" : opts.initialValue || "",
      style: isPField ? "display:none;" : "",
      placeholder: opts.placeholder || "",
    });
    const pfieldInput = el("input", {
      type: "text",
      maxlength: "10",
      placeholder: "FIELDNAME",
      value: isPField ? opts.initialValue || "" : "",
      style: isPField ? "" : "display:none;",
    });
    const toggleBtn = el("button", { class: "btn pfield-toggle", type: "button" }, [isPField ? "P-field" : "Literal"]);
    toggleBtn.addEventListener("click", () => {
      isPField = !isPField;
      literalInput.style.display = isPField ? "none" : "";
      pfieldInput.style.display = isPField ? "" : "none";
      toggleBtn.textContent = isPField ? "P-field" : "Literal";
    });
    wrap.appendChild(literalInput);
    wrap.appendChild(pfieldInput);
    wrap.appendChild(toggleBtn);
    return {
      row: wrap,
      getValue() {
        if (isPField) {
          const name = pfieldInput.value.trim().toUpperCase().slice(0, 10);
          return name ? "&" + name : "";
        }
        return literalInput.value.trim();
      },
    };
  }

  /** Splits a single already-extracted param token into {isPField, value} — "&NAME" -> {true,"NAME"}, "11" -> {false,"11"}. */
  // tokenToPField/parseFontSpecKeyword's pure parsing logic now lives in
  // PrtfWebviewLogic (src/prtfWebviewLogic.js) so it's unit testable
  // without a DOM. Kept as thin local aliases here so the many call sites
  // below don't all need a PrtfWebviewLogic. prefix.
  const tokenToPField = PrtfWebviewLogic.tokenToPField;
  const parseFontSpecKeyword = PrtfWebviewLogic.parseFontSpecKeyword;
  const paramsToText = PrtfWebviewLogic.paramsToText;
  const paramsInnerText = PrtfWebviewLogic.paramsInnerText;

  /** Builds a keyword's params text ("(...)") from its param rows and optional pointsize rows. Returns null if the mandatory first param is empty (meaning: don't write this keyword). Thin DOM-reading wrapper around PrtfWebviewLogic.buildFontSpecParamsFromValues. */
  function buildFontSpecParams(spec, paramRows, heightRow, widthRow) {
    const vals = paramRows.map((r) => r.getValue());
    const h = spec.pointSize && heightRow ? heightRow.getValue() : null;
    const w = spec.pointSize && widthRow ? widthRow.getValue() : null;
    return PrtfWebviewLogic.buildFontSpecParamsFromValues(spec, vals, h, w);
  }

  // Batch B keyword shapes, sourced from docs/KEYWORD-INVENTORY.md §1-§3.
  // FONT/CDEFNT/FNTCHRSET/FONTNAME/CHRID all support P-field indirection on
  // their name/library params (§5); CHRSIZ and CCSID don't (plain numeric),
  // so they're handled separately below rather than forced into this shape.
  const FONT_SIZING_SPECS = [
    {
      name: "FONT",
      hint: "Selects the font by FGID (Font Global Identifier) or a program-to-system field.",
      params: [{ key: "fgid", label: "Font (FGID)", placeholder: "e.g. 11" }],
      pointSize: true,
    },
    {
      name: "CDEFNT",
      hint: "Selects an AFP coded font by name (e.g. X0N51EHC) or a program-to-system field.",
      params: [
        { key: "name", label: "Coded font name" },
        { key: "library", label: "Library", optional: true },
      ],
      pointSize: true,
    },
    {
      name: "FNTCHRSET",
      hint: "Selects a host font character set + code page (FOCA font resource).",
      params: [
        { key: "charset", label: "Font char set name" },
        { key: "charsetLib", label: "Char set library", optional: true },
        { key: "codepage", label: "Code page name" },
        { key: "codepageLib", label: "Code page library", optional: true },
      ],
      pointSize: true,
    },
    {
      name: "FONTNAME",
      hint: "Selects a TrueType/OpenType font by resource name.",
      // Batch L (continued): quoted, since FONTNAME's value is a DDS
      // character literal (IBM's own example: FONTNAME('Courier New' ...))
      // that can contain internal spaces — parseFontSpecKeyword/
      // buildFontSpecParamsFromValues use this flag to quote/unquote it
      // correctly rather than mishandling the embedded space.
      params: [{ key: "name", label: "Font resource name", quoted: true }],
      pointSize: false,
    },
    {
      name: "CHRID",
      hint: "Selects the graphic character set/code page for a printer-resident font. Ignored if CDEFNT or FNTCHRSET is also coded.",
      params: [
        { key: "charset", label: "Graphic character set" },
        { key: "codepage", label: "Code page" },
      ],
      pointSize: false,
    },
  ];

  /**
   * Renders the Batch B "Font & sizing" panel: FONT/CDEFNT/FNTCHRSET/
   * FONTNAME/CHRID (via the shared P-field component) plus plain-numeric
   * CHRSIZ/CCSID, against whatever keyword array is passed in (a record's
   * or a field's). `applyFn(name, params)`/`removeFn(name)` post the
   * appropriate edit message — record-level and field-level callers supply
   * different ones, but the panel itself doesn't know or care which.
   */
  function renderFontSizingPanel(keywords, applyFn, removeFn, titleSuffix) {
    const panel = el("div", { class: "props" });
    panel.appendChild(el("h4", {}, ["Font & sizing" + (titleSuffix ? " — " + titleSuffix : "")]));

    (PrtfEngine.validateFontKeywords(keywords) || []).forEach((w) => {
      panel.appendChild(el("div", { class: "hint warning" }, [w.message]));
    });

    FONT_SIZING_SPECS.forEach((spec) => {
      const existing = PrtfEngine.findKeyword(keywords, spec.name);
      const parsed = parseFontSpecKeyword(spec, existing);

      const cbId = "fk-" + spec.name + "-" + Math.random().toString(36).slice(2, 7);
      const cb = el("input", { type: "checkbox", id: cbId });
      if (existing) cb.setAttribute("checked", "checked");
      panel.appendChild(el("label", { class: "ind-label", for: cbId, title: spec.hint }, [cb, " " + spec.name]));

      const body = el("div", { style: existing ? "" : "display:none;" });
      const paramRows = spec.params.map((p, i) => {
        const r = pFieldRow(p.label, { initialIsPField: parsed.values[i].isPField, initialValue: parsed.values[i].value, placeholder: p.placeholder });
        body.appendChild(r.row);
        return r;
      });
      let heightRow = null;
      let widthRow = null;
      if (spec.pointSize) {
        heightRow = pFieldRow("Point size height", { initialIsPField: parsed.height.isPField, initialValue: parsed.height.value, numeric: !parsed.height.isPField, placeholder: "optional" });
        widthRow = pFieldRow("Point size width", { initialIsPField: parsed.width.isPField, initialValue: parsed.width.value, numeric: !parsed.width.isPField, placeholder: "optional" });
        body.appendChild(heightRow.row);
        body.appendChild(widthRow.row);
      }
      const applyBtn = el("button", { class: "btn", type: "button" }, ["Apply " + spec.name]);
      applyBtn.addEventListener("click", () => {
        const params = buildFontSpecParams(spec, paramRows, heightRow, widthRow);
        if (params) applyFn(spec.name, params);
      });
      body.appendChild(applyBtn);
      panel.appendChild(body);

      cb.addEventListener("change", () => {
        if (cb.checked) {
          body.style.display = "";
        } else {
          body.style.display = "none";
          removeFn(spec.name);
        }
      });
    });

    // CHRSIZ and CCSID: plain numeric, no P-field indirection per
    // KEYWORD-INVENTORY §2/§3 (neither is listed among the P-field-capable
    // parameters there).
    const chrsizExisting = PrtfEngine.findKeyword(keywords, "CHRSIZ");
    const chrsizTokens = chrsizExisting ? PrtfEngine.paramTokens(chrsizExisting) : [];
    const chrsizCbId = "fk-chrsiz-" + Math.random().toString(36).slice(2, 7);
    const chrsizCb = el("input", { type: "checkbox", id: chrsizCbId });
    if (chrsizExisting) chrsizCb.setAttribute("checked", "checked");
    panel.appendChild(
      el("label", { class: "ind-label", for: chrsizCbId, title: "Character size multipliers 1.0-20.0. Requires an IPDS printer." }, [
        chrsizCb,
        " CHRSIZ",
      ])
    );
    const chrsizBody = el("div", { style: chrsizExisting ? "" : "display:none;" });
    const widthMultRow = labeledInput("Width multiplier", { type: "number", min: "1", max: "20", step: "0.1", value: chrsizTokens[0] || "1.0" });
    const heightMultRow = labeledInput("Height multiplier", { type: "number", min: "1", max: "20", step: "0.1", value: chrsizTokens[1] || "1.0" });
    chrsizBody.appendChild(widthMultRow.row);
    chrsizBody.appendChild(heightMultRow.row);
    const chrsizApplyBtn = el("button", { class: "btn", type: "button" }, ["Apply CHRSIZ"]);
    chrsizApplyBtn.addEventListener("click", () => {
      const w = widthMultRow.input.value || "1.0";
      const h = heightMultRow.input.value || "1.0";
      applyFn("CHRSIZ", "(" + w + " " + h + ")");
    });
    chrsizBody.appendChild(chrsizApplyBtn);
    panel.appendChild(chrsizBody);
    chrsizCb.addEventListener("change", () => {
      if (chrsizCb.checked) chrsizBody.style.display = "";
      else {
        chrsizBody.style.display = "none";
        removeFn("CHRSIZ");
      }
    });

    const ccsidExisting = PrtfEngine.findKeyword(keywords, "CCSID");
    const ccsidCbId = "fk-ccsid-" + Math.random().toString(36).slice(2, 7);
    const ccsidCb = el("input", { type: "checkbox", id: ccsidCbId });
    if (ccsidExisting) ccsidCb.setAttribute("checked", "checked");
    panel.appendChild(
      el("label", { class: "ind-label", for: ccsidCbId, title: "Coded character set ID for this file/record/field's text." }, [ccsidCb, " CCSID"])
    );
    const ccsidBody = el("div", { style: ccsidExisting ? "" : "display:none;" });
    const ccsidValRow = labeledInput("CCSID", { type: "number", min: "1", value: ccsidExisting ? String(ccsidExisting.params).replace(/[()]/g, "").trim() : "" });
    ccsidBody.appendChild(ccsidValRow.row);
    const ccsidApplyBtn = el("button", { class: "btn", type: "button" }, ["Apply CCSID"]);
    ccsidApplyBtn.addEventListener("click", () => {
      const v = ccsidValRow.input.value.trim();
      if (v) applyFn("CCSID", "(" + v + ")");
    });
    ccsidBody.appendChild(ccsidApplyBtn);
    panel.appendChild(ccsidBody);
    ccsidCb.addEventListener("change", () => {
      if (ccsidCb.checked) ccsidBody.style.display = "";
      else {
        ccsidBody.style.display = "none";
        removeFn("CCSID");
      }
    });

    return panel;
  }

  function labeledSelect(labelText, options, currentValue) {
    const select = el("select", {});
    options.forEach((opt) => {
      const o = el("option", { value: opt }, [opt || "(blank)"]);
      if (opt === currentValue) o.setAttribute("selected", "selected");
      select.appendChild(o);
    });
    return { row: el("label", { class: "prop-row" }, [labelText, select]), input: select };
  }

  /** Renders the properties panel for either a pending-new entry or the currently selected one. Returns null if nothing to show. */
  function renderPropsPanel(layout) {
    if (state.pendingNew) return renderNewEntryPanel(state.pendingNew);
    if (state.selectedId) {
      const cell = layout.cells.find((c) => c.id === state.selectedId);
      if (cell) return renderEditPanel(cell, layout);
    }
    return null;
  }

  /**
   * Batch P — inline forms for the record-format container operations
   * (add/rename/delete) armed by renderToolbar's buttons above. Rendered
   * in the same "props" slot renderPropsPanel uses for field/constant
   * editing, since only one of these is ever showing at a time
   * (clearPendingUiState keeps them mutually exclusive) — but as a
   * SEPARATE call from renderPropsPanel (not folded into it), since this
   * operates on the record CONTAINER itself, not on a field/constant
   * within it, and doesn't depend on `layout.cells` the way
   * renderPropsPanel/renderEditPanel do.
   *
   * Matches the existing "no separate Save/confirm round trip needed for
   * Cancel, but wait for the setModel round trip after a real edit" pattern
   * already used by renderNewEntryPanel below: a Save/Add/Rename/Delete
   * button posts the edit and closes the form immediately (optimistic,
   * without calling render() itself) — the next incoming `setModel`
   * message (after the extension host applies the edit and re-parses) is
   * what actually redraws the toolbar/select with the new state; Cancel
   * buttons close the form AND call render() directly, since there's no
   * round trip to wait for.
   */
  function renderRecordManagementPanel() {
    if (!state.pendingNewRecord && !state.renamingRecord && !state.confirmDeleteRecord) return null;
    const panel = el("div", { class: "props" });

    if (state.pendingNewRecord) {
      panel.appendChild(el("h4", {}, ["New record format"]));
      panel.appendChild(
        el("div", { class: "hint" }, ["Inserted right after \"" + state.recordName + "\" in the source."])
      );
      const nameRow = labeledInput("Name", { type: "text", maxlength: "10" });
      panel.appendChild(nameRow.row);
      const btnRow = el("div", { class: "prop-buttons" });
      const addBtn = el("button", { class: "btn primary" }, ["Add"]);
      addBtn.addEventListener("click", () => {
        const name = nameRow.input.value.trim().toUpperCase().slice(0, 10);
        if (!name) return;
        vscode.postMessage({ type: "edit", edit: { kind: "addRecord", name, afterRecordName: state.recordName } });
        state.pendingNewRecord = false;
      });
      const cancelBtn = el("button", { class: "btn" }, ["Cancel"]);
      cancelBtn.addEventListener("click", () => {
        state.pendingNewRecord = false;
        render();
      });
      btnRow.appendChild(addBtn);
      btnRow.appendChild(cancelBtn);
      panel.appendChild(btnRow);
    }

    if (state.renamingRecord) {
      panel.appendChild(el("h4", {}, ["Rename record format \"" + state.recordName + "\""]));
      const nameRow = labeledInput("New name", { type: "text", maxlength: "10", value: state.recordName || "" });
      panel.appendChild(nameRow.row);
      const btnRow = el("div", { class: "prop-buttons" });
      const saveBtn = el("button", { class: "btn primary" }, ["Rename"]);
      saveBtn.addEventListener("click", () => {
        const newName = nameRow.input.value.trim().toUpperCase().slice(0, 10);
        if (!newName) return;
        vscode.postMessage({ type: "edit", edit: { kind: "renameRecord", oldName: state.recordName, newName } });
        // Optimistically track the rename locally so the toolbar <select>
        // doesn't flash back to the old name before the setModel round
        // trip completes; the incoming setModel's own fallback (see the
        // bottom of this file) still corrects this if the edit was
        // rejected as a no-op (e.g. a duplicate name).
        state.recordName = newName;
        state.renamingRecord = false;
      });
      const cancelBtn = el("button", { class: "btn" }, ["Cancel"]);
      cancelBtn.addEventListener("click", () => {
        state.renamingRecord = false;
        render();
      });
      btnRow.appendChild(saveBtn);
      btnRow.appendChild(cancelBtn);
      panel.appendChild(btnRow);
    }

    if (state.confirmDeleteRecord) {
      panel.appendChild(el("h4", {}, ["Delete record format \"" + state.recordName + "\"?"]));
      panel.appendChild(
        el("div", { class: "hint warning" }, [
          "This removes the record format and all its fields/constants. Undo with Ctrl+Z in the text editor if needed — this panel has no separate undo of its own.",
        ])
      );
      const btnRow = el("div", { class: "prop-buttons" });
      const confirmBtn = el("button", { class: "btn danger" }, ["Delete"]);
      confirmBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "edit", edit: { kind: "deleteRecord", name: state.recordName } });
        state.confirmDeleteRecord = false;
      });
      const cancelBtn = el("button", { class: "btn" }, ["Cancel"]);
      cancelBtn.addEventListener("click", () => {
        state.confirmDeleteRecord = false;
        render();
      });
      btnRow.appendChild(confirmBtn);
      btnRow.appendChild(cancelBtn);
      panel.appendChild(btnRow);
    }

    return panel;
  }

  /**
   * Batch Q (docs/TASKS.md) — the pure decision logic (name suggestion,
   * which keywords carry over, defaulting to same-record scope) lives in
   * PrtfWebviewLogic (src/prtfWebviewLogic.js) so it's unit testable
   * without a DOM, same split as pixelToLineCol/paramsToText/etc. above.
   */
  function suggestCopyName(sourceName, existingNames) {
    return PrtfWebviewLogic.suggestCopyName(sourceName, existingNames);
  }
  function buildCopyPendingNew(kind, line, position, source, layout) {
    const existingFieldNames = new Set(layout.cells.filter((c) => c.kind === "field").map((c) => c.name));
    return PrtfWebviewLogic.buildCopyPendingNew(kind, line, position, source, existingFieldNames);
  }

  function renderNewEntryPanel(pending) {
    const panel = el("div", { class: "props" });
    const isCopy = !!(pending.sourceKeywords && pending.sourceKeywords.length) || pending.name !== undefined || pending.literal !== undefined;
    panel.appendChild(
      el("h4", {}, [
        (isCopy ? "Copy of " + pending.kind : "New " + pending.kind) + " at line " + pending.line + ", position " + pending.position,
      ])
    );
    if (pending.sourceKeywords && pending.sourceKeywords.length) {
      panel.appendChild(
        el("div", { class: "hint" }, [
          "Keywords carried over from the source: " + pending.sourceKeywords.map((k) => k.name).join(", ") + ".",
        ])
      );
    }

    let nameInput, litInput, lenInput, typeSelect, decInput, usageSelect;

    if (pending.kind === "field") {
      const nameRow = labeledInput("Name", { type: "text", maxlength: "10", value: pending.name || "" });
      nameInput = nameRow.input;
      panel.appendChild(nameRow.row);

      const lenRow = labeledInput("Length", { type: "number", min: "1", value: String(pending.length || 10) });
      lenInput = lenRow.input;
      panel.appendChild(lenRow.row);

      const typeRow = labeledSelect("Data type", ["A", "S", "P", "B"], pending.dataType || "A");
      typeSelect = typeRow.input;
      panel.appendChild(typeRow.row);

      const decRow = labeledInput("Decimals", { type: "number", min: "0", value: String(pending.decimalPositions || 0) });
      decInput = decRow.input;
      panel.appendChild(decRow.row);

      const usageRow = labeledSelect("Usage", ["O", "I", "B", "H"], pending.usage || "O");
      usageSelect = usageRow.input;
      panel.appendChild(usageRow.row);
    } else {
      const litRow = labeledInput("Text", { type: "text", value: pending.literal || "" });
      litInput = litRow.input;
      panel.appendChild(litRow.row);
    }

    const btnRow = el("div", { class: "prop-buttons" });
    const saveBtn = el("button", { class: "btn primary" }, [isCopy ? "Add copy" : "Add"]);
    saveBtn.addEventListener("click", () => {
      if (pending.kind === "field") {
        vscode.postMessage({
          type: "edit",
          edit: {
            kind: "addField",
            recordName: state.recordName,
            line: pending.line,
            position: pending.position,
            name: (nameInput.value || "FLD" + Math.floor(Math.random() * 1000)).toUpperCase().slice(0, 10),
            length: Number(lenInput.value) || 10,
            dataType: typeSelect.value,
            decimalPositions: typeSelect.value === "A" ? undefined : Number(decInput.value) || 0,
            usage: usageSelect.value,
            sourceKeywords: pending.sourceKeywords,
          },
        });
      } else {
        vscode.postMessage({
          type: "edit",
          edit: {
            kind: "addConstant",
            recordName: state.recordName,
            line: pending.line,
            position: pending.position,
            literal: litInput.value || "",
            sourceKeywords: pending.sourceKeywords,
          },
        });
      }
      state.pendingNew = null;
    });
    const cancelBtn = el("button", { class: "btn" }, ["Cancel"]);
    cancelBtn.addEventListener("click", () => {
      state.pendingNew = null;
      render();
    });
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    panel.appendChild(btnRow);
    return panel;
  }

  // Batch G (docs/TASKS.md) — field-level data/edit keywords. All are
  // non-repeating (at most one per field), so each is a checkbox ("present
  // on this field?") plus, for the two with a parameter, a select — same
  // shape as Batch F's BATCH_F_KEYWORDS for record-level keywords, applied
  // immediately via setFieldKeyword/removeFieldKeyword rather than waiting
  // for this panel's own Save button (which only covers the base
  // positional attributes + REF/REFFLD).
  const BATCH_G_FIELD_KEYWORDS = [
    { name: "ALIAS", kind: "text", placeholder: "alt. field name", maxlength: "10", upper: true, hint: "Alternative name for the field — a second name HLL programs can reference it by." },
    { name: "BLKFOLD", kind: "flag", hint: "Wrap to a blank instead of a hard break when data exceeds the field width. Only has effect with FOLD(*YES) on CRTPRTF/CHGPRTF/OVRPRTF." },
    { name: "CVTDTA", kind: "flag", hint: "Convert Data — the field carries hex code points rather than character data (used with DFNCHR on SCS/IPDS printers)." },
    { name: "DLTEDT", kind: "flag", hint: "Delete Edit — ignores any EDTCDE/EDTWRD copied in from a referenced field. Only has effect when \"Reference a field\" is on." },
    { name: "FLTFIXDEC", kind: "flag", hint: "Shows a floating-point value in fixed-decimal form instead of scientific notation. Floating-point fields (data type F) only." },
    { name: "FLTPCN", kind: "select", options: ["*SINGLE", "*DOUBLE"], hint: "Floating-point precision. Floating-point fields (data type F) only." },
    { name: "TRNSPY", kind: "flag", hint: "Transparency — passes field data through as raw hex rather than interpreting it as printer commands. Character fields only." },
    { name: "TXTRTT", kind: "select", options: ["0", "90", "180", "270"], hint: "Rotates this field's text, in degrees, independent of the record's PAGRTT." },
  ];

  /** Renders the always-visible "Data/edit keywords" section inside a field's properties panel — see BATCH_G_FIELD_KEYWORDS above. */
  function renderFieldKeywordsSection(cell) {
    const section = el("div", {});
    section.appendChild(el("h4", {}, ["Data/edit keywords"]));

    (cell.fieldWarnings || []).forEach((w) => {
      section.appendChild(el("div", { class: "hint warning" }, [w.message]));
    });

    const onSet = (name, params) => vscode.postMessage({ type: "edit", edit: { kind: "setFieldKeyword", id: cell.id, name, params } });
    const onRemove = (name) => vscode.postMessage({ type: "edit", edit: { kind: "removeFieldKeyword", id: cell.id, name } });
    appendKeywordRows(section, BATCH_G_FIELD_KEYWORDS, cell.keywords, "fkw-" + cell.id, onSet, onRemove);

    return section;
  }

  // Batch A: field-only keywords — attach to a NAMED field, per IBM's DDS
  // reference "DDS File With Date, Time, and Timestamp Fields" example,
  // which shows DATFMT/DATSEP/TIMFMT/TIMSEP used on named L (date) / T
  // (time) type fields. EDTCDE is handled separately below (two-part:
  // code + optional fill character, not a single value).
  const BATCH_A_FIELD_ONLY_KEYWORDS = [
    { name: "EDTWRD", kind: "quotedText", placeholder: "e.g.   .  ", hint: "Edit word mask." },
    { name: "DATFMT", kind: "select", options: ["*MDY", "*DMY", "*YMD", "*JUL", "*ISO", "*USA", "*EUR", "*JIS", "*JOB"], hint: "Date format for a date (L) type field." },
    { name: "DATSEP", kind: "quotedSelect", options: ["*JOB", "/", "-", ".", ",", " "], hint: "Date separator. Not valid with *ISO/*USA/*EUR/*JIS (fixed separator)." },
    { name: "TIMFMT", kind: "select", options: ["*ISO", "*USA", "*EUR", "*JIS", "*HMS", "*JOB"], hint: "Time format for a time (T) type field." },
    { name: "TIMSEP", kind: "quotedSelect", options: ["*JOB", ":", ".", ",", " "], hint: "Time separator. Not valid with *ISO/*USA/*EUR/*JIS (fixed separator)." },
    { name: "DFT", kind: "quotedText", placeholder: "default value", hint: "Default value for this field." },
  ];
  const EDTCDE_OPTIONS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "J", "K", "L", "M", "N", "O", "P", "Q", "W", "X", "Y", "Z"];

  // Batch A: constant-only keywords. Per IBM's DDS reference syntax
  // overview: "Constant (unnamed) fields require only a location and a
  // keyword, as described in the DATE, DFT, PAGNBR, TIME, and MSGCON
  // keyword descriptions." DFT is deliberately NOT repeated here (kept
  // field-only above) — a constant already carries its value via the
  // literal-text input in renderEditPanel, so offering DFT here too would
  // just be a redundant path to the same result. MSGCON is handled
  // separately below (four-part: length/id/file/library).
  const BATCH_A_CONSTANT_ONLY_KEYWORDS = [
    { name: "DATE", kind: "flag", hint: "Prints the current date as a 6- or 8-byte value." },
    { name: "TIME", kind: "flag", hint: "Prints the current system time as a 6-byte value." },
    { name: "PAGNBR", kind: "flag", hint: "Prints the current page number (unnamed 4-digit zoned field)." },
  ];

  // Batch A: keywords valid on both a named field and a constant. HIGHLIGHT
  // here is the field-level form of the keyword Batch B's font panel
  // already validates against CDEFNT/FNTCHRSET (cell.fieldWarnings, used
  // in renderFieldKeywordsSection above, comes from the same
  // validateFieldKeywords() call) — no separate validation needed here.
  const BATCH_A_SHARED_KEYWORDS = [
    { name: "HIGHLIGHT", kind: "flag", hint: "Highlighted printing. Ignored if CDEFNT or FNTCHRSET is also coded here." },
    { name: "UNDERLINE", kind: "flag", hint: "Underlined printing. May not print correctly on *AFPDS output distributed to System z." },
  ];

  const NAMED_COLORS = [
    ["*BLK", "Black"], ["*BLU", "Blue"], ["*BRN", "Brown"], ["*GRN", "Green"],
    ["*PNK", "Pink"], ["*RED", "Red"], ["*TRQ", "Turquoise"], ["*YLW", "Yellow"],
  ];

  /**
   * Appends one prop-row per keyword definition into an existing container —
   * the single "checkbox toggles a keyword, optional select/text input
   * supplies its parameter, changes apply immediately" building block shared
   * by every keyword panel in this file: the Batch G field data/edit-keywords
   * section, the Batch F record print/finishing panel, the Batch A general
   * record-keywords panel, and the Batch A general field/constant-keywords
   * section. (Previously each of those four re-implemented this loop with
   * small, accidental differences — see the code review that prompted this
   * refactor. EDTCDE/MSGCON/COLOR stay bespoke, appended separately by their
   * callers, since their multi-part shape doesn't fit a single value input.)
   *
   * Handles kinds "flag" (checkbox only), "text"/"quotedText" (checkbox + a
   * free-text input; "quotedText" DDS-quotes the value, plain "text" doesn't),
   * and "select"/"quotedSelect" (checkbox + a dropdown of def.options).
   *
   * Per-definition options beyond `name`/`kind`/`hint`/`options`/`placeholder`:
   *   - `maxlength`: HTML maxlength for a text input (e.g. ALIAS's 10-char DDS name limit).
   *   - `upper`: uppercase the value before sending (e.g. ALIAS, a DDS name).
   */
  function appendKeywordRows(container, keywordDefs, entryKeywords, idPrefix, onSet, onRemove) {
    keywordDefs.forEach((def) => {
      const existing = PrtfEngine.findKeyword(entryKeywords, def.name);
      const rowWrap = el("div", { class: "prop-row" });

      const cbId = idPrefix + "-" + def.name;
      const cb = el("input", { type: "checkbox", id: cbId });
      if (existing) cb.setAttribute("checked", "checked");
      rowWrap.appendChild(el("label", { class: "ind-label", for: cbId, title: def.hint || "" }, [cb, " " + def.name]));

      let valueInput = null;
      if (def.kind === "select" || def.kind === "quotedSelect") {
        const sel = el("select", {});
        def.options.forEach((opt) => {
          const o = el("option", { value: opt }, [opt]);
          if (opt === paramsInnerText(existing, def.kind)) o.setAttribute("selected", "selected");
          sel.appendChild(o);
        });
        valueInput = sel;
        rowWrap.appendChild(sel);
      } else if (def.kind === "quotedText" || def.kind === "text") {
        const inputAttrs = { type: "text", placeholder: def.placeholder || "", value: paramsInnerText(existing, def.kind) };
        if (def.maxlength) inputAttrs.maxlength = def.maxlength;
        const inp = el("input", inputAttrs);
        valueInput = inp;
        rowWrap.appendChild(inp);
      }

      const sendUpdate = () => {
        if (!cb.checked) {
          onRemove(def.name);
          return;
        }
        // A checked keyword whose value is required (ALIAS/OUTBIN/INVMMAP/
        // EDTWRD/DFT/...) would otherwise write a bare "NAME()", which isn't
        // valid DDS. Leave the box checked but don't send anything until
        // there's a value.
        if ((def.kind === "quotedText" || def.kind === "text") && valueInput && !valueInput.value.trim()) return;
        const rawValue = valueInput ? valueInput.value : "";
        onSet(def.name, valueInput ? paramsToText(def.kind, def.upper ? rawValue.toUpperCase() : rawValue) : "");
      };

      cb.addEventListener("change", sendUpdate);
      if (valueInput) valueInput.addEventListener("change", sendUpdate);

      container.appendChild(rowWrap);
    });
  }

  /** Bespoke EDTCDE row (Batch A) — two-part: edit code (1-9, A-D, J-Q, W-Z) plus an optional fill character (* or a currency symbol), per docs/KEYWORD-INVENTORY.md §3. */
  function appendEdtcdeRow(container, entryKeywords, idPrefix, onSet, onRemove) {
    const existing = PrtfEngine.findKeyword(entryKeywords, "EDTCDE");
    const existingInner = paramsInnerText(existing);
    const parts = existingInner ? existingInner.split(/\s+/) : [];

    const rowWrap = el("div", { class: "prop-row" });
    const cbId = idPrefix + "-EDTCDE";
    const cb = el("input", { type: "checkbox", id: cbId });
    if (existing) cb.setAttribute("checked", "checked");
    rowWrap.appendChild(el("label", { class: "ind-label", for: cbId, title: "Edit code (numeric display formatting) plus optional fill character." }, [cb, " EDTCDE"]));

    const sel = el("select", {});
    EDTCDE_OPTIONS.forEach((opt) => {
      const o = el("option", { value: opt }, [opt]);
      if (opt === parts[0]) o.setAttribute("selected", "selected");
      sel.appendChild(o);
    });
    rowWrap.appendChild(sel);
    const fillInput = el("input", { type: "text", maxlength: "1", placeholder: "fill (* or currency)", value: parts[1] || "" });
    rowWrap.appendChild(fillInput);
    container.appendChild(rowWrap);

    const sendUpdate = () => {
      if (!cb.checked) {
        onRemove("EDTCDE");
        return;
      }
      const fill = (fillInput.value || "").trim();
      onSet("EDTCDE", fill ? "(" + sel.value + " " + fill + ")" : "(" + sel.value + ")");
    };
    cb.addEventListener("change", sendUpdate);
    sel.addEventListener("change", sendUpdate);
    fillInput.addEventListener("change", sendUpdate);
  }

  /** Bespoke MSGCON row (Batch A) — MSGCON(length message-id message-file [library]), verified against IBM's DDS reference. Pulling the actual message text from the message file would need Code for i (out of scope per docs/TASKS.md Batch A); this just round-trips the keyword's own parameters. */
  function appendMsgconRow(container, entryKeywords, idPrefix, onSet, onRemove) {
    const existing = PrtfEngine.findKeyword(entryKeywords, "MSGCON");
    const inner = paramsInnerText(existing);
    const tokens = inner ? inner.split(/\s+/) : [];

    const rowWrap = el("div", { class: "prop-row" });
    const cbId = idPrefix + "-MSGCON";
    const cb = el("input", { type: "checkbox", id: cbId });
    if (existing) cb.setAttribute("checked", "checked");
    rowWrap.appendChild(el("label", { class: "ind-label", for: cbId, title: "Constant text pulled from a message description." }, [cb, " MSGCON"]));
    container.appendChild(rowWrap);

    const valuesRow = el("div", { class: "prop-row" });
    const lenInp = el("input", { type: "number", min: "1", max: "132", placeholder: "length", value: tokens[0] || "" });
    const idInp = el("input", { type: "text", placeholder: "message id or *LIST", value: tokens[1] || "" });
    const fileInp = el("input", { type: "text", placeholder: "message file", value: tokens[2] || "" });
    const libInp = el("input", { type: "text", placeholder: "library (*LIBL)", value: tokens[3] || "" });
    [lenInp, idInp, fileInp, libInp].forEach((i) => valuesRow.appendChild(i));
    container.appendChild(valuesRow);

    const sendUpdate = () => {
      if (!cb.checked) {
        onRemove("MSGCON");
        return;
      }
      if (!lenInp.value || !idInp.value.trim() || !fileInp.value.trim()) return;
      const parts = [lenInp.value, idInp.value.trim().toUpperCase(), fileInp.value.trim().toUpperCase()];
      if (libInp.value.trim()) parts.push(libInp.value.trim().toUpperCase());
      onSet("MSGCON", "(" + parts.join(" ") + ")");
    };
    cb.addEventListener("change", sendUpdate);
    [lenInp, idInp, fileInp, libInp].forEach((i) => i.addEventListener("change", sendUpdate));
  }

  /**
   * Bespoke COLOR row (Batch A) — richer than a single select/text kind
   * supports, since COLOR's shape genuinely differs per model. Named
   * colors and *RGB are confirmed against this project's own established
   * fixture (test/fixtures/sample-afpds.pf uses COLOR(*BLU) and
   * COLOR(*RGB 0 0 0)). *CMYK/*CIELAB's exact special-value names and
   * numeric ranges are NOT independently confirmed against IBM's DDS
   * reference — inferred from the *RGB pattern shown on the RLU "Work with
   * Colors" screen's second page (docs/KEYWORD-INVENTORY.md §3) — so those
   * two get a plain space-separated text input instead of false-precision
   * numeric range inputs. Flagged in docs/TASKS.md for a follow-up
   * verification pass.
   */
  function appendColorRow(container, entryKeywords, idPrefix, onSet, onRemove) {
    const existing = PrtfEngine.findKeyword(entryKeywords, "COLOR");
    const inner = paramsInnerText(existing);
    const tokens = inner ? inner.split(/\s+/) : [];
    const model = tokens[0] === "*RGB" || tokens[0] === "*CMYK" || tokens[0] === "*CIELAB" ? tokens[0] : "Named";

    const rowWrap = el("div", { class: "prop-row" });
    const cbId = idPrefix + "-COLOR";
    const cb = el("input", { type: "checkbox", id: cbId });
    if (existing) cb.setAttribute("checked", "checked");
    rowWrap.appendChild(el("label", { class: "ind-label", for: cbId }, [cb, " COLOR"]));

    const modelSel = el("select", {});
    ["Named", "*RGB", "*CMYK", "*CIELAB"].forEach((m) => {
      const o = el("option", { value: m }, [m]);
      if (m === model) o.setAttribute("selected", "selected");
      modelSel.appendChild(o);
    });
    rowWrap.appendChild(modelSel);
    container.appendChild(rowWrap);

    const valuesRow = el("div", { class: "prop-row" });
    container.appendChild(valuesRow);

    let compose = () => "";
    const sendUpdate = () => {
      if (!cb.checked) {
        onRemove("COLOR");
        return;
      }
      const composed = compose().trim();
      if (!composed) return;
      onSet("COLOR", "(" + composed + ")");
    };

    function renderValueInputs() {
      valuesRow.innerHTML = "";
      if (modelSel.value === "Named") {
        const sel = el("select", {});
        NAMED_COLORS.forEach(([v, label]) => {
          const o = el("option", { value: v }, [label]);
          if (v === tokens[0]) o.setAttribute("selected", "selected");
          sel.appendChild(o);
        });
        valuesRow.appendChild(sel);
        compose = () => sel.value;
        sel.addEventListener("change", sendUpdate);
      } else if (modelSel.value === "*RGB") {
        const r = el("input", { type: "number", min: "0", max: "255", value: tokens[1] || "0" });
        const g = el("input", { type: "number", min: "0", max: "255", value: tokens[2] || "0" });
        const b = el("input", { type: "number", min: "0", max: "255", value: tokens[3] || "0" });
        [r, g, b].forEach((i) => {
          valuesRow.appendChild(i);
          i.addEventListener("change", sendUpdate);
        });
        compose = () => "*RGB " + r.value + " " + g.value + " " + b.value;
      } else {
        const raw = el("input", { type: "text", placeholder: "space-separated values (unverified format — see code comment)", value: tokens.slice(1).join(" ") });
        valuesRow.appendChild(raw);
        raw.addEventListener("change", sendUpdate);
        compose = () => modelSel.value + " " + raw.value;
      }
    }
    renderValueInputs();
    modelSel.addEventListener("change", () => {
      renderValueInputs();
      sendUpdate();
    });
    cb.addEventListener("change", sendUpdate);
  }

  // Batch C (docs/TASKS.md) — BARCODE full parameter surface. Bespoke
  // (like appendColorRow/appendMsgconRow above) rather than a
  // BATCH_C_KEYWORDS + appendKeywordRows entry, since BARCODE's shape —
  // one keyword with up to a dozen sub-parameters, several themselves
  // parenthesized expressions — doesn't fit appendKeywordRows'
  // single-value-per-keyword model. Valid on both fields and constants
  // per IBM's DDS reference (constants are restricted to CODEABAR/
  // CODE128/CODE3OF9 plus DFT — surfaced as a hint, not enforced, same
  // "live-editor hint, CRTPRTF is the real enforcement point" spirit as
  // every other validation in this file). Rendering stays the existing
  // labeled placeholder box (see renderPage) — this batch is UI/model/
  // parsing only, per its docs/TASKS.md scope; Batch D gives it visual
  // meaning later.
  const BARCODE_DEFAULTS = {
    barCodeId: "",
    heightMode: "none",
    heightLines: undefined,
    heightValue: undefined,
    direction: "horizontal",
    hriPosition: "below",
    asterisk: false,
    modifier: "",
    narrowBarWidth: undefined,
    ratio: undefined,
    extra2D: "",
    unrecognizedRaw: [],
  };

  function renderBarcodeSection(cell) {
    const section = el("div", {});
    section.appendChild(el("h4", {}, ["BARCODE"]));
    if (cell.kind === "constant") {
      section.appendChild(
        el("div", { class: "hint" }, [
          "On a constant, only CODEABAR/CODE128/CODE3OF9 are valid bar-code-IDs, and DFT must also be coded — not enforced here.",
        ])
      );
    }

    const existing = PrtfEngine.findKeyword(cell.keywords, "BARCODE");
    const f = Object.assign({}, BARCODE_DEFAULTS, existing ? cell.barcodeParams || {} : {});

    const onRemove = () => vscode.postMessage({ type: "edit", edit: { kind: "removeFieldKeyword", id: cell.id, name: "BARCODE" } });
    const sendUpdate = () => {
      if (!cb.checked) {
        onRemove();
        return;
      }
      if (!f.barCodeId.trim()) return; // bar-code-ID is required — don't write BARCODE()
      vscode.postMessage({
        type: "edit",
        edit: { kind: "setFieldKeyword", id: cell.id, name: "BARCODE", params: PrtfEngine.buildBarcodeParams(f) },
      });
    };

    const cbId = "barcode-" + cell.id;
    const cb = el("input", { type: "checkbox", id: cbId });
    if (existing) cb.setAttribute("checked", "checked");
    const enableRow = el("div", { class: "prop-row" });
    enableRow.appendChild(el("label", { class: "ind-label", for: cbId }, [cb, " Enable BARCODE"]));
    section.appendChild(enableRow);

    const formWrap = el("div", { style: existing ? "" : "display:none;" });
    cb.addEventListener("change", () => {
      formWrap.style.display = cb.checked ? "" : "none";
      sendUpdate();
    });
    section.appendChild(formWrap);

    // Batch N: mutual-exclusion hint — shown first/most prominently in
    // this panel per docs/TASKS.md Batch N's own instruction to attach
    // this validation to BARCODE's form (Batch C) rather than to whichever
    // OTHER keyword's own panel is the conflicting one (contrast with
    // HIGHLIGHT+CDEFNT/FNTCHRSET, which is instead shown in the FONT
    // panel — see renderFontSizingPanel — since here BARCODE itself, not
    // any one of its several possible conflicting partners, is the
    // natural single place a person editing this field would look).
    (PrtfEngine.validateBarcodeExclusions(cell.keywords) || []).forEach((h) => {
      formWrap.appendChild(el("div", { class: "hint warning" }, [h]));
    });

    const idRow = labeledInput("Bar-code-ID", { type: "text", maxlength: "10", placeholder: "e.g. CODE3OF9, UPCA", value: f.barCodeId });
    idRow.input.addEventListener("change", () => {
      f.barCodeId = idRow.input.value.trim().toUpperCase();
      sendUpdate();
    });
    formWrap.appendChild(idRow.row);

    const heightModeRow = labeledSelect("Height", ["none", "lines", "uom"], f.heightMode);
    formWrap.appendChild(heightModeRow.row);
    const heightValueRow = labeledInput("Height value", {
      type: "number",
      min: f.heightMode === "lines" ? "1" : "0.1",
      max: f.heightMode === "lines" ? "9" : "10",
      step: f.heightMode === "lines" ? "1" : "0.01",
      value: String((f.heightMode === "lines" ? f.heightLines : f.heightValue) || ""),
    });
    heightValueRow.row.style.display = f.heightMode === "none" ? "none" : "";
    formWrap.appendChild(heightValueRow.row);
    heightModeRow.input.addEventListener("change", () => {
      f.heightMode = heightModeRow.input.value;
      heightValueRow.row.style.display = f.heightMode === "none" ? "none" : "";
      heightValueRow.input.min = f.heightMode === "lines" ? "1" : "0.1";
      heightValueRow.input.max = f.heightMode === "lines" ? "9" : "10";
      sendUpdate();
    });
    heightValueRow.input.addEventListener("change", () => {
      const n = Number(heightValueRow.input.value);
      if (f.heightMode === "lines") f.heightLines = n;
      else if (f.heightMode === "uom") f.heightValue = n;
      sendUpdate();
    });

    const dirRow = labeledSelect("Bar format", ["horizontal", "vertical"], f.direction);
    dirRow.input.addEventListener("change", () => {
      f.direction = dirRow.input.value;
      sendUpdate();
    });
    formWrap.appendChild(dirRow.row);

    const hriRow = labeledSelect("HRI position", ["below", "above", "none"], f.hriPosition);
    hriRow.input.addEventListener("change", () => {
      f.hriPosition = hriRow.input.value;
      sendUpdate();
    });
    formWrap.appendChild(hriRow.row);

    const astRow = el("label", { class: "prop-row" }, ["Asterisk (CODE3OF9)"]);
    const astCb = el("input", { type: "checkbox" });
    if (f.asterisk) astCb.setAttribute("checked", "checked");
    astRow.appendChild(astCb);
    astCb.addEventListener("change", () => {
      f.asterisk = astCb.checked;
      sendUpdate();
    });
    formWrap.appendChild(astRow);

    const modRow = labeledInput("Modifier (hex)", { type: "text", maxlength: "2", placeholder: "00-FE", value: f.modifier });
    modRow.input.addEventListener("change", () => {
      f.modifier = modRow.input.value.trim().toUpperCase();
      sendUpdate();
    });
    formWrap.appendChild(modRow.row);

    const widthRow = labeledInput("Narrow bar width (in)", { type: "number", min: "0.007", max: "0.208", step: "0.001", value: f.narrowBarWidth != null ? String(f.narrowBarWidth) : "" });
    widthRow.input.addEventListener("change", () => {
      f.narrowBarWidth = widthRow.input.value === "" ? undefined : Number(widthRow.input.value);
      sendUpdate();
    });
    formWrap.appendChild(widthRow.row);

    const ratioRow = labeledInput("Wide:narrow ratio", { type: "number", min: "2.00", max: "3.00", step: "0.01", value: f.ratio != null ? String(f.ratio) : "" });
    ratioRow.input.addEventListener("change", () => {
      f.ratio = ratioRow.input.value === "" ? undefined : Number(ratioRow.input.value);
      sendUpdate();
    });
    formWrap.appendChild(ratioRow.row);

    const extra2DRow = labeledInput("Additional 2D params", { type: "text", placeholder: "e.g. (*QRCODE 4 1)", value: f.extra2D });
    extra2DRow.input.addEventListener("change", () => {
      f.extra2D = extra2DRow.input.value.trim();
      sendUpdate();
    });
    formWrap.appendChild(extra2DRow.row);

    const hints = PrtfEngine.validateBarcodeParams(f, state.uom);
    hints.forEach((h) => formWrap.appendChild(el("div", { class: "hint warning" }, [h])));

    return section;
  }

  /** Batch A: general field/constant keyword section, appended into the click-a-cell properties panel below the existing Batch G "Data/edit keywords" section (fields) or directly (constants). Applies immediately on change, same UX as the other keyword panels. */
  function renderBatchAKeywordsSection(cell) {
    const section = el("div", {});
    section.appendChild(el("h4", {}, ["General keywords"]));

    const onSet = (name, params) => vscode.postMessage({ type: "edit", edit: { kind: "setFieldKeyword", id: cell.id, name, params } });
    const onRemove = (name) => vscode.postMessage({ type: "edit", edit: { kind: "removeFieldKeyword", id: cell.id, name } });
    const idPrefix = "gfkw-" + cell.id;

    if (cell.kind === "field") {
      appendEdtcdeRow(section, cell.keywords, idPrefix, onSet, onRemove);
      appendKeywordRows(section, BATCH_A_FIELD_ONLY_KEYWORDS, cell.keywords, idPrefix, onSet, onRemove);
    } else {
      appendKeywordRows(section, BATCH_A_CONSTANT_ONLY_KEYWORDS, cell.keywords, idPrefix, onSet, onRemove);
      appendMsgconRow(section, cell.keywords, idPrefix, onSet, onRemove);
    }
    appendKeywordRows(section, BATCH_A_SHARED_KEYWORDS, cell.keywords, idPrefix, onSet, onRemove);
    appendColorRow(section, cell.keywords, idPrefix, onSet, onRemove);

    return section;
  }

  function renderEditPanel(cell, layout) {
    const panel = el("div", { class: "props" });
    panel.appendChild(el("h4", {}, [cell.kind === "field" ? "Field: " + cell.name : "Constant"]));

    let nameInput, litInput, lenInput, typeSelect, decInput, usageSelect;
    let refCheckbox, refFieldInput, refLibInput, refFileInput, useRefValuesCheckbox, refFieldsRow;
    const lineRow = labeledInput("Line", { type: "number", min: "1", value: String(cell.line) });
    const posRow = labeledInput("Position", { type: "number", min: "1", value: String(cell.position) });

    if (cell.kind === "field") {
      const nameRow = labeledInput("Name", { type: "text", maxlength: "10", value: cell.name || "" });
      nameInput = nameRow.input;
      panel.appendChild(nameRow.row);

      const lenRow = labeledInput("Length", { type: "number", min: "1", value: String(cell.length) });
      lenInput = lenRow.input;
      panel.appendChild(lenRow.row);

      const typeRow = labeledSelect("Data type", ["A", "S", "P", "B"], cell.dataType || "A");
      typeSelect = typeRow.input;
      panel.appendChild(typeRow.row);

      const decRow = labeledInput("Decimals", { type: "number", min: "0", value: String(cell.decimalPositions || 0) });
      decInput = decRow.input;
      panel.appendChild(decRow.row);

      const usageRow = labeledSelect("Usage", ["O", "I", "B", "H"], cell.usage || "O");
      usageSelect = usageRow.input;
      panel.appendChild(usageRow.row);

      // Batch H (docs/TASKS.md) — "Reference a field" Y/N + "Use referenced
      // values" Y/N pair (docs/KEYWORD-INVENTORY.md §3): position 29 'R'
      // plus REFFLD's own field/library/file, wired up here without a live
      // database picker (that part needs Code for i — see the "Resolve
      // Referenced Field" button below), same manually-entered-first
      // approach Batch H's task detail calls for.
      const refToggleRow = el("label", { class: "prop-row" }, ["Reference a field"]);
      refCheckbox = el("input", { type: "checkbox" });
      if (cell.reference) refCheckbox.setAttribute("checked", "checked");
      refToggleRow.appendChild(refCheckbox);
      panel.appendChild(refToggleRow);

      const target = cell.refTarget || {};
      refFieldsRow = el("div", { style: cell.reference ? "" : "display:none;" });
      const refFieldRow = labeledInput("Ref. field name", { type: "text", maxlength: "10", value: target.fieldName || cell.name || "" });
      refFieldInput = refFieldRow.input;
      refFieldsRow.appendChild(refFieldRow.row);
      // Batch H "remaining" piece — picks the field (and, if the file has
      // more than one, the record format) from a live list via Code for i
      // instead of typing it blind. Reads the SAME already-saved
      // library/file the "Resolve Referenced Field" button below does
      // (see extension.ts's handleBrowseReferencedField) — save library/
      // file first if they were just typed. Applies immediately on pick,
      // same as "Resolve Referenced Field" — no separate Save click
      // needed for the field name itself.
      // Bug-fix follow-up (same "not connected" state the badge above
      // already reports, just acted on instead of only displayed —
      // mirrors I-SDA's own Task L18 follow-up fix): rather than leaving
      // this visible-but-doomed-to-fail with no live connection, it's
      // hidden outright and replaced with a hint explaining why. Reappears
      // the moment state.codeForI next reports connected: true (on
      // "ready", after any Code-for-i action, or the cheap poll — see
      // extension.ts's sendCodeForIStatus) — no reload needed, since
      // render() rebuilds this panel from state on every codeForIStatus
      // message.
      if (state.codeForI.connected) {
        const browseBtn = el("button", { class: "btn", style: "width:100%;margin-bottom:8px;" }, ["Browse fields… (Code for i)"]);
        browseBtn.addEventListener("click", () => {
          vscode.postMessage({ type: "browseReferencedField", id: cell.id });
        });
        refFieldsRow.appendChild(browseBtn);
      } else {
        refFieldsRow.appendChild(el("div", { class: "hint warning", style: "margin-bottom:8px;" }, ["Browse fields… needs a live Code for i connection (see IBM i status above)."]));
      }
      const refLibRow = labeledInput("Ref. library", { type: "text", maxlength: "10", value: target.library || "" });
      refLibInput = refLibRow.input;
      refFieldsRow.appendChild(refLibRow.row);
      const refFileRow = labeledInput("Ref. file", { type: "text", maxlength: "10", value: target.file || "" });
      refFileInput = refFileRow.input;
      refFieldsRow.appendChild(refFileRow.row);
      const useRefValuesRow = el("label", { class: "prop-row" }, ["Use referenced values"]);
      useRefValuesCheckbox = el("input", { type: "checkbox" });
      useRefValuesCheckbox.setAttribute("checked", "checked"); // default Y, matching real RLU
      useRefValuesRow.appendChild(useRefValuesCheckbox);
      refFieldsRow.appendChild(useRefValuesRow);
      // Same hide-when-disconnected treatment as the "Browse fields…"
      // button above.
      if (state.codeForI.connected) {
        const resolveBtn = el("button", { class: "btn", style: "width:100%;margin-bottom:8px;" }, ["Resolve Referenced Field (Code for i)"]);
        resolveBtn.addEventListener("click", () => {
          vscode.postMessage({
            type: "resolveReferencedField",
            id: cell.id,
            useReferencedValues: useRefValuesCheckbox.checked,
          });
        });
        refFieldsRow.appendChild(resolveBtn);
      } else {
        refFieldsRow.appendChild(el("div", { class: "hint warning", style: "margin-bottom:8px;" }, ["Resolve Referenced Field needs a live Code for i connection (see IBM i status above)."]));
      }
      panel.appendChild(refFieldsRow);

      refCheckbox.addEventListener("change", (e) => {
        refFieldsRow.style.display = e.target.checked ? "" : "none";
      });

      panel.appendChild(renderFieldKeywordsSection(cell));
    } else {
      const litRow = labeledInput("Text", { type: "text", value: cell.literal || "" });
      litInput = litRow.input;
      panel.appendChild(litRow.row);
    }

    panel.appendChild(lineRow.row);
    panel.appendChild(posRow.row);

    if (cell.keywords) {
      panel.appendChild(
        renderFontSizingPanel(
          cell.keywords,
          (name, params) => vscode.postMessage({ type: "edit", edit: { kind: "setFieldKeyword", id: cell.id, name, params } }),
          (name) => vscode.postMessage({ type: "edit", edit: { kind: "removeFieldKeyword", id: cell.id, name } }),
          cell.kind === "field" ? cell.name : "constant"
        )
      );
      panel.appendChild(renderBatchAKeywordsSection(cell));
      panel.appendChild(renderBarcodeSection(cell));
    }

    const btnRow = el("div", { class: "prop-buttons" });
    const saveBtn = el("button", { class: "btn primary" }, ["Save"]);
    saveBtn.addEventListener("click", () => {
      const line = Number(lineRow.input.value) || cell.line;
      const position = Number(posRow.input.value) || cell.position;
      if (cell.kind === "field") {
        vscode.postMessage({
          type: "edit",
          edit: {
            kind: "updateField",
            id: cell.id,
            name: (nameInput.value || cell.name).toUpperCase().slice(0, 10),
            length: Number(lenInput.value) || cell.length,
            dataType: typeSelect.value,
            decimalPositions: typeSelect.value === "A" ? undefined : Number(decInput.value) || 0,
            usage: usageSelect.value,
            line,
            position,
            reference: refCheckbox.checked,
            refFieldName: refFieldInput.value ? refFieldInput.value.toUpperCase().slice(0, 10) : undefined,
            refLibrary: refLibInput.value ? refLibInput.value.toUpperCase().slice(0, 10) : undefined,
            refFile: refFileInput.value ? refFileInput.value.toUpperCase().slice(0, 10) : undefined,
          },
        });
      } else {
        vscode.postMessage({
          type: "edit",
          edit: { kind: "updateConstant", id: cell.id, literal: litInput.value || "", line, position },
        });
      }
    });
    const deleteBtn = el("button", { class: "btn danger" }, ["Delete"]);
    deleteBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "edit", edit: { kind: "delete", id: cell.id } });
      state.selectedId = null;
    });
    // Batch Q (docs/TASKS.md) — copies this field/constant, keywords
    // included, to a new position the person picks by clicking the page
    // (reuses the same "click to place" flow `+ Field`/`+ Constant`
    // already use — see the page click handler in renderPage and
    // buildCopyPendingNew above). Deliberately does NOT touch the model
    // yet: routes through state.pendingNew the same as a plain add, so
    // the person confirms/edits the suggested name (and everything else)
    // before anything is actually written — this is why clicking Copy
    // alone can never mutate or duplicate the source entry by itself.
    const copyBtn = el("button", { class: "btn" }, ["Copy"]);
    copyBtn.addEventListener("click", () => {
      const source = cell;
      clearPendingUiState();
      state.copySource = source;
      state.placing = source.kind;
      render();
    });
    const cancelBtn = el("button", { class: "btn" }, ["Close"]);
    cancelBtn.addEventListener("click", () => {
      state.selectedId = null;
      render();
    });
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(deleteBtn);
    btnRow.appendChild(copyBtn);
    btnRow.appendChild(cancelBtn);
    panel.appendChild(btnRow);
    return panel;
  }

  // Batch F: print/finishing keywords (DUPLEX, FORCE, OUTBIN, ZFOLD,
  // STAPLE, INVMMAP). These don't affect the page-preview layout at all —
  // they're physical-printer behavior — so they get their own small
  // always-visible panel (per record) rather than living in the
  // click-a-cell properties panel used for fields/constants. Each row is a
  // checkbox ("keyword present on this record?") plus, for keywords that
  // take a parameter, an input for its value. Changes are applied
  // immediately (no separate Save button), matching the indicator-toggle
  // UX already used in the toolbar.
  const BATCH_F_KEYWORDS = [
    { name: "DUPLEX", kind: "select", options: ["*NO", "*YES", "*TUMBLE"], hint: "Double-sided printing." },
    { name: "FORCE", kind: "flag", hint: "Forces a new sheet to be fed before this record prints (duplex printing)." },
    { name: "OUTBIN", kind: "text", placeholder: "1-65535 or *DEVD", hint: "Selects an output bin (matches OVRPRTF OUTBIN)." },
    { name: "ZFOLD", kind: "flag", hint: "Z-fold finishing. Requires PSF printing — no effect under Host Print Transform." },
    { name: "STAPLE", kind: "flag", hint: "Staple finishing. Requires PSF printing — no effect under Host Print Transform." },
    { name: "INVMMAP", kind: "text", placeholder: "medium map name", hint: "Invokes a new medium map." },
  ];

  function renderRecordKeywordsPanel(record) {
    const panel = el("div", { class: "props" });
    panel.appendChild(el("h4", {}, ["Print/finishing keywords — " + record.name]));
    panel.appendChild(
      el("div", { class: "hint" }, [
        "These don't change the page preview — they control physical printer behavior (duplexing, output bin, finishing).",
      ])
    );

    const warnings = (PrtfEngine.validateRecordKeywords(record) || []).concat(
      PrtfEngine.validateFileLevelKeywords(state.model) || []
    );
    warnings.forEach((w) => {
      panel.appendChild(el("div", { class: "hint warning" }, [w.message]));
    });

    // No blank option on the "select" keywords here: every one modeled with
    // kind "select" (just DUPLEX today) requires a parameter, so the
    // checkbox alone isn't enough — the dropdown defaults to its first
    // option when nothing's set yet.
    const onSet = (name, params) => vscode.postMessage({ type: "edit", edit: { kind: "setRecordKeyword", recordName: record.name, name, params } });
    const onRemove = (name) => vscode.postMessage({ type: "edit", edit: { kind: "removeRecordKeyword", recordName: record.name, name } });
    appendKeywordRows(panel, BATCH_F_KEYWORDS, record.keywords, "kw-" + record.name, onSet, onRemove);

    return panel;
  }

  // Batch A: general record-level keywords not covered by any other batch's
  // panel. PRTQLTY/DRAWER/PAGRTT values verified against IBM's DDS
  // reference (not just RLU's own screen picklist numbering — e.g. RLU
  // shows "1=Standard" for what's actually PRTQLTY(*STD) underneath).
  // HIGHLIGHT here is the record-level form of the same keyword Batch B's
  // font panel already validates against CDEFNT/FNTCHRSET via
  // validateFontKeywords() — see renderFontSizingPanel, no separate check
  // needed in this panel.
  const BATCH_A_RECORD_KEYWORDS = [
    { name: "PRTQLTY", kind: "select", options: ["*STD", "*DRAFT", "*NLQ", "*FASTDRAFT"], hint: "Print quality: Standard / Draft / Near letter / Fast draft." },
    { name: "DRAWER", kind: "select", options: ["1", "2", "3", "4"], hint: "Forms drawer to select from — which physical drawer each number maps to is printer-specific." },
    { name: "PAGRTT", kind: "select", options: ["0", "90", "180", "270"], hint: "Degrees of page rotation." },
    { name: "HIGHLIGHT", kind: "flag", hint: "Highlighted printing. Ignored if CDEFNT or FNTCHRSET is also coded on this record." },
  ];

  // Batch E (docs/TASKS.md) — the three simple keywords in this batch's
  // scope that fit appendKeywordRows' single-value shape directly:
  // STRPAGGRP's group-name (a quoted character value, or a bare &field),
  // ENDPAGGRP (no params at all), and DTASTMCMD's text (also a quoted
  // character value). OVERLAY/PAGSEG/AFPRSC/DOCIDXTAG each have 2+
  // positional params and get bespoke rows below instead, same split this
  // codebase already uses for COLOR/MSGCON/EDTCDE vs. the simpler
  // Batch A/F/G keywords.
  const BATCH_E_SIMPLE_KEYWORDS = [
    { name: "STRPAGGRP", kind: "quotedText", placeholder: "group name, or &field", hint: "Begins a named logical grouping of pages (for AFP document indexing / PDF bookmarks). Must be matched by an ENDPAGGRP later in the file — groups can't nest or overlap." },
    { name: "ENDPAGGRP", kind: "flag", hint: "Ends the page group most recently started by STRPAGGRP. Ignored if no group is active." },
    { name: "DTASTMCMD", kind: "quotedText", placeholder: "raw AFP data-stream command text, or &field", hint: "Embeds a raw AFP data-stream structured-field command — an escape hatch, not something this tool interprets." },
  ];

  /** Bespoke OVERLAY row (Batch E) — OVERLAY([library/]overlay-name position-down position-across [extra]), name unquoted (object name, not a literal). */
  function appendOverlayRow(container, record, onSet, onRemove) {
    const existing = PrtfEngine.findKeyword(record.keywords, "OVERLAY");
    const f = existing ? PrtfEngine.parseOverlay(existing, 10, 6, state.uom) : { name: "", posDown: "", posAcross: "", extra: "" };

    const rowWrap = el("div", { class: "prop-row" });
    const cbId = "pg-" + record.name + "-OVERLAY";
    const cb = el("input", { type: "checkbox", id: cbId });
    if (existing) cb.setAttribute("checked", "checked");
    rowWrap.appendChild(el("label", { class: "ind-label", for: cbId, title: "Names an AFP overlay resource (e.g. a preprinted form image) placed at a fixed offset on every page of this record format." }, [cb, " OVERLAY"]));
    container.appendChild(rowWrap);

    const nameInp = el("input", { type: "text", placeholder: "[library/]overlay-name, or &field", value: f.name || "" });
    const downInp = el("input", { type: "text", placeholder: "position-down", value: f.posDown || "" });
    const acrossInp = el("input", { type: "text", placeholder: "position-across", value: f.posAcross || "" });
    const extraInp = el("input", { type: "text", placeholder: "extra, e.g. (*ROTATION 90)", value: f.extra || "" });
    [nameInp, downInp, acrossInp, extraInp].forEach((i) => container.appendChild(i));

    const sendUpdate = () => {
      if (!cb.checked) {
        onRemove("OVERLAY");
        return;
      }
      const params = PrtfEngine.buildOverlayParams({ name: nameInp.value, posDown: downInp.value, posAcross: acrossInp.value, extra: extraInp.value });
      if (!params) return;
      onSet("OVERLAY", params);
    };
    cb.addEventListener("change", sendUpdate);
    [nameInp, downInp, acrossInp, extraInp].forEach((i) => i.addEventListener("change", sendUpdate));
  }

  /** Bespoke PAGSEG row (Batch E) — PAGSEG(page-segment-name [vertical-offset horizontal-offset] [extra]), offsets optional as a pair. */
  function appendPagsegRow(container, record, onSet, onRemove) {
    const existing = PrtfEngine.findKeyword(record.keywords, "PAGSEG");
    const f = existing ? PrtfEngine.parsePagseg(existing, 10, 6, state.uom) : { name: "", posDown: "", posAcross: "", extra: "" };

    const rowWrap = el("div", { class: "prop-row" });
    const cbId = "pg-" + record.name + "-PAGSEG";
    const cb = el("input", { type: "checkbox", id: cbId });
    if (existing) cb.setAttribute("checked", "checked");
    rowWrap.appendChild(el("label", { class: "ind-label", for: cbId, title: "Places an AFP page segment (a scanned image resource, e.g. a logo) at a fixed offset on every page of this record format." }, [cb, " PAGSEG"]));
    container.appendChild(rowWrap);

    const nameInp = el("input", { type: "text", placeholder: "[library/]page-segment-name, or &field", value: f.name || "" });
    const downInp = el("input", { type: "text", placeholder: "vertical offset (optional)", value: f.posDown || "" });
    const acrossInp = el("input", { type: "text", placeholder: "horizontal offset (optional)", value: f.posAcross || "" });
    const extraInp = el("input", { type: "text", placeholder: "extra, e.g. (*ROTATION 90)", value: f.extra || "" });
    [nameInp, downInp, acrossInp, extraInp].forEach((i) => container.appendChild(i));

    const sendUpdate = () => {
      if (!cb.checked) {
        onRemove("PAGSEG");
        return;
      }
      const params = PrtfEngine.buildPagsegParams({ name: nameInp.value, posDown: downInp.value, posAcross: acrossInp.value, extra: extraInp.value });
      if (!params) return;
      onSet("PAGSEG", params);
    };
    cb.addEventListener("change", sendUpdate);
    [nameInp, downInp, acrossInp, extraInp].forEach((i) => i.addEventListener("change", sendUpdate));
  }

  /** Bespoke AFPRSC row (Batch E) — AFPRSC('resource-name' object-type position-down position-across [extra]). resource-name IS a quoted character value (unlike OVERLAY/PAGSEG's object names). */
  function appendAfprscRow(container, record, onSet, onRemove) {
    const existing = PrtfEngine.findKeyword(record.keywords, "AFPRSC");
    const f = existing ? PrtfEngine.parseAfprsc(existing, 10, 6, state.uom) : { name: "", objectType: "", posDown: "", posAcross: "", extra: "" };

    const rowWrap = el("div", { class: "prop-row" });
    const cbId = "pg-" + record.name + "-AFPRSC";
    const cb = el("input", { type: "checkbox", id: cbId });
    if (existing) cb.setAttribute("checked", "checked");
    rowWrap.appendChild(el("label", { class: "ind-label", for: cbId, title: "Names an arbitrary AFP or non-AFP resource by IFS path. Cannot be used for fonts, overlays, page segments, or form/page definitions — those go through their own keywords." }, [cb, " AFPRSC"]));
    container.appendChild(rowWrap);

    const nameInp = el("input", { type: "text", placeholder: "resource name, or &field", value: f.name || "" });
    const typeInp = el("input", { type: "text", placeholder: "object type (e.g. *PAGSEG), or &field", value: f.objectType || "" });
    const downInp = el("input", { type: "text", placeholder: "position-down", value: f.posDown || "" });
    const acrossInp = el("input", { type: "text", placeholder: "position-across", value: f.posAcross || "" });
    const extraInp = el("input", { type: "text", placeholder: "extra, e.g. (*SIZE 2 1)", value: f.extra || "" });
    [nameInp, typeInp, downInp, acrossInp, extraInp].forEach((i) => container.appendChild(i));

    const sendUpdate = () => {
      if (!cb.checked) {
        onRemove("AFPRSC");
        return;
      }
      const params = PrtfEngine.buildAfprscParams({ name: nameInp.value, objectType: typeInp.value, posDown: downInp.value, posAcross: acrossInp.value, extra: extraInp.value });
      if (!params) return;
      onSet("AFPRSC", params);
    };
    cb.addEventListener("change", sendUpdate);
    [nameInp, typeInp, downInp, acrossInp, extraInp].forEach((i) => i.addEventListener("change", sendUpdate));
  }

  /** Bespoke DOCIDXTAG row (Batch E) — DOCIDXTAG(attribute-name attribute-value tag-level), tag-level is GROUP or PAGE (unquoted special value). */
  function appendDocidxtagRow(container, record, onSet, onRemove) {
    const existing = PrtfEngine.findKeyword(record.keywords, "DOCIDXTAG");
    const f = existing ? PrtfEngine.parseDocidxtag(existing) : { attributeName: "", attributeValue: "", tagLevel: "" };

    const rowWrap = el("div", { class: "prop-row" });
    const cbId = "pg-" + record.name + "-DOCIDXTAG";
    const cb = el("input", { type: "checkbox", id: cbId });
    if (existing) cb.setAttribute("checked", "checked");
    rowWrap.appendChild(el("label", { class: "ind-label", for: cbId, title: "Attaches a document index tag (name/value pair) to the page group currently active — used by PSF's AFP document indexing for viewers like PDF bookmarks." }, [cb, " DOCIDXTAG"]));
    container.appendChild(rowWrap);

    const nameInp = el("input", { type: "text", placeholder: "attribute name, or &field", value: f.attributeName || "" });
    const valueInp = el("input", { type: "text", placeholder: "attribute value, or &field", value: f.attributeValue || "" });
    const levelSel = el("select", {});
    ["GROUP", "PAGE"].forEach((opt) => {
      const o = el("option", { value: opt }, [opt]);
      if (opt === f.tagLevel) o.setAttribute("selected", "selected");
      levelSel.appendChild(o);
    });
    [nameInp, valueInp, levelSel].forEach((i) => container.appendChild(i));

    const sendUpdate = () => {
      if (!cb.checked) {
        onRemove("DOCIDXTAG");
        return;
      }
      const params = PrtfEngine.buildDocidxtagParams({ attributeName: nameInp.value, attributeValue: valueInp.value, tagLevel: levelSel.value });
      if (!params) return;
      onSet("DOCIDXTAG", params);
    };
    cb.addEventListener("change", sendUpdate);
    [nameInp, valueInp, levelSel].forEach((i) => i.addEventListener("change", sendUpdate));
  }

  /**
   * Batch E (docs/TASKS.md) — AFP page-group / resource keyword panel:
   * OVERLAY, PAGSEG, AFPRSC (rendered as placeholder boxes on the page —
   * see renderPage's `layout.resources` loop), plus STRPAGGRP/ENDPAGGRP/
   * DOCIDXTAG/DTASTMCMD (no page position — summarized as badges instead,
   * from `layout.pageGroupKeywords`).
   *
   * Like every other record-keyword panel in this file, editing here
   * targets the keyword by NAME via setRecordKeyword/removeRecordKeyword
   * (the same generic edit kinds Batch F established) — for a record that
   * codes the same one of these keywords more than once (e.g. two OVERLAYs
   * for front/back), only the first occurrence is reachable from this
   * panel; every occurrence still renders correctly on the page (see
   * prtfLayout.js's resolveResourcePlaceholders, which uses
   * findAllKeywords, not findKeyword) and round-trips correctly whether or
   * not it's ever touched here.
   */
  function renderPageGroupPanel(record, layout) {
    const panel = el("div", { class: "props" });
    panel.appendChild(el("h4", {}, ["AFP page-group / resource keywords — " + record.name]));
    panel.appendChild(
      el("div", { class: "hint" }, [
        "These name external AFP resources (overlays, page segments) or page-grouping metadata — I-RLU can't show their real pixel content without the resource files themselves, so OVERLAY/PAGSEG/AFPRSC render as a labeled placeholder box on the page instead.",
      ])
    );

    const onSet = (name, params) => vscode.postMessage({ type: "edit", edit: { kind: "setRecordKeyword", recordName: record.name, name, params } });
    const onRemove = (name) => vscode.postMessage({ type: "edit", edit: { kind: "removeRecordKeyword", recordName: record.name, name } });

    appendOverlayRow(panel, record, onSet, onRemove);
    appendPagsegRow(panel, record, onSet, onRemove);
    appendAfprscRow(panel, record, onSet, onRemove);
    appendDocidxtagRow(panel, record, onSet, onRemove);
    appendKeywordRows(panel, BATCH_E_SIMPLE_KEYWORDS, record.keywords, "pgs-" + record.name, onSet, onRemove);

    // Batch P: STRPAGGRP/ENDPAGGRP pairing is a property of record ORDER
    // across the whole file (not just this one record's own keywords),
    // since reordering record formats (this batch's own reorderRecord
    // edit) is the most direct way to break it — see
    // PrtfEngine.validatePageGroupOrder's own header for the exact rules.
    // Scoped to warnings naming THIS record, so each affected record's own
    // panel shows only what's relevant to it.
    (PrtfEngine.validatePageGroupOrder(state.model) || [])
      .filter((w) => w.recordName === record.name)
      .forEach((w) => panel.appendChild(el("div", { class: "hint warning" }, [w.message])));

    const badges = (layout && layout.pageGroupKeywords) || [];
    if (badges.length) {
      const badgeList = el("div", { class: "badge-list" });
      badges.forEach((b) => badgeList.appendChild(el("span", { class: "badge", title: b.summary }, [b.keyword])));
      panel.appendChild(el("div", { class: "hint" }, ["On this record now: "]));
      panel.appendChild(badgeList);
    }

    return panel;
  }

  function renderGeneralRecordKeywordsPanel(record) {
    const panel = el("div", { class: "props" });
    panel.appendChild(el("h4", {}, ["General record keywords — " + record.name]));

    // HIGHLIGHT's own conflict warning (vs. CDEFNT/FNTCHRSET) is already
    // shown by the "Font & sizing" panel below (Batch B's
    // validateFontKeywords call) — not duplicated here.

    const onSet = (name, params) => vscode.postMessage({ type: "edit", edit: { kind: "setRecordKeyword", recordName: record.name, name, params } });
    const onRemove = (name) => vscode.postMessage({ type: "edit", edit: { kind: "removeRecordKeyword", recordName: record.name, name } });
    appendKeywordRows(panel, BATCH_A_RECORD_KEYWORDS, record.keywords, "gkw-" + record.name, onSet, onRemove);

    return panel;
  }

  /**
   * Batch G (docs/TASKS.md) — lets the person document what each indicator
   * used in this record means, via record-level INDTXT. Only lists
   * indicators the record actually conditions on (PrtfEngine.
   * collectIndicators), since documenting an indicator nothing references
   * would be a keyword with nothing to explain. Returns null when there
   * are no indicators to document, so render() can skip the panel
   * entirely rather than showing an empty one.
   */
  function renderIndicatorTextPanel(record) {
    const indicators = PrtfEngine.collectIndicators(record);
    if (!indicators.length) return null;

    const panel = el("div", { class: "props" });
    panel.appendChild(el("h4", {}, ["Indicator text (INDTXT) — " + record.name]));
    panel.appendChild(
      el("div", { class: "hint" }, [
        "Documentation only — INDTXT has no effect at compile time. Describes what each indicator means, shown next to its checkbox above.",
      ])
    );

    const descriptions = PrtfEngine.collectIndicatorDescriptions(state.model, record);
    indicators.forEach((ind) => {
      const row = el("div", { class: "prop-row" });
      row.appendChild(el("span", { class: "ind-label" }, [ind]));
      const inp = el("input", { type: "text", value: descriptions[ind] || "", placeholder: "what this indicator means" });
      inp.addEventListener("change", () => {
        const text = inp.value.trim();
        if (text) {
          vscode.postMessage({ type: "edit", edit: { kind: "setIndicatorText", recordName: record.name, indicator: ind, text } });
        } else {
          vscode.postMessage({ type: "edit", edit: { kind: "removeIndicatorText", recordName: record.name, indicator: ind } });
        }
      });
      row.appendChild(inp);
      panel.appendChild(row);
    });

    return panel;
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "setModel") {
      state.model = msg.model;
      if (msg.uom) state.uom = msg.uom;
      if (!state.model.records.find((r) => r.name === state.recordName)) {
        state.recordName = state.model.records[0] ? state.model.records[0].name : null;
      }
      render();
    } else if (msg.type === "codeForIStatus") {
      state.codeForI = { installed: !!msg.installed, connected: !!msg.connected };
      render();
    }
  });

  vscode.postMessage({ type: "ready" });
})();
