/**
 * docs/TASKS.md Batch W — where "I-RLU: Open Report Designer" (and
 * opening a .pf/.prtf/.rlu file via the editor selector) puts the
 * designer, driven by the i-rlu.designerOpenColumn setting. Split out
 * of extension.ts (which owns the actual
 * vscode.workspace.getConfiguration/vscode.commands.executeCommand
 * glue) so the value-normalization decision is unit-testable without a
 * real VS Code host — the same "pure logic module extension.ts calls
 * into" pattern this project already uses for prtfCompileTarget.ts and
 * prtfEdits.ts.
 *
 * Mirrors I-SDA's identical DesignerOpenMode/getDesignerOpenMode (see
 * that project's src/extension.ts) — same three values, same reasoning:
 * "active" is the default because the designer's own side panels
 * (record/keyword lists, properties) already give people the context a
 * split source view would otherwise provide, and a full-width designer
 * avoids the two fighting over horizontal space on any but the widest
 * terminals. "beside" restores the split-column-next-to-the-source
 * behavior for people who want to see the raw DDS while they work, and
 * "newWindow" pops the designer straight out into its own OS window.
 */
export type DesignerOpenMode = "beside" | "active" | "newWindow";

/**
 * Normalizes an arbitrary settings value into a valid DesignerOpenMode,
 * falling back to "active" for anything else — including `undefined`
 * (setting not yet migrated/present) and any unrecognized string (a
 * stale value from a future version's setting schema, or a user-edited
 * settings.json typo) — rather than throwing or silently misbehaving.
 */
export function normalizeDesignerOpenMode(value: string | undefined): DesignerOpenMode {
  return value === "beside" || value === "newWindow" ? value : "active";
}
