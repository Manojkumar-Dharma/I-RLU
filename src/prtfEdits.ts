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
      // Batch Q (docs/TASKS.md) — the actual point of "copy a field/
      // constant" is that its keywords come along too, not just its
      // position/type. edit.sourceKeywords carries name/params pairs only
      // (see webviewProtocol.ts's comment on this field for why); rebuild
      // each into a full Keyword the same way setRecordKeyword/
      // setFieldKeyword already do for a freshly-set keyword (raw =
      // name+params, sourceLineIndex -1, since this entry has no source
      // line yet either). A plain "+ Field"/"+ Constant" add (no
      // sourceKeywords) still gets the same empty [] it always has.
      const copiedKeywords = (edit.sourceKeywords || []).map((k) => ({
        name: k.name,
        params: k.params || "",
        raw: k.params ? k.name + k.params : k.name,
        sourceLineIndex: -1,
      }));
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
              keywords: copiedKeywords,
            }
          : {
              kind: "constant",
              id: "tmp" + Date.now(),
              sourceLineIndex: -1,
              literal: edit.literal,
              line: edit.line,
              position: edit.position,
              conditions: [],
              keywords: copiedKeywords,
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
    // Batch P — record-format container operations. Record formats are
    // identified by NAME (see webviewProtocol.ts's comment on this batch's
    // edit kinds), so these look up model.records by name rather than by
    // the stable `id` findEntryById uses for fields/constants.
    case "addRecord": {
      const name = (edit.name || "").trim();
      if (!name) return false;
      if (model.records.some((r) => r.name === name)) return false; // record names must be unique
      const newRecord: RecordFormatEntry = {
        kind: "record",
        sourceLineIndex: -1,
        name,
        conditions: [],
        keywords: [],
        fields: [],
      };
      // Inserted right after the currently-selected record (edit.afterRecordName),
      // not always at the end of the file — more intuitive for building up a
      // header/detail/footer sequence one record at a time (docs/TASKS.md
      // Batch P's own instruction to pick one and document the reasoning).
      // Falls back to appending at the end when afterRecordName is omitted
      // or doesn't match any existing record (e.g. an empty file with no
      // "currently selected" record yet).
      let recordsInsertIndex = model.records.length;
      let sequenceAnchor: RecordFormatEntry | FieldEntry | ConstantEntry | null = null;
      if (edit.afterRecordName) {
        const afterIndex = model.records.findIndex((r) => r.name === edit.afterRecordName);
        if (afterIndex !== -1) {
          recordsInsertIndex = afterIndex + 1;
          const afterRecord = model.records[afterIndex];
          sequenceAnchor = afterRecord.fields.length > 0 ? afterRecord.fields[afterRecord.fields.length - 1] : afterRecord;
        }
      }
      model.records.splice(recordsInsertIndex, 0, newRecord);
      const anchorSeqIndex = sequenceAnchor ? model.sequence.indexOf(sequenceAnchor) : -1;
      model.sequence.splice(anchorSeqIndex === -1 ? model.sequence.length : anchorSeqIndex + 1, 0, newRecord);
      return true;
    }
    case "renameRecord": {
      const record = model.records.find((r) => r.name === edit.oldName);
      if (!record) return false;
      const newName = (edit.newName || "").trim();
      if (!newName) return false;
      if (newName !== record.name && model.records.some((r) => r.name === newName)) return false; // must stay unique
      // NOTE on REF/REFFLD: confirmed against IBM's DDS reference ("When to
      // specify REF and REFFLD keywords for DDS files") that REFFLD's
      // parameters are always [field-name, *SRC-or-external-database-file]
      // — *SRC means "search the whole file being defined" by FIELD NAME,
      // it is never scoped to a particular RECORD FORMAT name within this
      // same source. Neither REF nor REFFLD ever names a record format
      // within the file being compiled, only an external database file (or
      // that external file's own record format, when it has more than
      // one) — so there is no in-model reference to a record format's own
      // name for this rename to dangle. No REF/REFFLD fixup or flagging is
      // needed here, verified rather than assumed per this batch's own
      // instruction to check.
      record.name = newName;
      return true;
    }
    case "deleteRecord": {
      const idx = model.records.findIndex((r) => r.name === edit.name);
      if (idx === -1) return false;
      const record = model.records[idx];
      // Remove the record's own fields/constants and the record entry
      // itself from model.sequence (not just clear record.fields), so
      // regenerateSource doesn't still walk and re-emit them.
      for (const f of record.fields) {
        const seqIdx = model.sequence.indexOf(f);
        if (seqIdx !== -1) model.sequence.splice(seqIdx, 1);
      }
      const recordSeqIdx = model.sequence.indexOf(record);
      if (recordSeqIdx !== -1) model.sequence.splice(recordSeqIdx, 1);
      model.records.splice(idx, 1);
      return true;
    }
    case "reorderRecord": {
      const idx = model.records.findIndex((r) => r.name === edit.name);
      if (idx === -1) return false;
      const neighborIdx = edit.direction === "up" ? idx - 1 : idx + 1;
      if (neighborIdx < 0 || neighborIdx >= model.records.length) return false; // already at that edge — no-op
      const record = model.records[idx];
      const neighbor = model.records[neighborIdx];

      // Each record's "block" in model.sequence is itself plus everything
      // up to (but not including) the next record-kind entry — this
      // deliberately sweeps up any trailing comments/blank lines after a
      // record's last field along with that record, rather than splitting
      // them, since there's no way to know whether a comment right before
      // the next record's `R` line was meant as a trailing note for this
      // record or a leading one for the next.
      const blockRange = (r: RecordFormatEntry): [number, number] | null => {
        const start = model.sequence.indexOf(r);
        if (start === -1) return null;
        let end = model.sequence.length;
        for (let i = start + 1; i < model.sequence.length; i++) {
          if (model.sequence[i].kind === "record") {
            end = i;
            break;
          }
        }
        return [start, end];
      };
      const recordRange = blockRange(record);
      const neighborRange = blockRange(neighbor);
      if (!recordRange || !neighborRange) return false;

      // model.records and model.sequence are kept in the same relative
      // order (every addRecord/deleteRecord above preserves that
      // invariant), so with neighborIdx = idx±1 these two ranges are
      // adjacent in the sequence — swap their two contiguous slices in
      // place, whichever one currently comes first.
      const [firstRange, secondRange] = recordRange[0] < neighborRange[0] ? [recordRange, neighborRange] : [neighborRange, recordRange];
      const firstBlock = model.sequence.slice(firstRange[0], firstRange[1]);
      const secondBlock = model.sequence.slice(secondRange[0], secondRange[1]);
      model.sequence.splice(firstRange[0], secondRange[1] - firstRange[0], ...secondBlock, ...firstBlock);

      model.records[idx] = neighbor;
      model.records[neighborIdx] = record;
      return true;
    }
    default:
      return false;
  }
}
