/**
 * Typed shape of the messages the designer webview (media/webviewClient.js)
 * posts to the extension host. webviewClient.js is plain JS with no build
 * step of its own, so this union exists purely on the host side — it
 * documents, and lets TypeScript check, what extension.ts's applyEdit
 * assumes about each edit.kind. If webviewClient.js starts sending a shape
 * that doesn't match one of these, that's a bug in this file (or in the
 * webview) to fix, not a reason to widen a field back to `any`.
 *
 * Keep this in sync with the `vscode.postMessage({ type: "edit", edit: {...} })`
 * call sites in media/webviewClient.js — there's no way to check the two
 * against each other automatically, since the webview isn't type-checked.
 */
export type WebviewEdit =
  | { kind: "move"; id: string; line: number; position: number }
  | {
      kind: "updateField";
      id: string;
      name: string;
      length?: number;
      dataType?: string;
      decimalPositions?: number;
      usage?: string;
      line: number;
      position: number;
      // Batch H "Reference a field" toggle — see extension.ts's applyEdit,
      // "updateField" case, for how these four are read.
      reference?: boolean;
      refFieldName?: string;
      refLibrary?: string;
      refFile?: string;
    }
  | { kind: "updateConstant"; id: string; literal: string; line: number; position: number }
  | { kind: "delete"; id: string }
  | { kind: "setRecordKeyword"; recordName: string; name: string; params?: string }
  | { kind: "removeRecordKeyword"; recordName: string; name: string }
  | { kind: "setFieldKeyword"; id: string; name: string; params?: string }
  | { kind: "removeFieldKeyword"; id: string; name: string }
  | { kind: "setIndicatorText"; recordName: string; indicator: string; text: string }
  | { kind: "removeIndicatorText"; recordName: string; indicator: string }
  | {
      kind: "addField";
      recordName: string;
      line: number;
      position: number;
      name: string;
      length: number;
      dataType: string;
      decimalPositions?: number;
      usage: string;
      // Batch Q — carries the source field/constant's keywords along on a
      // copy (media/webviewClient.js's "Copy" button, renderEditPanel).
      // name/params only (not the full Keyword shape) — prtfEdits.ts
      // rebuilds `raw`/`sourceLineIndex` for the new entry, same as every
      // other keyword-adding edit kind already does. Omitted (or empty)
      // for a plain "+ Field" add.
      sourceKeywords?: { name: string; params: string }[];
    }
  | {
      kind: "addConstant";
      recordName: string;
      line: number;
      position: number;
      literal: string;
      // Batch Q — see addField's own comment on this field, same shape and purpose.
      sourceKeywords?: { name: string; params: string }[];
      // Batch Z — "Add system constant" alternative to a literal-text
      // constant (see renderNewEntryPanel's constant branch). When set,
      // `literal` is ignored by prtfEdits.ts's addConstant case — the new
      // constant carries the bare keyword only (matching real DDS: DATE/
      // TIME/PAGNBR constants take no literal text token at all — see
      // "Constant fields in printer files" in IBM's DDS Reference:
      // Printer Files), not an empty-string literal.
      systemConstantKeyword?: "DATE" | "TIME" | "PAGNBR";
    }
  // Batch P — record-format container operations. Unlike field/constant
  // edits, record formats are identified by NAME (there's no stable `id`
  // for them in prtfModel.ts's RecordFormatEntry — see prtfEdits.ts).
  | { kind: "addRecord"; name: string; afterRecordName?: string }
  | { kind: "renameRecord"; oldName: string; newName: string }
  | { kind: "deleteRecord"; name: string }
  | { kind: "reorderRecord"; name: string; direction: "up" | "down" };

/** Every message shape media/webviewClient.js posts to the extension host via vscode.postMessage. */
export type WebviewMessage =
  | { type: "ready" }
  | { type: "select"; id?: string }
  | { type: "edit"; edit: WebviewEdit }
  | { type: "resolveReferencedField"; id: string; useReferencedValues?: boolean }
  // Batch H (docs/TASKS.md) "remaining" piece — the field/record-format
  // picker. library/file aren't included here: unlike resolveReferencedField
  // (which needs a field name to already be known), this is how the field
  // name gets *found* in the first place, so it deliberately reuses
  // PrtfEngine.resolveReferenceTarget's already-saved library/file (same
  // source resolveReferencedField itself reads) rather than trusting
  // whatever's currently typed into the (possibly unsaved) webview inputs.
  | { type: "browseReferencedField"; id: string };

