"use strict";
/**
 * Batch F/G/B/TT keyword-applicability validation hints, surfaced in the
 * properties panel. None of these keywords affect page-preview layout —
 * they're print-time/physical-printer behavior, or documented restrictions
 * — so this is validation-only: CRTPRTF remains the real enforcement
 * point, nothing here blocks an edit.
 *
 * Split out of the old monolithic prtfEngine.js (docs/TASKS.md review
 * comment #5) — this file owns every "Batch X validation" function; new
 * batches that add keyword-applicability checks belong here going forward.
 */

// eslint-disable-next-line no-undef
const { findKeyword, findAllKeywords, paramTokens } =
  typeof module !== "undefined" && module.exports ? require("./prtfKeywordHelpers.js") : window.PrtfKeywordHelpers;

// --- Batch F: print/finishing keywords (DUPLEX, FORCE, OUTBIN, ZFOLD,
// STAPLE, INVMMAP) -----------------------------------------------------

/** File- and record-level keywords that take no parameters at all (option indicators only) — must be re-emitted as a bare keyword name, never "NAME()". `RELPOS` added by Batch UU (docs/TASKS.md) — file-level, no parameters, same round-trip-safety reasoning as `FORCE`/`ZFOLD`/`STAPLE`. `ENDPAGE` added by Batch YY — record-level, no parameters, same reasoning (docs/AUDIT-RECORD-LEVEL.md §5). */
const VALUELESS_KEYWORDS = ["FORCE", "ZFOLD", "STAPLE", "RELPOS", "ENDPAGE"];

/** ZFOLD/STAPLE/GDF (Batch WW) only take effect when printing through PSF — silently ignored otherwise, per IBM's DDS reference. */
const PSF_ONLY_KEYWORDS = ["ZFOLD", "STAPLE", "GDF"];

/**
 * Keywords whose presence is a strong signal a record targets *AFPDS.
 * DEVTYPE itself is a CRTPRTF/CHGPRTF/OVRPRTF command parameter, not DDS
 * source text, so I-RLU can never know for certain from the source alone
 * (same caveat as the i-rlu.unitOfMeasure setting) — this is a heuristic
 * used only to decide whether to surface the SKIPA/SKIPB/RELPOS file-level
 * hints below, not a hard classification. GDF added by Batch WW — like
 * OVERLAY/PAGSEG/AFPRSC, it's PSF-only and AFPDS-only per IBM's reference.
 */
const AFPDS_INDICATOR_KEYWORDS = [
  "FONT", "CDEFNT", "FNTCHRSET", "FONTNAME", "PAGSEG", "OVERLAY",
  "STRPAGGRP", "ENDPAGGRP", "DOCIDXTAG", "AFPRSC", "DTASTMCMD", "BARCODE", "GDF",
];

function looksLikeAfpds(model) {
  // Batch SS (docs/TASKS.md) — bug fix. This used to treat a parsed
  // "DEVTYPE" keyword as an authoritative answer, trusting file- or
  // record-level DEVTYPE(*AFPDS)/DEVTYPE(*SCS) text over the heuristic
  // below. That was wrong: DEVTYPE is a CRTPRTF/CHGPRTF/OVRPRTF COMMAND
  // parameter (see the AFPDS_INDICATOR_KEYWORDS comment above and
  // docs/AUDIT-FILE-LEVEL.md §3), not DDS source text — it can never
  // legally appear in real DDS, so a source line naming it is either a
  // hand-edited test fixture (all 3 of this project's own bundled
  // fixtures used to do exactly this) or already-invalid source, and
  // either way isn't something I-RLU should treat as ground truth. The
  // AFPDS-typical-keyword heuristic is the ONLY signal available here now.
  return model.records.some(
    (r) =>
      AFPDS_INDICATOR_KEYWORDS.some((name) => findKeyword(r.keywords, name)) ||
      r.fields.some((f) => AFPDS_INDICATOR_KEYWORDS.some((name) => findKeyword(f.keywords, name)))
  );
}

