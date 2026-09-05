// Tests for docs/TASKS.md Batch W — configurable designer-open location
// (src/designerOpenMode.ts). Deliberately no `vscode` import anywhere in
// this file: this module is the pure-logic split out of extension.ts
// specifically so it's testable without a real VS Code host, the same
// pattern test/prtfCompileTarget.test.ts already established for
// prtfCompileTarget.ts. extension.ts's own getDesignerOpenMode()/
// openInDesigner() wiring (reading vscode.workspace.getConfiguration,
// calling vscode.commands.executeCommand) has no automated coverage —
// same documented gap as Batches T/U/V — and should be verified manually
// in a real Extension Development Host for all three enum values.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDesignerOpenMode } from "../src/designerOpenMode";

test("normalizeDesignerOpenMode: recognizes both non-default values", () => {
  assert.equal(normalizeDesignerOpenMode("beside"), "beside");
  assert.equal(normalizeDesignerOpenMode("newWindow"), "newWindow");
});

test("normalizeDesignerOpenMode: explicit \"active\" stays \"active\"", () => {
  assert.equal(normalizeDesignerOpenMode("active"), "active");
});

test("normalizeDesignerOpenMode: falls back to \"active\" for undefined (setting absent)", () => {
  assert.equal(normalizeDesignerOpenMode(undefined), "active");
});

test("normalizeDesignerOpenMode: falls back to \"active\" for any unrecognized string", () => {
  // Guards against a stale value from a future settings schema, or a
  // user-edited settings.json typo, silently misbehaving or throwing
  // rather than degrading to the safe default.
  assert.equal(normalizeDesignerOpenMode("besside"), "active");
  assert.equal(normalizeDesignerOpenMode(""), "active");
  assert.equal(normalizeDesignerOpenMode("NEWWINDOW"), "active");
});
