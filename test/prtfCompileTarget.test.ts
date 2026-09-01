// Tests for docs/TASKS.md Batch J — compile command (CRTPRTF) library/
// source-file/member picker (src/prtfCompileTarget.ts). Deliberately no
// `vscode` import anywhere in this file: this module is the pure-logic
// split out of extension.ts specifically so it's testable without a real
// VS Code host, the same pattern test/prtfEdits.test.ts already
// established for prtfEdits.ts. Covers: (1) parseMemberUri/
// targetFromMemberUri for the accurate no-prompt path when a source is
// already open as a Code for i `member:` URI, (2) deriveMemberNameFromFileName
// and validateIbmIObjectName, the prompt-flow helpers, and (3)
// buildCrtprtfCommand — including the two real bugs this batch found and
// fixed in the pre-Batch-J command (the `&CURLIB`->`*CURLIB` mistake, and
// the missing `REPLACE(*YES)`).
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMemberUri,
  targetFromMemberUri,
  deriveMemberNameFromFileName,
  validateIbmIObjectName,
  buildCrtprtfCommand,
} from "../src/prtfCompileTarget";

test("parseMemberUri: a well-formed member: URI parses library/file/name/extension", () => {
  const parsed = parseMemberUri("member", "/MYLIB/QDDSSRC/STMTHDR.pf");
  assert.deepEqual(parsed, { library: "MYLIB", file: "QDDSSRC", name: "STMTHDR", extension: "pf" });
});

test("parseMemberUri: an iASP-qualified member: URI (4 segments) still parses correctly, taking the LAST three", () => {
  const parsed = parseMemberUri("member", "/MYASP/MYLIB/QDDSSRC/STMTHDR.pf");
  assert.deepEqual(parsed, { library: "MYLIB", file: "QDDSSRC", name: "STMTHDR", extension: "pf" });
});

test("parseMemberUri: non-member schemes return null", () => {
  assert.equal(parseMemberUri("file", "/MYLIB/QDDSSRC/STMTHDR.pf"), null);
  assert.equal(parseMemberUri("streamfile", "/home/user/stmthdr.pf"), null);
});

test("parseMemberUri: malformed member: URIs (too few segments, no extension) return null rather than throwing", () => {
  assert.equal(parseMemberUri("member", "/QDDSSRC/STMTHDR.pf"), null); // only 2 segments
  assert.equal(parseMemberUri("member", "/MYLIB/QDDSSRC/STMTHDR"), null); // no extension
});

test("targetFromMemberUri: derives a CompileTarget directly from a member: URI, member name uppercased", () => {
  const target = targetFromMemberUri("member", "/mylib/qddssrc/stmthdr.pf");
  assert.deepEqual(target, { library: "mylib", sourceFile: "qddssrc", memberName: "STMTHDR" });
});

test("targetFromMemberUri: returns null for a local file URI, signaling the caller to fall back to cache/prompt", () => {
  assert.equal(targetFromMemberUri("file", "/home/user/project/stmthdr.pf"), null);
});

test("deriveMemberNameFromFileName: strips the extension and uppercases", () => {
  assert.equal(deriveMemberNameFromFileName("stmthdr.pf"), "STMTHDR");
  assert.equal(deriveMemberNameFromFileName("StmtHdr.prtf"), "STMTHDR");
  assert.equal(deriveMemberNameFromFileName("no-extension"), "NO-EXTENSION");
});

test("validateIbmIObjectName: accepts valid IBM i object names", () => {
  assert.equal(validateIbmIObjectName("QDDSSRC"), undefined);
  assert.equal(validateIbmIObjectName("MYLIB1"), undefined);
  assert.equal(validateIbmIObjectName("$PGM"), undefined);
  assert.equal(validateIbmIObjectName("#TEMP"), undefined);
  assert.equal(validateIbmIObjectName("A_B"), undefined);
});

test("validateIbmIObjectName: rejects blank, over-length, and badly-formed names with a specific message", () => {
  assert.match(validateIbmIObjectName("")!, /required/i);
  assert.match(validateIbmIObjectName("  ")!, /required/i);
  assert.match(validateIbmIObjectName("ELEVENCHARS1")!, /10 characters/);
  assert.match(validateIbmIObjectName("1BAD")!, /must start with a letter/i);
  assert.match(validateIbmIObjectName("HAS SPACE")!, /must start with a letter/i);
});

test("buildCrtprtfCommand: blank library uses *CURLIB for FILE and *LIBL for SRCFILE (IBM's own differing defaults for the two parameters)", () => {
  const command = buildCrtprtfCommand({ library: "", sourceFile: "QDDSSRC", memberName: "STMTHDR" });
  assert.equal(command, "CRTPRTF FILE(*CURLIB/STMTHDR) SRCFILE(*LIBL/QDDSSRC) SRCMBR(STMTHDR) REPLACE(*YES)");
});

test("buildCrtprtfCommand: uses *CURLIB, not &CURLIB — the pre-Batch-J bug (a CL variable reference, meaningless in a raw command string) this batch fixed", () => {
  const command = buildCrtprtfCommand({ library: "", sourceFile: "QDDSSRC", memberName: "STMTHDR" });
  assert.doesNotMatch(command, /&CURLIB/);
  assert.match(command, /\*CURLIB/);
});

test("buildCrtprtfCommand: always specifies REPLACE(*YES) — the pre-Batch-J bug (CRTPRTF's own default is REPLACE(*NO), which would fail every recompile) this batch fixed", () => {
  const command = buildCrtprtfCommand({ library: "MYLIB", sourceFile: "QDDSSRC", memberName: "STMTHDR" });
  assert.match(command, /REPLACE\(\*YES\)/);
});

test("buildCrtprtfCommand: an explicit library is used (uppercased) for BOTH FILE's and SRCFILE's library qualifiers", () => {
  const command = buildCrtprtfCommand({ library: "mylib", sourceFile: "qddssrc", memberName: "stmthdr" });
  assert.equal(command, "CRTPRTF FILE(MYLIB/STMTHDR) SRCFILE(MYLIB/QDDSSRC) SRCMBR(STMTHDR) REPLACE(*YES)");
});

test("buildCrtprtfCommand: a blank source file falls back to QDDSSRC", () => {
  const command = buildCrtprtfCommand({ library: "MYLIB", sourceFile: "  ", memberName: "STMTHDR" });
  assert.match(command, /SRCFILE\(MYLIB\/QDDSSRC\)/);
});
