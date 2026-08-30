"use strict";
// Builds test/fixtures/sample-scs.pf — a printer file scoped to *SCS
// (line-printer / char-cell) device type, i.e. it deliberately avoids every
// AFPDS-only keyword documented in docs/KEYWORD-INVENTORY.md (no FONT,
// CDEFNT, PAGSEG, COLOR, LINE/BOX, etc.) so parser/engine tests can assert
// SCS-mode behavior distinctly from AFPDS-mode behavior. Built with the real
// writer for the same reason sample1.pf is: guaranteed column-correctness.
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

push({ kind: "comment", text: " I-RLU sample printer file - SCS device type (no AFPDS keywords)" });
push({ kind: "blank" });
push({
  kind: "fileLevel",
  keywords: [
    { name: "PAGSIZE", params: "(66 132)", raw: "PAGSIZE(66 132)" },
    { name: "DEVTYPE", params: "(*SCS)", raw: "DEVTYPE(*SCS)" },
    { name: "CPI", params: "(10)", raw: "CPI(10)" },
    { name: "LPI", params: "(6)", raw: "LPI(6)" },
  ],
});
push({
  kind: "record",
  name: "HEADER",
  conditions: [],
  keywords: [{ name: "SKIPB", params: "(1)", raw: "SKIPB(1)" }],
});
push({
  kind: "constant",
  line: 1,
  position: 1,
  conditions: [],
  literal: "MONTHLY SALES REPORT",
  keywords: [],
});
push({
  kind: "constant",
  line: 1,
  position: 60,
  conditions: [],
  literal: "PAGE",
  keywords: [{ name: "SPACEB", params: "(0)", raw: "SPACEB(0)" }],
});
push({
  kind: "field",
  name: "",
  reference: false,
  conditions: [],
  keywords: [{ name: "PAGNBR", params: "", raw: "PAGNBR" }],
});
model.sequence[model.sequence.length - 1] = {
  kind: "constant",
  line: 1,
  position: 65,
  conditions: [],
  keywords: [{ name: "PAGNBR", params: "", raw: "PAGNBR" }],
};
push({
  kind: "constant",
  line: 3,
  position: 1,
  conditions: [],
  literal: "REGION",
  keywords: [],
});
push({
  kind: "constant",
  line: 3,
  position: 20,
  conditions: [],
  literal: "SALES AMT",
  keywords: [],
});
push({
  kind: "record",
  name: "DETAIL",
  conditions: [],
  keywords: [{ name: "OVERFLOW", params: "(60)", raw: "OVERFLOW(60)" }],
});
push({
  kind: "field",
  name: "REGNAME",
  reference: false,
  length: 15,
  dataType: "A",
  usage: "O",
  line: 1,
  position: 1,
  conditions: [],
  keywords: [],
});
push({
  kind: "field",
  name: "SALESAMT",
  reference: false,
  length: 9,
  dataType: "S",
  decimalPositions: 2,
  usage: "O",
  line: 1,
  position: 20,
  conditions: [],
  keywords: [{ name: "EDTCDE", params: "(J)", raw: "EDTCDE(J)" }],
});
push({
  kind: "record",
  name: "FOOTER",
  conditions: [],
  keywords: [{ name: "SKIPB", params: "(2)", raw: "SKIPB(2)" }],
});
push({
  kind: "constant",
  line: 1,
  position: 1,
  conditions: [],
  literal: "--- END OF REPORT ---",
  keywords: [],
});

const text = regenerateSource(model);
fs.writeFileSync(path.join(__dirname, "sample-scs.pf"), text);
console.log(text);
