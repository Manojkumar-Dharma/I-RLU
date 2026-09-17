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

/** Record-level keywords that take no parameters at all (option indicators only) — must be re-emitted as a bare keyword name, never "NAME()". */
const VALUELESS_KEYWORDS = ["FORCE", "ZFOLD", "STAPLE"];

/** ZFOLD/STAPLE (and GDF, if ever modeled) only take effect when printing through PSF — silently ignored otherwise, per IBM's DDS reference. */
const PSF_ONLY_KEYWORDS = ["ZFOLD", "STAPLE"];

/**
 * Keywords whose presence is a strong signal a record targets *AFPDS.
 * DEVTYPE itself is a CRTPRTF/CHGPRTF/OVRPRTF command parameter, not DDS
 * source text, so I-RLU can never know for certain from the source alone
 * (same caveat as the i-rlu.unitOfMeasure setting) — this is a heuristic
 * used only to decide whether to surface the SKIPA/SKIPB file-level hint
 * below, not a hard classification.
 */
const AFPDS_INDICATOR_KEYWORDS = [
  "FONT", "CDEFNT", "FNTCHRSET", "FONTNAME", "PAGSEG", "OVERLAY",
  "STRPAGGRP", "ENDPAGGRP", "DOCIDXTAG", "AFPRSC", "DTASTMCMD", "BARCODE",
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

/** Validation hints for a single record's keywords — the ZFOLD/STAPLE PSF-only notice (Batch F) plus the Batch TT "no indicators allowed" check. Returns [] when there's nothing to flag. */
function validateRecordKeywords(record) {
  const warnings = [];
  PSF_ONLY_KEYWORDS.forEach((name) => {
    if (findKeyword(record.keywords, name)) {
      warnings.push({
        keyword: name,
        message: name + " is only supported when printing through PSF (Print Services Facility) — it's ignored under Host Print Transform.",
      });
    }
  });
  return warnings.concat(validateKeywordIndicators(record.keywords));
}

/** Validation hints scoped to the whole file — the *AFPDS file-level SKIPA/SKIPB restriction (Batch F) plus the Batch TT "no indicators allowed" check. Returns [] when there's nothing to flag. */
function validateFileLevelKeywords(model) {
  const warnings = [];
  ["SKIPA", "SKIPB"].forEach((name) => {
    if (findKeyword(model.fileLevel.keywords, name) && looksLikeAfpds(model)) {
      warnings.push({
        keyword: name,
        message:
          name +
          " isn't allowed at the file level for *AFPDS spooled files (this file appears to target AFPDS — other AFPDS-typical keywords are present). Move it to the record level, or confirm this file actually compiles as SCS.",
      });
    }
  });
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
 * rule live in the designer. Returns [] when there's nothing to flag.
 */
function validateFieldKeywords(field) {
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
 * Returns [] when there's nothing to flag.
 */
function validateFontKeywords(keywords) {
  const warnings = [];
  const hasCdefnt = !!findKeyword(keywords, "CDEFNT");
  const hasFntchrset = !!findKeyword(keywords, "FNTCHRSET");
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
const NO_INDICATOR_KEYWORDS = [
  // File-level (docs/AUDIT-FILE-LEVEL.md §5)
  "REF", "INDARA", "RELPOS", "INDTXT", "CCSID",
  // Field-level, additional to the above (docs/AUDIT-FIELD-LEVEL.md §4)
  "ALIAS", "REFFLD", "MSGCON", "DATE", "DATFMT", "DATSEP", "TIMFMT", "TIMSEP",
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

const mod = {
  // Batch F
  VALUELESS_KEYWORDS,
  PSF_ONLY_KEYWORDS,
  validateRecordKeywords,
  validateFileLevelKeywords,
  // Batch G
  FIELD_LEVEL_VALUELESS_KEYWORDS,
  validateFieldKeywords,
  parseIndtxt,
  collectIndicatorDescriptions,
  // Batch B
  validateFontKeywords,
  // Batch TT
  NO_INDICATOR_KEYWORDS,
  validateKeywordIndicators,
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfKeywordValidation = mod;
