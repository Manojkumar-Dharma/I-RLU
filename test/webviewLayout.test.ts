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

// Batch CC — "check box and text box are improperly placed" / "Range them
// in a way it is easy and uniform". Real browser layout is needed to prove
// rows actually line up (unavailable in this sandbox), so these lock in
// the specific CSS rules the fix depends on, the same documented-gap
// pattern the two tests above already use for the #root fix.
test("webview layout (Batch CC): checkboxes inside .prop-row are excluded from the value-input width rule", () => {
  const css = extractCss(getWebviewHtml("testnonce"));
  const checkboxRuleMatch = css.match(/\.prop-row input\[type="checkbox"\]\s*\{([^}]*)\}/);
  assert.ok(checkboxRuleMatch, ".prop-row has no dedicated input[type=checkbox] rule — checkboxes risk being stretched by the value-input width rule again");
  assert.match(checkboxRuleMatch![1], /width\s*:\s*auto\b/, "checkbox width must be auto, not inherited from the value-input rule");
  const valueInputRuleMatch = css.match(/\.prop-row input:not\(\[type="checkbox"\]\), \.prop-row select\s*\{([^}]*)\}/);
  assert.ok(valueInputRuleMatch, ".prop-row's value-input rule must explicitly exclude input[type=checkbox] via :not()");
});

test("webview layout (Batch CC): the label/checkbox column has a fixed width shared by every row shape", () => {
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

test("webview layout (Batch CC): value inputs share row width proportionally instead of each claiming a fixed 140px", () => {
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
test("webview layout (Batch CC): OVERLAY/PAGSEG/AFPRSC/DOCIDXTAG's value inputs are wrapped in their own .prop-row, not appended bare", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../media/webviewClient.js"), "utf8");
  for (const fnName of ["appendOverlayRow", "appendPagsegRow", "appendAfprscRow", "appendDocidxtagRow"]) {
    const fnMatch = source.match(new RegExp("function " + fnName + "\\([^)]*\\) \\{([\\s\\S]*?)\\n  \\}\\n"));
    assert.ok(fnMatch, `${fnName} not found in media/webviewClient.js`);
    const body = fnMatch![1];
    assert.match(body, /const valuesRow = el\("div", \{ class: "prop-row" \}\)/, `${fnName} must build its value inputs into a .prop-row div, not append them bare to container`);
    assert.doesNotMatch(body, /\]\.forEach\(\(i\) => container\.appendChild\(i\)\)/, `${fnName} must not append its value inputs directly to container with no row wrapper`);
  }
});
