"use strict";
/**
 * Regenerates PRTF DDS source text from a ParsedSource model (see
 * prtfModel.ts / prtfParser.ts for the column layout this mirrors).
 *
 * Strategy: walk `model.sequence` in original order. Comment and blank
 * lines are reproduced verbatim from `model.rawLines` (they carry no
 * structured data, so there is nothing to regenerate). Every structured
 * entry (file-level, record, field, constant) is rebuilt fresh from its
 * current field values, so in-place edits to the model (e.g. changing a
 * field's `line`/`position`, or pushing a new Keyword) are reflected on
 * the next call. This keeps the writer simple and predictable at the cost
 * of not preserving incidental original whitespace inside an edited
 * entry's own line — untouched entries are byte-identical, which is what
 * matters for round-trip safety.
 *
 * Batch PP (docs/TASKS.md) extends that same "leave what wasn't touched
 * alone" principle one level deeper, inside a changed entry: an entry's
 * keyword-bearing physical lines are no longer flattened and rewrapped
 * from scratch on every regenerate (see emitEntryWithConditionedKeywords/
 * packKeywordsPreservingLines below) — a keyword that's untouched since
 * parse keeps the exact physical line it already occupied, so adding or
 * editing one keyword doesn't disturb that same entry's other, unrelated
 * keyword lines either.
 */

const LINE_WIDTH = 80; // last column the DDS compiler itself ever reads