// --- Batch VV: SKIPA/SKIPB/SPACEA/SPACEB constraint validation
// (docs/AUDIT-FILE-LEVEL.md §4) -----------------------------------------
//
// All four keywords share the same three documented restrictions, worded
// near-identically in each of their own reference sections:
//  - Not valid at record or field level on a record format that also has
//    BOX, ENDPAGE, GDF, LINE, OVERLAY, PAGSEG, or POSITION specified
//    anywhere in that record format. The first six are record-level
//    keywords (checked via record.keywords); POSITION is field-level, so
//    it's checked across every field in the record instead.
//  - Not valid at record or field level on a record format where one or
//    more fields carry an explicit Location line number (columns 39-41) —
//    "the line number entries are flagged as errors" per the reference.
//  - Cardinality: at most once at record level and once per field
//    (SKIPA/SKIPB additionally once at file level — see
//    validateFileLevelKeywords).
const SKIP_SPACE_KEYWORDS = ["SKIPA", "SKIPB", "SPACEA", "SPACEB"];
const SKIP_SPACE_RECORD_EXCLUSION_KEYWORDS = ["BOX", "ENDPAGE", "GDF", "LINE", "OVERLAY", "PAGSEG"];

/** true if `record` carries BOX/ENDPAGE/GDF/LINE/OVERLAY/PAGSEG (record-level) or POSITION on any of its fields — the shared exclusion set SKIPA/SKIPB/SPACEA/SPACEB are all invalid alongside. */
function recordHasSkipSpaceExclusion(record) {
  if (SKIP_SPACE_RECORD_EXCLUSION_KEYWORDS.some((name) => findKeyword(record.keywords, name))) return true;
  return (record.fields || []).some((f) => findKeyword(f.keywords, "POSITION"));
}

/** true if any field/constant in `record` carries an explicit Location line number (columns 39-41) — the other condition SKIPA/SKIPB/SPACEA/SPACEB are all invalid alongside. */
function recordHasLineNumbers(record) {
  return (record.fields || []).some((f) => f.line !== undefined);
}

/** Shared SKIPA/SKIPB/SPACEA/SPACEB constraint warnings for one keyword array (record.keywords or a field's keywords), given the owning record's exclusion/line-number state. `scope` ("record" or "field") only changes the cardinality wording. */
function validateSkipSpaceKeywords(keywords, record, scope) {
  const warnings = [];
  const hasExclusion = recordHasSkipSpaceExclusion(record);
  const hasLineNumbers = recordHasLineNumbers(record);
  SKIP_SPACE_KEYWORDS.forEach((name) => {
    const matches = findAllKeywords(keywords, name);
    if (matches.length === 0) return;
    if (hasExclusion) {
      warnings.push({
        keyword: name,
        message: name + " is not valid at the " + scope + " level because this record format also has BOX, ENDPAGE, GDF, LINE, OVERLAY, PAGSEG, or POSITION specified.",
      });
    }
    if (hasLineNumbers) {
      warnings.push({
        keyword: name,
        message: name + " is not valid at the " + scope + " level for a record format that has line numbers specified (positions 39-41) on one or more fields — those entries are flagged as errors.",
      });
    }
    if (matches.length > 1) {
      warnings.push({
        keyword: name,
        message: name + " can only be specified once " + (scope === "record" ? "at the record level" : "per field") + ".",
      });
    }
  });
  return warnings;
}

// --- Batch YY: ENDPAGE constraint validation (docs/AUDIT-RECORD-LEVEL.md
// §4) -----------------------------------------------------------------
//
// ENDPAGE is already a member of SKIP_SPACE_RECORD_EXCLUSION_KEYWORDS
// above, so validateSkipSpaceKeywords already flags a record's
// SKIPA/SKIPB/SPACEA/SPACEB when that same record also has ENDPAGE — that
// exclusion-set constant is the single source of truth both directions
// read from, per docs/TASKS.md's own note. This section validates it from
// ENDPAGE's own side (reusing SKIP_SPACE_KEYWORDS rather than a second
// hardcoded list), plus ENDPAGE's two further documented restrictions that
// have no SKIPA/SKIPB/SPACEA/SPACEB equivalent: no constant field is
// allowed anywhere in a record that has ENDPAGE (unlike
// BOX/GDF/LINE/OVERLAY/PAGSEG's more lenient "OK if that constant also has
// its own POSITION" escape hatch — tracked separately for the field-level
// audit, not ENDPAGE, which has no such exception), and the same
// DEVTYPE(*AFPDS) heuristic requirement RELPOS/SKIPA/SKIPB already use.

