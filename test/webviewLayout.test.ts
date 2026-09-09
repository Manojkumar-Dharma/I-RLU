// Regression coverage for a real bug: the properties/keywords column
// (.side-col) had overflow-y: auto (added across Batch S/U) but never
// actually scrolled in a real VS Code webview — it just got silently
// clipped by body's overflow: hidden, indistinguishable from "no
// scrollbar" to the user. Root cause: render() in media/webviewClient.js
// appends the toolbar and .workspace as children of the literal #root
// div from the HTML shell (not directly to body), so #root — not body —
// is the flex item that needs to fill the fixed 100vh and hand a bounded
// height down through .workspace to .side-col. #root had no sizing rule
// at all, so as a plain flex child of body with default flex-basis:auto
// and no min-height:0, it sized to its OWN content's height instead of
// being capped by body's 100vh, breaking the height-constraint chain
// every .side-col overflow-y: auto below it depends on (see the
// accompanying CSS comment in src/buildWebviewTemplate.js for the full
// explanation, and that file's header for why I-SDA's own three-column
// shell never hit this: its columns are direct grid-item children of
// body, with no intermediate #root wrapper to forget to size).
//
// A real browser layout engine is needed to prove the scroll itself
// works (unavailable in this sandbox — see docs/TASKS.md), so this test
// instead locks in the specific CSS rule the fix depends on existing,
// so it can't silently regress (e.g. someone reverting #root's flex
// rules while "simplifying" the CSS) without a test failing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getWebviewHtml } = require("../src/webviewTemplate.js");

function extractCss(html: string): string {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error("getWebviewHtml() output has no <style> tag to extract");
  return m[1];
}

test("webview layout: #root has an explicit height-bounding flex rule so .side-col's overflow-y:auto can take effect", () => {
  const css = extractCss(getWebviewHtml("testnonce"));
  const rootRuleMatch = css.match(/#root\s*\{([^}]*)\}/);
  assert.ok(rootRuleMatch, "#root has no CSS rule at all — .side-col's scroll chain is broken (see this test's header comment)");
  const rootRule = rootRuleMatch![1];
  // flex: 1 makes #root fill body's fixed 100vh (it's body's only flex
  // item); min-height: 0 overrides flex's default content-based minimum
  // so #root can actually be shorter than its content, same escape hatch
  // .workspace already relies on one level down.
  assert.match(rootRule, /flex\s*:\s*1\b/, "#root must have flex: 1 to fill body's 100vh");
  assert.match(rootRule, /min-height\s*:\s*0\b/, "#root must have min-height: 0 to override flex's content-based default minimum");
  assert.match(rootRule, /display\s*:\s*flex\b/, "#root must be display: flex for its own flex-direction/flex-item rules to apply");
});

test("webview layout: the height-constraint chain from body down to .side-col has no gaps", () => {
  const css = extractCss(getWebviewHtml("testnonce"));
  // Each link below must itself be height-bounded (not just "overflow:
  // auto with nothing actually constraining its box") for the next
  // link's overflow rule to mean anything. min-height: 0 is the part
  // that's easy to forget (flex items default to min-height: auto,
  // i.e. "at least as tall as my content", which silently defeats any
  // overflow rule on that same element).
  for (const selector of ["#root", "\\.workspace", "\\.side-col"]) {
    const ruleMatch = css.match(new RegExp(selector + "\\s*\\{([^}]*)\\}"));
    assert.ok(ruleMatch, `${selector} has no CSS rule`);
    assert.match(ruleMatch![1], /min-height\s*:\s*0\b/, `${selector} must have min-height: 0`);
  }
});

// Batch FF — "check box and text box are improperly placed" / "Range them
// in a way it is easy and uniform". Real browser layout is needed to prove
// rows actually line up (unavailable in this sandbox), so these lock in
// the specific CSS rules the fix depends on, the same documented-gap
// pattern the two tests above already use for the #root fix.
test("webview layout (Batch FF): checkboxes inside .prop-row are excluded from the value-input width rule", () => {
  const css = extractCss(getWebviewHtml("testnonce"));
  const checkboxRuleMatch = css.match(/\.prop-row input\[type="checkbox"\]\s*\{([^}]*)\}/);
  assert.ok(checkboxRuleMatch, ".prop-row has no dedicated input[type=checkbox] rule — checkboxes risk being stretched by the value-input width rule again");
  assert.match(checkboxRuleMatch![1], /width\s*:\s*auto\b/, "checkbox width must be auto, not inherited from the value-input rule");
  const valueInputRuleMatch = css.match(/\.prop-row input:not\(\[type="checkbox"\]\), \.prop-row select\s*\{([^}]*)\}/);
  assert.ok(valueInputRuleMatch, ".prop-row's value-input rule must explicitly exclude input[type=checkbox] via :not()");
});

