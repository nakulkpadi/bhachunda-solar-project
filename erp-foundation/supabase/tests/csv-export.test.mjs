import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
const source = stripTypeScriptTypes(await readFile(new URL("../../apps/web/src/csv-export.ts", import.meta.url), "utf8"), { mode: "strip" });
const { csvValue } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
test("CSV quotes preserve Gujarati, leading zeroes, embedded quotes and line breaks", () => {
  assert.equal(csvValue("૦૦૧૨ / Survey"), '"૦૦૧૨ / Survey"');
  assert.equal(csvValue('A "quoted", value\nnext line'), '"A ""quoted"", value\nnext line"');
  assert.equal(csvValue(null), '""');
});
test("CSV text cannot start a spreadsheet formula after whitespace", () => {
  for (const input of ['=HYPERLINK("https://example.invalid")', "+SUM(1,2)", "@SUM(1,2)", "-1+2", "  =1+2", "\t=1+2", "\r=1+2", "\uFEFF=1+2"]) assert.ok(csvValue(input).startsWith('"\''));
});
test("CSV numeric data stays numeric and normal survey identifiers stay unchanged", () => {
  assert.equal(csvValue(-1), '"-1"'); assert.equal(csvValue(3.26), '"3.26"');
  assert.equal(csvValue("140-1-P2"), '"140-1-P2"');
});