/** ENDPAGE-specific constraint warnings for `record`. `model` (optional) enables the *AFPDS heuristic check; omit it to skip just that one check (same convention as the rest of this file's optional context params). */
function validateEndpageKeywords(record, model) {
  const warnings = [];
  if (!findKeyword(record.keywords, "ENDPAGE")) return warnings;
  if (SKIP_SPACE_KEYWORDS.some((name) => findKeyword(record.keywords, name))) {
    warnings.push({
      keyword: "ENDPAGE",
      message: "ENDPAGE cannot be specified together with SPACEA, SPACEB, SKIPA, or SKIPB on the same record.",
    });
  }
  if ((record.fields || []).some((f) => f.kind === "constant")) {
    warnings.push({
      keyword: "ENDPAGE",
      message: "An error is raised if a constant field is specified in a record format that also has ENDPAGE — unlike BOX/GDF/LINE/OVERLAY/PAGSEG, there's no escape hatch for this one.",
    });
  }
  if (model && !looksLikeAfpds(model)) {
    warnings.push({
      keyword: "ENDPAGE",
      message: "ENDPAGE only has an effect when this file compiles as *AFPDS (CRTPRTF's DEVTYPE parameter) — otherwise it's ignored, with a warning message issued at print time. No AFPDS-typical keywords were found elsewhere in this file.",
    });
  }
  return warnings;
}

// --- Batch CCC: BARCODE's two record-level-only exclusions
// (docs/AUDIT-CROSS-LEVEL.md §9) --------------------------------------
//
// `prtfBarcodeParams.js`'s BARCODE_EXCLUDED_KEYWORDS already checks the
// field-level "do not specify BARCODE in the same field with..." list.
// Two further constraints from the same reference section are scoped to
// the whole record format instead of a single field, so they belong here
// rather than in that field-scoped module:
//  - "You cannot specify BARCODE on the same record format with BLKFOLD,
//    CPI, or DFNCHR" — those three are record-level keywords, checked
//    against record.keywords directly.
//  - "If you specify CHRSIZ at the record level, it applies to all
//    fields in that record. If you specify BARCODE in one of those
//    fields, the BARCODE keyword is not allowed" — record-level CHRSIZ
//    combined with ANY field in the record carrying BARCODE.
const BARCODE_RECORD_EXCLUSION_KEYWORDS = ["BLKFOLD", "CPI", "DFNCHR"];

/** Record-scoped BARCODE exclusion warnings for `record` — see the Batch CCC comment above. Returns [] when the record has no field/constant with BARCODE at all (nothing to check against). */
function validateBarcodeRecordKeywords(record) {
  const warnings = [];
  const hasBarcodeField = (record.fields || []).some((f) => findKeyword(f.keywords, "BARCODE"));
  if (!hasBarcodeField) return warnings;
  BARCODE_RECORD_EXCLUSION_KEYWORDS.forEach((name) => {
    if (findKeyword(record.keywords, name)) {
      warnings.push({
        keyword: name,
        message: "BARCODE (used on a field in this record) can't be combined with " + name + " on the same record format — CRTPRTF will reject this combination.",
      });
    }
  });
  if (findKeyword(record.keywords, "CHRSIZ")) {
    warnings.push({
      keyword: "CHRSIZ",
      message: "Record-level CHRSIZ applies to every field in this record — BARCODE is not allowed on any field within a record that also has record-level CHRSIZ.",
    });
  }
  return warnings;
}

