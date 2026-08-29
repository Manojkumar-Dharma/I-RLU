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
 */
(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    model: null,
    recordName: null,
    indicators: {},
    selectedId: null, // id of the currently selected cell, if any
    placing: null, // null | "field" | "constant" — armed "click to place" mode
    pendingNew: null, // { kind, line, position } — set right after a placement click, before Save
  };

  const CELL_W = 8; // px per character column, monospace grid
  const CELL_H = 18; // px per line row

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
    return PrtfEngine.resolveLayout(state.model, state.recordName, state.indicators);
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
    const main = el("div", { class: "main" });
    main.appendChild(renderRuler(layout));
    main.appendChild(renderPage(layout));
    root.appendChild(main);

    const panel = renderPropsPanel(layout);
    if (panel) root.appendChild(panel);

    if (layout.skippedByIndicator && layout.skippedByIndicator.length) {
      root.appendChild(
        el("div", { class: "note" }, ["Hidden by indicator state: " + layout.skippedByIndicator.join(", ")])
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
      const indPanel = el("span", { class: "indicators" });
      indicators.forEach((ind) => {
        const id = "ind-" + ind;
        const cb = el("input", { type: "checkbox", id });
        if (state.indicators[ind]) cb.setAttribute("checked", "checked");
        cb.addEventListener("change", (e) => {
          state.indicators[ind] = e.target.checked;
          render();
        });
        indPanel.appendChild(el("label", { class: "ind-label", for: id }, [cb, " " + ind]));
      });
      toolbar.appendChild(el("span", { class: "indicators-wrap" }, ["Indicators: ", indPanel]));
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
      const div = el(
        "div",
        {
          class:
            "cell" +
            (cell.hasDraw ? " has-draw" : "") +
            (cell.kind === "constant" ? " constant" : " field") +
            (cell.id === state.selectedId ? " selected" : ""),
          style: `position:absolute;left:${(cell.position - 1) * CELL_W}px;top:${(cell.line - 1) * CELL_H}px;width:${
            cell.length * CELL_W
          }px;height:${CELL_H}px;`,
          draggable: "true",
        },
        [cell.kind === "constant" ? cell.text : "{" + cell.name + "}"]
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

  function renderEditPanel(cell) {
    const panel = el("div", { class: "props" });
    panel.appendChild(el("h4", {}, [cell.kind === "field" ? "Field: " + cell.name : "Constant"]));

    let nameInput, litInput, lenInput, typeSelect, decInput, usageSelect;
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
    } else {
      const litRow = labeledInput("Text", { type: "text", value: cell.literal || "" });
      litInput = litRow.input;
      panel.appendChild(litRow.row);
    }

    panel.appendChild(lineRow.row);
    panel.appendChild(posRow.row);

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

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "setModel") {
      state.model = msg.model;
      if (!state.model.records.find((r) => r.name === state.recordName)) {
        state.recordName = state.model.records[0] ? state.model.records[0].name : null;
      }
      render();
    }
  });

  vscode.postMessage({ type: "ready" });
})();
