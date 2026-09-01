"use strict";
// Bakes prtfEngine.js + afpFontMetrics.js + media/webviewClient.js + CSS into
// a single self-contained HTML string, written to out/src/webviewTemplate.js
// as a small CommonJS module exporting getWebviewHtml(nonce). Keeping the
// webview to one inlined HTML blob (rather than several files loaded via
// asWebviewUri) avoids CSP/URI-mapping complexity for a fairly small amount
// of client code — same approach I-SDA's README describes for its own
// designer webview.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

// The webview inlines every one of these files into ONE shared global-scope
// <script> tag (no <script type="module">, no bundler — see this file's
// header for why), rather than using Node's require(). Each file below
// still has its own top-level `const mod = {...}; ... window.X = mod;`
// export shape written for require()/CommonJS (see e.g. prtfEngine.js's own
// header) — fine in Node, where each file is its own module scope, but
// NOT fine simply concatenated: every file declaring `const mod` at top
// level in the SAME script tag is a `SyntaxError: Identifier 'mod' has
// already been declared` (this was in fact a latent, never-triggered bug
// in this project before this comment was added — afpFontMetrics.js and
// the old monolithic prtfEngine.js both did this, and nothing ever
// exercised the assembled webview script to catch it; see docs/TASKS.md
// review comment #6, "webviewClient.js has zero test coverage").
//
// Each file is instead wrapped in its own IIFE below (see wrapInIife), so
// its internal `const mod` is scoped to that IIFE alone; the final
// `window.X = mod` line still runs and sets the shared global other
// wrapped files read off `window` (see e.g. prtfLayout.js requiring
// prtfKeywordHelpers.js via `window.PrtfKeywordHelpers`), same as it does
// under Node's require(). List order below MUST still respect dependency
// order (a file can only read a window global that an earlier-listed file
// has already set) — see each file's own header comment for what it needs.
const WEBVIEW_MODULE_FILES = [
  ["src", "afpFontMetrics.js"],
  ["src", "prtfKeywordHelpers.js"],
  ["src", "prtfReferenceField.js"],
  ["src", "prtfKeywordValidation.js"],
  ["src", "prtfLayout.js"],
  ["src", "prtfEngine.js"],
  // Pure keyword-text/pixel-math helpers pulled out of webviewClient.js
  // (review comment #6) so they're unit testable — see prtfWebviewLogic.js's
  // own header for why. Only depends on prtfKeywordHelpers.js (isFieldRef).
  ["src", "prtfWebviewLogic.js"],
];

function wrapInIife(source) {
  return "(function () {\n" + source + "\n})();\n";
}

const inlinedModulesJs = WEBVIEW_MODULE_FILES.map(([dir, file]) =>
  wrapInIife(fs.readFileSync(path.join(root, dir, file), "utf8"))
).join("\n");

// webviewClient.js is NOT one of the above — it's already self-wrapped in
// its own top-level `(function () { ... })();` IIFE (see its own header),
// and it's the one file that's meant to run its top-level side effects
// (acquireVsCodeApi(), the initial render()) immediately when the webview
// loads, so it's kept last and separate rather than folded into the
// dependency-module list above.
const clientJs = fs.readFileSync(path.join(root, "media", "webviewClient.js"), "utf8");

const css = `
body { font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); margin: 0; padding: 8px; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; flex-wrap: wrap; }
.indicators { display: inline-flex; gap: 8px; flex-wrap: wrap; }
.indicators-wrap { display: inline-flex; align-items: center; gap: 4px; }
.ind-label { display: inline-flex; align-items: center; gap: 2px; font-size: 11px; }
.ind-text { color: var(--vscode-descriptionForeground); font-style: italic; }
.hint { font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic; }
.hint.warning { color: var(--vscode-inputValidation-warningForeground, #b89500); font-style: normal; margin: 4px 0; }
.main { display: flex; flex-direction: column; }
.ruler { position: relative; height: 14px; font-size: 9px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 2px; }
.page { border: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background, #fff); overflow: auto; }
.cell { font-family: monospace; font-size: 12px; line-height: 18px; white-space: pre; overflow: hidden; border: 1px dashed transparent; cursor: grab; box-sizing: border-box; }
.cell.field { color: var(--vscode-charts-blue, #4daafc); border-color: rgba(77,170,252,0.4); }
.cell.constant { color: var(--vscode-editor-foreground); }
.cell:hover { border-color: var(--vscode-focusBorder); }
.cell.selected { border: 1px solid var(--vscode-focusBorder); background: rgba(77,170,252,0.15); }
.draw-line { background: var(--vscode-charts-orange, orange); }
.draw-box { border: 1px solid var(--vscode-charts-orange, orange); box-sizing: border-box; }
.draw-line.approximate, .draw-box.approximate { opacity: 0.5; border-style: dashed; }
.cell.barcode { background: repeating-linear-gradient(90deg, var(--vscode-charts-purple, #b180d7) 0 2px, transparent 2px 5px); border: 1px solid var(--vscode-charts-purple, #b180d7); display: flex; align-items: flex-end; justify-content: center; }
.barcode-label { background: var(--vscode-editor-background); font-size: 9px; padding: 0 2px; }
.empty, .note { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 8px; }
.btn { font-size: 11px; padding: 3px 8px; background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #fff); border: none; border-radius: 2px; cursor: pointer; }
.btn:hover { opacity: 0.85; }
.btn.active { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); }
.btn.primary { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); }
.btn.danger { background: var(--vscode-inputValidation-errorBackground, #a1260d); color: #fff; }
.props { margin-top: 10px; padding: 8px 10px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; max-width: 320px; background: var(--vscode-editorWidget-background); }
.props h4 { margin: 0 0 8px 0; font-size: 12px; }
.prop-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px; margin-bottom: 6px; }
.prop-row input, .prop-row select { width: 140px; font-size: 11px; }
.pfield-row { flex-wrap: wrap; }
.pfield-label { flex: 1 1 auto; min-width: 90px; }
.pfield-row input { width: 100px; }
.pfield-toggle { font-size: 10px; padding: 2px 6px; }
.prop-buttons { display: flex; gap: 6px; margin-top: 8px; }
`;

const outDir = path.join(root, "out", "src");
fs.mkdirSync(outDir, { recursive: true });
// Write the generated module with everything the function body needs
// (engineJs/fontMetricsJs/clientJs/css) embedded as JSON-escaped constants
// in its own scope, rather than relying on getWebviewHtml.toString() (which
// would lose the closure over those outer variables).
const generated =
  "'use strict';\n" +
  "const inlinedModulesJs = " + JSON.stringify(inlinedModulesJs) + ";\n" +
  "const clientJs = " + JSON.stringify(clientJs) + ";\n" +
  "const css = " + JSON.stringify(css) + ";\n" +
  "function getWebviewHtml(nonce) {\n" +
  "  return `<!DOCTYPE html>\n" +
  "<html lang=\"en\">\n" +
  "<head>\n" +
  "<meta charset=\"UTF-8\">\n" +
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';\">\n" +
  "<style>${css}</style>\n" +
  "</head>\n" +
  "<body>\n" +
  "<div id=\"root\"></div>\n" +
  "<script nonce=\"${nonce}\">\n" +
  "${inlinedModulesJs}\n${clientJs}\n" +
  "</script>\n" +
  "</body>\n" +
  "</html>`;\n" +
  "}\n" +
  "module.exports = { getWebviewHtml };\n";
fs.writeFileSync(path.join(outDir, "webviewTemplate.js"), generated);

console.log("Wrote", path.join(outDir, "webviewTemplate.js"));