/** Validation hints for a single record's keywords — the ZFOLD/STAPLE/GDF PSF-only notice (Batch F/WW), the Batch VV SKIPA/SKIPB/SPACEA/SPACEB constraints, the Batch YY ENDPAGE constraints, the Batch CCC BARCODE record-level exclusions, plus the Batch TT "no indicators allowed" check. `model` (optional, added by Batch YY) enables the ENDPAGE *AFPDS heuristic check — callers without a model in scope (some existing tests) simply skip that one check, same "optional context param" convention Batch VV's `validateFieldKeywords(field, record)` established. Returns [] when there's nothing to flag. */
function validateRecordKeywords(record, model) {
  const warnings = [];
  PSF_ONLY_KEYWORDS.forEach((name) => {
    if (findKeyword(record.keywords, name)) {
      warnings.push({
        keyword: name,
        message: name + " is only supported when printing through PSF (Print Services Facility) — it's ignored under Host Print Transform.",
      });
    }
  });
  warnings.push(...validateSkipSpaceKeywords(record.keywords, record, "record"));
  warnings.push(...validateEndpageKeywords(record, model));
  warnings.push(...validateBarcodeRecordKeywords(record));
  return warnings.concat(validateKeywordIndicators(record.keywords));
}

/** Validation hints scoped to the whole file — the *AFPDS file-level SKIPA/SKIPB restriction (Batch F), the RELPOS/*AFPDS requirement (Batch UU), plus the Batch TT "no indicators allowed" check. Returns [] when there's nothing to flag. */
function validateFileLevelKeywords(model) {
  const warnings = [];
  ["SKIPA", "SKIPB"].forEach((name) => {
    const matches = findAllKeywords(model.fileLevel.keywords, name);
    if (matches.length === 0) return;
    if (looksLikeAfpds(model)) {
      warnings.push({
        keyword: name,
        message:
          name +
          " isn't allowed at the file level for *AFPDS spooled files (this file appears to target AFPDS — other AFPDS-typical keywords are present). Move it to the record level, or confirm this file actually compiles as SCS.",
      });
      return;
    }
    // Batch VV (docs/TASKS.md) — "If you specify the keyword at the file
    // level, you must option it with one or more indicators" (both
    // SKIPA's and SKIPB's own reference sections). Only checked in the
    // non-AFPDS branch above, since a file-level SKIPA/SKIPB isn't valid
    // at all under *AFPDS — that's already the stronger warning.
    if (!matches.some((kw) => kw.conditions && kw.conditions.length)) {
      warnings.push({
        keyword: name,
        message: name + " requires at least one option indicator when specified at the file level.",
      });
    }
    if (matches.length > 1) {
      warnings.push({ keyword: name, message: name + " can only be specified once at the file level." });
    }
  });
  // Batch UU (docs/TASKS.md) — RELPOS only has an effect for *AFPDS
  // spooled files; per IBM's reference, if DEVTYPE is anything else the
  // keyword is silently ignored, with a warning message issued at print
  // time. RELPOS is deliberately NOT in AFPDS_INDICATOR_KEYWORDS above
  // (same reasoning as SKIPA/SKIPB just above: it's validated AGAINST
  // that heuristic, not folded into it, or this check could never fire).
  if (findKeyword(model.fileLevel.keywords, "RELPOS") && !looksLikeAfpds(model)) {
    warnings.push({
      keyword: "RELPOS",
      message:
        "RELPOS only has an effect when this file compiles as *AFPDS (CRTPRTF's DEVTYPE parameter) — otherwise it's ignored, with a warning message issued at print time. No AFPDS-typical keywords were found elsewhere in this file.",
    });
  }
  return warnings.concat(validateKeywordIndicators(model.fileLevel.keywords));
}

// --- Batch G: field-level data/edit keywords (ALIAS, BLKFOLD, CVTDTA,
// DLTEDT, FLTFIXDEC, FLTPCN, TRNSPY, TXTRTT) + INDTXT indicator text ------
//
// None of these affect page-preview layout — ALIAS/CVTDTA/TRNSPY/TXTRTT
// describe how print-time data is interpreted or rotated (not something
// this character-grid preview models), BLKFOLD/DLTEDT/FLTFIXDEC/FLTPCN are
// print-time formatting choices, and INDTXT is documentation-only (no
// compile effect at all). Same validation-only approach as Batch F:
// CRTPRTF remains the real enforcement point, this just surfaces IBM's
// documented applicability rules as properties-panel hints.

