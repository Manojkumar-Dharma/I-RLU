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

const mod = { resolveReferenceTarget };
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfReferenceField = mod;