test("webview layout (Batch FF): the label/checkbox column has a fixed width shared by every row shape", () => {
  const css = extractCss(getWebviewHtml("testnonce"));
  // .ind-label (checkbox rows), .prop-label (labeledInput/labeledSelect's
  // wrapped text label), and .pfield-label (pFieldRow) must all resolve to
  // the SAME flex-basis, or rows built with different helper functions
  // would misalign against each other again despite each individually
  // "having a width".
  const combinedRuleMatch = css.match(/\.prop-row > \.ind-label, \.prop-row > \.prop-label, \.pfield-row > \.pfield-label\s*\{([^}]*)\}/);
  assert.ok(combinedRuleMatch, "the three label classes must share one combined selector so a future edit can't accidentally desync their widths");
  assert.match(combinedRuleMatch![1], /flex\s*:\s*0 0 \d+px/, "the label column must have a fixed (non-growing, non-shrinking) flex-basis");
});

test("webview layout (Batch FF): value inputs share row width proportionally instead of each claiming a fixed 140px", () => {
  const css = extractCss(getWebviewHtml("testnonce"));
  const valueInputRuleMatch = css.match(/\.prop-row input:not\(\[type="checkbox"\]\), \.prop-row select\s*\{([^}]*)\}/);
  assert.ok(valueInputRuleMatch);
  // flex: 1 ... lets 2+ inputs on one row (EDTCDE's select+fill, MSGCON's
  // 4 params) share whatever width is actually available instead of each
  // independently demanding 140px and forcing an uneven wrap.
  assert.match(valueInputRuleMatch![1], /flex\s*:\s*1\s+1\s+\d+px/, "value inputs must flex-share row width, not each claim an independent fixed width");
  assert.doesNotMatch(css, /\.prop-row input, \.prop-row select \{ width: 140px/, "the old un-scoped fixed-width rule (which also stretched checkboxes) must not still be present");
});

// media/webviewClient.js isn't require()-able as a CommonJS module (it's a
// browser-only IIFE assuming window/document/vscode globals — see
// webviewAssembly.test.ts for the actual vm-execution approach), so unlike
// the CSS checks above, this is a plain source-text shape check: it can't
// prove the four rows actually render lined-up, but it does prove the
// specific "bare appendChild with no row wrapper at all" shape (which
// isn't a CSS problem the rules above could ever catch, however correct
// they are) doesn't silently come back.
test("webview layout (Batch FF): OVERLAY/PAGSEG/AFPRSC/DOCIDXTAG's value inputs are wrapped in their own .prop-row, not appended bare", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  for (const fnName of ["appendOverlayRow", "appendPagsegRow", "appendAfprscRow", "appendDocidxtagRow"]) {
    const fnMatch = source.match(new RegExp("function " + fnName + "\\([^)]*\\) \\{([\\s\\S]*?)\\n  \\}\\n"));
    assert.ok(fnMatch, `${fnName} not found in media/webviewClient.js`);
    const body = fnMatch![1];
    assert.match(body, /const valuesRow = el\("div", \{ class: "prop-row" \}\)/, `${fnName} must build its value inputs into a .prop-row div, not append them bare to container`);
    assert.doesNotMatch(body, /\]\.forEach\(\(i\) => container\.appendChild\(i\)\)/, `${fnName} must not append its value inputs directly to container with no row wrapper`);
  }
});

