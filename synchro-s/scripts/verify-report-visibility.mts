import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const page = readFileSync("app/synchro-s/page.tsx", "utf8");
const grid = readFileSync("components/schedule/TimetableGrid.tsx", "utf8");
const progress = readFileSync("components/schedule/SaveProgress.tsx", "utf8");
const begin = grid.indexOf("  const manuallyVisibleDays =");
const end = grid.indexOf("  const manuallyVisibleTimeSlots", begin);
const code = ts.transpileModule(grid.slice(begin, end) + "\nJSON.stringify(renderDays)", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const days = [{ key: 1 }, { key: 2 }, { key: 3 }];
for (const hideEmptyDays of [true, false]) {
  assert.deepEqual(JSON.parse(vm.runInNewContext(code, { days, hiddenDays: [2], hideEmptyDays, activeDaySet: new Set([1, 2, 3]) })), [{ key: 1 }, { key: 3 }]);
  assert.deepEqual(JSON.parse(vm.runInNewContext(code, { days, hiddenDays: [1, 2, 3], hideEmptyDays, activeDaySet: new Set() })), []);
}
assert.deepEqual(days, [{ key: 1 }, { key: 2 }, { key: 3 }]);
assert.ok(page.includes("setHiddenTimeSlots([]);\n    setHiddenDays([]);"));
assert.ok(page.includes('document.addEventListener("visibilitychange", restoreReportVisibility)'));
assert.ok(!page.includes("synchro-s-hidden-time-slots-v1"));
assert.ok(progress.includes("Math.min(95,"), "Pending estimate must never show completion");
assert.ok(progress.includes("motion-reduce:transition-none"));
assert.ok(progress.includes("window.clearInterval(timer)"));
assert.ok(progress.includes('role="progressbar"'));
console.log("PASS: actual grid day filtering incl. all-hidden; no source mutation; ephemeral scope reset; progress truth/reduced-motion/cleanup contracts.");
