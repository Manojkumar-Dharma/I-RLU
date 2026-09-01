/**
 * docs/TASKS.md Batch J — compile command (CRTPRTF) library/source-file/
 * member picker. Split out of extension.ts (which owns all the
 * vscode.window.showInputBox/workspaceState/runCommand glue) so the actual
 * decision logic — where does this compile target come from, and what
 * exact CRTPRTF command does it produce — is unit-testable without a real
 * VS Code host, the same "pure logic module extension.ts calls into"
 * pattern this project already uses for prtfEdits.ts (and Batch H's own
 * "part 1: pure resolution logic" split).
 *
 * Two real bugs in the pre-Batch-J command were found and fixed while
 * writing this, not just the missing picker the batch was scoped for:
 *
 * 1. The old command embedded `&CURLIB` literally inside the CRTPRTF
 *    command text (`FILE(&CURLIB/...)`). `&CURLIB` is a CL *variable*
 *    reference — meaningful inside a compiled CL program, meaningless in a
 *    raw command string submitted via Code for i's runCommand (confirmed
 *    against codefori.github.io/docs/dev/examples/, which shows `&CURLIB`/
 *    `&LIBL` used only as *separate* `env` object keys passed alongside
 *    `command`, never inline in the command text itself). The correct
 *    inline special value is `*CURLIB` (verified against IBM's own CRTPRTF
 *    reference, ibm.com/docs/ssw_ibm_i_72/cl/crtprtf.htm — FILE's own
 *    Qualifier 2 default). `buildCrtprtfCommand` below fixes this.
 * 2. `REPLACE` was never specified, and CRTPRTF's own documented default is
 *    `REPLACE(*NO)` — so recompiling the same file a second time would
 *    fail with CPF7302 ("File not created") every time, not just on a
 *    genuine conflict. `buildCrtprtfCommand` now specifies `REPLACE(*YES)`
 *    explicitly, matching "recompile the file I'm iterating on" being the
 *    only realistic use of this command (there's no other object sharing
 *    that name/library the person would be trying to protect).
 */

export interface CompileTarget {
  /** '' means "let CRTPRTF apply its own default" — *CURLIB for FILE's library, *LIBL for SRCFILE's (see buildCrtprtfCommand) — not the same default for both, so an empty library is NOT simply "*CURLIB for both". */
  library: string;
  sourceFile: string;
  memberName: string;
}

export interface ParsedMemberUri {
  library: string;
  file: string;
  name: string;
  extension: string;
}

/** `[^.]+\.` extension stays with `name`? No — trims it, matching I-SDA's own `parseMemberUri` (src/extension.ts) exactly, since a Code for i `member:` URI is `/LIBRARY/SOURCEFILE/MEMBERNAME.ext` — this is the same parse, ported rather than re-derived, since it's already been proven correct there. */
export function parseMemberUri(scheme: string, path: string): ParsedMemberUri | null {
  if (scheme !== "member") return null;
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 3) return null;
  const last = segments[segments.length - 1];
  const dot = last.lastIndexOf(".");
  if (dot <= 0) return null;
  const file = segments[segments.length - 2];
  const library = segments[segments.length - 3];
  if (!file || !library) return null;
  return { library, file, name: last.slice(0, dot), extension: last.slice(dot + 1) };
}

/**
 * The accurate, no-prompt-needed path: when the source is already open as
 * a Code for i `member:` URI, the URI itself names the exact library,
 * source file, and member — asking the person to re-enter what's already
 * known would just invite a typo. Returns null for any other URI scheme
 * (local file, streamfile, ...), where the caller has to fall back to a
 * cached or prompted target instead.
 */
export function targetFromMemberUri(scheme: string, path: string): CompileTarget | null {
  const parsed = parseMemberUri(scheme, path);
  if (!parsed) return null;
  return { library: parsed.library, sourceFile: parsed.file, memberName: parsed.name.toUpperCase() };
}

/** Strips the local file's extension and uppercases it — the pre-Batch-J default member-name derivation, kept as the starting point a prompt pre-fills rather than replaced outright. */
export function deriveMemberNameFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").toUpperCase();
}

/**
 * IBM i object name rules (library, source file, and member names all
 * share this rule — confirmed against IBM's CRTPRTF/CRTSRCPF parameter
 * references, which document every qualified-name part as "Name", the
 * standard system object-name grammar): 1-10 characters, must start with a
 * letter or $/#/@, and contain only letters, digits, underscore, or $/#/@
 * after that. Returns an error string for showInputBox's validateInput, or
 * undefined when valid.
 */
export function validateIbmIObjectName(input: string): string | undefined {
  const v = (input || "").trim();
  if (!v) return "Required.";
  if (v.length > 10) return "IBM i object names are 10 characters or fewer.";
  if (!/^[A-Za-z$#@][A-Za-z0-9$#@_]*$/.test(v)) {
    return "Must start with a letter (or $/#/@) and contain only letters, digits, underscore, $, #, or @.";
  }
  return undefined;
}

/**
 * Builds the exact CRTPRTF command text for a resolved target. See this
 * module's own header for the two bugs fixed here (the `*CURLIB` special
 * value, and `REPLACE(*YES)`).
 *
 * `library` empty means "let CRTPRTF apply its own per-parameter default"
 * — which is *CURLIB for FILE's library qualifier but *LIBL for SRCFILE's
 * (IBM's own documented defaults differ between the two parameters), so
 * this can't be simplified to one shared "*CURLIB when blank" rule.
 */
export function buildCrtprtfCommand(target: CompileTarget): string {
  const library = target.library.trim().toUpperCase();
  const sourceFile = (target.sourceFile.trim() || "QDDSSRC").toUpperCase();
  const memberName = target.memberName.trim().toUpperCase();
  const fileQual = library ? `${library}/${memberName}` : `*CURLIB/${memberName}`;
  const srcQual = library ? `${library}/${sourceFile}` : `*LIBL/${sourceFile}`;
  return `CRTPRTF FILE(${fileQual}) SRCFILE(${srcQual}) SRCMBR(${memberName}) REPLACE(*YES)`;
}
