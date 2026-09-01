# Vendored: JsBarcode 3.12.3

`JsBarcode.all.min.js` is copied unmodified from the `jsbarcode` npm package
(https://www.npmjs.com/package/jsbarcode, MIT license — see `LICENSE.txt`,
also copied unmodified), specifically `dist/JsBarcode.all.min.js` from
version 3.12.3.

## Why vendored instead of `require()`d

This file needs to run **inside the VS Code webview** (a sandboxed browser
context — see `src/buildWebviewTemplate.js`'s header for why the webview is
one inlined `<script>` rather than several files loaded via
`asWebviewUri`), not inside the extension host's Node process, so it can't
be pulled in the normal Node `require()` way `prtfEngine.js` and friends
are. `src/buildWebviewTemplate.js` reads this file's text and inlines it
into the webview's single `<script>` tag alongside `src/prtfEngine.js`,
`media/webviewClient.js`, etc., exactly like every other webview module —
see `WEBVIEW_MODULE_FILES` there. When evaluated, it sets `window.JsBarcode`
(confirmed by inspecting the minified source: `"undefined"!=typeof
window&&(window.JsBarcode=h)`), which `media/webviewClient.js` then calls
directly (Batch D, docs/TASKS.md) to render the symbologies listed in
`src/prtfBarcodeRender.js`'s `RENDERABLE` table.

`jsbarcode` is still recorded as a `devDependency` in `package.json` (not a
runtime dependency — nothing at extension runtime calls `require("jsbarcode")`)
purely so a future maintainer can `npm install` and re-derive/update this
vendored copy from the same pinned version, rather than trusting a stray
file with no traceable origin.

## Do not hand-edit

If JsBarcode needs an update, bump the `jsbarcode` version in
`package.json`, `npm install`, then re-copy
`node_modules/jsbarcode/dist/JsBarcode.all.min.js` over this file (and
`node_modules/jsbarcode/MIT-LICENSE.txt` over `LICENSE.txt`) — don't edit
this file by hand, since that'd silently diverge from the upstream release
it's supposed to be a byte-for-byte copy of.
