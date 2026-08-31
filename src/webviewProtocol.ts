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
    }
  | { kind: "addConstant"; recordName: string; line: number; position: number; literal: string };

/** Every message shape media/webviewClient.js posts to the extension host via vscode.postMessage. */
export type WebviewMessage =
  | { type: "ready" }
  | { type: "select"; id?: string }
  | { type: "edit"; edit: WebviewEdit }
  | { type: "resolveReferencedField"; id: string; useReferencedValues?: boolean };

