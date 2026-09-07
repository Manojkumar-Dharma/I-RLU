/**
 * The "Open iRLU" CodeLens shown above a printer-file DDS source's first
 * line — mirrors I-SDA's own "$(open-preview) Open Screen Design" CodeLens
 * (see that project's src/extension.ts) for the same reason: a person
 * opening ARRPT01.PRTF (whether a local file or, as in the screenshot that
 * prompted this, a remote Code for i member under a source physical file)
 * should have a one-click way into the visual designer without hunting for
 * the right-click menu, the editor-title button, or the Command Palette
 * entry that already exist.
 *
 * Split out of extension.ts (which owns the actual
 * vscode.languages.registerCodeLensProvider glue) so the actual
 * "does this document look like something I-RLU should offer a
 * CodeLens for" decision is unit-testable without a real VS Code host —
 * the same "pure logic module extension.ts calls into" pattern this
 * project already uses for designerOpenMode.ts/prtfCompileTarget.ts.
 */

/**
 * `member:`/`streamfile:` scheme URIs (Code for i's own representation of
 * a remote IBM i source member or IFS streamfile) carry the source's real
 * extension as the LAST segment of the path itself — e.g.
 * `member:/MANOJKUMAR/QDDSSRC/ARRPT01.PRTF` for the exact screenshot that
 * prompted this — the same way a local `file:` path does. Checking
 * `uri.path` directly (rather than VS Code's own `resourceExtname`
 * context key, which I-SDA's own extension.ts comment already documents
 * as unreliable for these two schemes) therefore works uniformly across
 * all three schemes I-RLU's customEditors/menus already recognize a
 * printer file by: `file:`, `member:`, `streamfile:`.
 *
 * Deliberately scoped to the SAME extension set package.json's own
 * `customEditors`/`menus` contributions already recognize (`.pf`,
 * `.prtf`, `.rlu`, case-insensitive) — not also `.pf38`/`.prtf38`/`.dds`,
 * which the IBMi Languages extension's own language-ID scheme separately
 * recognizes as legacy/database-physical-file source types I-RLU doesn't
 * declare anywhere else. Offering the CodeLens for an extension I-RLU's
 * own customEditor/right-click menu don't also treat as a printer file
 * would be a new, inconsistent surface, not a faithful mirror of an
 * already-existing capability.
 */
export function isLikelyPrintFilePath(path: string): boolean {
  return /\.(pf|prtf|rlu)$/i.test(path);
}
