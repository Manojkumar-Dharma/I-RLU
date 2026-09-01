// Regression coverage for a real bug found while working on review comment
// #6 (docs/TASKS.md — "webviewClient.js has zero test coverage"): the
// webview inlines afpFontMetrics.js, every prtfEngine.js split-out module,
// and webviewClient.js into ONE shared global-scope <script> tag (see
// src/buildWebviewTemplate.js). Both afpFontMetrics.js and the old
// monolithic prtfEngine.js independently declared `const mod = {...}` at
// their own top level — fine as separate CommonJS modules under Node's
// require(), but a `SyntaxError: Identifier 'mod' has already been
// declared` once literally concatenated into one script scope. That bug
// pre-dated this test and was never caught, because nothing ever actually
// loaded/executed the assembled webview script — exactly the coverage gap
// review comment #6 flagged. buildWebviewTemplate.js now wraps each
// inlined module in its own IIFE to fix this (see its own comments); this
// test locks that in by actually running the assembled script in a
// vm context, not just reading the source.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getWebviewHtml } = require("../src/webviewTemplate.js");

function extractInlineScript(html: string): string {
  const m = html.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("getWebviewHtml() output has no inline <script> tag to extract");
  return m[1];
}

/**
 * Runs the assembled webview script in a real vm context with `window` as
 * the global object (mirroring a browser, where `window` and the top-level
 * scope are the same object) and no `module`/`require` in scope (mirroring
 * a browser, where those are undefined) — so every file's own
 * `typeof module !== "undefined" ? require(...) : window.X` fallback takes
 * the same branch it would in the real webview, not the Node branch a
 * plain `eval()` from a CommonJS test file would incorrectly trigger.
 */
function runAssembledWebviewScript(scriptSource: string) {
  const sandbox: any = {};
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.document = {
    getElementById: () => ({ innerHTML: "", appendChild() {}, addEventListener() {} }),
    createElement: () => ({ setAttribute() {}, appendChild() {}, style: {}, addEventListener() {}, classList: { add() {}, remove() {} } }),
    createTextNode: () => ({}),
  };
  sandbox.acquireVsCodeApi = () => ({ postMessage: () => {}, setState: () => {}, getState: () => undefined });
  vm.createContext(sandbox);
  vm.runInContext(scriptSource, sandbox, { filename: "webview-inline-script.js" });
  return sandbox;
}

test("webview assembly: the generated HTML contains exactly one inline <script> tag", () => {
  const html = getWebviewHtml("testnonce");
  const matches = html.match(/<script nonce="[^"]*">/g) || [];
  assert.equal(matches.length, 1);
});

test("webview assembly: the assembled inline script is syntactically valid JavaScript", () => {
  const html = getWebviewHtml("testnonce");
  const script = extractInlineScript(html);
  // new vm.Script throws a SyntaxError immediately for invalid source,
  // without needing to actually run it — this alone would have caught the
  // 'const mod' redeclaration bug this test file is guarding against.
  assert.doesNotThrow(() => new vm.Script(script, { filename: "webview-inline-script.js" }));
});

test("webview assembly: the assembled script executes end-to-end and wires up every expected global", () => {
  const html = getWebviewHtml("testnonce");
  const script = extractInlineScript(html);
  const sandbox = runAssembledWebviewScript(script);
  for (const name of ["AfpFontMetrics", "PrtfKeywordHelpers", "PrtfReferenceField", "PrtfKeywordValidation", "PrtfLayout", "PrtfEngine", "PrtfWebviewLogic"]) {
    assert.equal(typeof sandbox[name], "object", `window.${name} was not set by the assembled script`);
  }
});

test("webview assembly: cross-module calls actually work through the assembled global chain (not just present, but functional)", () => {
  const html = getWebviewHtml("testnonce");
  const script = extractInlineScript(html);
  const sandbox = runAssembledWebviewScript(script);
  // PrtfEngine.isFieldRef is prtfLayout.js's re-export of
  // prtfKeywordHelpers.js's isFieldRef — exercising it proves prtfLayout.js
  // successfully read window.PrtfKeywordHelpers set by an earlier module.
  assert.equal(sandbox.PrtfEngine.isFieldRef("&FOO"), true);
  assert.equal(sandbox.PrtfEngine.isFieldRef("FOO"), false);
  // PrtfWebviewLogic.tokenToPField depends on the same
  // window.PrtfKeywordHelpers.isFieldRef, via a different module. Compared
  // via JSON (not assert.deepEqual) because objects constructed inside a
  // vm context are a different realm than this test's own objects, and
  // Node's strict deepEqual treats cross-realm objects as unequal even
  // when structurally identical.
  assert.equal(JSON.stringify(sandbox.PrtfWebviewLogic.tokenToPField("&BAR")), JSON.stringify({ isPField: true, value: "BAR" }));
});
