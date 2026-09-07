import {
  ConditioningIndicator,
  ConstantEntry,
  FieldEntry,
  FileLevelEntry,
  Keyword,
  ParsedSource,
  RecordFormatEntry,
  SourceLineEntry,
} from "./prtfModel";

// Column positions are 1-based in DDS documentation; we convert to 0-based
// string indices here. `sub(line, startCol, endCol)` returns the inclusive
// 1-based column range [startCol, endCol] from a line, padding with spaces
// if the line is shorter than the requested range.
function sub(line: string, startCol: number, endCol: number): string {
  const padded = line.length < endCol ? line + " ".repeat(endCol - line.length) : line;
  return padded.slice(startCol - 1, endCol);
}

function col(line: string, colNum: number): string {
  return sub(line, colNum, colNum);
}

function parseConditions(line: string): ConditioningIndicator[] {
  const slots = [sub(line, 8, 10), sub(line, 11, 13), sub(line, 14, 16)];
  const result: ConditioningIndicator[] = [];
  for (const raw of slots) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const negate = trimmed.toUpperCase().startsWith("N") && trimmed.length > 1;
    result.push({
      raw: trimmed,
      negate,
      indicator: negate ? trimmed.slice(1) : trimmed,
    });
  }
  return result;
}

/**
 * Extracts the keyword-area text (columns 45-80) from a physical line,
 * stripping the sequence number/comment/positional columns, and reporting
 * whether the line continues onto the next one (trailing '+' or '-' in
 * column 80).
 */
function keywordAreaOf(line: string): { text: string; continues: boolean; joinWithSpace: boolean } {
  const area = sub(line, 45, 80);
  const col80 = area[area.length - 1];
  if (col80 === "+" || col80 === "-") {
    return { text: area.slice(0, -1).replace(/\s+$/, ""), continues: true, joinWithSpace: col80 === "-" };
  }
  return { text: area.replace(/\s+$/, ""), continues: false, joinWithSpace: false };
}

