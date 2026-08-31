import { ParsedSource, RecordFormatEntry, FieldEntry, ConstantEntry } from "./prtfModel";
import { WebviewEdit } from "./webviewProtocol";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { upsertReffldKeyword } = require("./prtfWriter.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PrtfEngine = require("./prtfEngine.js");

/**
 * Finds the field or constant with the given stable id, along with its
 * owning record and index within that record's `fields` array — the lookup
 * every id-scoped edit (move/update/delete/setFieldKeyword/...) and
 * extension.ts's "Resolve Referenced Field" handler need before they can
 * touch an entry. Shared here so there's exactly one place that knows how to
 * walk model.records to find an entry by id, rather than each caller
 * re-implementing the same loop.
 */
export function findEntryById(
  model: ParsedSource,
  id: string
): { record: RecordFormatEntry; entry: FieldEntry | ConstantEntry; fieldsIndex: number } | null {
  for (const record of model.records) {
    const fieldsIndex = record.fields.findIndex((f) => f.id === id);
    if (fieldsIndex !== -1) return { record, entry: record.fields[fieldsIndex], fieldsIndex };
  }
  return null;
}

/**
 * Mutates `model` in place to apply one structured edit from the webview.
 * Every edit kind follows the same shape: find the target by id/recordName,
 * mutate it, and (for delete/addField/addConstant) keep model.sequence in
 * sync with model.records[*].fields, since prtfWriter.regenerateSource walks
 * model.sequence.
 *
 * Deliberately has NO dependency on vscode or on prtfWriter's
 * regenerateSource — this is pure in-memory model mutation, nothing else —
 * so it can be unit tested directly (see test/prtfEdits.test.ts) the same
 * way prtfParser/prtfWriter/prtfEngine already are, without needing a live
 * VS Code extension host or a real TextDocument. extension.ts's applyEdit is
 * a thin wrapper: call this, then (if it returns true) regenerate the
 * source and write it back as a single WorkspaceEdit.
 *
 * Returns true if the model was actually changed and the caller should
 * regenerate + write the document; false for a no-op — an unrecognized
 * edit.kind, or a dangling id/recordName that no longer exists in the
 * current model (e.g. a stale webview message for an entry a previous edit
 * already deleted).
 */
export function applyEditToModel(model: ParsedSource, edit: WebviewEdit): boolean {
  switch (edit.kind) {
    case "move": {
      const found = findEntryById(model, edit.id);
      if (!found) return false;
      found.entry.line = edit.line;
      found.entry.position = edit.position;
      return true;
    }
    case "updateField": {
      const found = findEntryById(model, edit.id);
      if (!found || found.entry.kind !== "field") return false;
      Object.assign(found.entry, {
        name: edit.name,
        length: edit.length,
        dataType: edit.dataType,
        decimalPositions: edit.decimalPositions,
        usage: edit.usage,
        line: edit.line,
        position: edit.position,
      });
      // Batch H (docs/TASKS.md) — "Reference a field" Y/N toggle (position
      // 29 'R'). `edit.reference` is only sent when the toggle itself was
      // touched (the panel always includes the field's current value, so
      // this is really "was the panel showing a reference field"); when
      // present, keep the REFFLD keyword in sync with whatever
      // field/library/file the panel's picker inputs carried, or drop it
      // entirely if the toggle was switched off. See
      // PrtfEngine.resolveReferenceTarget for how REFFLD/REF are read back
      // out, and KEYWORD-INVENTORY.md §3 for the RLU UI shape this mirrors.
      if (edit.reference !== undefined) {
        found.entry.reference = !!edit.reference;
        found.entry.keywords = upsertReffldKeyword(
          found.entry.keywords,
          edit.reference ? { fieldName: edit.refFieldName, library: edit.refLibrary, file: edit.refFile } : null
        );
      }
      return true;
    }
    case "updateConstant": {
      const found = findEntryById(model, edit.id);
      if (!found || found.entry.kind !== "constant") return false;
      Object.assign(found.entry, { literal: edit.literal, line: edit.line, position: edit.position });
      return true;
    }
    case "delete": {
      const found = findEntryById(model, edit.id);
      if (!found) return false;
      found.record.fields.splice(found.fieldsIndex, 1);
      const seqIndex = model.sequence.indexOf(found.entry);
      if (seqIndex !== -1) model.sequence.splice(seqIndex, 1);
      return true;
    }
    case "setRecordKeyword": {
      // Batch F (and reusable by future keyword-panel batches): adds or
      // replaces a record-level keyword by name. These keywords aren't
      // repeating for this batch's set (DUPLEX/FORCE/OUTBIN/ZFOLD/
      // STAPLE/INVMMAP each appear at most once per record), so "set"
      // replaces any existing entry with the same name rather than
      // appending a duplicate.
      const record = model.records.find((r) => r.name === edit.recordName);
      if (!record) return false;
      const raw = edit.params ? edit.name + edit.params : edit.name;
      const existingIndex = record.keywords.findIndex((k) => k.name === edit.name);
      const newKeyword = { name: edit.name, params: edit.params || "", raw, sourceLineIndex: -1 };
      if (existingIndex !== -1) record.keywords[existingIndex] = newKeyword;
      else record.keywords.push(newKeyword);
      return true;
    }
    case "removeRecordKeyword": {
      const record = model.records.find((r) => r.name === edit.recordName);
      if (!record) return false;
      const idx = record.keywords.findIndex((k) => k.name === edit.name);
      if (idx !== -1) record.keywords.splice(idx, 1);
      return true;
    }
    case "setFieldKeyword": {
      // Shared by Batch G (ALIAS, BLKFOLD, CVTDTA, DLTEDT, FLTFIXDEC,
      // FLTPCN, TRNSPY, TXTRTT) and Batch B (FONT, CDEFNT, FNTCHRSET,
      // FONTNAME, CHRID, CHRSIZ, CCSID) — adds or replaces a
      // field/constant-level keyword by name, targeting by id (fields/
      // constants don't have a unique name the way record formats do).
      // Deliberately NOT restricted to entry.kind === "field": Batch B's
      // keywords (FONT etc.) are valid DDS on constants too — a
      // constant is rendered text, same as a field, and DDS doesn't
      // distinguish them for font/sizing purposes. Batch G's own keyword
      // set happens to be field-specific (several require a data type
      // constants don't have), but that's enforced by Batch G's UI only
      // showing its panel for fields, not by this shared handler — don't
      // re-add a kind check here without checking both batches' UIs
      // still work if you do. Both sets are non-repeating (at most one
      // keyword instance per name per entry), so "set" replaces any
      // existing entry with the same name rather than appending a
      // duplicate. Not used for REFFLD (see upsertReffldKeyword, Batch
      // H) or INDTXT (repeating, keyed by indicator number rather than
      // by keyword name alone — see PrtfEngine.collectIndicatorDescriptions)
      // since neither fits this "set once per name" shape.
      const found = findEntryById(model, edit.id);
      if (!found) return false;
      const raw = edit.params ? edit.name + edit.params : edit.name;
      const existingIndex = found.entry.keywords.findIndex((k) => k.name === edit.name);
      const newKeyword = { name: edit.name, params: edit.params || "", raw, sourceLineIndex: -1 };
      if (existingIndex !== -1) found.entry.keywords[existingIndex] = newKeyword;
      else found.entry.keywords.push(newKeyword);
      return true;
    }
    case "removeFieldKeyword": {
      const found = findEntryById(model, edit.id);
      if (!found) return false;
      const idx = found.entry.keywords.findIndex((k) => k.name === edit.name);
      if (idx !== -1) found.entry.keywords.splice(idx, 1);
      return true;
    }
    case "setIndicatorText": {
      // Batch G — INDTXT (docs/KEYWORD-INVENTORY.md §1) is a repeating
      // keyword: a record can carry one INDTXT per indicator it wants to
      // document, so this can't reuse setRecordKeyword's "one keyword
      // per name, replace whichever's there" logic — it has to find the
      // specific INDTXT entry for THIS indicator (via
      // PrtfEngine.parseIndtxt) and only touch that one, leaving any
      // INDTXT for other indicators untouched. Scoped to the record
      // level here, matching the indicator-toggle panel's own per-record
      // scope (see PrtfEngine.collectIndicatorDescriptions for why
      // file/field-level INDTXT are still read, just not editable from
      // this panel).
      const record = model.records.find((r) => r.name === edit.recordName);
      if (!record) return false;
      const text = String(edit.text || "").replace(/'/g, "''");
      const params = "(" + edit.indicator + " '" + text + "')";
      const newKeyword = { name: "INDTXT", params, raw: "INDTXT" + params, sourceLineIndex: -1 };
      const existingIndex = record.keywords.findIndex(
        (k) => k.name === "INDTXT" && PrtfEngine.parseIndtxt(k) && PrtfEngine.parseIndtxt(k).indicator === edit.indicator
      );
      if (existingIndex !== -1) record.keywords[existingIndex] = newKeyword;
      else record.keywords.push(newKeyword);
      return true;
    }
    case "removeIndicatorText": {
      const record = model.records.find((r) => r.name === edit.recordName);
      if (!record) return false;
      const idx = record.keywords.findIndex(
        (k) => k.name === "INDTXT" && PrtfEngine.parseIndtxt(k) && PrtfEngine.parseIndtxt(k).indicator === edit.indicator
      );
      if (idx !== -1) record.keywords.splice(idx, 1);
      return true;
    }
    case "addField":
    case "addConstant": {
      const record = model.records.find((r) => r.name === edit.recordName);
      if (!record) return false;
      const newEntry: FieldEntry | ConstantEntry =
        edit.kind === "addField"
          ? {
              kind: "field",
              id: "tmp" + Date.now(),
              sourceLineIndex: -1,
              name: edit.name,
              reference: false,
              length: edit.length,
              dataType: edit.dataType,
              decimalPositions: edit.decimalPositions,
              usage: edit.usage,
              line: edit.line,
              position: edit.position,
              conditions: [],
              keywords: [],
            }
          : {
              kind: "constant",
              id: "tmp" + Date.now(),
              sourceLineIndex: -1,
              literal: edit.literal,
              line: edit.line,
              position: edit.position,
              conditions: [],
              keywords: [],
            };
      record.fields.push(newEntry);
      // Insert into the sequence right after this record's last existing
      // field/constant (or right after the record entry itself if it had
      // none), so the new line lands in a sensible place in the source.
      const lastFieldOfRecord = record.fields.length > 1 ? record.fields[record.fields.length - 2] : null;
      const anchor = lastFieldOfRecord || record;
      const anchorIndex = model.sequence.indexOf(anchor);
      model.sequence.splice(anchorIndex === -1 ? model.sequence.length : anchorIndex + 1, 0, newEntry);
      return true;
    }
    default:
      return false;
  }
}
