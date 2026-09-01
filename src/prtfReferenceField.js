"use strict";
/**
 * Resolve Referenced Field (REF/REFFLD, position 29 'R') — Batch H (see
 * docs/TASKS.md). Given a field flagged as a database reference, works out
 * WHICH field, in WHICH library/file, its length/type/decimals should be
 * resolved from — the pure "where do I look" half of "Resolve Referenced
 * Field via Code for i"; the actual network round-trip (DSPFFD + an SQL
 * lookup) only makes sense on the extension host, so it lives in
 * extension.ts, built on top of this. Mirrors I-SDA's own
 * DspfEngine.resolveReferenceTarget (src/dspfEngine.js), adapted for PRTF's
 * REF being valid at file, record, OR field level (KEYWORD-INVENTORY.md
 * §1/§3), not just file level. See "When to specify REF and REFFLD
 * keywords for DDS files" in IBM's DDS reference for the precedence rules
 * this follows:
 *   - REFFLD's own field-name parameter (defaulting to this field's own
 *     name when REFFLD isn't present at all — a bare R means "same-named
 *     field").
 *   - REFFLD's own [library/]file parameter, if given, OVERRIDES any
 *     record- or file-level REF.
 *   - REFFLD(field-name *SRC) means "search the file being defined" —
 *     there's no live database file to query for that, so this returns
 *     null (unresolvable via this feature) rather than guessing.
 *   - With no REFFLD file/library at all, falls back to the record-level
 *     REF keyword, then the file-level REF keyword; with none of those,
 *     there's nothing to resolve against.
 *
 * Split out of the old monolithic prtfEngine.js (docs/TASKS.md review
 * comment #5) — this is the one piece of that file with no dependency on
 * layout/geometry at all, so it gets its own module.
 */

// eslint-disable-next-line no-undef
const { findKeyword, paramTokens } = typeof module !== "undefined" && module.exports ? require("./prtfKeywordHelpers.js") : window.PrtfKeywordHelpers;

/** @returns {{fieldName:string, library:?string, file:string}|null} */
function resolveReferenceTarget(model, record, field) {
  if (!field || field.kind !== "field" || !field.reference) return null;

  const reffld = findKeyword(field.keywords, "REFFLD");
  let fieldName = field.name;
  let fileSpec = null;

  if (reffld) {
    const parts = paramTokens(reffld);
    if (parts.length === 0) return null;
    fieldName = parts[0];
    if (parts.length > 1) {
      if (parts[1].toUpperCase() === "*SRC") return null; // "search this DDS file itself" — no live file to query
      fileSpec = parts[1];
    }
  }

  if (!fileSpec) {
    const recordRef = record && findKeyword(record.keywords, "REF");
    const fileRef = model && model.fileLevel && findKeyword(model.fileLevel.keywords, "REF");
    const refKw = recordRef || fileRef;
    if (!refKw) return null; // nothing to resolve against
    const refParts = paramTokens(refKw);
    if (refParts.length === 0) return null;
    fileSpec = refParts[0];
  }

  const slash = fileSpec.indexOf("/");
  const library = slash >= 0 ? fileSpec.slice(0, slash) : null;
  const file = slash >= 0 ? fileSpec.slice(slash + 1) : fileSpec;
  if (!file) return null;

  return { fieldName, library, file };
}

/**
 * Interprets one DSPFFD OUTFILE row (QADSPFFD/QWHDRFFD format) into DDS's
 * own length/type/decimals shape. Same mapping I-SDA's own
 * mapDspffdRowToAttributes uses (src/extension.ts) — WHFLDT='A' (character)
 * means WHFLDB (byte length) is the field's length; anything else
 * (numeric) means WHFLDD (total digits) is, with WHFLDP as decimal
 * positions when positive. Pure (no vscode/Code-for-i dependency, unlike
 * the DSPFFD command/SQL that produces `row` in the first place — that
 * I/O lives in extension.ts, same "pure logic here, I/O there" split as
 * resolveReferenceTarget vs. extension.ts's fetchReferencedFieldAttributes
 * above), so it moved here from extension.ts (where it started, duplicating
 * I-SDA's copy verbatim) once a second caller — Batch H's field-browsing
 * picker's groupDatabaseFileFieldRows, below — needed the same mapping and
 * a single shared copy was clearly better than two.
 */
function mapDspffdRowToAttributes(row) {
  const rowValue = (key) => (row[key] !== undefined ? row[key] : row[String(key).toLowerCase()]);
  const whfldt = String(rowValue("WHFLDT") || "").trim().toUpperCase();
  const whfldb = Number(rowValue("WHFLDB"));
  const whfldd = Number(rowValue("WHFLDD"));
  const whfldp = Number(rowValue("WHFLDP"));

  if (whfldt === "A") {
    return { length: whfldb, dataType: "", decimalPositions: null };
  }
  return { length: whfldd, dataType: whfldt, decimalPositions: whfldp > 0 ? whfldp : null };
}

/**
 * Batch H (docs/TASKS.md) "remaining" piece — the field/record-format
 * *picker*, following I-SDA's own Task L14
 * (fetchDatabaseFileFields/listDatabaseFields, src/extension.ts) as "the
 * closest existing pattern", per that batch's own task description.
 *
 * This is the one piece of that lookup with no I/O — given DSPFFD OUTFILE
 * rows extension.ts's fetchDatabaseFileFields already fetched (a
 * `library`/`file`'s full field list, every record format at once when
 * `recordFormat` isn't given), decides whether the file has more than one
 * record format (WHNAME is DSPFFD's own record-format-name column — same
 * column I-SDA's own fetchDatabaseFileFields groups by) and if so returns
 * just the distinct format names for the caller to disambiguate with
 * (rather than misordering WHFLDO across formats, or silently guessing
 * one), or otherwise maps every row into a field via
 * mapDspffdRowToAttributes and returns the field list. Split out as a
 * pure function (unlike I-SDA's own inline version of this logic) so it's
 * unit-testable without a live IBM i connection, the same "pure logic vs.
 * I/O" split resolveReferenceTarget/fetchReferencedFieldAttributes already
 * follow in this codebase.
 *
 * @returns {{formats:string[]}|{fields:Array<{name:string,text:string,length:number,dataType:string,decimalPositions:?number}>,recordFormat:string}|{error:string}}
 */
function groupDatabaseFileFieldRows(rows, recordFormat) {
  const rowValue = (row, key) => (row[key] !== undefined ? row[key] : row[String(key).toLowerCase()]);

  if (!rows || rows.length === 0) {
    return recordFormat ? { error: `Record format "${recordFormat}" was not found.` } : { error: "No fields found." };
  }

  if (!recordFormat) {
    const distinctFormats = Array.from(new Set(rows.map((row) => String(rowValue(row, "WHNAME") || "").trim())));
    if (distinctFormats.length > 1) return { formats: distinctFormats };
  }

  const fields = rows.map((row) => ({
    name: String(rowValue(row, "WHFLDI") || "").trim(),
    text: String(rowValue(row, "WHFTXT") || "").trim(),
    ...mapDspffdRowToAttributes(row),
  }));
  return { fields, recordFormat: recordFormat || String(rowValue(rows[0], "WHNAME") || "").trim() };
}

const mod = { resolveReferenceTarget, mapDspffdRowToAttributes, groupDatabaseFileFieldRows };
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfReferenceField = mod;
