"use strict";
/**
 * docs/TASKS.md Batch L (continued) — best-effort resolution for the three
 * font-selection keywords `resolveFont` (prtfLayout.js) previously left
 * completely unresolved: `FONTNAME` (TrueType/OpenType by name), `CDEFNT`
 * (IBM i "coded font" resource object name), and `FNTCHRSET` (host AFP
 * font character set + code page pair). Companion to afpFontMetrics.js,
 * which only ever handled `FONT`/FGID.
 *
 * These three keywords are architecturally very different from FGID, and
 * from each other — worth spelling out, since it shapes what this module
 * can honestly claim to resolve:
 *
 *  - FONTNAME's value already IS the human-readable TrueType/OpenType font
 *    family name (IBM's own "Example: Specifying a font":
 *    FONTNAME('Courier New' (*POINTSIZE 20)(*CODEPAGE T1V10037))
 *    — https://www.ibm.com/docs/ssw_ibm_i_72/rzau6/rzau6fntxmp.htm) — fully
 *    resolvable offline, no live IBM i connection needed at all. The only
 *    reason this wasn't already done is nobody had gotten around to it.
 *    (Getting the raw value right required a separate, related fix — see
 *    prtfWebviewLogic.js's parseFontSpecKeyword/buildFontSpecParamsFromValues:
 *    FONTNAME's value is DDS-quoted and can contain internal spaces, e.g.
 *    'Courier New', which the pre-existing plain whitespace-split
 *    tokenizer mangled.)
 *
 *  - CDEFNT names an IBM i "coded font" RESOURCE OBJECT — a
 *    library-qualified system object, viewable via the WRKFNTRSC command,
 *    that pairs a font character set + code page under one name. IBM's own
 *    "Coded fonts" documentation
 *    (https://www.ibm.com/support/knowledgecenter/ssw_ibm_i_72/rzalu/rzaluconcodedfont.htm)
 *    states this plainly: "Coded font names are read by the system and
 *    then translated to a font character set and a code page... To find
 *    out which font character set and code page make up a coded font
 *    name, use the Work with Font Resources (WRKFNTRSC) command." A
 *    separate IBM page (the same doc's Portuguese mirror) adds: "No coded
 *    font substitution happens on the IBM i platform — if the coded font
 *    isn't available, the document doesn't print." In other words, beyond
 *    the documented naming PREFIX (see below), what a given coded font
 *    object actually looks like is genuinely per-system data with no
 *    universal decode table — this is IBM's own documented design, not a
 *    gap in this tool's research. A live-connection-dependent WRKFNTRSC
 *    lookup could resolve it precisely, but that's future work (parallel
 *    to Batch H's live-connection pieces), not something this module
 *    pretends to fake with a guess.
 *
 *  - FNTCHRSET similarly follows a documented PREFIX convention for its
 *    two params — font character set: "C0" (raster) / "CZ" (outline); code
 *    page: always begins "T1" — per IBM's AFP Font Collection
 *    documentation (G544-5846-03) and the z/OS Font Collection docs' own
 *    "Naming convention for coded fonts" material, corroborated by the
 *    z/OS font-mapping-table documentation's MAPFONT examples (RFONT=C0...,
 *    OFONT=CZ...). The REST of each name (pitch/typeface/style digits) is
 *    drawn from large IBM-published summary tables (dozens of pages) this
 *    module doesn't attempt to fully reproduce — same "decode what's
 *    documented, be honest about the rest" treatment as CDEFNT.
 *
 * Net effect: FONTNAME gets a complete, real resolution; CDEFNT/FNTCHRSET
 * get an honest partial one (prefix-decoded raster/outline distinction,
 * plus a small number of independently-verified example names) with a
 * `resolutionNote` explaining exactly what's still unknown and how a
 * person could find out (WRKFNTRSC) — never a confident-looking guess
 * dressed up as real data. This mirrors afpFontMetrics.js's own honesty
 * caveats for its AFM-substitute proportional-font widths.
 *
 * FONTNAME advance widths (getAdvanceWidth, below): resolveFontName's
 * family/name/spacing were always resolvable offline with zero
 * approximation (see above) — but a per-character ADVANCE WIDTH needs the
 * named font's actual binary, which this tool has no access to (no live
 * connection reads a real .ttf/.otf off a connected IBM i's IFS yet — see
 * docs/ROADMAP.md's "real AFP font metrics" item). For the handful of
 * extremely common names FONTNAME_GENERIC_FALLBACK already classifies by
 * spacing bucket, real, permissively-licensed substitute fonts vendored at
 * resources/fonts/ (see that directory's NOTICE.md) are parsed via
 * src/afpTrueTypeMetrics.js's real sfnt binary parser, giving genuine
 * per-glyph advance widths — a real font's real data, same honesty
 * standard as afpFontMetrics.js's Adobe-AFM Helvetica/Times tables, just
 * sourced from an actual binary font instead of a published metrics table.
 * Same "flagged as substitute, not invented" treatment either way.
 */