/** Field-level keywords that take no parameters at all (option indicators only) — must be re-emitted as a bare keyword name, never "NAME()". */
const FIELD_LEVEL_VALUELESS_KEYWORDS = ["BLKFOLD", "DLTEDT", "TRNSPY", "FLTFIXDEC", "CVTDTA"];

/**
 * Validation hints for a single field's Batch G keywords — IBM's DDS
 * reference restricts several of these to a specific data type or to
 * reference fields, but the data-description processor is the only thing
 * that actually enforces it at compile time; this just surfaces the same
 * rule live in the designer. `record` (optional, added by Batch VV) is the
 * owning record format — when provided, also surfaces the SKIPA/SKIPB/
 * SPACEA/SPACEB constraint warnings (Batch VV) and the ALIAS uniqueness
 * check (Batch ZZ), both of which need the whole record's other
 * keywords/fields to evaluate. Every existing caller that already had a
 * record in scope (prtfLayout.js's resolveLayout) now passes it; callers
 * that only have the field in isolation (some existing tests) simply skip
 * those specific checks, same as before this batch. Returns [] when
 * there's nothing to flag.
 */
function validateFieldKeywords(field, record) {
  const warnings = [];
  if (findKeyword(field.keywords, "DLTEDT") && !field.reference) {
    warnings.push({
      keyword: "DLTEDT",
      message: "DLTEDT only has an effect on a field that references another field (position 29 'R') — it deletes EDTCDE/EDTWRD editing that would otherwise be copied in from the referenced field.",
    });
  }
  const fltfixdec = findKeyword(field.keywords, "FLTFIXDEC");
  const fltpcn = findKeyword(field.keywords, "FLTPCN");
  [fltfixdec, fltpcn].forEach((kw) => {
    if (kw && field.dataType && field.dataType !== "F") {
      warnings.push({ keyword: kw.name, message: kw.name + " only applies to floating-point fields (data type F)." });
    }
  });
  if (fltpcn) {
    const val = (paramTokens(fltpcn)[0] || "").toUpperCase();
    if (val && val !== "*SINGLE" && val !== "*DOUBLE") {
      warnings.push({ keyword: "FLTPCN", message: "FLTPCN's parameter must be *SINGLE or *DOUBLE, not " + val + "." });
    }
  }
  const trnspy = findKeyword(field.keywords, "TRNSPY");
  if (trnspy && field.dataType && field.dataType !== "A") {
    warnings.push({ keyword: "TRNSPY", message: "TRNSPY only applies to character fields (data type A)." });
  }
  const txtrtt = findKeyword(field.keywords, "TXTRTT");
  if (txtrtt) {
    const deg = paramTokens(txtrtt)[0];
    if (deg && ["0", "90", "180", "270"].indexOf(deg) === -1) {
      warnings.push({ keyword: "TXTRTT", message: "TXTRTT's rotation must be 0, 90, 180, or 270 degrees, not " + deg + "." });
    }
  }
  // Batch ZZ (docs/TASKS.md, docs/AUDIT-FIELD-LEVEL.md §2/§3) — two more
  // field-level exclusion rules, neither previously checked anywhere.
  if (findKeyword(field.keywords, "DFT")) {
    [findKeyword(field.keywords, "EDTCDE"), findKeyword(field.keywords, "EDTWRD")].forEach((editKw) => {
      if (editKw) {
        warnings.push({ keyword: editKw.name, message: editKw.name + " cannot be specified with DFT on the same field." });
      }
    });
  }
  if (findKeyword(field.keywords, "MSGCON") && ["DATE", "DFT", "EDTCDE", "EDTWRD", "TIME"].some((name) => findKeyword(field.keywords, name))) {
    warnings.push({
      keyword: "MSGCON",
      message:
        "MSGCON cannot be specified together with DATE, DFT, EDTCDE, EDTWRD, or TIME on the same field — with DFT specifically, the two are documented as functionally equivalent and the file isn't created at all if both are coded.",
    });
  }
  if (record) {
    warnings.push(
      ...validateAliasUniqueness(record)
        .filter((w) => w.fieldId === field.id)
        .map((w) => ({ keyword: w.keyword, message: w.message }))
    );
    warnings.push(...validateSkipSpaceKeywords(field.keywords, record, "field"));
  }
  return warnings.concat(validateKeywordIndicators(field.keywords));
}

