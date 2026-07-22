import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/notionScheduleParser.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { exports: module.exports, module }, { filename: "notionScheduleParser.js" });

const { parseNotionClassCell } = module.exports;

assert.deepEqual(
  { ...parseNotionClassCell("통과-개별(유소연T)") },
  { subjectLabel: "통과", classTypeLabel: "개별", instructorName: "유소연", rawText: "통과-개별(유소연T)" }
);
assert.equal(parseNotionClassCell("통과-개별（유소연T）\u200B").instructorName, "유소연");
assert.equal(parseNotionClassCell("통과-개별(유소연T) ※").instructorName, "유소연");
assert.equal(parseNotionClassCell("수학-개별(원장님)").instructorName, "안준성");
assert.equal(parseNotionClassCell("수학-개별(원장님T)").instructorName, "안준성");
assert.equal(parseNotionClassCell("국어-개별(남종언T)").instructorName, "남종언");
assert.equal(parseNotionClassCell("수학-개별(박은채T)").instructorName, "박은채");
assert.equal(parseNotionClassCell("통과-개별 유소연T").instructorName, "");

console.log("notion schedule parser verification passed");