// --- FONTNAME advance-width substitute fonts ----------------------------

// Node-only (this module also loads as a plain <script> in the browser
// webview via window.AfpCodedFontMetrics — see the bottom of this file —
// where `require`/`fs`/font-file reading make no sense; the webview never
// needs FONTNAME's per-character advance widths today, only extension.ts
// does, so this guard just keeps the browser load path a no-op instead of
// throwing).
// eslint-disable-next-line no-undef
const canLoadFontFiles = typeof module !== "undefined" && !!module.exports;
// eslint-disable-next-line no-undef
const AfpTrueTypeMetrics = canLoadFontFiles ? require("./afpTrueTypeMetrics.js") : undefined;

/**
 * Maps FONTNAME_GENERIC_FALLBACK's three spacing buckets to a real,
 * vendored substitute font file (resources/fonts/) and a human-readable
 * name for that substitute, for resolutionNote text. See that directory's
 * NOTICE.md for why these three specific fonts (Cousine/Tinos are
 * purpose-built Courier New/Times New Roman substitutes; PT Sans fills the
 * sans-serif bucket but is NOT purpose-built as an Arial substitute — the
 * real Arial-compatible croscore font, Arimo, ships only as a variable
 * font, which this fixed-per-glyph-width model can't read).
 */
const SUBSTITUTE_FONTS = {
  monospace: { file: "Cousine-Regular.ttf", displayName: "Cousine" },
  serif: { file: "Tinos-Regular.ttf", displayName: "Tinos" },
  "sans-serif": { file: "PTSans-Regular.ttf", displayName: "PT Sans" },
};

// Parsed-font cache, keyed by filename — a font is only ever parsed once
// per extension-host session, not once per resolveFontName/getAdvanceWidth
// call.
const substituteFontCache = {};

/**
 * Lazily parses (and caches) one of the vendored substitute fonts. Returns
 * `undefined` — rather than throwing — if the file can't be read/parsed,
 * so a packaging problem degrades to "no width data available" instead of
 * crashing the extension host; callers already treat `undefined` as the
 * normal "unknown width" case (see afpTrueTypeMetrics.js's own
 * getAdvanceWidth doc comment).
 */
function loadSubstituteFont(filename) {
  if (substituteFontCache[filename]) return substituteFontCache[filename];
  if (!canLoadFontFiles) return undefined;
  try {
    // eslint-disable-next-line no-undef, @typescript-eslint/no-var-requires
    const fs = require("fs");
    // eslint-disable-next-line no-undef, @typescript-eslint/no-var-requires
    const path = require("path");
    // This file (compiled) lives at out/src/afpCodedFontMetrics.js —
    // resources/fonts/ is two levels up, at the extension root.
    const filePath = path.join(__dirname, "..", "..", "resources", "fonts", filename);
    const buf = fs.readFileSync(filePath);
    const font = AfpTrueTypeMetrics.parseFont(buf);
    // Real, computed-from-the-actual-font average over the same ASCII
    // printable range afpFontMetrics.js's PROPORTIONAL_AVG_WIDTH
    // normalizes against — but computed from this font's own real widths
    // rather than a hardcoded constant, so the same "1.0 == roughly one
    // average character" cell-relative convention applies without baking
    // in a number that only happened to be right for the Adobe AFM tables.
    let total = 0;
    let count = 0;
    for (let cp = 32; cp <= 126; cp++) {
      const w = font.getAdvanceWidth(cp);
      if (typeof w === "number") {
        total += w;
        count++;
      }
    }
    font.averageAdvanceWidth = count > 0 ? total / count : font.unitsPerEm / 2;
    substituteFontCache[filename] = font;
    return font;
  } catch (e) {
    return undefined;
  }
}

/**
 * Returns the advance width of `ch` for a FONTNAME value that falls into
 * one of FONTNAME_GENERIC_FALLBACK's known spacing buckets, in the same
 * "character cell" units afpFontMetrics.js's own getAdvanceWidth uses (1.0
 * == one cell; see that function's doc comment). `name` is matched the
 * same case-insensitive way resolveFontName matches it. Returns
 * `undefined` — not a guessed fallback — for a name outside the known
 * buckets, or a character the substitute font's own cmap doesn't map,
 * mirroring afpTrueTypeMetrics.js's own "honestly report unknown" design.
 */
