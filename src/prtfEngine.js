"use strict";
/**
 * Public entry point for PRTF layout/validation logic. This used to be one
 * 660-line file covering reference-field resolution, LINE/BOX/BARCODE
 * geometry, font resolution, layout/cursor placement, and the Batch F/G/B
 * keyword validators all at once (see docs/TASKS.md review comment #5).
 * It's now split so each concern can grow independently:
 *
 *   - prtfKeywordHelpers.js   — findKeyword/findAllKeywords/numericParam/
 *                               paramTokens/isFieldRef/toInches, shared by
 *                               all three of the below.
 *   - prtfLayout.js           — geometry/cursor placement/resolveLayout,
 *                               listRecordNames, collectIndicators.
 *   - prtfReferenceField.js   — resolveReferenceTarget (REF/REFFLD).
 *   - prtfKeywordValidation.js — the Batch F/G/B/TT keyword-applicability
 *                               validators (validateRecordKeywords,
 *                               validateFileLevelKeywords,
 *                               validateFieldKeywords, validateFontKeywords,
 *                               validateKeywordIndicators, INDTXT
 *                               parsing/collection).
 *
 * This file just re-exports all of them under the same `PrtfEngine`/`mod`
 * shape every existing caller (extension.ts, prtfEdits.ts,
 * media/webviewClient.js, and the test suite) already uses, so none of
 * them needed to change when the split happened. New batches that add
 * keyword validation should add it to prtfKeywordValidation.js and
 * re-export it here, rather than growing this file directly.
 */

// eslint-disable-next-line no-undef
const req = (path, globalName) => (typeof module !== "undefined" && module.exports ? require(path) : window[globalName]);

const KeywordHelpers = req("./prtfKeywordHelpers.js", "PrtfKeywordHelpers");
const Layout = req("./prtfLayout.js", "PrtfLayout");
const ReferenceField = req("./prtfReferenceField.js", "PrtfReferenceField");
const KeywordValidation = req("./prtfKeywordValidation.js", "PrtfKeywordValidation");
const BarcodeParams = req("./prtfBarcodeParams.js", "PrtfBarcodeParams");
const PageGroupKeywords = req("./prtfPageGroupKeywords.js", "PrtfPageGroupKeywords");
const CodedFontMetrics = req("./afpCodedFontMetrics.js", "AfpCodedFontMetrics");