// Batch JJ — multi-select for bulk move/copy/delete. Same "webviewClient.js
// isn't require()-able" constraint as the OVERLAY/PAGSEG check above, so
// these are source-text shape checks rather than DOM-interaction tests
// (the actual mutation logic these wire up to is fully unit tested in
// test/prtfBatchJJ.test.ts, which needs no DOM at all).
test("webview layout (Batch JJ): .multi-selected has its own distinct CSS rule from .selected", () => {
  const css = extractCss(getWebviewHtml("testnonce"));
  const multiSelectedMatch = css.match(/\.cell\.multi-selected\s*\{([^}]*)\}/);
  assert.ok(multiSelectedMatch, ".cell.multi-selected has no CSS rule at all — a Ctrl/Cmd-click multi-select would be visually indistinguishable from an unselected cell");
  assert.match(multiSelectedMatch![1], /border/, ".multi-selected should have a visible border, same as .selected does");
});

test("webview layout (Batch JJ): the cell click handler checks ctrlKey/metaKey before toggling multi-select, and the three bulk edit kinds are actually sent", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  assert.match(
    source,
    /if \(ev\.ctrlKey \|\| ev\.metaKey\)/,
    "cell click handler must check both ctrlKey and metaKey (Windows/Linux vs macOS) before toggling multiSelectIds"
  );
  // Guards the two files (webviewProtocol.ts's WebviewEdit union and this
  // file's actual postMessage calls) against silently drifting apart —
  // webviewProtocol.ts's own header comment already flags this as
  // impossible to check automatically any other way, since the webview
  // itself isn't type-checked.
  for (const kind of ["bulkMove", "bulkDelete", "bulkCopy"]) {
    assert.match(source, new RegExp('kind:\\s*"' + kind + '"'), `media/webviewClient.js never sends a "${kind}" edit — webviewProtocol.ts declares it but nothing actually posts it`);
  }
});

// Batch QQ (docs/TASKS.md) — bug fix. extension.ts's sendCodeForIStatus polls
// on a plain 10s setInterval and posts a "codeForIStatus" message on every
// tick regardless of whether the connection state actually changed. The
// handler used to call the full destructive render() (root.innerHTML = ""
// + total rebuild) unconditionally on every such message, wiping the whole
// side panel — including any input mid-edit and scroll position — every 10
// seconds even when nothing about the connection had changed. Same
// "webviewClient.js isn't require()-able" constraint as the OVERLAY/JJ
// checks above, so this is a source-text shape check: it locks in that the
// handler compares the incoming installed/connected values against the
// current state BEFORE deciding whether to render(), rather than calling
// render() unconditionally.
test("webview layout (Batch QQ): the codeForIStatus handler only re-renders when installed/connected actually changed", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  const handlerMatch = source.match(/\} else if \(msg\.type === "codeForIStatus"\) \{([\s\S]*?)\n    \} else if \(msg\.type === "afpResourcePreview"\)/);
  assert.ok(handlerMatch, "codeForIStatus message handler not found in media/webviewClient.js");
  const body = handlerMatch![1];
  assert.match(
    body,
    /state\.codeForI\.installed !== installed \|\| state\.codeForI\.connected !== connected/,
    "codeForIStatus handler must compare the incoming installed/connected values against state.codeForI before rendering, or every 10s poll tick blows away the whole side panel regardless of whether anything changed"
  );
  // The render() call itself must be inside that comparison's if-block, not
  // sitting unconditionally after it — otherwise the comparison is dead
  // code that never actually gates anything. Matched through to the
  // handler's own closing brace (rather than stopping at the first "}",
  // which would land on the { installed, connected } object literal
  // instead of the end of the if-block).
  const ifBlockMatch = body.match(/if \(state\.codeForI\.installed !== installed \|\| state\.codeForI\.connected !== connected\) \{([\s\S]*)$/);
  assert.ok(ifBlockMatch, "the installed/connected comparison's if-block could not be isolated");
  assert.match(ifBlockMatch![1], /render\(\);/, "render() must be called INSIDE the changed-check, not unconditionally after it");
});

