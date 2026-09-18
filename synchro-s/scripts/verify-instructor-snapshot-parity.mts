import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mergeScheduleStudentRosters } from "../lib/homeDashboardGrouping";
import { mergeScheduleReviewEvents } from "../lib/scheduleReviewSnapshot";
import type { ScheduleEvent } from "../types/schedule";

const source = readFileSync(new URL("../app/synchro-s/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helpers: string[] = [];
const helperNames = new Set([
  "normalizePersonName", "normalizeLookupToken", "scopeScheduleEventToStudent",
  "getInstructorScheduleMergeKey", "mergeStudentRosters", "dedupeInstructorStudentTimeSlots"
]);
let callback = "";
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && helperNames.has(node.name.text)) helpers.push(node.getText(ast));
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "activeStudentEventsForInstructor" &&
      node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0]!.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback, "execute the real instructor projection, not a test-only replacement");
const js = ts.transpileModule(`${helpers.join("\n")}\n(${callback})()`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;

function lesson(hour: number, overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: "shared-chemistry-class", instructorId: "chemistry", instructorName: "김현진",
    studentIds: ["student"], studentNames: ["최한별"],
    subjectCode: "CHEMISTRY", subjectName: "화학", classTypeCode: "REGULAR_MULTI",
    classTypeLabel: "개별정규", badgeText: "[개별정규]", scheduleMode: "recurring",
    weekday: 1, classDate: "2026-09-14", startTime: `${hour}:00`, endTime: `${hour + 1}:00`,
    progressStatus: "planned", createdAt: "2026-08-31T00:00:00Z", ...overrides
  };
}
const chemistry = [19, 20, 21].map(hour => lesson(hour));
const english = [17, 18].map(hour => lesson(hour, {
  id: "english", instructorId: "english", instructorName: "이영재", subjectName: "영어", subjectCode: "ENGLISH"
}));
const saved = { targetId: "student", classIds: ["shared-chemistry-class", "english"], snapshotEvents: [...english, ...chemistry] };
const live = [17, 18, 19, 20, 21].map(hour => lesson(hour));
function project(groups = [saved], liveEvents = live, tag: string | null = "september", instructorId = "chemistry") {
  return vm.runInNewContext(js, {
    roleView: "instructor", selectedInstructorId: instructorId,
    selectedInstructorLabel: instructorId === "chemistry" ? "김현진" : "이영재",
    activeStudentIdSet: new Set(["student", "other"]), activeStudentNameSet: new Set(["최한별", "다른학생"]),
    effectiveStudentGroupByTargetId: new Map(groups.map(group => [group.targetId, group])),
    filteredEvents: liveEvents, selectedScheduleTagId: tag,
    mergeScheduleReviewEvents, mergeScheduleStudentRosters
  }) as ScheduleEvent[];
}
const hours = (events: ScheduleEvent[], student = "student") => Array.from(events)
  .filter(event => event.studentIds.includes(student)).map(event => event.startTime).sort();
const initial = JSON.stringify({ saved, live });
assert.deepEqual(hours(project()), ["19:00", "20:00", "21:00"], "linked class hours must not widen saved participation from 19–22 to 17–22");
assert.deepEqual(hours(project([saved], live, null)), ["19:00", "20:00", "21:00"], "untagged live fallback must not resurrect saved student's old hours");
assert.deepEqual(hours(project([saved], live, "september", "english")), ["17:00", "18:00"], "saved instructor reassignment must be preserved");
assert.deepEqual(hours(project([{ ...saved, snapshotEvents: english }])), [], "a snapshot with no lessons for this instructor must not trigger live fallback");
assert.deepEqual(hours(project([saved], [...live, lesson(22, { id: "unlinked-class" })])), ["19:00", "20:00", "21:00"], "unlinked live lessons cannot leak into a selected tag");
const other = { targetId: "other", classIds: ["shared-chemistry-class"], snapshotEvents: [17, 18, 19, 20, 21].map(hour => lesson(hour, { studentIds: ["other"], studentNames: ["다른학생"] })) };
const combined = project([saved, other]);
assert.deepEqual(hours(combined), ["19:00", "20:00", "21:00"]);
assert.deepEqual(hours(combined, "other"), ["17:00", "18:00", "19:00", "20:00", "21:00"], "other student's legitimate earlier participation must remain");
const mixedRoster = live.map(event => ({ ...event, studentIds: ["student", "other"], studentNames: ["최한별", "다른학생"] }));
const mixedFallback = project([saved], mixedRoster, null);
assert.deepEqual(hours(mixedFallback), ["19:00", "20:00", "21:00"]);
assert.deepEqual(hours(mixedFallback, "other"), ["17:00", "18:00", "19:00", "20:00", "21:00"], "ungrouped students in a shared live roster must not disappear");
assert.deepEqual(hours(project([{ ...saved, snapshotEvents: [] }])), ["17:00", "18:00", "19:00", "20:00", "21:00"], "legacy groups without snapshots retain linked-live fallback");
assert.deepEqual(hours(project([{ ...saved, snapshotEvents: [lesson(19, { id: "draft-unpersisted" })] }])), ["17:00", "18:00", "19:00", "20:00", "21:00"], "unpersisted draft snapshots use the same legacy fallback as the student view");
assert.deepEqual(hours(project([], live)), [], "selected tags without a group must stay empty");
assert.deepEqual(hours(project([], live, null)), ["17:00", "18:00", "19:00", "20:00", "21:00"]);
assert.equal(JSON.stringify({ saved, live }), initial, "read-only projection must not mutate stored data");
console.log("PASS: real instructor projection respects saved participation, instructor changes, per-student rosters, tags, legacy fallback, and immutability.");
