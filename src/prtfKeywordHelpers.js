"use strict";
/**
 * Small keyword lookup/parsing primitives shared by every part of the old
 * prtfEngine.js (now split into prtfLayout.js, prtfReferenceField.js, and
 * prtfKeywordValidation.js — see docs/TASKS.md review comment #5). Pulled
 * out into their own module rather than duplicated three ways, or living in
 * whichever of the three files happened to need them first.
 */

function findKeyword(keywords, name) {
  return (keywords || []).find((k) => k.name === name);
}

function findAllKeywords(keywords, name) {
  return (keywords || []).filter((k) => k.name === name);
}

/**
 * Filters `keywords` down to only those active under the given indicator
 * toggle state — see prtfModel.ts's Keyword.conditions comment and
 * prtfLayout.js's own `indicatorActive` (the same AND-of-up-to-3-slots,
 * negation-aware evaluation, just usable here too without a circular
 * require back into prtfLayout.js). A keyword with no `conditions` of its
 * own (the ordinary case — inline on its entry's own header line) is
 * always active regardless of `indicatorState`, matching real DDS: only a
 * keyword that came from its OWN attached, independently-conditioned line
 * can ever be filtered out here.
 */
function activeKeywords(keywords, indicatorState) {
  indicatorState = indicatorState || {};
  return (keywords || []).filter((k) => {
    if (!k.conditions || k.conditions.length === 0) return true;
    return k.conditions.every((c) => {
      const state = !!indicatorState[c.indicator];
      return c.negate ? !state : state;
    });
  });
}

/**
 * `findKeyword`, but only among keywords currently active per
 * `indicatorState` (see `activeKeywords`) — and, unlike `findKeyword`'s own
 * first-match-wins semantics, returns the LAST active match rather than
 * the first. This matters specifically for the "default + conditional
 * override" authoring pattern this whole conditioning mechanism exists
 * for: an unconditioned PAGSIZE(66 132) followed by a conditioned
 * PAGSIZE(88 198) on the same record are BOTH "active" once the override's
 * indicator is on (the unconditioned one is unconditionally active by
 * definition) — first-match-wins would always return the default and the
 * override would never visibly take effect, defeating the entire point of
 * writing it. Later-in-source wins instead, mirroring how a person reading
 * the DDS top-to-bottom would expect a later, conditioned line to override
 * an earlier default when its condition holds.
 */
function findActiveKeyword(keywords, name, indicatorState) {
  const active = findAllKeywords(activeKeywords(keywords, indicatorState), name);
  return active.length ? active[active.length - 1] : undefined;
}

/** `findAllKeywords`, but only among keywords currently active per `indicatorState` (see `activeKeywords`). */
function findAllActiveKeywords(keywords, name, indicatorState) {
  return findAllKeywords(activeKeywords(keywords, indicatorState), name);
}

function numericParam(kw, fallback) {
  if (!kw) return fallback;
  const m = String(kw.params).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : fallback;
}

/** Splits a keyword's "(...)" params into whitespace-separated tokens, respecting nothing fancier than that (no nested parens expected in LINE/BOX params). */
function paramTokens(kw) {
  const inner = String(kw.params || "").replace(/^\(/, "").replace(/\)$/, "");
  return inner.trim() === "" ? [] : inner.trim().split(/\s+/);
}

/** true if a LINE/BOX parameter token is a program-to-system field reference (&NAME) rather than a literal value — these can't be resolved without a live compile/run, so geometry using them is flagged approximate. */
function isFieldRef(tok) {
  return typeof tok === "string" && tok.startsWith("&");
}

function toNumber(tok, fallback) {
  if (tok === undefined || isFieldRef(tok)) return fallback;
  const n = Number(tok);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Converts a physical measurement to inches, given the unit of measure it
 * was coded in. LINE/BOX geometry and BARCODE's "(height *UOM)" form are
 * always specified in whatever unit CRTPRTF's UOM parameter selects for
 * that compile — there is no UOM keyword in DDS source itself, so this
 * tool has no way to know that unit from the source alone. Callers pass it
 * in explicitly (see resolveLayout's `uom` parameter), defaulting to
 * "inch" (CRTPRTF's own default) unless the person configures
 * i-rlu.unitOfMeasure to match what their shop actually compiles with.
 */
function toInches(value, uom) {
  return uom === "cm" ? value / 2.54 : value;
}

const mod = { findKeyword, findAllKeywords, activeKeywords, findActiveKeyword, findAllActiveKeywords, numericParam, paramTokens, isFieldRef, toNumber, toInches };
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.PrtfKeywordHelpers = mod;
