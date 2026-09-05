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

function conditionSlots(conditions) {
  const slots = ["   ", "   ", "   "]; // 3 blank columns per slot when no condition is present
  (conditions || []).slice(0, 3).forEach((c, i) => {
    const text = (c.negate ? "N" : "") + c.indicator;
    // 3-char slot, right-justified (matches how indicator numbers are conventionally punched, e.g. " 01", "N01").
    slots[i] = text.length >= 3 ? text.slice(0, 3) : " ".repeat(3 - text.length) + text;
  });
  return slots;
}

function buildPositional({ nameType, name, reference, length, dataType, decimalPositions, usage, lineNo, position, conditions }) {
  const [c1, c2, c3] = conditionSlots(conditions);
  let s = "";
  s += "     "; // 1-5 sequence number (left blank; most shops let the editor/compiler ignore it)
  s += " "; // 6 form type
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
  s += padLeftNum(position, 3); // 42-44
  return s; // exactly 44 chars
}

function keywordsToText(keywords) {
  return (keywords || []).map((k) => k.raw != null ? k.raw : (k.name + (k.params || ""))).join(" ");
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
 * 44-char positional prefix for the first line (continuation lines get a
 * blank 44-char prefix).
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
function emitWithKeywords(positional44, keywordText) {
  const KEYWORD_WIDTH = 34; // columns 45-78; col 79 unused, col 80 reserved for +/-
  const lines = [];
  const tokens = keywordText.trim() === "" ? [] : tokenizeKeywordText(keywordText.trim());
  let current = "";
  let firstLine = true;
  const flush = (hasMore) => {
    const prefix = firstLine ? positional44 : " ".repeat(44);
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

function regenerateSource(model) {
  const outLines = [];
  for (const entry of model.sequence) {
    switch (entry.kind) {
      case "blank":
        outLines.push("");
        break;
      case "comment":
        outLines.push("      *" + entry.text);
        break;
      case "fileLevel": {
        const positional = buildPositional({});
        outLines.push(...emitWithKeywords(positional, keywordsToText(entry.keywords)));
        break;
      }
      case "record": {
        const positional = buildPositional({ nameType: "R", name: entry.name, conditions: entry.conditions });
        outLines.push(...emitWithKeywords(positional, keywordsToText(entry.keywords)));
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
          conditions: entry.conditions,
        });
        outLines.push(...emitWithKeywords(positional, keywordsToText(entry.keywords)));
        break;
      }
      case "constant": {
        const positional = buildPositional({ lineNo: entry.line, position: entry.position, conditions: entry.conditions });
        let kwText = keywordsToText(entry.keywords);
        if (entry.literal !== undefined) {
          const litToken = "'" + String(entry.literal).replace(/'/g, "''") + "'";
          kwText = kwText ? litToken + " " + kwText : litToken;
        }
        outLines.push(...emitWithKeywords(positional, kwText));
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
  upsertReffldKeyword,
  tokenizeKeywordText,
  commentOutLine,
  buildModTag,
  appendModTag,
  applyModificationTracking,
};
