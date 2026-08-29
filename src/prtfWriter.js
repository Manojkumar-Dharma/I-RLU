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
 * Wraps keyword text into one or more 80-column physical lines, given a
 * 44-char positional prefix for the first line (continuation lines get a
 * blank 44-char prefix). Uses '+' continuation (no implied space at the
 * join) which is safe for any token boundary; splitting only ever happens
 * between separate keyword tokens, never inside one.
 */
function emitWithKeywords(positional44, keywordText) {
  const KEYWORD_WIDTH = 34; // columns 45-78; col 79 unused, col 80 reserved for +/-
  const lines = [];
  const tokens = keywordText.trim() === "" ? [] : keywordText.trim().split(/\s+/);
  let current = "";
  let firstLine = true;
  const flush = (hasMore) => {
    const prefix = firstLine ? positional44 : " ".repeat(44);
    const body = padRight(current, KEYWORD_WIDTH) + " "; // col 79 blank
    lines.push(prefix + body + (hasMore ? "+" : " "));
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
    // Replace trailing '+' of the last emitted line with a space since
    // there's nothing more to say.
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

module.exports = { regenerateSource, buildPositional, emitWithKeywords, keywordsToText };