/**
 * Batch B validation hints for FONT/CDEFNT/FNTCHRSET/CHRSIZ/CHRID, generic
 * over a keyword array so it works for both record-level and field-level
 * keywords without duplicating the checks. Per IBM's DDS reference:
 *  - HIGHLIGHT is ignored (with a compile-time message) if CDEFNT or
 *    FNTCHRSET is also coded on the same record/field.
 *  - CHRID is ignored (with a compile-time message) if CDEFNT or FNTCHRSET
 *    is also coded on the same record/field.
 *  - CHRSIZ requires an IPDS printer and is explicitly documented as one
 *    of the few keywords *not* supported under Host Print Transform — this
 *    is always worth a heads-up when CHRSIZ is present, not conditional on
 *    another keyword.
 *
 * `level` (optional, added by Batch CCC — docs/AUDIT-CROSS-LEVEL.md §4) is
 * "record" or "field"; when "record", also flags CHRID itself as invalid,
 * since CHRID is a field-level-only keyword per IBM's reference (unlike
 * FONT/CDEFNT/FNTCHRSET/FONTNAME, which are all valid at both levels).
 * Omitting `level` (every pre-existing call/test) preserves prior
 * behavior — this check simply never fires.
 * Returns [] when there's nothing to flag.
 */
function validateFontKeywords(keywords, level) {
  const warnings = [];
  const hasCdefnt = !!findKeyword(keywords, "CDEFNT");
  const hasFntchrset = !!findKeyword(keywords, "FNTCHRSET");
  if (level === "record" && findKeyword(keywords, "CHRID")) {
    warnings.push({
      keyword: "CHRID",
      message: "CHRID is a field-level-only keyword — it isn't valid DDS at the record level and CRTPRTF will reject it.",
    });
  }
  if ((hasCdefnt || hasFntchrset) && findKeyword(keywords, "HIGHLIGHT")) {
    warnings.push({
      keyword: "HIGHLIGHT",
      message: "HIGHLIGHT is ignored (with a compile-time message) because " + (hasCdefnt ? "CDEFNT" : "FNTCHRSET") + " is also coded here.",
    });
  }
  if ((hasCdefnt || hasFntchrset) && findKeyword(keywords, "CHRID")) {
    warnings.push({
      keyword: "CHRID",
      message: "CHRID is ignored (with a compile-time message) because " + (hasCdefnt ? "CDEFNT" : "FNTCHRSET") + " is also coded here.",
    });
  }
  if (findKeyword(keywords, "CHRSIZ")) {
    warnings.push({
      keyword: "CHRSIZ",
      message: "CHRSIZ requires an IPDS printer — it's one of the few keywords not supported under Host Print Transform.",
    });
  }
  return warnings;
}

/**
 * Parses one INDTXT keyword's "(indicator 'text')" params into
 * {indicator, text}, or null if malformed. Indicator numbers are
 * normalized to uppercase (INDTXT documents response/option indicators,
 * which are numeric, but this stays consistent with how conditioning
 * indicators are stored elsewhere in this file).
 */
function parseIndtxt(kw) {
  const m = String(kw.params || "").match(/\(\s*([A-Za-z0-9]+)\s+'((?:[^']|'')*)'/);
  if (!m) return null;
  return { indicator: m[1].toUpperCase(), text: m[2].replace(/''/g, "'") };
}

/**
 * Collects indicator -> description text from every INDTXT keyword in
 * scope for a record, so the indicator-toggle panel can show each
 * indicator's documented meaning next to its checkbox (docs/TASKS.md
 * Batch G, matching the UX I-SDA has for the same DSPF concept). INDTXT is
 * valid at file, record, AND field level (KEYWORD-INVENTORY.md §1/§2/§3),
 * so all three are scanned. When the same indicator is documented at more
 * than one level, the most specific scope wins (field, then record, then
 * file) — same "most specific wins" convention this file already follows
 * for REF/REFFLD (see prtfReferenceField.js's resolveReferenceTarget).
 */
