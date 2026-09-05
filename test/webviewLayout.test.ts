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
