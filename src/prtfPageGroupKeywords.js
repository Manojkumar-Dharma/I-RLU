"use strict";
/**
 * docs/TASKS.md Batch E — AFP page-group / resource keyword placeholders:
 * OVERLAY (record-level), PAGSEG, STRPAGGRP/ENDPAGGRP, DOCIDXTAG, AFPRSC,
 * DTASTMCMD. All seven are confirmed record-level (docs/KEYWORD-INVENTORY.md
 * §2's "Work with Record Keywords" menu grid lists every one of them).
 *
 * Per this batch's own scope in docs/TASKS.md ("most just need a name/path
 * field and don't need deep parameter modeling"), this module models each
 * keyword's own positional parameters just deeply enough to (a) round-trip
 * correctly, (b) place a labeled placeholder box on the page for the three
 * that carry a page position (OVERLAY/PAGSEG/AFPRSC), and (c) surface the
 * other four (STRPAGGRP/ENDPAGGRP/DOCIDXTAG/DTASTMCMD — none of which have a
 * page position of their own) as an editable badge list. It deliberately
 * does NOT model every optional sub-parameter each keyword supports (e.g.
 * OVERLAY/PAGSEG's optional "(*ROTATION n)", AFPRSC's *SIZE/mapping-option/
 * color-profile) — anything the person hand-wrote beyond what's modeled here
 * is preserved verbatim in an `extra` free-text field and re-appended on
 * build, the same "don't silently drop what I don't have a dedicated field
 * for" treatment Batch C's BARCODE `extra2D`/`unrecognizedRaw` already
 * established for this codebase.
 *
 * Quoting rule (verified against IBM's DDS reference for each keyword,
 * scribd's "Printer File AS400"/"IBM i Printer Files Programming" mirrors,
 * and the MC Press AFP-overlay writeup):
 *  - OVERLAY's overlay-name and PAGSEG's page-segment-name are OBJECT NAMES
 *    (optionally library-qualified, e.g. MYLIB/COMPLOGO), not character
 *    literals — unquoted in source, matching this project's own
 *    test/fixtures/sample-afpds.pf fixture (`PAGSEG(COMPLOGO 0.5 0.5)`,
 *    `OVERLAY(STMTFORM 0 0)`).
 *  - STRPAGGRP's group-name, DOCIDXTAG's attribute-name/attribute-value, and
 *    DTASTMCMD's text are CHARACTER VALUES — quoted, e.g.
 *    `STRPAGGRP('513')`, `DOCIDXTAG('Policy Number' '43127' PAGE)`.
 *  - AFPRSC's resource-name is a character value (quoted); its object-type
 *    and DOCIDXTAG's tag-level are unquoted special/enumerated values
 *    (`*PAGSEG`/`*OVL`/... , `GROUP`/`PAGE`).
 *  - Any of the above may instead be a program-to-system field (`&NAME`),
 *    which is never quoted regardless of which case it replaces — same rule
 *    PrtfKeywordHelpers.isFieldRef already uses.
 */

// eslint-disable-next-line no-undef
const { isFieldRef, toNumber, toInches, findKeyword } =
  typeof module !== "undefined" && module.exports ? require("./prtfKeywordHelpers.js") : window.PrtfKeywordHelpers;
// groupTokens (not the plain paramTokens) is used throughout this file:
// several of these keywords' params carry quoted character values that can
// themselves contain internal spaces (e.g. DOCIDXTAG('Policy Number' ...)),
// and paramTokens's plain whitespace split (fine for LINE/BOX/BARCODE's
// numeric-only params) would incorrectly split "'Policy Number'" into two
// tokens. Reused from Batch C's BARCODE work (prtfBarcodeParams.js) rather
// than re-implemented, since it's the same paren/quote-aware tokenizing
// problem BARCODE's own nested `(*QRCODE ...)` parameter already solved.
// eslint-disable-next-line no-undef
const { groupTokens } =
  typeof module !== "undefined" && module.exports ? require("./prtfBarcodeParams.js") : window.PrtfBarcodeParams;

/** Adapts groupTokens (which takes a bare "inner" string) to the same `paramTokens(kw)` call shape prtfKeywordHelpers.js's plain version uses elsewhere in this codebase. */
function paramTokens(kw) {
  const inner = String((kw && kw.params) || "").replace(/^\(/, "").replace(/\)$/, "");
  return groupTokens(inner);
}

