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
 *   - prtfKeywordValidation.js — the Batch F/G/B keyword-applicability
 *                               validators (validateRecordKeywords,
 *                               validateFileLevelKeywords,
 *                               validateFieldKeywords, validateFontKeywords,
 *                               INDTXT parsing/collection).
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

const mod = {
  resolveLayout: Layout.resolveLayout,
  listRecordNames: Layout.listRecordNames,
  collectIndicators: Layout.collectIndicators,
  findKeyword: KeywordHelpers.findKeyword,
  findAllKeywords: KeywordHelpers.findAllKeywords,
  numericParam: KeywordHelpers.numericParam,
  // Batch H
  resolveReferenceTarget: ReferenceField.resolveReferenceTarget,
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
};
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfEngine = mod;
