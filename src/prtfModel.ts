/**
 * Data model for parsed IBM i printer file (PRTF) DDS source.
 *
 * Column positions referenced throughout this file and in prtfParser.ts are
 * taken from IBM's DDS reference ("Positional entries for printer files",
 * positions 1 through 44):
 *
 *   1-5    Sequence number
 *   6      Form type
 *   7      Comment ('*' makes the whole line a comment)
 *   8-16   Conditioning (three 3-character indicator slots: col 7 itself can
 *          also hold 'A'/'O' for AND/OR continuation of conditioning)
 *   17     Type of name/specification ('R' = record format, blank = field
 *          or constant)
 *   18     Reserved
 *   19-28  Name (record format name or field name; blank for constants)
 *   29     Reference ('R' = REFFLD-style reference elsewhere in the keyword
 *          area)
 *   30-34  Length
 *   35     Data type (A, P, S, B, ...)
 *   36-37  Decimal positions
 *   38     Usage (O, I, B, H, M, P, ...)
 *   39-41  Location: line number
 *   42-44  Location: position (column) number
 *   45-80  Keyword area (continues onto following lines when position 80
 *          holds '+' or '-')
 */

/** A single conditioning-indicator slot, e.g. "N01", " 01", "H1", "LR". */
export interface ConditioningIndicator {
  /** Raw 3-character slot exactly as it appeared in the source (trimmed of trailing padding, not leading). */
  raw: string;
  /** true if this slot begins with 'N' (negated indicator). */
  negate: boolean;
  /** The indicator name/number with the leading 'N' (if any) stripped, e.g. "01", "H1", "LR". */
  indicator: string;
}

/** One DDS keyword entry, possibly spanning multiple continuation lines. */
export interface Keyword {
  /** Keyword name, e.g. "SKIPB", "LINE", "PAGSIZE". */
  name: string;
  /** Raw parameter text inside (and including) the parentheses, e.g. "(3)". Empty string for valueless keywords. */
  params: string;
  /** Exact reconstructed text of the keyword entry (name + params) as it should be re-emitted. */
  raw: string;
  /** Index (into ParsedSource.rawLines) of the first physical line this keyword started on. */
  sourceLineIndex: number;
}

export type EntryKind = "fileLevel" | "record" | "field" | "constant" | "comment" | "blank";

export interface BaseEntry {
  kind: EntryKind;
  /** Index into ParsedSource.rawLines where this entry's positional portion begins. */
  sourceLineIndex: number;
}

export interface CommentEntry extends BaseEntry {
  kind: "comment";
  text: string;
}

export interface BlankEntry extends BaseEntry {
  kind: "blank";
}

export interface FileLevelEntry extends BaseEntry {
  kind: "fileLevel";
  keywords: Keyword[];
}

export interface RecordFormatEntry extends BaseEntry {
  kind: "record";
  name: string;
  conditions: ConditioningIndicator[];
  keywords: Keyword[];
  /** Populated by the parser after the full pass: fields/constants belonging to this record, in source order. */
  fields: (FieldEntry | ConstantEntry)[];
}

export interface FieldEntry extends BaseEntry {
  kind: "field";
  /** Stable id assigned by the parser, used by the webview to reference this entry in edit messages instead of fragile name/position matching. */
  id: string;
  name: string;
  reference: boolean;
  length?: number;
  dataType?: string;
  decimalPositions?: number;
  usage?: string;
  line?: number;
  position?: number;
  conditions: ConditioningIndicator[];
  keywords: Keyword[];
}

export interface ConstantEntry extends BaseEntry {
  kind: "constant";
  /** Stable id assigned by the parser, used by the webview to reference this entry in edit messages instead of fragile name/position matching. */
  id: string;
  /** Literal constant text, extracted from a keyword-area token of the form 'literal text'. Undefined if the constant is defined purely via a keyword like DATE/TIME/PAGNBR. */
  literal?: string;
  line?: number;
  position?: number;
  conditions: ConditioningIndicator[];
  keywords: Keyword[];
}

export type SourceLineEntry =
  | CommentEntry
  | BlankEntry
  | FileLevelEntry
  | RecordFormatEntry
  | FieldEntry
  | ConstantEntry;

export interface ParsedSource {
  /** Original source text, split into lines (no trailing newline characters). */
  rawLines: string[];
  /** Line ending style detected from the original text, so the writer can reproduce it. */
  lineEnding: "\n" | "\r\n";
  /** File-level keywords (appearing before the first record format). */
  fileLevel: FileLevelEntry;
  /** All record formats, in source order. */
  records: RecordFormatEntry[];
  /**
   * Every entry in the file in original source order — comments, blank
   * lines, the file-level entry, record entries, and field/constant
   * entries. This is what the writer walks to regenerate the file, so that
   * anything not touched by an edit is reproduced exactly.
   */
  sequence: SourceLineEntry[];
}
