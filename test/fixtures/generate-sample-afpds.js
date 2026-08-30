"use strict";
// Builds test/fixtures/sample-afpds.pf — exercises the AFPDS-only keywords
// newly cataloged in docs/KEYWORD-INVENTORY.md that sample1.pf doesn't
// already cover: FONT (coded-font + point size), CDEFNT, COLOR (named +
// RGB), CHRSIZ, PAGSEG, record-level OVERLAY (name + offsets, distinct from
// BARCODE/BOX which sample1.pf already covers), STRPAGGRP/ENDPAGGRP,
// DUPLEX/OUTBIN (print/finishing, no layout effect), and a
// program-to-system-field (&NAME) parameter to exercise the "P-field"
// indirection pattern noted in KEYWORD-INVENTORY §5. Built with the real
// writer for guaranteed column-correctness; round-trip parity is the test.
const fs = require("fs");
const path = require("path");
const { regenerateSource } = require("../../src/prtfWriter.js");

const model = {
  lineEnding: "\n",
  sequence: [],
};

function push(entry) {
  model.sequence.push(entry);
}

push({ kind: "comment", text: " I-RLU sample printer file - AFPDS device type, expanded keyword coverage" });
push({ kind: "blank" });
push({
  kind: "fileLevel",
  keywords: [
    { name: "PAGSIZE", params: "(66 132)", raw: "PAGSIZE(66 132)" },
    { name: "DEVTYPE", params: "(*AFPDS)", raw: "DEVTYPE(*AFPDS)" },
    { name: "FONT", params: "(2304)", raw: "FONT(2304)" },
    { name: "DUPLEX", params: "(*YES)", raw: "DUPLEX(*YES)" },
    { name: "OUTBIN", params: "(1)", raw: "OUTBIN(1)" },
  ],
});
push({
  kind: "record",
  name: "STMTHDR",
  conditions: [],
  keywords: [
    { name: "STRPAGGRP", params: "", raw: "STRPAGGRP" },
    { name: "SKIPB", params: "(1)", raw: "SKIPB(1)" },
    { name: "PAGSEG", params: "(COMPLOGO 0.5 0.5)", raw: "PAGSEG(COMPLOGO 0.5 0.5)" },
    { name: "OVERLAY", params: "(STMTFORM 0 0)", raw: "OVERLAY(STMTFORM 0 0)" },
  ],
});
push({
  kind: "constant",
  line: 1,
  position: 40,
  conditions: [],
  literal: "CUSTOMER STATEMENT",
  keywords: [
    { name: "CDEFNT", params: "(920 *CURLIB)", raw: "CDEFNT(920 *CURLIB)" },
    { name: "COLOR", params: "(*BLU)", raw: "COLOR(*BLU)" },
  ],
});
push({
  kind: "field",
  name: "CUSTNAME",
  reference: false,
  length: 30,
  dataType: "A",
  usage: "O",
  line: 3,
  position: 10,
  conditions: [],
  keywords: [
    { name: "CHRSIZ", params: "(1.5 1.5)", raw: "CHRSIZ(1.5 1.5)" },
    { name: "COLOR", params: "(*RGB 0 0 0)", raw: "COLOR(*RGB 0 0 0)" },
  ],
});
push({
  kind: "field",
  name: "ACCTBAL",
  reference: false,
  length: 11,
  dataType: "S",
  decimalPositions: 2,
  usage: "O",
  line: 3,
  position: 90,
  conditions: [],
  // &CURFONT is a program-to-system field (KEYWORD-INVENTORY §5): the
  // coded-font parameter is supplied by the HLL program at runtime rather
  // than fixed at compile time. This exercises the writer/parser's handling
  // of literal DDS text that happens to be an &NAME reference rather than a
  // number/name literal, without requiring any special-case model support.
  keywords: [{ name: "CDEFNT", params: "(&CURFONT)", raw: "CDEFNT(&CURFONT)" }],
});
push({
  kind: "record",
  name: "STMTFTR",
  conditions: [],
  keywords: [
    { name: "SKIPB", params: "(2)", raw: "SKIPB(2)" },
    { name: "ENDPAGGRP", params: "", raw: "ENDPAGGRP" },
  ],
});
push({
  kind: "constant",
  line: 1,
  position: 1,
  conditions: [],
  literal: "Thank you for your business.",
  keywords: [],
});

const text = regenerateSource(model);
fs.writeFileSync(path.join(__dirname, "sample-afpds.pf"), text);
console.log(text);