function padRight(str, len) {
  str = str == null ? "" : String(str);
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function padLeftNum(num, len) {
  if (num === undefined || num === null || num === "") return " ".repeat(len);
  const s = String(num);
  return s.length >= len ? s.slice(-len) : " ".repeat(len - s.length) + s;
}

/**
 * Same right-justified padding as padLeftNum, but for DDS's RELPOS `+n`
 * relative-position notation (see prtfModel.ts's FieldEntry.relativePosition
 * doc comment) — the `+` is part of the padded value itself, not a
 * separate column, e.g. `2` -> ` +2` (matches real-world source: see
 * test/fixtures/scsprt1-realworld.prtf's own `+2`/`+1` entries, right-
 * justified within the same 3-column field an absolute number uses).
 * IBM's own RELPOS reference caps this at 0-99, so it always fits.
 */
function padLeftRelative(num, len) {
  if (num === undefined || num === null || num === "") return " ".repeat(len);
  const s = "+" + String(num);
  return s.length >= len ? s.slice(-len) : " ".repeat(len - s.length) + s;
}

function conditionSlots(conditions) {
  const slots = ["   ", "   ", "   "]; // 3 blank columns per slot when no condition is present
  (conditions || []).slice(0, 3).forEach((c, i) => {
    const text = (c.negate ? "N" : "") + c.indicator;
    // 3-char slot, right-justified (matches how indicator numbers are conventionally punched, e.g. " 01", "N01").
    slots[i] = text.length >= 3 ? text.slice(0, 3) : " ".repeat(3 - text.length) + text;
  });
  return slots;
}

function buildPositional({ nameType, name, reference, length, dataType, decimalPositions, usage, lineNo, position, relativePosition, conditions, formType }) {
  const [c1, c2, c3] = conditionSlots(conditions);
  let s = "";
  s += "     "; // 1-5 sequence number (left blank; most shops let the editor/compiler ignore it)
  s += formType || " "; // 6 form type — Batch AA: reproduces the source's own char (usually blank, sometimes 'A') rather than always blanking it
  s += " "; // 7 comment/AND-OR (blank = normal AND of the three slots below when present)
  s += c1;
  s += c2;
  s += c3;
  s += padRight(nameType || "", 1); // 17
  s += " "; // 18 reserved
  s += padRight(name || "", 10); // 19-28
  s += reference ? "R" : " "; // 29
  s += padLeftNum(length, 5); // 30-34
  s += padRight(dataType || "", 1); // 35
  s += padLeftNum(decimalPositions, 2); // 36-37
  s += padRight(usage || "", 1); // 38
  s += padLeftNum(lineNo, 3); // 39-41
  s += relativePosition ? padLeftRelative(position, 3) : padLeftNum(position, 3); // 42-44 — Batch LL: `+n` (RELPOS) vs. a plain absolute column
  return s; // exactly 44 chars
}

function keywordsToText(keywords) {
  return (keywords || []).map((k) => k.raw != null ? k.raw : (k.name + (k.params || ""))).join(" ");
}

/**
 * Groups a keywords array into consecutive runs sharing the same
 * conditioning (see prtfModel.ts's Keyword.conditions comment for why
 * this exists at all): a run of keywords with no `conditions` of their
 * own — the ordinary case, living on the entry's own header line/wrap-
 * continuations — versus a run that came from an attached keyword-only
 * line and needs to be re-emitted on its OWN physical line(s) with its
 * own conditioning columns, name/type/position left blank. Consecutive
 * keywords sharing the exact same conditioning are kept in one group (one
 * physical line, wrapping further if long) rather than one line per
 * keyword, matching how such lines are actually authored — several
 * keywords under the same condition together, e.g. `05  COLOR(BLU) DSPATR(HI)`.
 */
function groupKeywordsByConditions(keywords) {
  const groups = [];
  const key = (conditions) => (conditions && conditions.length ? conditions.map((c) => c.raw).join(",") : "");
  for (const kw of keywords || []) {
    const kwConditions = kw.conditions && kw.conditions.length ? kw.conditions : undefined;
    const last = groups[groups.length - 1];
    if (last && last.key === key(kwConditions)) {
      last.keywords.push(kw);
    } else {
      groups.push({ conditions: kwConditions, key: key(kwConditions), keywords: [kw] });
    }
  }
  return groups;
}

/**
 * Batch PP (docs/TASKS.md) — reconstructs, from the ORIGINAL source text
 * (`rawLines`, i.e. `ParsedSource.rawLines`), the full physical-line range
 * a keyword continuation run occupied, by following DDS's own column-80
 * continuation marker exactly the way prtfParser.ts's `keywordAreaOf`
 * already does when parsing — this is the writer's read-side mirror of
 * that same convention, used only to check whether an untouched run of
 * keywords can be reproduced byte-for-byte rather than repacked.
 */
function originalRunRange(rawLines, startLine) {
  let end = startLine;
  while (end < rawLines.length - 1) {
    const contChar = (rawLines[end] || "")[79]; // col 80, 0-based index 79
    if (contChar === "-" || contChar === "+") end++;
    else break;
  }
  return [startLine, end];
}

/**
 * Reconstructs the keyword-area TEXT (cols 45-80) a continuation run's
 * original physical lines represent, honoring DDS's '-' (implies a joining
 * space) vs '+' (no space) continuation semantics — same distinction
 * prtfParser.ts's `keywordAreaOf` draws. Used only to compare against the
 * CURRENT keyword set's raw text for that run, to decide verbatim-safety;
 * see packKeywordsPreservingLines' own comment and this batch's
 * docs/TASKS.md writeup for why byte-for-byte reproduction matters (an
 * untouched entry, or an untouched run within a touched entry, must never
 * be silently reflowed).
 */
function originalRunKeywordText(rawLines, start, end) {
  let text = "";
  for (let i = start; i <= end; i++) {
    const line = rawLines[i] || "";
    const isLast = i === end;
    const chunk = (line.length > 44 ? line.slice(44, isLast ? 80 : 79) : "").replace(/\s+$/, "");
    if (i === start) {
      text = chunk;
    } else {
      const prevContChar = (rawLines[i - 1] || "")[79];
      text += (prevContChar === "+" ? "" : " ") + chunk;
    }
  }
  return text.trim();
}

/**
 * Splits a (same-conditions) keyword list into consecutive runs sharing
 * the same real `sourceLineIndex`; a keyword with no real sourceLineIndex
 * (freshly added or edited — see packKeywordsPreservingLines' own comment
 * on that convention) is "dirty" and every consecutive stretch of dirty
 * keywords forms its own run too, so a downstream caller can decide
 * verbatim-vs-packed treatment per run.
 */
function splitIntoSourceLineRuns(keywords) {
  const runs = [];
  for (const kw of keywords || []) {
    const sli = kw.sourceLineIndex != null && kw.sourceLineIndex !== -1 ? kw.sourceLineIndex : null;
    const last = runs[runs.length - 1];
    if (last && last.sourceLineIndex === sli) {
      last.keywords.push(kw);
    } else {
      runs.push({ sourceLineIndex: sli, keywords: [kw] });
    }
  }
  return runs;
}

/**
 * Batch PP (docs/TASKS.md) — emits ONE conditions-group's keyword lines
 * (see groupKeywordsByConditions), preferring exact byte-for-byte reuse of
 * the group's ORIGINAL physical source lines wherever nothing in them
 * changed, and falling back to packKeywordsPreservingLines/
 * emitGroupKeywordLines (a fresh repack) only for the keywords that were
 * actually added, edited, or had a sibling removed from their shared
 * original line.
 *
 * Why this exists at all, on top of packKeywordsPreservingLines: that
 * function's own `sourceLineIndex`-anchor packing is necessarily
 * approximate for anything that originally SPANNED multiple physical
 * lines, because prtfParser.ts assigns one `sourceLineIndex` per keyword
 * continuation RUN, not per individual physical line within it (a
 * keyword's own params can themselves straddle a wrap, e.g.
 * `PAGSEG(COMPLOGO -` / `0.5 0.5)` in real hand-authored source) — so an
 * entirely untouched entry could still come out re-wrapped slightly
 * differently by pure anchor-based packing alone. Verbatim reuse sidesteps
 * that by comparing the CURRENT keyword set's raw text against the
 * ORIGINAL text for that exact physical-line range and only trusting a
 * byte-for-byte splice when they match exactly (which also safely catches
 * "a sibling on this same original line was removed", since a removal
 * shortens the current text and the comparison then correctly fails).
 *
 * `freshPrefix44` (columns 1-44) is always freshly computed by the caller
 * (buildPositional) and always wins on the group's own first physical
 * line, even when that line is otherwise verbatim-safe — position/length/
 * name etc. can change independently of the keywords, so columns 1-44
 * can never be trusted from old source text. Every other line either
 * reuses the ORIGINAL line whole (verbatim segments) or gets the standard
 * blank+formType continuation prefix (packed segments).
 */
function emitGroupKeywordLines(freshPrefix44, groupKeywords, formType, rawLines, leadingText) {
  const runs = splitIntoSourceLineRuns(groupKeywords);
  const segments = []; // { kind: "verbatim", start, end } | { kind: "packed", keywords }
  let pendingPacked = [];
  const flushPacked = () => {
    if (pendingPacked.length) {
      segments.push({ kind: "packed", keywords: pendingPacked });
      pendingPacked = [];
    }
  };
  // leadingText (a constant's literal) has no sourceLineIndex of its own —
  // it's part of whichever original physical line the group's first run
  // occupied, so it's folded into that run's own verbatim comparison
  // (below) rather than tracked as a separate run; if that comparison
  // fails (or there's no first run at all), it's prepended to the packed
  // fallback instead, exactly once.
  //
  // Real DDS source can legitimately place a keyword BEFORE a constant's
  // own literal on its header line (e.g. `2SPACEB(1) 'SOME TEXT'` — seen
  // verbatim in test/fixtures/scsprt1-realworld.prtf) even though this
  // writer, like the one it replaced, always emits the literal first for
  // freshly-packed content. Since verbatim-safety only cares whether the
  // CURRENT content matches the ORIGINAL text, not which order produced
  // it, the comparison tries both orderings before giving up — otherwise
  // an entirely untouched entry using that convention would wrongly be
  // sent through the packer (which changes the order back to
  // literal-first) instead of being spliced byte-for-byte.
  let leadingConsumed = !leadingText;
  for (const run of runs) {
    if (run.sourceLineIndex !== null && rawLines) {
      const [start, end] = originalRunRange(rawLines, run.sourceLineIndex);
      const original = originalRunKeywordText(rawLines, start, end);
      const runText = run.keywords.map(keywordRaw).join(" ");
      const literalFirst = !leadingConsumed ? (runText ? leadingText + " " + runText : leadingText) : runText;
      const keywordFirst = !leadingConsumed && runText ? runText + " " + leadingText : literalFirst;
      if (original === literalFirst || original === keywordFirst) {
        flushPacked();
        segments.push({ kind: "verbatim", start, end });
        leadingConsumed = true;
        continue;
      }
    }
    if (!leadingConsumed) {
      pendingPacked.push({ sourceLineIndex: -1, raw: leadingText });
      leadingConsumed = true;
    }
    pendingPacked.push(...run.keywords);
  }
  if (!leadingConsumed) pendingPacked.push({ sourceLineIndex: -1, raw: leadingText });
  flushPacked();
  if (segments.length === 0) segments.push({ kind: "packed", keywords: [] });

  // Flatten every segment into one ordered list of physical lines, each
  // either a verbatim original rawLines index or a packed token group.
  const physicalLines = []; // { verbatimLine: number } | { tokens: string[] }
  for (const seg of segments) {
    if (seg.kind === "verbatim") {
      for (let i = seg.start; i <= seg.end; i++) physicalLines.push({ verbatimLine: i });
    } else {
      for (const tokens of packKeywordsPreservingLines(seg.keywords)) physicalLines.push({ tokens });
    }
  }
  if (physicalLines.length === 0) physicalLines.push({ tokens: [] });

  const contPrefixChars = new Array(44).fill(" ");
  if (formType) contPrefixChars[5] = formType;
  const contPrefix = contPrefixChars.join("");

  return physicalLines.map((pl, i) => {
    if (pl.verbatimLine !== undefined) {
      const raw = rawLines[pl.verbatimLine] || "";
      if (i === 0) return (freshPrefix44 + padTo(raw, 80).slice(44)).replace(/\s+$/, "");
      return raw.replace(/\s+$/, "");
    }
    const prefix = i === 0 ? freshPrefix44 : contPrefix;
    const body = padRight(pl.tokens.join(" "), KEYWORD_WIDTH) + " "; // col 79 blank
    const hasMore = i < physicalLines.length - 1;
    return (prefix + body + (hasMore ? "-" : " ")).replace(/\s+$/, "");
  });
}

function padTo(str, len) {
  str = str == null ? "" : String(str);
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

/**
 * Batch PP (docs/TASKS.md) — each conditions-group's keywords are handed
 * to emitGroupKeywordLines (not emitWithKeywords/keywordsToText) so that
 * adding or editing one keyword doesn't reflow every OTHER physical line
 * this entry already had; see emitGroupKeywordLines' own comment for the
 * full mechanism (verbatim reuse of untouched original lines, falling
 * back to packKeywordsPreservingLines only for what actually changed).
 */
function emitEntryWithConditionedKeywords(positional44, keywords, leadingText, formType, rawLines) {
  const groups = groupKeywordsByConditions(keywords);
  const firstGroup = groups[0];
  const firstIsUnconditioned = !firstGroup || !firstGroup.conditions;
  const headerKeywords = firstIsUnconditioned && firstGroup ? firstGroup.keywords : [];
  const lines = emitGroupKeywordLines(positional44, headerKeywords, formType, rawLines, leadingText);
  const restGroups = firstIsUnconditioned ? groups.slice(1) : groups;
  for (const group of restGroups) {
    // Batch AA — an attached conditioned-keyword line is its own separate
    // physical line of the SAME entry, so it carries the same formType
    // char too, not a hardcoded blank.
    const groupPositional = buildPositional({ conditions: group.conditions, formType });
    lines.push(...emitGroupKeywordLines(groupPositional, group.keywords, formType, rawLines));
  }
  return lines;
}

/**
 * Splits keyword-area text into whitespace-separated tokens, treating an
 * entire single-quoted DDS literal (including any spaces inside it, and
 * respecting DDS's doubled-`''`-means-a-literal-quote escaping) as ONE
 * indivisible token, never split on the whitespace inside it.
 *
 * Without this, a naive `text.split(/\s+/)` (what this function replaced —
 * see docs/TASKS.md Batch R) treats a run of spaces *inside* a quoted
 * parameter exactly the same as the spaces *between* separate keywords, so
 * rejoining tokens with a single space later silently collapses any
 * deliberate multi-space content inside a literal — e.g. `EDTWRD('  .  ')`
 * (a realistic edit-word mask; multiple internal spaces are common for
 * currency column alignment) round-tripped back as `EDTWRD(' . ')`.
 */
function tokenizeKeywordText(text) {
  const tokens = [];
  let current = "";
  let inQuote = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          current += "''"; // doubled quote = one literal quote char, stays inside the span
          i += 2;
          continue;
        }
        current += "'"; // closing quote
        inQuote = false;
        i += 1;
        continue;
      }
      current += ch; // anything inside the quote, including spaces, is part of this token
      i += 1;
      continue;
    }
    if (ch === "'") {
      inQuote = true;
      current += ch;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Wraps keyword text into one or more 80-column physical lines, given a
 * pre-built 44-char positional prefix for the FIRST line. Continuation
 * lines get a blank 44-char prefix — except column 6 (index 5), which
 * (Batch AA) carries the same `formType` character as the first line
 * rather than always being blank, since real-world source commonly keeps
 * that column filled ('A') uniformly across every physical line of an
 * entry, continuation lines included.
 *
 * Continuation character: real DDS distinguishes '-' (a single space is
 * implied at the join when the line is reassembled) from '+' (no space is
 * implied — used only when a split falls strictly inside a single token,
 * e.g. a literal or name broken mid-word). This function only ever splits
 * between separate tokens (see tokenizeKeywordText above and the loop below
 * — a token, including a whole quoted literal, is moved to the next line as
 * a unit, never divided), so the space that separated those two tokens in
 * the original keyword text must always be preserved across the join. That
 * makes '-' the correct choice in every case this function actually
 * produces.
 *
 * (An earlier version of this function always emitted '+', on the reasoning
 * that '+' is "safe for any token boundary" — that has it backwards: '+'
 * drops the space, which silently corrupts any wrap that happens to land
 * between two space-separated tokens, e.g. `PAGSEG(COMPLOGO 0.5 0.5)`
 * wrapped after `COMPLOGO` round-tripped back as `PAGSEG(COMPLOGO0.5 0.5)`.
 * See docs/TASKS.md Batch M and test/prtfFixtures.test.ts's
 * sample-afpds.pf round-trip test, which is what caught this.)
 */
function emitWithKeywords(positional44, keywordText, formType) {
  const KEYWORD_WIDTH = 34; // columns 45-78; col 79 unused, col 80 reserved for +/-
  const lines = [];
  const tokens = keywordText.trim() === "" ? [] : tokenizeKeywordText(keywordText.trim());
  let current = "";
  let firstLine = true;
  const contPrefixChars = new Array(44).fill(" ");
  if (formType) contPrefixChars[5] = formType;
  const contPrefix = contPrefixChars.join("");
  const flush = (hasMore) => {
    const prefix = firstLine ? positional44 : contPrefix;
    const body = padRight(current, KEYWORD_WIDTH) + " "; // col 79 blank
    lines.push(prefix + body + (hasMore ? "-" : " "));
    firstLine = false;
    current = "";
  };
  for (const tok of tokens) {
    const candidate = current ? current + " " + tok : tok;
    if (candidate.length > KEYWORD_WIDTH) {
      flush(true);
      current = tok;
    } else {
      current = candidate;
    }
  }
  if (current || lines.length === 0) flush(false);
  else {
    // Replace trailing continuation char of the last emitted line with a
    // space since there's nothing more to say.
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + " ";
  }
  return lines.map((l) => l.replace(/\s+$/, ""));
}

const KEYWORD_WIDTH = 34; // columns 45-78; col 79 unused, col 80 reserved for +/- (see emitWithKeywords' own copy of this constant above, kept separate rather than shared so neither function's tests can be affected by touching the other)

function keywordRaw(kw) {
  return kw.raw != null ? kw.raw : kw.name + (kw.params || "");
}

/**
 * Batch PP (docs/TASKS.md) — packs a same-conditions keyword run into
 * physical-line token groups, preferring to keep each keyword on the SAME
 * physical line it already occupied in the source (tracked per keyword via
 * Keyword.sourceLineIndex, prtfModel.ts/prtfParser.ts) rather than
 * flattening the whole run and re-wrapping it from scratch on every edit —
 * see docs/TASKS.md Batch PP for the full "why" and the Batch AA repro
 * this is closing the root cause of (one keyword add flagged 67/93 lines
 * as changed, because `emitWithKeywords` above rebuilds an entry's entire
 * keyword-line block on every regenerate, discarding original wrap
 * points).
 *
 * A keyword is "preserved" when its own `sourceLineIndex` is a real (>= 0)
 * value; every add/update case in prtfEdits.ts already resets a keyword's
 * `sourceLineIndex` to -1 the moment it creates or changes that keyword's
 * content (the convention `setRecordKeyword` established before this
 * batch existed) — that's exactly the signal this function relies on to
 * tell "never touched since parse" apart from "just added or edited."
 *
 * Packing rule, walking `keywords` in array order (which already reflects
 * "unchanged keywords keep their original relative order; edits replace
 * in place or land at the end" — prtfEdits.ts never reorders a keyword
 * list on its own): a DIRTY keyword (no real sourceLineIndex) always tries
 * to join whichever physical line is currently being built, since it has
 * no original position of its own to protect. A PRESERVED keyword joins
 * the line currently being built only if that line hasn't already
 * collected content from a DIFFERENT original line — otherwise it starts
 * a line of its own. Either way a keyword only ever joins the current line
 * if the combined text still fits the KEYWORD_WIDTH-column keyword area;
 * overflow starts a new line exactly like the flat wrap above always has.
 *
 * Net effect: adding one new keyword to an entry appends it to the last
 * existing physical line if there's room (or starts one new line if not)
 * without touching any earlier, unrelated line; editing one keyword among
 * several that shared an original line only reflows that one physical
 * line, never the entry's other, untouched lines. Uses each keyword's own
 * `raw`/`name`+`params` directly (never re-joins into one string and
 * re-tokenizes it the way `emitWithKeywords` above does) — a keyword like
 * `LINE`/`BOX` has its own un-quoted internal spaces (e.g.
 * `LINE(4 3 5 *HRZ .01)`), which `tokenizeKeywordText` would otherwise
 * split mid-keyword if a wrap point happened to fall inside it; working
 * keyword-object-by-keyword-object sidesteps that risk entirely for this,
 * the only path `regenerateSource` actually uses. The one exception: if a
 * SINGLE keyword's own full text is longer than KEYWORD_WIDTH by itself
 * (a long `FNTCHRSET`/`PAGSEG`/etc.), there is no way to fit it on one
 * physical line at all — DDS itself has no representation for that except
 * splitting mid-keyword across a continuation, so only in that specific,
 * unavoidable circumstance does this fall back to the same quote-aware
 * whitespace splitting `tokenizeKeywordText` uses, and only for that one
 * keyword's own text.
 */
function packKeywordsPreservingLines(keywords) {
  const lines = []; // { tokens: string[], anchorLine: number|null }[]
  for (const kw of keywords || []) {
    const raw = keywordRaw(kw);
    const preservedLine = kw.sourceLineIndex != null && kw.sourceLineIndex !== -1 ? kw.sourceLineIndex : null;
    const pieces = raw.length > KEYWORD_WIDTH ? tokenizeKeywordText(raw) : [raw];
    for (const piece of pieces) {
      const last = lines[lines.length - 1];
      const combined = last ? (last.tokens.length ? last.tokens.join(" ") + " " + piece : piece) : piece;
      const anchorCompatible = !last || preservedLine === null || last.anchorLine === null || last.anchorLine === preservedLine;
      if (last && anchorCompatible && combined.length <= KEYWORD_WIDTH) {
        last.tokens.push(piece);
        if (preservedLine !== null && last.anchorLine === null) last.anchorLine = preservedLine;
      } else {
        lines.push({ tokens: [piece], anchorLine: preservedLine });
      }
    }
  }
  return lines.map((l) => l.tokens);
}

function regenerateSource(model) {
  const outLines = [];
  for (const entry of model.sequence) {
    switch (entry.kind) {
      case "blank":
        outLines.push("");
        break;
      case "comment":
        outLines.push("     " + (entry.formType || " ") + "*" + entry.text);
        break;
      case "fileLevel": {
        const positional = buildPositional({ formType: entry.formType });
        outLines.push(...emitEntryWithConditionedKeywords(positional, entry.keywords, undefined, entry.formType, model.rawLines));
        break;
      }
      case "record": {
        const positional = buildPositional({ nameType: "R", name: entry.name, conditions: entry.conditions, formType: entry.formType });
        outLines.push(...emitEntryWithConditionedKeywords(positional, entry.keywords, undefined, entry.formType, model.rawLines));
        break;
      }
      case "field": {
        const positional = buildPositional({
          name: entry.name,
          reference: entry.reference,
          length: entry.length,
          dataType: entry.dataType,
          decimalPositions: entry.decimalPositions,
          usage: entry.usage,
          lineNo: entry.line,
          position: entry.position,
          relativePosition: entry.relativePosition,
          conditions: entry.conditions,
          formType: entry.formType,
        });
        outLines.push(...emitEntryWithConditionedKeywords(positional, entry.keywords, undefined, entry.formType, model.rawLines));
        break;
      }
      case "constant": {
        const positional = buildPositional({ lineNo: entry.line, position: entry.position, relativePosition: entry.relativePosition, conditions: entry.conditions, formType: entry.formType });
        const litToken = entry.literal !== undefined ? "'" + String(entry.literal).replace(/'/g, "''") + "'" : undefined;
        outLines.push(...emitEntryWithConditionedKeywords(positional, entry.keywords, litToken, entry.formType, model.rawLines));
        break;
      }
      default:
        break;
    }
  }
  const eol = model.lineEnding || "\n";
  return outLines.join(eol) + eol;
}

/**
 * Batch H (docs/TASKS.md) — builds/updates/removes the REFFLD keyword on a
 * field's keyword list, given the "Reference a field" picker's own
 * field/library/file inputs (see docs/KEYWORD-INVENTORY.md §3's "Reference
 * a field" Y/N + "Use referenced values" Y/N pair). Returns a NEW keywords
 * array rather than mutating the one passed in, matching the
 * regenerate-fresh-from-current-values discipline this module already
 * follows elsewhere.
 *
 * `target` of `null`/`undefined` (or one with neither a field name nor a
 * file) removes any existing REFFLD, leaving only the file/record-level
 * REF (if any) to fall back on — see PrtfEngine.resolveReferenceTarget for
 * how that fallback is worked out.
 */
function upsertReffldKeyword(keywords, target) {
  const withoutReffld = (keywords || []).filter((k) => k.name !== "REFFLD");
  if (!target || (!target.fieldName && !target.file)) return withoutReffld;
  const qualifiedFile = (target.library ? target.library.toUpperCase() + "/" : "") + (target.file ? target.file.toUpperCase() : "");
  const params = target.fieldName
    ? target.fieldName.toUpperCase() + (qualifiedFile ? " " + qualifiedFile : "")
    : qualifiedFile;
  const raw = "REFFLD(" + params + ")";
  return withoutReffld.concat([{ name: "REFFLD", params: "(" + params + ")", raw, sourceLineIndex: -1 }]);
}

/**
 * Batch X (docs/TASKS.md) — track source modifications, mirroring I-SDA's
 * isda.trackSourceModifications/isda.modificationTag feature
 * (I-SDA/src/dspfWriter.js). Ported rather than re-derived from scratch —
 * same shape, same column conventions — since PRTF and DSPF DDS source
 * share the exact same 80-column layout and comment convention this
 * project's own regenerateSource already uses (`"      *" + text`, i.e.
 * column 7 is `*`; see the "comment" case above).
 */

function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLen(a, b, maxLen) {
  const n = Math.min(a.length, b.length, maxLen == null ? Infinity : maxLen);
  let i = 0;
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Turns an existing line into a plain DDS comment — column 7 set to '*'
 * (the same flag regenerateSource's own freshly-written comment lines
 * use), every other column (sequence number/form type in 1-6, the line's
 * own original content from 8 on) left exactly as it was, so the line
 * reads as history rather than being reworded into a synthetic note. A
 * too-short line is padded (never truncated) before columns 1-6/7 are
 * addressed by index.
 */
function commentOutLine(line) {
  let s = line == null ? "" : String(line);
  if (s.length < 7) s = s + " ".repeat(7 - s.length);
  return (s.slice(0, 6) + "*" + s.slice(7)).replace(/\s+$/, "");
}

/**
 * Normalizes whatever the person typed into the properties panel's
 * modification-tag box into the fixed 10-character payload that gets
 * written to columns 81-90 — stripped of newlines (a tag is always one
 * line) and capped at 10 characters; no particular format is imposed
 * beyond that, matching I-SDA's own buildModTag.
 */
function buildModTag(rawTag) {
  return (rawTag || "").replace(/[\r\n]/g, "").slice(0, 10);
}

/**
 * Appends `tag` starting at column 81 — past LINE_WIDTH (80), i.e. past
 * every column DDS's own compiler ever reads — padding the line out to
 * exactly 80 columns first (never truncating real column 1-80 content)
 * so the tag always lands in the same fixed column no matter how short
 * the line's own compiled content is. A blank/empty tag is a no-op
 * (nothing appended, line returned unchanged).
 */
function appendModTag(line, tag) {
  if (!tag) return line;
  let s = line == null ? "" : String(line);
  if (s.length < LINE_WIDTH) s = s + " ".repeat(LINE_WIDTH - s.length);
  return (s + tag).replace(/\s+$/, "");
}

/**
 * Wraps a completed edit's (oldLines -> newLines) pair with modification
 * tracking, when `options.enabled` is true: the common prefix/suffix
 * between the two arrays is trimmed off first (untouched lines, which can
 * dwarf the actually-edited range in a large file), then every position
 * within the remaining differing range is classified:
 *   - present in both, identical -> left alone, no tag
 *   - present in both, different -> the OLD line is commented out
 *     (commentOutLine) immediately before the NEW line, which itself
 *     gets the inline tag (appendModTag)
 *   - only in the new range (the edit grew the line count) -> tagged,
 *     nothing to comment out
 *   - only in the old range (the edit shrank the line count) -> kept,
 *     commented out, rather than silently dropped — this is what keeps a
 *     deletion's history in the file too, not just an in-place edit's
 *   - a genuinely blank old line dropped by a shrinking edit is NOT
 *     preserved as an empty comment — there is no content worth a history
 *     entry for
 * `options.enabled` false (the common case — feature is off) returns
 * `newLines` completely unchanged, so this is always safe to call
 * unconditionally from a single choke point.
 *
 * Ported from I-SDA's dspfWriter.js (same function name/shape), including
 * its Task L52 fix: every changed/removed OLD line is commented out
 * first, in its own original order, THEN every changed/added NEW line is
 * tagged and appended, in its own new order — not interleaved — since DDS
 * requires a continuation line ('-'/'+' in column 80) to immediately
 * follow the line it continues, and an unrelated commented-out line
 * landing between a new line and its own continuation would corrupt it.
 */
function applyModificationTracking(oldLines, newLines, options) {
  options = options || {};
  if (!options.enabled) return newLines;
  const tag = buildModTag(options.tag);
  if (!tag) return newLines;

  const prefix = commonPrefixLen(oldLines, newLines);
  const maxSuffix = Math.min(oldLines.length, newLines.length) - prefix;
  const suffix = commonSuffixLen(oldLines, newLines, maxSuffix);

  const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
  const newMid = newLines.slice(prefix, newLines.length - suffix);
  if (oldMid.length === 0 && newMid.length === 0) return newLines;

  const outMid = [];
  const maxLen = Math.max(oldMid.length, newMid.length);
  for (let i = 0; i < maxLen; i++) {
    const oi = i < oldMid.length ? oldMid[i] : null;
    const ni = i < newMid.length ? newMid[i] : null;
    if (oi != null && oi !== ni && oi.trim() !== "") outMid.push(commentOutLine(oi));
  }
  for (let j = 0; j < maxLen; j++) {
    const oj = j < oldMid.length ? oldMid[j] : null;
    const nj = j < newMid.length ? newMid[j] : null;
    if (nj == null) continue;
    outMid.push(oj === nj ? nj : appendModTag(nj, tag));
  }

  return newLines.slice(0, prefix).concat(outMid, newLines.slice(newLines.length - suffix));
}

module.exports = {
  regenerateSource,
  buildPositional,
  emitWithKeywords,
  keywordsToText,
  groupKeywordsByConditions,
  emitEntryWithConditionedKeywords,
  upsertReffldKeyword,
  tokenizeKeywordText,
  commentOutLine,
  buildModTag,
  appendModTag,
  applyModificationTracking,
  // Batch PP (docs/TASKS.md) — exported directly so they're unit-testable
  // in isolation, same rationale as emitWithKeywords/tokenizeKeywordText
  // above.
  packKeywordsPreservingLines,
  emitGroupKeywordLines,
  originalRunRange,
  originalRunKeywordText,
};