function collectIndicatorDescriptions(model, record) {
  const result = {};
  const apply = (keywords) => {
    findAllKeywords(keywords, "INDTXT").forEach((kw) => {
      const parsed = parseIndtxt(kw);
      if (parsed) result[parsed.indicator] = parsed.text;
    });
  };
  apply(model.fileLevel.keywords);
  apply(record.keywords);
  record.fields.forEach((f) => apply(f.keywords));
  return result;
}

// --- Batch TT: centralized "option indicators not valid for this
// keyword" validation (docs/AUDIT-FILE-LEVEL.md §5, docs/AUDIT-RECORD-
// LEVEL.md §6, docs/AUDIT-FIELD-LEVEL.md §4) -----------------------------
//
// IBM's DDS reference explicitly documents that certain keywords may
// never carry their OWN conditioning indicators, even though the
// field/record/file they sit on can still be conditioned normally via
// positions 7-16 (the entry's own `conditions`, distinct from a
// keyword's own `conditions` — see prtfModel.ts's Keyword.conditions
// comment). A keyword only ends up with its own `conditions` when
// prtfParser.ts recognizes a genuine "attached keyword-only" continuation
// line (the classic RLU technique for e.g. two mutually-exclusive COLOR
// keywords, one under indicator 05, the other under N05) — so this is
// exactly the shape IBM's restriction applies to, and exactly the gap the
// audit trilogy found: nothing anywhere stopped one of these keywords
// from being given that treatment. This is one shared table consulted at
// all three levels (file/record/field), per the audit's own
// recommendation, rather than a per-batch/per-panel patch.
// Batch BBB (docs/TASKS.md, docs/AUDIT-CROSS-LEVEL.md §8) — a full-text
// sweep of every "Option indicators are not valid for this keyword"
// occurrence in docs/DDS-PRINTER-FILE-REFERENCE.txt, mapped back to its
// enclosing keyword section, found 28 keywords total. Batch TT's own two
// source audits only picked up keywords whose intro sentence explicitly
// says "...field-level keyword..." right next to the indicator note;
// most of the 15 added below state the restriction in a separate
// sentence further down their section instead, so that original
// read-through missed them. `LPI` is the only record-level one among
// them — the record-level audit didn't check for this pattern at all.
const NO_INDICATOR_KEYWORDS = [
  // File-level (docs/AUDIT-FILE-LEVEL.md §5)
  "REF", "INDARA", "RELPOS", "INDTXT", "CCSID",
  // Field-level, additional to the above (docs/AUDIT-FIELD-LEVEL.md §4)
  "ALIAS", "REFFLD", "MSGCON", "DATE", "DATFMT", "DATSEP", "TIMFMT", "TIMSEP",
  // Batch BBB — record-level (LPI) and field-level, found by the full-text
  // sweep above rather than a per-level read-through.
  "LPI",
  "BARCODE", "BLKFOLD", "CHRID", "CHRSIZ", "CVTDTA", "DFT", "DLTEDT",
  "EDTCDE", "EDTWRD", "FLTFIXDEC", "FLTPCN", "TEXT", "TIME", "TRNSPY",
];

/**
 * Scans a keyword array for any NO_INDICATOR_KEYWORDS entry that was
 * parsed with its own attached-line conditioning (`kw.conditions`,
 * non-empty) and flags it. Deliberately does NOT look at the owning
 * entry's own `conditions` — conditioning the field/record/constant as a
 * whole via positions 7-16 is always valid for every keyword here; only
 * a keyword-specific attached conditioning line is the documented
 * restriction. Returns [] when there's nothing to flag.
 */
function validateKeywordIndicators(keywords) {
  const warnings = [];
  (keywords || []).forEach((kw) => {
    if (NO_INDICATOR_KEYWORDS.indexOf(kw.name) !== -1 && kw.conditions && kw.conditions.length) {
      warnings.push({
        keyword: kw.name,
        message:
          kw.name +
          " does not accept its own conditioning indicators — option indicators are not valid for this keyword (the field/record/constant it's on can still be conditioned normally).",
      });
    }
  });
  return warnings;
}

