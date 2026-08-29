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
 *  - Let the user click a field/constant to select it, and drag it to a
 *    new line/position.
 *  - Post `edit` messages back to the extension host describing what
 *    changed; the host applies them to the real model and re-parses/
 *    re-sends the layout (round trip, same discipline as I-SDA).
 */
(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    model: null,
    recordName: null,
    indicators: {},
    selected: null, // { sourceLineIndex }
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

  function render() {
    const root = document.getElementById("root");
    root.innerHTML = "";
    if (!state.model || state.model.records.length === 0) {
      root.appendChild(el("div", { class: "empty" }, ["No record formats found in this printer file yet."]));
      return;
    }
    if (!state.recordName) state.recordName = state.model.records[0].name;

    // Toolbar: record format switcher + indicator toggles.
    const toolbar = el("div", { class: "toolbar" });
    const select = el("select", { id: "recordSelect" });
    state.model.records.forEach((r) => {
      const opt = el("option", { value: r.name }, [r.name]);
      if (r.name === state.recordName) opt.setAttribute("selected", "selected");
      select.appendChild(opt);
    });
    select.addEventListener("change", (e) => {
      state.recordName = e.target.value;
      render();
    });
    toolbar.appendChild(el("label", {}, ["Record format: ", select]));

    const record = state.model.records.find((r) => r.name === state.recordName);
    const indicators = PrtfEngine.collectIndicators(record);
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
    if (indicators.length) toolbar.appendChild(el("span", { style: "margin-left:16px" }, ["Indicators: ", indPanel]));
    root.appendChild(toolbar);

    const layout = PrtfEngine.resolveLayout(state.model, state.recordName, state.indicators);

    const page = el("div", {
      class: "page",
      style: `position:relative;width:${layout.pageCols * CELL_W}px;height:${Math.min(layout.pageLines, 70) * CELL_H}px;`,
    });

    // Ruler.
    const ruler = el("div", { class: "ruler", style: `width:${layout.pageCols * CELL_W}px;` });
    for (let c = 10; c <= layout.pageCols; c += 10) {
      ruler.appendChild(el("span", { style: `position:absolute;left:${(c - 1) * CELL_W}px;` }, [String(c)]));
    }
    root.appendChild(ruler);

    layout.cells.forEach((cell) => {
      const div = el(
        "div",
        {
          class: "cell" + (cell.hasDraw ? " has-draw" : "") + (cell.kind === "constant" ? " constant" : " field"),
          "data-line": String(cell.line),
          "data-position": String(cell.position),
          style: `position:absolute;left:${(cell.position - 1) * CELL_W}px;top:${(cell.line - 1) * CELL_H}px;width:${
            cell.length * CELL_W
          }px;height:${CELL_H}px;`,
          draggable: "true",
        },
        [cell.kind === "constant" ? cell.text : "{" + cell.name + "}"]
      );
      div.addEventListener("click", () => {
        state.selected = cell;
        vscode.postMessage({ type: "select", cell });
      });
      div.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", JSON.stringify(cell));
      });
      page.appendChild(div);
    });

    page.addEventListener("dragover", (ev) => ev.preventDefault());
    page.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const rect = page.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const newPosition = Math.max(1, Math.round(x / CELL_W) + 1);
      const newLine = Math.max(1, Math.round(y / CELL_H) + 1);
      const dragged = JSON.parse(ev.dataTransfer.getData("text/plain"));
      vscode.postMessage({
        type: "edit",
        edit: {
          kind: "move",
          recordName: state.recordName,
          name: dragged.name,
          text: dragged.text,
          line: dragged.line,
          position: dragged.position,
          newLine,
          newPosition,
        },
      });
    });

    root.appendChild(page);

    if (layout.skippedByIndicator && layout.skippedByIndicator.length) {
      root.appendChild(
        el("div", { class: "note" }, ["Hidden by indicator state: " + layout.skippedByIndicator.join(", ")])
      );
    }
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
