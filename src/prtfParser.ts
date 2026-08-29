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
        });
      }
    }
    pendingKeywordTarget = null;
    pendingKeywordText = "";
    pendingJoinWithSpace = false;
    pendingStartLine = -1;
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
      const entry = { kind: "comment" as const, sourceLineIndex: idx, text: line.slice(7) };
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
    const position = posRaw ? parseInt(posRaw, 10) : undefined;

    let target: Keyword[];
    let entry: SourceLineEntry;
    let kwTextForKeywords = kwText;

    if (!currentRecord) {
      // File-level keyword line (no record format opened yet).
      target = fileLevel.keywords;
      entry = fileLevel; // not pushed to sequence more than once; see below
      if (sequence.indexOf(fileLevel) === -1) sequence.push(fileLevel);
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
        conditions,
        keywords: [],
      };
      currentRecord.fields.push(field);
      sequence.push(field);
      target = field.keywords;
      entry = field;
    } else {
      const constant: ConstantEntry = {
        kind: "constant",
        id: nextId(),
        sourceLineIndex: idx,
        line: lineNo,
        position,
        conditions,
        keywords: [],
      };
      currentRecord.fields.push(constant);
      sequence.push(constant);
      target = constant.keywords;
      entry = constant;
      // Pull a leading quoted literal out of the keyword text, if present,
      // as the constant's display text (e.g. R * 5 30'Invoice Date:').
      const literalMatch = kwText.match(/^\s*'((?:[^']|'')*)'/);
      if (literalMatch) {
        constant.literal = literalMatch[1].replace(/''/g, "'");
        kwTextForKeywords = kwText.slice(literalMatch.index! + literalMatch[0].length);
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
