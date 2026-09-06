import { ParsedSource, RecordFormatEntry, FieldEntry, ConstantEntry, Keyword } from "./prtfModel";
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
 * Batch Y — DDS field names within one record format must be unique.
 * Given a desired name (typically a database field's own name, when
 * bringing several fields in at once via "Add fields from database
 * file"), returns it unchanged if nothing in `record` already uses it, or
 * the shortest `<truncated-base><n>` (n starting at 2, incrementing until
 * free) that fits within DDS's 10-character field-name limit otherwise —
 * e.g. adding a field named CUSTNO into a record that already has one
 * yields CUSTNO2, not a collision the writer would silently accept. Pure
 * and pre-existing-record-aware (unlike I-SDA's own
 * nextAvailableFieldName, which always appends a numeric suffix even when
 * the base name is already free — checked here first, since re-adding the
 * SAME field twice from two different source files should still just be
 * named after itself the first time).
 */
export function nextAvailableFieldName(record: RecordFormatEntry, desiredName: string): string {
  const MAX_LEN = 10;
  const used = new Set(record.fields.filter((f) => f.kind === "field").map((f) => (f as FieldEntry).name.toUpperCase()));
  const base = (desiredName || "FLD").toUpperCase().slice(0, MAX_LEN);
  if (!used.has(base)) return base;
  let n = 2;
  while (true) {
    const suffix = String(n);
    const truncated = (desiredName || "FLD").toUpperCase().slice(0, Math.max(1, MAX_LEN - suffix.length));
    const candidate = truncated + suffix;
    if (!used.has(candidate)) return candidate;
    n++;
  }
}

/**
 * Batch II — record format names, like field names (see
 * nextAvailableFieldName above), must be unique — but scoped to the whole
 * MODEL (model.records), not to one record's own fields, and DDS's
 * 19-28 name column gives them the same 10-character limit. Used by
 * "duplicateRecord" below to name a cloned record format without
 * colliding with the source (or any other existing record). Same
 * "already-free base name wins outright" behavior as
 * nextAvailableFieldName, for the same reason — re-duplicating a record
 * that already has no colliding name shouldn't force a numeric suffix it
 * doesn't need (in practice this only matters if the desired base name
 * was somehow already free, since duplicateRecord's own caller always
 * passes the SOURCE record's name, which is by definition already used).
 */
export function nextAvailableRecordName(model: ParsedSource, desiredName: string): string {
  const MAX_LEN = 10;
  const used = new Set(model.records.map((r) => r.name.toUpperCase()));
  const base = (desiredName || "REC").toUpperCase().slice(0, MAX_LEN);
  if (!used.has(base)) return base;
  let n = 2;
  while (true) {
    const suffix = String(n);
    const truncated = (desiredName || "REC").toUpperCase().slice(0, Math.max(1, MAX_LEN - suffix.length));
    const candidate = truncated + suffix;
    if (!used.has(candidate)) return candidate;
    n++;
  }
}

/**
 * Batch II — generates ids for cloned field/constant entries that can't
 * collide with any id already present anywhere in the model. Separate from
 * prtfParser.ts's own per-parse `nextId()` counter (which starts fresh at
 * "e0" every parse and would very likely collide with real ids already in
 * this in-memory model, which was itself produced by a parse), and from
 * Batch Q's copy-a-single-field flow (which doesn't need this at all — a
 * single copied field's id is assigned server-side the same way any other
 * addField is, via the SAME per-parse counter, because it only happens
 * once at the point a fresh field is placed, not against an already-parsed
 * model with a pre-existing id namespace to avoid stepping on).
 */
function makeIdGenerator(model: ParsedSource): () => string {
  const used = new Set<string>();
  for (const r of model.records) {
    for (const f of r.fields) used.add(f.id);
  }
  let counter = 0;
  return () => {
    let id: string;
    do {
      id = "edup" + counter++;
    } while (used.has(id));
    used.add(id);
    return id;
  };
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
      // Batch Z (docs/TASKS.md) fix: an empty Text input used to write
      // literal: "" unconditionally, which — for a system-constant field
      // (DATE/TIME/PAGNBR, no literal at all in real DDS — see prtfWriter.js's
      // emit, which treats `entry.literal !== undefined` as "there IS a
      // literal token to emit") — regenerated a spurious `''` token next
      // to the keyword on next write-back. An empty Text field now means
      // "no literal", same as a freshly-parsed system-constant's entry.literal
      // being undefined in the first place (see prtfParser.ts's constant
      // branch, which only sets .literal when a quoted token is actually
      // present).
      Object.assign(found.entry, { literal: edit.literal || undefined, line: edit.line, position: edit.position });
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
    case "setFieldSampleValue": {
      // Batch HH — field-only (see FieldEntry.sampleValue's own comment
      // for why this is in-memory/session-only, never written to source).
      // Rejects a constant id rather than silently no-op'ing on it, same
      // "found but wrong kind -> false" shape prtfKeywordValidation.js's
      // own field-only checks use elsewhere.
      const found = findEntryById(model, edit.id);
      if (!found || found.entry.kind !== "field") return false;
      const value = edit.sampleValue || "";
      if (value) found.entry.sampleValue = value;
      else delete found.entry.sampleValue;
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
      // Batch Z (docs/TASKS.md) — "Add system constant": a bare DATE/TIME/
      // PAGNBR keyword, no literal text token, appended alongside whatever
      // Batch Q copy-keywords (if any) already populated copiedKeywords.
      if (edit.kind === "addConstant" && edit.systemConstantKeyword) {
        copiedKeywords.push({
          name: edit.systemConstantKeyword,
          params: "",
          raw: edit.systemConstantKeyword,
          sourceLineIndex: -1,
        });
      }
      const newEntry: FieldEntry | ConstantEntry =
        edit.kind === "addField"
          ? {
              kind: "field",
              id: "tmp" + Date.now(),
              sourceLineIndex: -1,
              name: edit.name,
              // Batch Y — see webviewProtocol.ts's comment on this field:
              // true for a field added via "Add fields from database
              // file" (position 29 'R'), false for a plain "+ Field" add
              // or a Batch Q copy (edit.reference omitted in both those
              // cases, so this keeps their prior hardcoded-false
              // behavior unchanged).
              reference: !!edit.reference,
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
              // Batch Z — a system-constant add carries no literal at all
              // (real DDS constant fields defined via DATE/TIME/PAGNBR take
              // no literal text token — see the systemConstantKeyword
              // comment on this edit kind in webviewProtocol.ts); an empty
              // Text field on a plain literal-text add means the same
              // thing a freshly-parsed blank constant would (undefined,
              // not ""), matching the updateConstant fix above.
              literal: edit.systemConstantKeyword ? undefined : edit.literal || undefined,
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
    // Batch II — clone an entire record format (header + every field/
    // constant/keyword) in one action. Unlike Batch Q's single-field copy,
    // a record format's own fields are copied byte-for-byte VERBATIM,
    // unchanged — DDS scopes field names per record format, not file-wide,
    // so a copied record's fields keep their exact original names with no
    // collision risk (the hard problem Batch Q actually has to solve
    // doesn't apply here). Only the record format's own NAME needs a
    // fresh, non-colliding one (nextAvailableRecordName above).
    case "duplicateRecord": {
      const sourceRecord = model.records.find((r) => r.name === edit.name);
      if (!sourceRecord) return false;
      const newName = nextAvailableRecordName(model, sourceRecord.name);
      const nextId = makeIdGenerator(model);

      // Keywords/conditions are cloned (not shared by reference) so an
      // edit to either copy's keywords later can't mutate the other's;
      // sourceLineIndex is reset to -1 since these are new physical lines
      // that don't exist anywhere in the original source yet — same
      // convention every other freshly-added entry in this file uses.
      const cloneConditions = (conditions: RecordFormatEntry["conditions"]) => conditions.map((c) => ({ ...c }));
      const cloneKeywords = (keywords: Keyword[]): Keyword[] =>
        keywords.map((k) => ({ ...k, sourceLineIndex: -1, conditions: k.conditions ? k.conditions.map((c) => ({ ...c })) : undefined }));

      const newRecord: RecordFormatEntry = {
        kind: "record",
        sourceLineIndex: -1,
        name: newName,
        conditions: cloneConditions(sourceRecord.conditions),
        keywords: cloneKeywords(sourceRecord.keywords),
        fields: [],
        formType: sourceRecord.formType,
      };

      const clonedFields: (FieldEntry | ConstantEntry)[] = sourceRecord.fields.map((f) => {
        if (f.kind === "field") {
          const clone: FieldEntry = {
            kind: "field",
            id: nextId(),
            sourceLineIndex: -1,
            name: f.name,
            reference: f.reference,
            length: f.length,
            dataType: f.dataType,
            decimalPositions: f.decimalPositions,
            usage: f.usage,
            line: f.line,
            position: f.position,
            conditions: cloneConditions(f.conditions),
            keywords: cloneKeywords(f.keywords),
            formType: f.formType,
          };
          return clone;
        }
        const constantClone: ConstantEntry = {
          kind: "constant",
          id: nextId(),
          sourceLineIndex: -1,
          literal: f.literal,
          line: f.line,
          position: f.position,
          conditions: cloneConditions(f.conditions),
          keywords: cloneKeywords(f.keywords),
          formType: f.formType,
        };
        return constantClone;
      });
      newRecord.fields = clonedFields;

      // Insert the new record right after the source record in
      // model.records (same "duplicate lands right next to its source"
      // placement addRecord's own afterRecordName default follows).
      const recordsIdx = model.records.indexOf(sourceRecord);
      model.records.splice(recordsIdx + 1, 0, newRecord);

      // Insert the new record's whole block (the record entry followed by
      // every cloned field/constant, in original order) right after the
      // SOURCE record's own block in model.sequence — its block being
      // itself plus everything up to (but not including) the next
      // record-kind entry, same definition reorderRecord's own blockRange
      // uses, so any trailing comments after the source stay attached to
      // the source rather than being swept into the new duplicate.
      const seqStart = model.sequence.indexOf(sourceRecord);
      let seqEnd = model.sequence.length;
      for (let i = seqStart + 1; i < model.sequence.length; i++) {
        if (model.sequence[i].kind === "record") {
          seqEnd = i;
          break;
        }
      }
      model.sequence.splice(seqEnd, 0, newRecord, ...clonedFields);
      return true;
    }
    // Batch JJ — bulk move/delete/copy for a multi-selected set of
    // fields/constants (see webviewProtocol.ts's comment on these three
    // edit kinds for the delta-based design and the same-record-only
    // bulkCopy scope boundary).
    case "bulkMove": {
      let changed = false;
      for (const id of edit.ids) {
        const found = findEntryById(model, id);
        if (!found) continue; // stale id (e.g. already deleted by a prior edit in the same batch) — skip, don't fail the whole bulk operation
        found.entry.line = (found.entry.line || 0) + edit.deltaLine;
        found.entry.position = (found.entry.position || 0) + edit.deltaPosition;
        changed = true;
      }
      return changed;
    }
    case "bulkDelete": {
      let changed = false;
      for (const id of edit.ids) {
        const found = findEntryById(model, id);
        if (!found) continue;
        found.record.fields.splice(found.fieldsIndex, 1);
        const seqIndex = model.sequence.indexOf(found.entry);
        if (seqIndex !== -1) model.sequence.splice(seqIndex, 1);
        changed = true;
      }
      return changed;
    }
    case "bulkCopy": {
      const record = model.records.find((r) => r.name === edit.recordName);
      if (!record) return false;
      const nextId = makeIdGenerator(model);
      let changed = false;
      for (const id of edit.ids) {
        const found = findEntryById(model, id);
        // v1 scope: only ids that belong to the TARGET record are copied —
        // matches Batch Q's own single-field "same-record copy only"
        // boundary. A multi-select spanning several records (not possible
        // via today's webview UI, which scopes selection to the currently
        // open record, but defensive here regardless) silently skips any
        // id outside `record` rather than copying it somewhere the person
        // never asked for.
        if (!found || found.record !== record) continue;
        const src = found.entry;
        const newLine = (src.line || 0) + edit.deltaLine;
        const newPosition = (src.position || 0) + edit.deltaPosition;
        // Keywords are cloned (not shared by reference), sourceLineIndex
        // reset to -1 — same convention duplicateRecord's own
        // cloneKeywords uses, for the same reason (these are new physical
        // lines with no source line of their own yet).
        const clonedKeywords: Keyword[] = src.keywords.map((k) => ({
          ...k,
          sourceLineIndex: -1,
          conditions: k.conditions ? k.conditions.map((c) => ({ ...c })) : undefined,
        }));
        let clone: FieldEntry | ConstantEntry;
        if (src.kind === "field") {
          clone = {
            kind: "field",
            id: nextId(),
            sourceLineIndex: -1,
            name: nextAvailableFieldName(record, src.name),
            reference: src.reference,
            length: src.length,
            dataType: src.dataType,
            decimalPositions: src.decimalPositions,
            usage: src.usage,
            line: newLine,
            position: newPosition,
            // Batch JJ v1: the source's OWN entry-level conditioning
            // (unrelated to the keyword-level conditions cloned above)
            // isn't carried over, same limitation Batch Q's single-field
            // copy already has (addField's edit shape has no
            // sourceConditions field either) — a fresh, unconditioned
            // copy either way.
            conditions: [],
            keywords: clonedKeywords,
          };
        } else {
          clone = {
            kind: "constant",
            id: nextId(),
            sourceLineIndex: -1,
            literal: src.literal,
            line: newLine,
            position: newPosition,
            conditions: [],
            keywords: clonedKeywords,
          };
        }
        record.fields.push(clone);
        // Same "right after its own source" placement duplicateRecord's
        // per-clone fields use — keeps a copied block visually adjacent to
        // what it was copied from in the regenerated source, even though
        // resolveLayout's placement of these entries only ever depends on
        // their own explicit line/position, never on model.sequence order.
        const anchorIndex = model.sequence.indexOf(src);
        model.sequence.splice(anchorIndex === -1 ? model.sequence.length : anchorIndex + 1, 0, clone);
        changed = true;
      }
      return changed;
    }
    default:
      return false;
  }
}