function getAdvanceWidth(name, ch) {
  const key = String(name || "").trim().toLowerCase();
  const bucket = FONTNAME_GENERIC_FALLBACK[key];
  const substitute = bucket ? SUBSTITUTE_FONTS[bucket] : undefined;
  if (!substitute) return undefined;
  const font = loadSubstituteFont(substitute.file);
  if (!font) return undefined;
  const raw = font.getAdvanceWidth(ch);
  if (raw === undefined) return undefined;
  return raw / font.averageAdvanceWidth;
}


// --- FONTNAME --------------------------------------------------------

/**
 * A small, deliberately conservative mapping of extremely common
 * TrueType/OpenType font family names to an appropriate CSS generic
 * fallback family, so rendering degrades sensibly on a machine that
 * doesn't have the exact named font installed. This is NOT an attempt to
 * catalog every font a shop might use — FONTNAME's value is already usable
 * directly as a CSS font-family with no lookup at all; this only adds a
 * better fallback, and a `spacing` guess for the handful of names common
 * enough to be confident about (all monospace print fonts here are
 * well-known, unambiguous cases — Courier/Consolas/Lucida Console).
 */
const FONTNAME_GENERIC_FALLBACK = {
  "courier new": "monospace",
  courier: "monospace",
  consolas: "monospace",
  "lucida console": "monospace",
  "andale mono": "monospace",
  arial: "sans-serif",
  "arial black": "sans-serif",
  helvetica: "sans-serif",
  calibri: "sans-serif",
  verdana: "sans-serif",
  tahoma: "sans-serif",
  segoe: "sans-serif",
  "times new roman": "serif",
  times: "serif",
  georgia: "serif",
  "book antiqua": "serif",
  cambria: "serif",
  garamond: "serif",
};

/**
 * Resolves FONTNAME's value into a renderable font identity. `name` is
 * already the real TrueType/OpenType font name (quoting is handled
 * upstream by prtfWebviewLogic.js's fixed parseFontSpecKeyword — see this
 * module's own header) — no substitution or guessing is happening here for
 * the family itself, only for the CSS generic fallback and (for a small
 * known set of names) the spacing classification.
 */