// Default placeholder box size (character cells) for the three positioned
// resource keywords (OVERLAY/PAGSEG/AFPRSC). These name external AFP
// objects (overlays, page-segment images) whose real pixel dimensions this
// tool has no access to without the resource files themselves
// (docs/REQUIREMENTS.md §8's documented hard limit — see docs/TASKS.md
// Batch O). A fixed placeholder size, flagged as such, is the same honest
// treatment BARCODE's own placeholder already uses rather than guessing.
const DEFAULT_RESOURCE_COLS = 20;
const DEFAULT_RESOURCE_ROWS = 3;

/** Quotes a character-value parameter, unless it's a program-to-system field (&NAME), which is never quoted. */
function quoteOrField(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (isFieldRef(v)) return v;
  return "'" + v.replace(/'/g, "''") + "'";
}

/** Inverse of quoteOrField — strips DDS quoting from a character-value token, leaving a &field reference untouched. */
function unquoteOrField(tok) {
  if (tok === undefined) return "";
  if (isFieldRef(tok)) return tok;
  if (tok.length >= 2 && tok[0] === "'" && tok[tok.length - 1] === "'") {
    return tok.slice(1, -1).replace(/''/g, "'");
  }
  return tok;
}

function placeholderGeometry(name, keyword, posDownTok, posAcrossTok, cpi, lpi, uom, extraApproximate) {
  const approximate = isFieldRef(posDownTok) || isFieldRef(posAcrossTok) || !!extraApproximate;
  const posDown = toInches(toNumber(posDownTok, 0), uom);
  const posAcross = toInches(toNumber(posAcrossTok, 0), uom);
  return {
    keyword,
    name: name || "",
    label: (name || keyword) + " (" + keyword + ")",
    row: Math.round(posDown * lpi) + 1,
    col: Math.round(posAcross * cpi) + 1,
    widthCols: DEFAULT_RESOURCE_COLS,
    heightRows: DEFAULT_RESOURCE_ROWS,
    approximate,
  };
}

/**
 * OVERLAY([library-name/]overlay-name position-down position-across
 *         [(*ROTATION rotation)]) — record-level, AFPDS-only.
 */
function parseOverlay(kw, cpi, lpi, uom) {
  const t = paramTokens(kw);
  const geometry = placeholderGeometry(t[0], "OVERLAY", t[1], t[2], cpi, lpi, uom, isFieldRef(t[0]));
  return Object.assign(geometry, {
    posDown: t[1] || "",
    posAcross: t[2] || "",
    extra: t.slice(3).join(" "),
  });
}

function buildOverlayParams(f) {
  const name = String(f.name || "").trim();
  if (!name) return null;
  const parts = [name, String(f.posDown || "0").trim() || "0", String(f.posAcross || "0").trim() || "0"];
  const extra = String(f.extra || "").trim();
  if (extra) parts.push(extra);
  return "(" + parts.join(" ") + ")";
}

/**
 * PAGSEG(page-segment-name [vertical-offset horizontal-offset]
 *        [(*ROTATION rotation)]) — record-level. Offsets are an optional
 * pair (both present or both omitted) per IBM's DDS reference.
 */
function parsePagseg(kw, cpi, lpi, uom) {
  const t = paramTokens(kw);
  const geometry = placeholderGeometry(t[0], "PAGSEG", t[1], t[2], cpi, lpi, uom, isFieldRef(t[0]));
  return Object.assign(geometry, {
    posDown: t[1] || "",
    posAcross: t[2] || "",
    extra: t.slice(3).join(" "),
  });
}

function buildPagsegParams(f) {
  const name = String(f.name || "").trim();
  if (!name) return null;
  const parts = [name];
  const posDown = String(f.posDown || "").trim();
  const posAcross = String(f.posAcross || "").trim();
  if (posDown || posAcross) {
    parts.push(posDown || "0", posAcross || "0");
  }
  const extra = String(f.extra || "").trim();
  if (extra) parts.push(extra);
  return "(" + parts.join(" ") + ")";
}

/**
 * AFPRSC('resource-name'|&resource-name-field object-type|object-comp-id|
 *        &object-type-field position-down position-across
 *        [(*SIZE width height)] ...) — record-level, AFPDS-only. Only the
 * first four positional params get dedicated fields here; anything after
 * (the *SIZE expression, mapping-option, color-profile, secondary-resource
 * params, ...) is preserved verbatim as `extra` per this module's own
 * header comment.
 */
function parseAfprsc(kw, cpi, lpi, uom) {
  const t = paramTokens(kw);
  const name = unquoteOrField(t[0]);
  const geometry = placeholderGeometry(name, "AFPRSC", t[2], t[3], cpi, lpi, uom, isFieldRef(t[0]));
  return Object.assign(geometry, {
    objectType: t[1] || "",
    posDown: t[2] || "",
    posAcross: t[3] || "",
    extra: t.slice(4).join(" "),
  });
}

function buildAfprscParams(f) {
  const name = String(f.name || "").trim();
  const objectType = String(f.objectType || "").trim();
  if (!name || !objectType) return null;
  const parts = [quoteOrField(name), objectType, String(f.posDown || "0").trim() || "0", String(f.posAcross || "0").trim() || "0"];
  const extra = String(f.extra || "").trim();
  if (extra) parts.push(extra);
  return "(" + parts.join(" ") + ")";
}

/**
 * DOCIDXTAG(attribute-name|&attribute-name-field
 *           attribute-value|&attribute-value-field
 *           tag-level|&attribute-tag-level-field) — record-level,
 * AFPDS-only. tag-level's two documented special values are GROUP and
 * PAGE. No inherent page position (it tags a page GROUP for AFP document
 * indexing, not a place on the printed page), so unlike OVERLAY/PAGSEG/
 * AFPRSC this doesn't get a placeholder box — see renderPageGroupPanel.
 */
function parseDocidxtag(kw) {
  const t = paramTokens(kw);
  return {
    keyword: "DOCIDXTAG",
    attributeName: unquoteOrField(t[0]),
    attributeValue: unquoteOrField(t[1]),
    tagLevel: t[2] || "",
  };
}

function buildDocidxtagParams(f) {
  const attributeName = String(f.attributeName || "").trim();
  const attributeValue = String(f.attributeValue || "").trim();
  const tagLevel = String(f.tagLevel || "").trim();
  if (!attributeName || !attributeValue || !tagLevel) return null;
  return "(" + quoteOrField(attributeName) + " " + quoteOrField(attributeValue) + " " + tagLevel + ")";
}

/**
 * docs/TASKS.md Batch P — validates STRPAGGRP/ENDPAGGRP pairing across the
 * WHOLE model (not just one record), since the pairing's validity is a
 * property of the ORDER record formats appear in the file, not of any
 * single record on its own. Reordering record formats (Batch P's own
 * reorderRecord edit) is the most direct way to break this, but the check
 * itself doesn't know or care WHY the ordering ended up wrong — it just
 * walks model.records in their current order and reports whatever it
 * finds, same live-editor-hint philosophy every other validation function
 * in this project follows (CRTPRTF remains the actual enforcement point).
 * Per media/webviewClient.js's own STRPAGGRP hint text ("groups can't nest
 * or overlap"), this flags:
 *  - an ENDPAGGRP with no unclosed STRPAGGRP before it (nothing to end);
 *  - a STRPAGGRP while a previous one is still unclosed (nesting);
 *  - a STRPAGGRP that's never closed by the end of the file.
 * Returns an array of { recordName, keyword, message } warnings in
 * whatever record order they were found — [] if the file has no page
 * groups at all, or the ones it has are all correctly paired.
 */
function validatePageGroupOrder(model) {
  const warnings = [];
  let openRecordName = null;
  for (const record of (model && model.records) || []) {
    const hasStart = !!findKeyword(record.keywords, "STRPAGGRP");
    const hasEnd = !!findKeyword(record.keywords, "ENDPAGGRP");
    if (hasStart) {
      if (openRecordName) {
        warnings.push({
          recordName: record.name,
          keyword: "STRPAGGRP",
          message:
            "STRPAGGRP on " + record.name + " starts a new page group before the one started on " + openRecordName +
            " was ended with ENDPAGGRP — page groups can't nest or overlap.",
        });
      } else {
        openRecordName = record.name;
      }
    }
    if (hasEnd) {
      if (!openRecordName) {
        warnings.push({
          recordName: record.name,
          keyword: "ENDPAGGRP",
          message: "ENDPAGGRP on " + record.name + " has no matching STRPAGGRP earlier in the file to end.",
        });
      } else {
        openRecordName = null;
      }
    }
  }
  if (openRecordName) {
    warnings.push({
      recordName: openRecordName,
      keyword: "STRPAGGRP",
      message: "STRPAGGRP on " + openRecordName + " is never closed by a later ENDPAGGRP.",
    });
  }
  return warnings;
}

const mod = {
  DEFAULT_RESOURCE_COLS,
  DEFAULT_RESOURCE_ROWS,
  quoteOrField,
  unquoteOrField,
  parseOverlay,
  buildOverlayParams,
  parsePagseg,
  buildPagsegParams,
  parseAfprsc,
  buildAfprscParams,
  parseDocidxtag,
  buildDocidxtagParams,
  validatePageGroupOrder,
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfPageGroupKeywords = mod;