// --- Batch ZZ: field-level small-fix bundle (docs/AUDIT-FIELD-LEVEL.md
// §1-3/§5) --------------------------------------------------------------
//
// Four independent, small fixes bundled because they're all field-level
// and all small. The TIMFMT properties-panel option-list bug lives in
// media/webviewClient.js (BATCH_A_FIELD_ONLY_KEYWORDS), not here. The
// EDTCDE/EDTWRD-vs-DFT and MSGCON exclusion checks are folded directly
// into validateFieldKeywords above (§2/§3) since they only need the one
// field's own keywords. ALIAS uniqueness (§5) is record-scoped — "must be
// different from all other alternative names and from all DDS field names
// in the record format" — so it's its own standalone function here,
// filtered down to one field's warnings inside validateFieldKeywords the
// same way Batch VV's validateSkipSpaceKeywords already needed the whole
// record in scope.

/**
 * ALIAS(alternative-name) must differ from every other field's ALIAS
 * value and from every DDS field name in the record format — a duplicate
 * either way is a compile error per the reference (constant fields have
 * no DDS name and never carry ALIAS, so they're excluded entirely). Note
 * the reference doesn't exempt a field's ALIAS from clashing with its OWN
 * name either, so that case is flagged too. Returns an array of
 * {fieldId, keyword: "ALIAS", message} — a field can appear more than
 * once if it collides on both checks. [] if the record has no ALIAS
 * keywords, or the ones it has are all fine.
 */
function validateAliasUniqueness(record) {
  const warnings = [];
  const fields = (record.fields || []).filter((f) => f.kind === "field");
  const fieldNames = fields.map((f) => (f.name || "").toUpperCase());
  const aliasEntries = fields
    .map((f) => {
      const kw = findKeyword(f.keywords, "ALIAS");
      const alias = kw ? (paramTokens(kw)[0] || "").toUpperCase() : null;
      return alias ? { field: f, alias } : null;
    })
    .filter(Boolean);

  aliasEntries.forEach(({ field, alias }) => {
    if (fieldNames.indexOf(alias) !== -1) {
      warnings.push({
        fieldId: field.id,
        keyword: "ALIAS",
        message:
          "ALIAS(" + alias + ") duplicates a DDS field name in this record format — the alternative name must differ from every field name.",
      });
    }
  });

  const byAlias = {};
  aliasEntries.forEach(({ field, alias }) => {
    (byAlias[alias] = byAlias[alias] || []).push(field);
  });
  Object.keys(byAlias).forEach((alias) => {
    const clashing = byAlias[alias];
    if (clashing.length < 2) return;
    clashing.forEach((field) => {
      const others = clashing.filter((f) => f !== field).map((f) => f.name);
      warnings.push({
        fieldId: field.id,
        keyword: "ALIAS",
        message: "ALIAS(" + alias + ") is also used on " + others.join(", ") + " in this record format — alternative names must be unique.",
      });
    });
  });
  return warnings;
}

const mod = {
  // Batch F
  VALUELESS_KEYWORDS,
  PSF_ONLY_KEYWORDS,
  validateRecordKeywords,
  validateFileLevelKeywords,
  // Batch G
  FIELD_LEVEL_VALUELESS_KEYWORDS,
  validateFieldKeywords,
  // Batch VV
  SKIP_SPACE_KEYWORDS,
  recordHasSkipSpaceExclusion,
  recordHasLineNumbers,
  // Batch YY
  validateEndpageKeywords,
  parseIndtxt,
  collectIndicatorDescriptions,
  // Batch B
  validateFontKeywords,
  // Batch CCC
  BARCODE_RECORD_EXCLUSION_KEYWORDS,
  validateBarcodeRecordKeywords,
  // Batch TT
  NO_INDICATOR_KEYWORDS,
  validateKeywordIndicators,
  // Batch ZZ
  validateAliasUniqueness,
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfKeywordValidation = mod;