function resolveFontName(name) {
  const trimmed = String(name || "").trim();
  const key = trimmed.toLowerCase();
  const known = FONTNAME_GENERIC_FALLBACK[key];
  const fallback = known || "sans-serif";
  const substitute = known ? SUBSTITUTE_FONTS[known] : undefined;
  return {
    name: trimmed,
    family: '"' + trimmed.replace(/"/g, "") + '", ' + fallback,
    spacing: known === "monospace" ? "fixed" : known ? "proportional" : undefined,
    weight: undefined,
    style: undefined,
    // Name/family/spacing are exact — see this module's own header — but
    // any per-character advance width this entry's data feeds into (via
    // this file's own getAdvanceWidth, below) comes from a real but
    // DIFFERENT font (a vendored substitute), not `trimmed`'s own binary.
    // true here mirrors afpFontMetrics.js's isPlaceholderMetrics meaning
    // for its own proportional-FGID case: "real data, but a substitute's,
    // not a verified match." Unknown names get false — not because
    // they're MORE trustworthy, but because there's no substitute
    // attached at all for them to be flagged about (getAdvanceWidth
    // returns undefined for any name outside the three known buckets).
    isPlaceholderMetrics: !!known,
    resolutionNote: known
      ? "Name/family are the exact FONTNAME value; per-character advance widths (where used) come from " +
        substitute.displayName +
        "'s real metrics as an open-licensed " +
        known +
        " substitute — see resources/fonts/NOTICE.md — not " +
        (trimmed || "this font") +
        "'s own font file, which this tool has no access to."
      : "Rendered using the exact name from FONTNAME; this specific font's spacing/weight aren't independently verified.",
  };
}

// --- CDEFNT ------------------------------------------------------------

/**
 * IBM-documented example coded font names this module can confidently
 * decode beyond the bare X0/XZ raster/outline prefix. Sourced from IBM's
 * own "Coded fonts" documentation (X0GT10 — "the GT10 indicates the type
 * family, typeface, and pitch for uniformly spaced and mixed-pitch fonts.
 * In this example the GT10 means that this font character set is a Gothic
 * Text style and the characters are 10 pitch or 10 characters per inch" —
 * https://www.ibm.com/support/knowledgecenter/ssw_ibm_i_72/rzalu/rzaluconcodedfont.htm)
 * and the "Shading Fonts Using Special Coded Font" support page (X0SHAD —
 * https://www.ibm.com/support/pages/shading-fonts-using-special-coded-font-code-page-and-character-set-and-fntchrset-dds).
 * Deliberately small, and only grown when a specific name is independently
 * verified against an IBM source — see this module's own header for why a
 * large decode table isn't attempted here at all (IBM's own documented
 * design is WRKFNTRSC, not a name-decode table).
 */
const KNOWN_CODED_FONTS = {
  X0GT10: { description: "Gothic Text style, 10 pitch (10 CPI)", family: "'Consolas', 'Lucida Console', monospace", spacing: "fixed", pitch: 10 },
  X0SHAD: { description: "IBM's special shading font (X0SHAD)", family: "monospace", spacing: "fixed" },
};

/**
 * Resolves CDEFNT's value. `cdefntValue` may be library-qualified
 * ([library/]coded-font-name) per IBM's DDS reference — only the object
 * name itself carries the naming convention, so the library prefix (if
 * any) is stripped before matching.
 */
function resolveCodedFont(cdefntValue) {
  const raw = String(cdefntValue || "").trim();
  const slash = raw.lastIndexOf("/");
  const name = (slash >= 0 ? raw.slice(slash + 1) : raw).toUpperCase();

  const known = KNOWN_CODED_FONTS[name];
  if (known) {
    return {
      name: raw,
      family: known.family,
      spacing: known.spacing,
      weight: known.weight,
      style: known.style,
      isPlaceholderMetrics: false,
      resolutionNote: "Coded font " + name + " matches an IBM-documented example (" + known.description + ").",
    };
  }

  const prefix = name.slice(0, 2);
  const isOutline = prefix === "XZ";
  const isRaster = prefix === "X0";
  return {
    name: raw,
    family: "monospace", // conservative fallback — most IBM-supplied coded fonts are line-printer-style; see resolutionNote
    spacing: undefined,
    weight: undefined,
    style: undefined,
    isPlaceholderMetrics: true,
    resolutionNote:
      isOutline || isRaster
        ? "Custom " +
          (isOutline ? "outline" : "raster") +
          " coded font — its exact typeface/pitch is data specific to this IBM i (use WRKFNTRSC to inspect); rendered with a generic placeholder."
        : "Unrecognized coded font name — rendered with a generic placeholder; use WRKFNTRSC on the connected system to inspect its actual font character set and code page.",
  };
}

// --- FNTCHRSET -----------------------------------------------------------

/**
 * Same "decode the documented prefix, be honest about the rest" treatment
 * as CDEFNT, for FNTCHRSET's font-character-set parameter: "C0" (raster) /
 * "CZ" (outline), per IBM's AFP Font Collection documentation
 * (G544-5846-03: "This identifies the character set as 'C0' (raster) or
 * 'CZ' (outline)") and corroborated by z/OS's own font-mapping-table
 * documentation, whose MAPFONT examples consistently pair RFONT=C0... with
 * OFONT=CZ... for the same typeface. FNTCHRSET's second parameter (the
 * code page, always prefixed "T1" per the same sources) isn't
 * independently decoded here — a code page selects a character ENCODING,
 * not a visual typeface, so it doesn't add anything to family/spacing/
 * weight/style resolution the way the font character set name might.
 */
function resolveFontCharacterSet(fontCharacterSetValue) {
  const raw = String(fontCharacterSetValue || "").trim();
  const prefix = raw.slice(0, 2).toUpperCase();
  const isOutline = prefix === "CZ";
  const isRaster = prefix === "C0";
  return {
    name: raw,
    family: "monospace",
    spacing: undefined,
    weight: undefined,
    style: undefined,
    isPlaceholderMetrics: true,
    resolutionNote:
      isOutline || isRaster
        ? "Custom " +
          (isOutline ? "outline" : "raster") +
          " font character set — its exact typeface/pitch is data specific to this IBM i's AFP font resources; rendered with a generic placeholder."
        : "Unrecognized font character set name — rendered with a generic placeholder.",
  };
}

const mod = { FONTNAME_GENERIC_FALLBACK, resolveFontName, getAdvanceWidth, KNOWN_CODED_FONTS, resolveCodedFont, resolveFontCharacterSet };
if (typeof module !== "undefined" && module.exports) module.exports = mod;
if (typeof window !== "undefined") window.AfpCodedFontMetrics = mod;
