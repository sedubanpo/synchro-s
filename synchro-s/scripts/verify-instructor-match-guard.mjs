import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadTypeScriptModule(relativePath, dependencyMap = {}) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => dependencyMap[specifier] ?? require(specifier);
  vm.runInNewContext(compiled, { exports: module.exports, module, require: localRequire }, { filename: relativePath });
  return module.exports;
}

const parser = loadTypeScriptModule("../lib/notionScheduleParser.ts");
const guard = loadTypeScriptModule("../lib/instructorMatchGuard.ts", {
  "@/lib/notionScheduleParser": parser
});

assert.equal(guard.isInstructorSourceMatch("원장님", "안준성"), true);
assert.equal(guard.isInstructorSourceMatch("원장님T", "안준성"), true);
assert.equal(guard.isInstructorSourceMatch("남종언T", "남종언"), true);
assert.equal(guard.isInstructorSourceMatch("박은채T", "박은채"), true);
assert.equal(guard.isInstructorSourceMatch("남종언T", "안준성"), false);
assert.equal(guard.isInstructorSourceMatch("박은채T", "안준성"), false);
assert.equal(guard.isInstructorSourceMatch("", "안준성"), false);

console.log("instructor source match guard verification passed");
