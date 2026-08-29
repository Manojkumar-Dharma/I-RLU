"use strict";
// Builds test/fixtures/sample1.pf from a hand-built model, using the real
// writer so the fixture is guaranteed to be column-correct. This is our
// "known good" source: parsing it and regenerating it must round-trip
// byte-for-byte.
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

push({ kind: "comment", text: " I-RLU sample printer file - customer invoice" });
push({ kind: "blank" });
push({
  kind: "fileLevel",
  keywords: [
    { name: "PAGSIZE", params: "(66 132)", raw: "PAGSIZE(66 132)" },
    { name: "PRTQLTY", params: "(*STD)", raw: "PRTQLTY(*STD)" },
  ],
});
push({
  kind: "record",
  name: "HEADER",
  conditions: [],
  keywords: [{ name: "SKIPB", params: "(1)", raw: "SKIPB(1)" }],
});
push({
  kind: "field",
  name: "CUSTNAME",
  reference: false,
  length: 30,
  dataType: "A",
  usage: "B",
  line: 1,
  position: 10,
  conditions: [],
  keywords: [],
});
push({
  kind: "field",
  name: "CUSTNBR",
  reference: false,
  length: 7,
  dataType: "S",
  decimalPositions: 0,
  usage: "B",
  line: 1,
  position: 50,
  conditions: [{ raw: "50", negate: false, indicator: "50" }],
  keywords: [{ name: "DRAW", params: "", raw: "DRAW" }],
});
push({
  kind: "constant",
  line: 5,
  position: 10,
  conditions: [],
  literal: "Invoice Date:",
  keywords: [{ name: "SPACEB", params: "(1)", raw: "SPACEB(1)" }],
});
push({
  kind: "field",
  name: "INVDATE",
  reference: false,
  length: 8,
  dataType: "A",
  usage: "O",
  line: 5,
  position: 25,
  conditions: [],
  keywords: [{ name: "SPACEA", params: "(2)", raw: "SPACEA(2)" }],
});
push({
  kind: "record",
  name: "DETAIL",
  conditions: [],
  keywords: [{ name: "OVERFLOW", params: "(60)", raw: "OVERFLOW(60)" }],
});
push({
  kind: "field",
  name: "ITEMDESC",
  reference: false,
  length: 20,
  dataType: "A",
  usage: "O",
  line: 1,
  position: 10,
  conditions: [],
  keywords: [],
});
push({
  kind: "field",
  name: "ITEMQTY",
  reference: false,
  length: 5,
  dataType: "S",
  decimalPositions: 0,
  usage: "O",
  line: 1,
  position: 32,
  conditions: [],
  keywords: [],
});
push({
  kind: "field",
  name: "ITEMAMT",
  reference: false,
  length: 9,
  dataType: "S",
  decimalPositions: 2,
  usage: "O",
  line: 1,
  position: 40,
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
  position: 5,
  conditions: [],
  literal: "Page",
  keywords: [],
});
push({
  kind: "field",
  name: "",
  reference: false,
  conditions: [],
  keywords: [{ name: "PAGNBR", params: "", raw: "PAGNBR" }],
});

// The blank name field above (record instance page number field) is
// unusual — printer files do allow unnamed keyword-only lines for things
// like PAGNBR; treat it as a constant-shaped entry instead for a cleaner
// fixture (matches how RLU/most shops would actually code it).
model.sequence[model.sequence.length - 1] = {
  kind: "constant",
  line: 1,
  position: 12,
  conditions: [],
  keywords: [{ name: "PAGNBR", params: "", raw: "PAGNBR" }],
};

const text = regenerateSource(model);
fs.writeFileSync(path.join(__dirname, "sample1.pf"), text);
console.log(text);