const mod = {
  resolveLayout: Layout.resolveLayout,
  listRecordNames: Layout.listRecordNames,
  collectIndicators: Layout.collectIndicators,
  findKeyword: KeywordHelpers.findKeyword,
  findAllKeywords: KeywordHelpers.findAllKeywords,
  numericParam: KeywordHelpers.numericParam,
  // Batch H
  resolveReferenceTarget: ReferenceField.resolveReferenceTarget,
  // Batch H "remaining" piece — see prtfReferenceField.js's own doc
  // comments for both.
  mapDspffdRowToAttributes: ReferenceField.mapDspffdRowToAttributes,
  groupDatabaseFileFieldRows: ReferenceField.groupDatabaseFileFieldRows,
  // Batch F
  VALUELESS_KEYWORDS: KeywordValidation.VALUELESS_KEYWORDS,
  PSF_ONLY_KEYWORDS: KeywordValidation.PSF_ONLY_KEYWORDS,
  validateRecordKeywords: KeywordValidation.validateRecordKeywords,
  validateFileLevelKeywords: KeywordValidation.validateFileLevelKeywords,
  // Batch G
  FIELD_LEVEL_VALUELESS_KEYWORDS: KeywordValidation.FIELD_LEVEL_VALUELESS_KEYWORDS,
  validateFieldKeywords: KeywordValidation.validateFieldKeywords,
  parseIndtxt: KeywordValidation.parseIndtxt,
  collectIndicatorDescriptions: KeywordValidation.collectIndicatorDescriptions,
  // Batch B
  validateFontKeywords: KeywordValidation.validateFontKeywords,
  // Batch B — shared parsing helpers, reused by the webview's font/sizing
  // properties-panel UI so P-field (&NAME) detection and the FONT
  // nested-*POINTSIZE grammar aren't duplicated between engine and UI code.
  paramTokens: Layout.paramTokens,
  isFieldRef: Layout.isFieldRef,
  parseFontKeyword: Layout.parseFontKeyword,
  // Batch C — full BARCODE parameter surface (parse/build/validate), used
  // by both the engine (parseBarcodeGeometry's rendering-only subset
  // delegates to parseBarcodeParams — see prtfLayout.js) and the webview's
  // BARCODE properties-panel form.
  parseBarcodeParams: BarcodeParams.parseBarcodeParams,
  buildBarcodeParams: BarcodeParams.buildBarcodeParams,
  validateBarcodeParams: BarcodeParams.validateBarcodeParams,
  // Batch N
  validateBarcodeExclusions: BarcodeParams.validateBarcodeExclusions,
  // Batch E — OVERLAY/PAGSEG/AFPRSC parse/build (positioned placeholders)
  // and STRPAGGRP/ENDPAGGRP/DOCIDXTAG/DTASTMCMD's quoting helpers, used by
  // the webview's page-group/resource properties panel.
  quoteOrField: PageGroupKeywords.quoteOrField,
  unquoteOrField: PageGroupKeywords.unquoteOrField,
  parseOverlay: PageGroupKeywords.parseOverlay,
  buildOverlayParams: PageGroupKeywords.buildOverlayParams,
  parsePagseg: PageGroupKeywords.parsePagseg,
  buildPagsegParams: PageGroupKeywords.buildPagsegParams,
  parseAfprsc: PageGroupKeywords.parseAfprsc,
  buildAfprscParams: PageGroupKeywords.buildAfprscParams,
  parseDocidxtag: PageGroupKeywords.parseDocidxtag,
  buildDocidxtagParams: PageGroupKeywords.buildDocidxtagParams,
  // Batch WW — GDF parse/build (positioned placeholder, sized from its
  // own mandatory graph-depth/graph-width rather than the fixed default).
  resolveResourceBoxSize: PageGroupKeywords.resolveResourceBoxSize,
  parseGdf: PageGroupKeywords.parseGdf,
  buildGdfParams: PageGroupKeywords.buildGdfParams,
  // Batch P
  validatePageGroupOrder: PageGroupKeywords.validatePageGroupOrder,
  // Batch L (continued) — CDEFNT/FNTCHRSET/FONTNAME resolution (see
  // prtfLayout.js's resolveFont/resolveFontDisplay for how these feed
  // into resolveLayout's cells[].font, and afpCodedFontMetrics.js's own
  // header for why each of the three gets a different depth of
  // resolution).
  resolveFont: Layout.resolveFont,
  resolveFontDisplay: Layout.resolveFontDisplay,
  resolveFontName: CodedFontMetrics.resolveFontName,
  resolveCodedFont: CodedFontMetrics.resolveCodedFont,
  resolveFontCharacterSet: CodedFontMetrics.resolveFontCharacterSet,
  // Batch EE — COLOR/HIGHLIGHT/UNDERLINE resolved to a renderable per-cell
  // style (see prtfLayout.js's resolveStyle/resolveColorStyle for the
  // per-keyword cascade rules and the DSPATR scope correction).
  resolveStyle: Layout.resolveStyle,
  resolveColorStyle: Layout.resolveColorStyle,
  // Batch GG — field/constant overlap detection (see prtfLayout.js's
  // detectFieldOverlaps for the printer-file-overprint-vs-display-file
  // scope decision).
  detectFieldOverlaps: Layout.detectFieldOverlaps,
  // Batch HH — design-time-only per-field sample value formatting (see
  // prtfLayout.js's formatSampleValue and prtfModel.ts's
  // FieldEntry.sampleValue for the "why transient, not written to DDS
  // source" scope decision).
  formatSampleValue: Layout.formatSampleValue,
  // Batch TT — centralized "option indicators not valid for this keyword"
  // validation, folded into validateFileLevelKeywords/validateRecordKeywords/
  // validateFieldKeywords above; also exported standalone so callers (and
  // any future scope, e.g. constants) can check an arbitrary keyword array.
  NO_INDICATOR_KEYWORDS: KeywordValidation.NO_INDICATOR_KEYWORDS,
  validateKeywordIndicators: KeywordValidation.validateKeywordIndicators,
  // Batch VV — SKIPA/SKIPB/SPACEA/SPACEB constraint validation, folded into
  // validateFileLevelKeywords/validateRecordKeywords/validateFieldKeywords
  // above; also exported standalone for direct testing/reuse (e.g. by
  // Batch YY's ENDPAGE exclusion check, which validates the same rule from
  // the other direction).
  SKIP_SPACE_KEYWORDS: KeywordValidation.SKIP_SPACE_KEYWORDS,
  recordHasSkipSpaceExclusion: KeywordValidation.recordHasSkipSpaceExclusion,
  recordHasLineNumbers: KeywordValidation.recordHasLineNumbers,
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfEngine = mod;
