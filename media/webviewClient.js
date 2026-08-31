"use strict";
/**
 * Runs inside the webview. Relies on PrtfEngine and AfpFontMetrics being
 * present as globals (inlined ahead of this script by buildWebviewTemplate.js)
 * and on `vscode` being the value of `acquireVsCodeApi()`.
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
 * apply.
 */
(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    model: null,
    recordName: null,
    indicators: {},
    uom: "inch", // set from the extension host's i-rlu.unitOfMeasure setting; see setModel handler
    selectedId: null, // id of the currently selected cell, if any
    placing: null, // null | "field" | "constant" — armed "click to place" mode
    pendingNew: null, // { kind, line, position } — set right after a placement click, before Save
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

  function render() {
    const root = document.getElementById("root");
    root.innerHTML = "";
    if (!state.model || state.model.records.length === 0) {
      root.appendChild(el("div", { class: "empty" }, ["No record formats found in this printer file yet."]));
      return;
    }
    if (!state.recordName) state.recordName = state.model.records[0].name;

    root.appendChild(renderToolbar());

    const layout = currentLayout();
    if (layout.grid) {
      CELL_W = layout.grid.cellWidthPx;
      CELL_H = layout.grid.cellHeightPx;
    }
    const main = el("div", { class: "main" });
    main.appendChild(renderRuler(layout));
    main.appendChild(renderPage(layout));
    root.appendChild(main);

    const panel = renderPropsPanel(layout);
    if (panel) root.appendChild(panel);

    const record = state.model.records.find((r) => r.name === state.recordName);
    root.appendChild(renderRecordKeywordsPanel(record));
    root.appendChild(renderGeneralRecordKeywordsPanel(record));
    const indTextPanel = renderIndicatorTextPanel(record);
    if (indTextPanel) root.appendChild(indTextPanel);
    root.appendChild(
      renderFontSizingPanel(
        record.keywords,
        (name, params) => vscode.postMessage({ type: "edit", edit: { kind: "setRecordKeyword", recordName: record.name, name, params } }),
        (name) => vscode.postMessage({ type: "edit", edit: { kind: "removeRecordKeyword", recordName: record.name, name } }),
        record.name + " (record)"
      )
    );

    if (layout.skippedByIndicator && layout.skippedByIndicator.length) {
      root.appendChild(
        el("div", { class: "note" }, ["Hidden by indicator state: " + layout.skippedByIndicator.join(", ")])
      );
    }
    if ((layout.draws || []).some((d) => d.approximate)) {
      root.appendChild(
        el("div", { class: "note" }, [
          "One or more LINE/BOX positions depend on a program-to-system field and are shown at their default position — actual placement is set at print time.",
        ])
      );
    }
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
      state.selectedId = null;
      state.pendingNew = null;
      render();
    });
    toolbar.appendChild(el("label", {}, ["Record: ", select]));

    const addFieldBtn = el(
      "button",
      { class: "btn" + (state.placing === "field" ? " active" : "") },
      ["+ Field"]
    );
    addFieldBtn.addEventListener("click", () => {
      state.placing = state.placing === "field" ? null : "field";
      state.pendingNew = null;
      state.selectedId = null;
      render();
    });
    const addConstBtn = el(
      "button",
      { class: "btn" + (state.placing === "constant" ? " active" : "") },
      ["+ Constant"]
    );
    addConstBtn.addEventListener("click", () => {
      state.placing = state.placing === "constant" ? null : "constant";
      state.pendingNew = null;
      state.selectedId = null;
      render();
    });
    toolbar.appendChild(addFieldBtn);
    toolbar.appendChild(addConstBtn);
    if (state.placing) {
      toolbar.appendChild(el("span", { class: "hint" }, ["Click on the page to place the new " + state.placing + "."]));
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
    return {
      position: Math.max(1, Math.round(x / CELL_W) + 1),
      line: Math.max(1, Math.round(y / CELL_H) + 1),
    };
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
      const fontCss = cell.font
        ? `font-family:${cell.font.family};` +
          (cell.font.weight ? `font-weight:${cell.font.weight};` : "") +
          (cell.font.style ? `font-style:${cell.font.style};` : "")
        : "";
      const fontTitle =
        cell.font && !cell.barcode
          ? "Font: " +
            cell.font.name +
            " (FGID " +
            cell.font.fgid +
            ", " +
            cell.font.spacing +
            ")" +
            (cell.font.isPlaceholderMetrics ? " — proportional widths are an approximation, not verified font metrics." : "") +
            (cell.font.approximate ? " Font is set by a program-to-system field; shown using the default font." : "")
          : "";
      const div = el(
        "div",
        {
          class:
            "cell" +
            (cell.kind === "constant" ? " constant" : " field") +
            (cell.barcode ? " barcode" : "") +
            (cell.id === state.selectedId ? " selected" : ""),
          style: `position:absolute;left:${(cell.position - 1) * CELL_W}px;top:${(cell.line - 1) * CELL_H}px;width:${w}px;height:${h}px;${fontCss}`,
          title: cell.barcode
            ? "Barcode placeholder — " +
              cell.barcode.barCodeId +
              " (" +
              cell.barcode.direction +
              "). Actual bar symbol not rendered." +
              (cell.barcode.approximateHeight ? " Height shown is a default estimate." : "")
            : fontTitle,
          draggable: "true",
        },
        cell.barcode
          ? [el("span", { class: "barcode-label" }, [cell.barcode.barCodeId || "BARCODE"])]
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

    page.addEventListener("click", (ev) => {
      if (state.placing) {
        const { line, position } = lineColFromEvent(ev, page);
        state.pendingNew = { kind: state.placing, line, position };
        state.placing = null;
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
  function tokenToPField(tok) {
    if (!tok) return { isPField: false, value: "" };
    if (PrtfEngine.isFieldRef(tok)) return { isPField: true, value: tok.slice(1) };
    return { isPField: false, value: tok };
  }

  /**
   * Parses an existing FONT/CDEFNT/FNTCHRSET/FONTNAME/CHRID keyword's raw
   * params into per-param values plus an optional trailing
   * "(*POINTSIZE height [width])" block, per spec.params' order. IBM's DDS
   * reference places *POINTSIZE last, after all name/library params, for
   * every keyword that supports it — this assumes that documented order
   * rather than trying to parse an arbitrary interleaving.
   */
  function parseFontSpecKeyword(spec, existingKw) {
    const raw = existingKw ? String(existingKw.params || "").replace(/^\(/, "").replace(/\)$/, "").trim() : "";
    let plainPart = raw;
    let height = null;
    let width = null;
    if (spec.pointSize) {
      const m = raw.match(/\(\s*\*POINTSIZE\s+(\S+?)(?:\s+(\S+?))?\s*\)\s*$/i);
      if (m) {
        height = m[1];
        width = m[2] || null;
        plainPart = raw.slice(0, m.index).trim();
      }
    }
    const tokens = plainPart === "" ? [] : plainPart.split(/\s+/);
    const values = spec.params.map((_p, i) => tokenToPField(tokens[i]));
    return { values, height: tokenToPField(height), width: tokenToPField(width) };
  }

  /** Builds a keyword's params text ("(...)") from its param rows and optional pointsize rows. Returns null if the mandatory first param is empty (meaning: don't write this keyword). */
  function buildFontSpecParams(spec, paramRows, heightRow, widthRow) {
    const vals = paramRows.map((r) => r.getValue());
    if (!vals[0]) return null;
    // Trim trailing empty *optional* params so e.g. an omitted library
    // doesn't leave a stray blank positional slot.
    while (vals.length > 1 && !vals[vals.length - 1] && spec.params[vals.length - 1] && spec.params[vals.length - 1].optional) {
      vals.pop();
    }
    let inner = vals.join(" ").replace(/\s+$/, "");
    if (spec.pointSize) {
      const h = heightRow.getValue();
      const w = widthRow.getValue();
      if (h) inner += (inner ? " " : "") + "(*POINTSIZE " + h + (w ? " " + w : "") + ")";
    }
    return "(" + inner + ")";
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
      params: [{ key: "name", label: "Font resource name" }],
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
      if (cell) return renderEditPanel(cell);
    }
    return null;
  }

  function renderNewEntryPanel(pending) {
    const panel = el("div", { class: "props" });
    panel.appendChild(el("h4", {}, ["New " + pending.kind + " at line " + pending.line + ", position " + pending.position]));

    let nameInput, litInput, lenInput, typeSelect, decInput, usageSelect;

    if (pending.kind === "field") {
      const nameRow = labeledInput("Name", { type: "text", maxlength: "10" });
      nameInput = nameRow.input;
      panel.appendChild(nameRow.row);

      const lenRow = labeledInput("Length", { type: "number", min: "1", value: "10" });
      lenInput = lenRow.input;
      panel.appendChild(lenRow.row);

      const typeRow = labeledSelect("Data type", ["A", "S", "P", "B"], "A");
      typeSelect = typeRow.input;
      panel.appendChild(typeRow.row);

      const decRow = labeledInput("Decimals", { type: "number", min: "0", value: "0" });
      decInput = decRow.input;
      panel.appendChild(decRow.row);

      const usageRow = labeledSelect("Usage", ["O", "I", "B", "H"], "O");
      usageSelect = usageRow.input;
      panel.appendChild(usageRow.row);
    } else {
      const litRow = labeledInput("Text", { type: "text" });
      litInput = litRow.input;
      panel.appendChild(litRow.row);
    }

    const btnRow = el("div", { class: "prop-buttons" });
    const saveBtn = el("button", { class: "btn primary" }, ["Add"]);
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
    { name: "ALIAS", kind: "text", placeholder: "alt. field name", hint: "Alternative name for the field — a second name HLL programs can reference it by." },
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

    BATCH_G_FIELD_KEYWORDS.forEach((def) => {
      const existing = PrtfEngine.findKeyword(cell.keywords, def.name);
      const rowWrap = el("div", { class: "prop-row" });

      const cbId = "fkw-" + cell.id + "-" + def.name;
      const cb = el("input", { type: "checkbox", id: cbId });
      if (existing) cb.setAttribute("checked", "checked");
      rowWrap.appendChild(el("label", { class: "ind-label", for: cbId, title: def.hint }, [cb, " " + def.name]));

      let valueInput = null;
      if (def.kind === "select") {
        const sel = el("select", {});
        def.options.forEach((opt) => {
          const o = el("option", { value: opt }, [opt]);
          if (opt === paramsInnerText(existing)) o.setAttribute("selected", "selected");
          sel.appendChild(o);
        });
        valueInput = sel;
        rowWrap.appendChild(sel);
      } else if (def.kind === "text") {
        const inp = el("input", { type: "text", maxlength: "10", placeholder: def.placeholder, value: paramsInnerText(existing) });
        valueInput = inp;
        rowWrap.appendChild(inp);
      }

      const sendUpdate = () => {
        if (!cb.checked) {
          vscode.postMessage({ type: "edit", edit: { kind: "removeFieldKeyword", id: cell.id, name: def.name } });
          return;
        }
        // ALIAS requires a real value — an empty text box would otherwise
        // write a bare "ALIAS()", which isn't valid DDS. Leave the box
        // checked but don't send anything until there's a value.
        if (def.kind === "text" && valueInput && !valueInput.value.trim()) return;
        vscode.postMessage({
          type: "edit",
          edit: {
            kind: "setFieldKeyword",
            id: cell.id,
            name: def.name,
            params: valueInput ? paramsToText(def.kind, valueInput.value.toUpperCase()) : "",
          },
        });
      };

      cb.addEventListener("change", sendUpdate);
      if (valueInput) valueInput.addEventListener("change", sendUpdate);

      section.appendChild(rowWrap);
    });

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

  /** Appends one prop-row per keyword definition into an existing container — shared by the general-record-keywords panel above and the field/constant section below. Handles the "flag"/"select"/"quotedSelect"/"quotedText" kinds; EDTCDE/MSGCON/COLOR are bespoke (appended separately) since their shape doesn't fit a single value input. */
  function appendBatchAKeywordRows(container, keywordDefs, entryKeywords, idPrefix, onSet, onRemove) {
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
      } else if (def.kind === "quotedText") {
        const inp = el("input", { type: "text", placeholder: def.placeholder || "", value: paramsInnerText(existing, def.kind) });
        valueInput = inp;
        rowWrap.appendChild(inp);
      }

      const sendUpdate = () => {
        if (!cb.checked) {
          onRemove(def.name);
          return;
        }
        if (def.kind === "quotedText" && valueInput && !valueInput.value.trim()) return;
        onSet(def.name, valueInput ? paramsToText(def.kind, valueInput.value) : "");
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

  /** Batch A: general field/constant keyword section, appended into the click-a-cell properties panel below the existing Batch G "Data/edit keywords" section (fields) or directly (constants). Applies immediately on change, same UX as the other keyword panels. */
  function renderBatchAKeywordsSection(cell) {
    const section = el("div", {});
    section.appendChild(el("h4", {}, ["General keywords"]));

    const onSet = (name, params) => vscode.postMessage({ type: "edit", edit: { kind: "setFieldKeyword", id: cell.id, name, params } });
    const onRemove = (name) => vscode.postMessage({ type: "edit", edit: { kind: "removeFieldKeyword", id: cell.id, name } });
    const idPrefix = "gfkw-" + cell.id;

    if (cell.kind === "field") {
      appendEdtcdeRow(section, cell.keywords, idPrefix, onSet, onRemove);
      appendBatchAKeywordRows(section, BATCH_A_FIELD_ONLY_KEYWORDS, cell.keywords, idPrefix, onSet, onRemove);
    } else {
      appendBatchAKeywordRows(section, BATCH_A_CONSTANT_ONLY_KEYWORDS, cell.keywords, idPrefix, onSet, onRemove);
      appendMsgconRow(section, cell.keywords, idPrefix, onSet, onRemove);
    }
    appendBatchAKeywordRows(section, BATCH_A_SHARED_KEYWORDS, cell.keywords, idPrefix, onSet, onRemove);
    appendColorRow(section, cell.keywords, idPrefix, onSet, onRemove);

    return section;
  }

  function renderEditPanel(cell) {
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
      const resolveBtn = el("button", { class: "btn", style: "width:100%;margin-bottom:8px;" }, ["Resolve Referenced Field (Code for i)"]);
      resolveBtn.addEventListener("click", () => {
        vscode.postMessage({
          type: "resolveReferencedField",
          id: cell.id,
          useReferencedValues: useRefValuesCheckbox.checked,
        });
      });
      refFieldsRow.appendChild(resolveBtn);
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
    const cancelBtn = el("button", { class: "btn" }, ["Close"]);
    cancelBtn.addEventListener("click", () => {
      state.selectedId = null;
      render();
    });
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(deleteBtn);
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

  function paramsToText(kind, value) {
    if (kind === "flag") return "";
    const v = (value || "").trim();
    if (!v) return "";
    // Batch A: quotedText always DDS-quotes its value (e.g. EDTWRD, DFT).
    // quotedSelect quotes everything except a "*"-prefixed special value
    // (e.g. DATSEP('-') vs. DATSEP(*JOB)) — see KEYWORD-INVENTORY §3 and
    // IBM's DDS reference, which documents *JOB as a bare special value
    // distinct from a literal separator character.
    if (kind === "quotedText") return "('" + v.replace(/'/g, "''") + "')";
    if (kind === "quotedSelect") return v.startsWith("*") ? "(" + v + ")" : "('" + v.replace(/'/g, "''") + "')";
    return "(" + v + ")";
  }

  /** Strips the surrounding parentheses (and, for the Batch A quoted kinds, the DDS quote pair) from a Keyword's raw params (e.g. "(*YES)" -> "*YES"), for populating an edit input from the current model. `kind` defaults to plain/unquoted for call sites that predate the quoted kinds. */
  function paramsInnerText(kw, kind) {
    if (!kw) return "";
    let inner = String(kw.params || "").replace(/^\(/, "").replace(/\)$/, "").trim();
    if ((kind === "quotedText" || kind === "quotedSelect") && inner.length >= 2 && inner[0] === "'" && inner[inner.length - 1] === "'") {
      inner = inner.slice(1, -1).replace(/''/g, "'");
    }
    return inner;
  }

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

    BATCH_F_KEYWORDS.forEach((def) => {
      const existing = PrtfEngine.findKeyword(record.keywords, def.name);
      const rowWrap = el("div", { class: "prop-row" });

      const cbId = "kw-" + record.name + "-" + def.name;
      const cb = el("input", { type: "checkbox", id: cbId });
      if (existing) cb.setAttribute("checked", "checked");
      rowWrap.appendChild(el("label", { class: "ind-label", for: cbId, title: def.hint }, [cb, " " + def.name]));

      let valueInput = null;
      if (def.kind === "select") {
        // No blank option: every keyword modeled with kind "select" (just
        // DUPLEX today) requires a parameter, so the checkbox alone isn't
        // enough — default to the first choice when nothing's set yet.
        const sel = el("select", {});
        def.options.forEach((opt) => {
          const o = el("option", { value: opt }, [opt]);
          if (opt === paramsInnerText(existing)) o.setAttribute("selected", "selected");
          sel.appendChild(o);
        });
        valueInput = sel;
        rowWrap.appendChild(sel);
      } else if (def.kind === "text") {
        const inp = el("input", { type: "text", placeholder: def.placeholder, value: paramsInnerText(existing) });
        valueInput = inp;
        rowWrap.appendChild(inp);
      }

      const sendUpdate = () => {
        if (!cb.checked) {
          vscode.postMessage({ type: "edit", edit: { kind: "removeRecordKeyword", recordName: record.name, name: def.name } });
          return;
        }
        // OUTBIN/INVMMAP require a real value — an empty text box would
        // otherwise write a bare "OUTBIN"/"INVMMAP" with no params, which
        // isn't valid DDS for either keyword. Leave the box checked but
        // don't send anything until there's a value to write.
        if (def.kind === "text" && valueInput && !valueInput.value.trim()) return;
        vscode.postMessage({
          type: "edit",
          edit: {
            kind: "setRecordKeyword",
            recordName: record.name,
            name: def.name,
            params: valueInput ? paramsToText(def.kind, valueInput.value) : "",
          },
        });
      };

      cb.addEventListener("change", sendUpdate);
      if (valueInput) valueInput.addEventListener("change", sendUpdate);

      panel.appendChild(rowWrap);
    });

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

  function renderGeneralRecordKeywordsPanel(record) {
    const panel = el("div", { class: "props" });
    panel.appendChild(el("h4", {}, ["General record keywords — " + record.name]));

    // HIGHLIGHT's own conflict warning (vs. CDEFNT/FNTCHRSET) is already
    // shown by the "Font & sizing" panel below (Batch B's
    // validateFontKeywords call) — not duplicated here.

    BATCH_A_RECORD_KEYWORDS.forEach((def) => {
      const existing = PrtfEngine.findKeyword(record.keywords, def.name);
      const rowWrap = el("div", { class: "prop-row" });

      const cbId = "gkw-" + record.name + "-" + def.name;
      const cb = el("input", { type: "checkbox", id: cbId });
      if (existing) cb.setAttribute("checked", "checked");
      rowWrap.appendChild(el("label", { class: "ind-label", for: cbId, title: def.hint }, [cb, " " + def.name]));

      let valueInput = null;
      if (def.kind === "select") {
        const sel = el("select", {});
        def.options.forEach((opt) => {
          const o = el("option", { value: opt }, [opt]);
          if (opt === paramsInnerText(existing)) o.setAttribute("selected", "selected");
          sel.appendChild(o);
        });
        valueInput = sel;
        rowWrap.appendChild(sel);
      }

      const sendUpdate = () => {
        if (!cb.checked) {
          vscode.postMessage({ type: "edit", edit: { kind: "removeRecordKeyword", recordName: record.name, name: def.name } });
          return;
        }
        vscode.postMessage({
          type: "edit",
          edit: {
            kind: "setRecordKeyword",
            recordName: record.name,
            name: def.name,
            params: valueInput ? paramsToText(def.kind, valueInput.value) : "",
          },
        });
      };

      cb.addEventListener("change", sendUpdate);
      if (valueInput) valueInput.addEventListener("change", sendUpdate);

      panel.appendChild(rowWrap);
    });

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
    }
  });

  vscode.postMessage({ type: "ready" });
})();