/** Splits a keyword-area string into individual KEYWORD(params) tokens. Handles nested parens and quoted literals. */
function splitKeywords(text: string): { name: string; params: string; raw: string }[] {
  const tokens: { name: string; params: string; raw: string }[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;
    const start = i;
    // A bare quoted literal (constant text) with no keyword name, e.g. 'HELLO'.
    if (text[i] === "'") {
      i++;
      while (i < n && !(text[i] === "'" && text[i + 1] !== "'")) {
        if (text[i] === "'" && text[i + 1] === "'") i++; // escaped quote
        i++;
      }
      i++; // closing quote
      const raw = text.slice(start, i);
      tokens.push({ name: "", params: raw, raw });
      continue;
    }
    let nameEnd = i;
    while (nameEnd < n && /[A-Za-z0-9_#@$]/.test(text[nameEnd])) nameEnd++;
    const name = text.slice(start, nameEnd).toUpperCase();
    i = nameEnd;
    let params = "";
    if (text[i] === "(") {
      let depth = 0;
      const pStart = i;
      let inQuote = false;
      while (i < n) {
        const c = text[i];
        if (c === "'" && text[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (c === "'") inQuote = !inQuote;
        if (!inQuote) {
          if (c === "(") depth++;
          if (c === ")") {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
        }
        i++;
      }
      params = text.slice(pStart, i);
    }
    const raw = name + params;
    if (name || params) tokens.push({ name, params, raw });
    if (i === start) i++; // safety: always make progress even on an unrecognized stray character
  }
  return tokens;
}

/**
 * Pulls the first bare (nameless) quoted token — a constant's own literal
 * text — out of an already-tokenized keyword-area list, returning the
 * extracted literal (with doubled single-quotes unescaped, same as any
 * other DDS literal) and the remaining tokens' raw text rejoined for
 * ordinary keyword parsing, or `null` if no bare token is present. Shared
 * by both the "line that creates a new constant" path and the "attached
 * keyword line targeting an already-created, still-literal-less constant"
 * path below — a constant's literal is legal DDS anywhere among its
 * keywords, not only on its own header line (see Batch BB's own
 * same-line version of this same "literal not just first" fix).
 */
function extractLiteralFromTokens(kwTokens: { name: string; params: string; raw: string }[]): { literal: string; remainingRaw: string } | null {
  const literalTokenIndex = kwTokens.findIndex((tok) => tok.name === "");
  if (literalTokenIndex === -1) return null;
  const literalTok = kwTokens[literalTokenIndex];
  return {
    literal: literalTok.params.slice(1, -1).replace(/''/g, "'"),
    remainingRaw: kwTokens
      .filter((_tok, i) => i !== literalTokenIndex)
      .map((tok) => tok.raw)
      .join(" "),
  };
}

export function parseSource(text: string): ParsedSource {
  const lineEnding: "\n" | "\r\n" = text.includes("\r\n") ? "\r\n" : "\n";
  const rawLines = text.split(/\r\n|\n/);
  // Drop a single trailing empty line produced by a final newline, so
  // round-tripping doesn't add a blank line every save.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const sequence: SourceLineEntry[] = [];
  const fileLevel: FileLevelEntry = { kind: "fileLevel", sourceLineIndex: 0, keywords: [] };
  const records: RecordFormatEntry[] = [];
  let currentRecord: RecordFormatEntry | null = null;

  // Pending keyword continuation state.
  let pendingKeywordTarget: Keyword[] | null = null;
  let pendingKeywordText = "";
  let pendingJoinWithSpace = false;
  let pendingStartLine = -1;
  // Set only when the CURRENT pending run started from an attached
  // keyword-only line (see the "attached keyword line" branch below) —
  // undefined for the far more common case of keywords continuing from an
  // entry's own header line, where they carry no conditioning of their
  // own beyond the entry's (see prtfModel.ts's Keyword.conditions comment).
  let pendingConditions: ConditioningIndicator[] | undefined;
  let entryIdCounter = 0;
  const nextId = () => "e" + entryIdCounter++;

  function flushPendingKeywords() {
    if (pendingKeywordTarget && pendingKeywordText.trim() !== "") {
      for (const tok of splitKeywords(pendingKeywordText)) {
        pendingKeywordTarget.push({
          name: tok.name,
          params: tok.params,
          raw: tok.raw,
          sourceLineIndex: pendingStartLine,
          conditions: pendingConditions,
        });
      }
    }
    pendingKeywordTarget = null;
    pendingKeywordText = "";
    pendingJoinWithSpace = false;
    pendingStartLine = -1;
    pendingConditions = undefined;
  }

  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];

    // Continuation of a previous line's keyword area.
    if (pendingKeywordTarget) {
      const { text: kwText, continues, joinWithSpace } = keywordAreaOf(line);
      pendingKeywordText += (pendingJoinWithSpace ? " " : "") + kwText;
      pendingJoinWithSpace = joinWithSpace;
      if (!continues) {
        flushPendingKeywords();
      }
      continue;
    }

    if (line.trim() === "") {
      sequence.push({ kind: "blank", sourceLineIndex: idx });
      continue;
    }

    const commentFlag = col(line, 7);
    if (commentFlag === "*") {
      const entry = { kind: "comment" as const, sourceLineIndex: idx, text: line.slice(7), formType: col(line, 6) };
      sequence.push(entry);
      continue;
    }

    const nameType = col(line, 17).toUpperCase();
    const name = sub(line, 19, 28).trim();
    const conditions = parseConditions(line);
    const { text: kwText, continues, joinWithSpace } = keywordAreaOf(line);

    if (nameType === "R") {
      const record: RecordFormatEntry = {
        kind: "record",
        sourceLineIndex: idx,
        name,
        conditions,
        keywords: [],
        fields: [],
        formType: col(line, 6),
      };
      records.push(record);
      currentRecord = record;
      sequence.push(record);
      if (continues) {
        pendingKeywordTarget = record.keywords;
        pendingKeywordText = kwText;
        pendingJoinWithSpace = joinWithSpace;
        pendingStartLine = idx;
      } else if (kwText.trim() !== "") {
        for (const tok of splitKeywords(kwText)) {
          record.keywords.push({ name: tok.name, params: tok.params, raw: tok.raw, sourceLineIndex: idx });
        }
      }
      continue;
    }

    // Field-level line (named field) or constant (unnamed, keyword-only) or
    // file-level line (before any record format has been seen).
    const referenceFlag = col(line, 29).toUpperCase() === "R";
    const lengthRaw = sub(line, 30, 34).trim();
    const dataType = sub(line, 35, 35).trim() || undefined;
    const decRaw = sub(line, 36, 37).trim();
    const usage = sub(line, 38, 38).trim() || undefined;
    const lineRaw = sub(line, 39, 41).trim();
    const posRaw = sub(line, 42, 44).trim();

    const length = lengthRaw ? parseInt(lengthRaw, 10) : undefined;
    const decimalPositions = decRaw ? parseInt(decRaw, 10) : undefined;
    const lineNo = lineRaw ? parseInt(lineRaw, 10) : undefined;
    // DDS's RELPOS-style relative positioning: a leading '+' in the
    // position field (columns 42-44) means "n spaces after the end of the
    // previous field on this line" rather than an absolute column — see
    // FieldEntry's own `relativePosition` doc comment (prtfModel.ts) for
    // the full citation and how this flows through to the writer/layout.
    // parseInt itself handles the leading '+' fine (parseInt("+2", 10) ===
    // 2) — the flag is the only thing that would otherwise be lost.
    const relativePosition = posRaw.startsWith("+");
    const position = posRaw ? parseInt(posRaw, 10) : undefined;

    let target: Keyword[];
    let entry: SourceLineEntry;
    let kwTextForKeywords = kwText;
    // A completely blank name/reference/length/type/decimals/usage/line/
    // position, but non-empty (or absent — see below) conditioning, is a
    // physical line whose ONLY job is to attach one or more additional
    // keyword(s) to the entry immediately before it — the classic RLU
    // technique for e.g. two mutually-exclusive COLOR keywords on the same
    // field, each independently conditioned. Every one of those positional
    // columns being blank is what marks this as "not a constant" (a
    // constant always needs at least a Location — line and position — to
    // be placed at all; DATE/TIME/PAGNBR-only "system constants" still
    // carry Location, just no literal). "The entry immediately before it"
    // is the record's own most recently added field/constant if it has
    // one, or the RECORD FORMAT ITSELF if a record has been opened but no
    // field/constant has been seen yet — the same technique applies to
    // record-level keywords like PAGSIZE/CPI/LPI/OVERLAY/STRPAGGRP, which
    // live directly on the record, not on any field (see this batch's own
    // tests in prtfConditionedKeywords.test.ts for a PAGSIZE example).
    // Requiring a record to have been opened at all guards against a
    // genuinely malformed line being silently absorbed with no diagnostic —
    // falls through to the ordinary constant branch below instead, same as
    // it did before this existed.
    const isAttachedKeywordLine =
      !!currentRecord &&
      !referenceFlag &&
      length === undefined &&
      dataType === undefined &&
      decimalPositions === undefined &&
      usage === undefined &&
      lineNo === undefined &&
      position === undefined;

    if (!currentRecord) {
      // File-level keyword line (no record format opened yet). Real DDS
      // rarely conditions file-level keywords (indicators are unusual at
      // that scope), but the syntax permits it and there's no reason to
      // special-case dropping it here — captured the same way an attached
      // field/record keyword line's conditioning is, just tagged directly
      // rather than via the isAttachedKeywordLine branch below (file-level
      // has no separate "genuine new entry" alternative to rule out the
      // way a constant is for a record's fields).
      target = fileLevel.keywords;
      entry = fileLevel; // not pushed to sequence more than once; see below
      if (sequence.indexOf(fileLevel) === -1) {
        // Batch AA — capture the form-type char from the FIRST file-level
        // line only: every file-level line's keywords get merged into
        // this one entry (and one regenerated physical block) regardless
        // of how many original lines contributed, so there's no single
        // "this entry's own line" beyond the first to prefer.
        fileLevel.formType = col(line, 6);
        sequence.push(fileLevel);
      }
      const lineConditions = conditions.length ? conditions : undefined;
      if (continues) {
        pendingKeywordTarget = target;
        pendingKeywordText = kwText;
        pendingJoinWithSpace = joinWithSpace;
        pendingStartLine = idx;
        pendingConditions = lineConditions;
      } else if (kwText.trim() !== "") {
        for (const tok of splitKeywords(kwText)) {
          target.push({ name: tok.name, params: tok.params, raw: tok.raw, sourceLineIndex: idx, conditions: lineConditions });
        }
      }
      continue;
    } else if (name) {
      const field: FieldEntry = {
        kind: "field",
        id: nextId(),
        sourceLineIndex: idx,
        name,
        reference: referenceFlag,
        length,
        dataType,
        decimalPositions,
        usage,
        line: lineNo,
        position,
        relativePosition,
        conditions,
        keywords: [],
        formType: col(line, 6),
      };
      currentRecord.fields.push(field);
      sequence.push(field);
      target = field.keywords;
      entry = field;
    } else if (isAttachedKeywordLine) {
      const owner = currentRecord.fields.length > 0 ? currentRecord.fields[currentRecord.fields.length - 1] : currentRecord;
      target = owner.keywords;
      entry = owner;
      const lineConditions = conditions.length ? conditions : undefined;
      // Root-cause fix (reported: RPTHEAD/RPTCOLHD-style records rendering
      // with empty constant text): a constant's own literal is very
      // commonly split across two physical lines in real-world PRTF
      // source — a "header" line carrying just LINE/POSITION (which,
      // having no name either, creates the constant itself, below), then
      // an attached-keyword-only line carrying nothing but the quoted
      // literal, e.g.:
      //   A                    32
      //   A                      'Customer Aging Report'
      // Before this fix, an attached-keyword line's tokens were always
      // pushed straight onto `owner.keywords` (via `splitKeywords`
      // further down) with no literal-extraction at all — fine for a
      // genuine additional keyword like a second COLOR(), but for a
      // still-literal-less constant it left `owner.literal` permanently
      // undefined, and prtfLayout.js's `resolveLayout` renders a
      // constant's cell text as `entry.literal || constantPlaceholder ||
      // ""` (see its own comment) — so the field just rendered as an
      // empty cell with no visible error anywhere. Only applies when the
      // owner is a constant that doesn't already have a literal (a
      // constant only ever has ONE literal — a second bare-quoted token
      // showing up on a later attached line is not expected in real DDS
      // and is left as an ordinary keyword rather than silently
      // overwriting the first).
      const extraction = owner.kind === "constant" && owner.literal === undefined ? extractLiteralFromTokens(splitKeywords(kwText)) : null;
      const kwTextForAttached = extraction ? extraction.remainingRaw : kwText;
      if (extraction) (owner as ConstantEntry).literal = extraction.literal;
      if (continues) {
        pendingKeywordTarget = target;
        pendingKeywordText = kwTextForAttached;
        pendingJoinWithSpace = joinWithSpace;
        pendingStartLine = idx;
        pendingConditions = lineConditions;
      } else if (kwTextForAttached.trim() !== "") {
        for (const tok of splitKeywords(kwTextForAttached)) {
          target.push({ name: tok.name, params: tok.params, raw: tok.raw, sourceLineIndex: idx, conditions: lineConditions });
        }
      }
      continue;
    } else {
      const constant: ConstantEntry = {
        kind: "constant",
        id: nextId(),
        sourceLineIndex: idx,
        line: lineNo,
        position,
        relativePosition,
        conditions,
        keywords: [],
        formType: col(line, 6),
      };
      currentRecord.fields.push(constant);
      sequence.push(constant);
      target = constant.keywords;
      entry = constant;
      // Pull the constant's own quoted literal (display text) out of the
      // keyword-area text, if present, e.g. R * 5 30'Invoice Date:'. A
      // constant's literal is legal DDS anywhere among its keywords, not
      // only first — e.g. `SPACEB(1) 'CUSTOMER MASTER LISTING'` is a real,
      // common pattern (a keyword before the literal). Batch BB: tokenize
      // the whole keyword-area text (quote-aware, via the same splitKeywords
      // used everywhere else) instead of only matching an anchored leading
      // literal, so a literal preceded by another keyword is still found —
      // take the FIRST bare (nameless) quoted token anywhere in the text as
      // the constant's literal, leaving every other token as an ordinary
      // keyword in its original order.
      const kwTokens = splitKeywords(kwText);
      const extraction = extractLiteralFromTokens(kwTokens);
      if (extraction) {
        constant.literal = extraction.literal;
        kwTextForKeywords = extraction.remainingRaw;
      }
    }

    if (continues) {
      pendingKeywordTarget = target;
      pendingKeywordText = kwTextForKeywords;
      pendingJoinWithSpace = joinWithSpace;
      pendingStartLine = idx;
    } else if (kwTextForKeywords.trim() !== "") {
      for (const tok of splitKeywords(kwTextForKeywords)) {
        target.push({ name: tok.name, params: tok.params, raw: tok.raw, sourceLineIndex: idx });
      }
    }
    void entry;
  }
  flushPendingKeywords();

  return { rawLines, lineEnding, fileLevel, records, sequence };
}