// Batch RR (docs/TASKS.md) — bug fix. Reported directly by Manoj: checking
// the "Font & sizing" panel's FONT checkbox, then checking CCSID, then
// unchecking CCSID caused FONT to appear unchecked too. Root cause:
// checking a Font & sizing checkbox only revealed its inputs — nothing
// was actually committed until the separate "Apply" button was clicked —
// while UNchecking committed immediately (calling removeFn, which
// triggers a full document round-trip and the webview's own destructive
// render()). So an already-checked-but-never-applied FONT silently
// reverted the moment ANY sibling keyword's own change committed and
// forced a full panel rebuild, since the real document never had FONT
// saved in the first place. Fixed by having every Font & sizing input
// (the P-field rows, the point-size rows, and CHRSIZ/CCSID's own plain
// inputs) auto-commit on its own "change" (blur) event, same "commit as
// soon as there's a value" convention appendKeywordRows (Batch A/G) has
// used from the start elsewhere in this file — closing the unsaved-state
// window instead of leaving it open until an explicit Apply click. Same
// "webviewClient.js isn't require()-able" constraint as the other checks
// in this file, so this is a source-text shape check rather than a DOM
// interaction test.
test("webview layout (Batch RR): Font & sizing panel inputs auto-commit on change, not only via the Apply button", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");

  // pFieldRow must accept and wire an onChange callback on both its
  // literal and P-field inputs (and the literal/P-field toggle button),
  // or a P-field row's own edits would never auto-commit regardless of
  // whether callers pass onChange.
  const pFieldRowMatch = source.match(/function pFieldRow\(labelText, opts\) \{([\s\S]*?)\n  \}\n/);
  assert.ok(pFieldRowMatch, "pFieldRow function not found");
  const pFieldRowBody = pFieldRowMatch![1];
  assert.match(pFieldRowBody, /if \(opts\.onChange\) opts\.onChange\(\);/, "pFieldRow's literal/P-field toggle button must also fire onChange — toggling changes getValue()'s result just as much as editing the input does");
  assert.match(pFieldRowBody, /literalInput\.addEventListener\("change", opts\.onChange\)/, "pFieldRow must wire its literal input's change event to opts.onChange");
  assert.match(pFieldRowBody, /pfieldInput\.addEventListener\("change", opts\.onChange\)/, "pFieldRow must wire its P-field input's change event to opts.onChange");

  // renderFontSizingPanel must actually pass a submit callback as
  // onChange for every paramRow / heightRow / widthRow it creates via
  // pFieldRow, not just leave the Apply button as the only trigger.
  const panelMatch = source.match(/function renderFontSizingPanel\(keywords, applyFn, removeFn, titleSuffix\) \{([\s\S]*?)\n    return panel;\n  \}\n/);
  assert.ok(panelMatch, "renderFontSizingPanel function not found");
  const panelBody = panelMatch![1];
  assert.match(panelBody, /const trySubmit = \(\) => \{/, "renderFontSizingPanel must define a shared trySubmit function reused by both the Apply button and each row's onChange");
  assert.match(panelBody, /pFieldRow\(p\.label, \{[^}]*onChange: trySubmit/, "each spec.params paramRow must be created with onChange: trySubmit");
  assert.match(panelBody, /pFieldRow\("Point size height", \{[^}]*onChange: trySubmit/, "the point-size height row must be created with onChange: trySubmit");
  assert.match(panelBody, /pFieldRow\("Point size width", \{[^}]*onChange: trySubmit/, "the point-size width row must be created with onChange: trySubmit");

  // CHRSIZ and CCSID (plain numeric inputs, not pFieldRow) must wire their
  // own inputs' "change" events to the same submit logic the Apply button
  // uses, via a named, shared function (not just the click handler alone).
  assert.match(panelBody, /const chrsizSubmit = \(\) => \{/, "CHRSIZ needs a shared chrsizSubmit function reused by both the Apply button and its inputs");
  assert.match(panelBody, /widthMultRow\.input\.addEventListener\("change", chrsizSubmit\)/, "CHRSIZ's width-multiplier input must auto-commit on change");
  assert.match(panelBody, /heightMultRow\.input\.addEventListener\("change", chrsizSubmit\)/, "CHRSIZ's height-multiplier input must auto-commit on change");
  assert.match(panelBody, /const ccsidSubmit = \(\) => \{/, "CCSID needs a shared ccsidSubmit function reused by both the Apply button and its input");
  assert.match(panelBody, /ccsidValRow\.input\.addEventListener\("change", ccsidSubmit\)/, "CCSID's value input must auto-commit on change");
});

