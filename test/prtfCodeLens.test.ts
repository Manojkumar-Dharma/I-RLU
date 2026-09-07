// Tests for the "Open iRLU" CodeLens (src/prtfCodeLens.ts) — requested
// directly against a real-world screenshot of a remote Code for i member
// (MANOJKUMAR/QDDSSRC/ARRPT01.PRTF) showing I-SDA's own equivalent "Open
// Screen Design" CodeLens and asking for the same one-click shortcut in
// I-RLU. Deliberately no `vscode` import anywhere in this file: this
// module is the pure-logic split out of extension.ts specifically so it's
// testable without a real VS Code host, the same pattern
// test/designerOpenMode.test.ts already established for
// designerOpenMode.ts. extension.ts's own
// vscode.languages.registerCodeLensProvider wiring has no automated
// coverage — same documented gap as every other VS Code API surface in
// this project — and should be verified manually in a real Extension
// Development Host, ideally against a remote member matching the
// screenshot that prompted this.
import test from "node:test";
import assert from "node:assert/strict";
import { isLikelyPrintFilePath } from "../src/prtfCodeLens";

test("isLikelyPrintFilePath: matches local .pf/.prtf/.rlu paths, any case", () => {
  assert.equal(isLikelyPrintFilePath("/home/user/ARRPT01.prtf"), true);
  assert.equal(isLikelyPrintFilePath("/home/user/ARRPT01.PRTF"), true);
  assert.equal(isLikelyPrintFilePath("/home/user/report.pf"), true);
  assert.equal(isLikelyPrintFilePath("/home/user/report.PF"), true);
  assert.equal(isLikelyPrintFilePath("/home/user/report.rlu"), true);
  assert.equal(isLikelyPrintFilePath("/home/user/report.RLU"), true);
});

test("isLikelyPrintFilePath: matches a member: scheme URI's path exactly the same way — the exact reported screenshot", () => {
  // Code for i represents a remote source member as
  // member:/LIBRARY/SRCFILE/MEMBER.type — the real path from the
  // screenshot that prompted this feature.
  assert.equal(isLikelyPrintFilePath("/MANOJKUMAR/QDDSSRC/ARRPT01.PRTF"), true);
});

test("isLikelyPrintFilePath: matches a streamfile: scheme URI's path the same way", () => {
  assert.equal(isLikelyPrintFilePath("/home/MANOJKUMAR/reports/ARRPT01.prtf"), true);
});

test("isLikelyPrintFilePath: rejects unrelated extensions, including other IBM i DDS source types", () => {
  assert.equal(isLikelyPrintFilePath("/MANOJKUMAR/QDDSSRC/CUSTMAST.dspf"), false);
  assert.equal(isLikelyPrintFilePath("/MANOJKUMAR/QRPGLESRC/ARRPT01.rpgle"), false);
  assert.equal(isLikelyPrintFilePath("/home/user/notes.txt"), false);
});

test("isLikelyPrintFilePath: deliberately does NOT match .pf38/.prtf38/.dds — extensions I-RLU's own customEditors/menus don't recognize either", () => {
  // Scope guard: the IBMi Languages extension's own language-ID scheme
  // separately recognizes these as legacy/database-physical-file source
  // types, but package.json's customEditors selector and menus "when"
  // clauses only ever list .pf/.prtf/.rlu — offering the CodeLens for an
  // extension nothing else in the extension treats as a printer file
  // would be a new, inconsistent surface.
  assert.equal(isLikelyPrintFilePath("/MANOJKUMAR/QDDSSRC/ARRPT01.pf38"), false);
  assert.equal(isLikelyPrintFilePath("/MANOJKUMAR/QDDSSRC/ARRPT01.prtf38"), false);
  assert.equal(isLikelyPrintFilePath("/MANOJKUMAR/QDDSSRC/ARRPT01.dds"), false);
});

test("isLikelyPrintFilePath: requires the extension at the very end of the path — not merely present somewhere in it", () => {
  assert.equal(isLikelyPrintFilePath("/home/user/prtf-backup/notes.txt"), false);
  assert.equal(isLikelyPrintFilePath("/home/user/report.pf.bak"), false);
});
