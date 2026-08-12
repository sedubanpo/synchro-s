import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createScheduleReviewSnapshot,
  getScheduleReviewFingerprint,
  mergeScheduleReviewEvents
} from "../lib/scheduleReviewSnapshot";
import type { ScheduleEvent } from "../types/schedule";

const root = fileURLToPath(new URL("../", import.meta.url));

function event(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: "class-a",
    scheduleMode: "recurring",
    instructorId: "teacher-a",
    instructorName: "안준성",
    studentIds: ["student-a"],
    studentNames: ["김동현b"],
    subjectCode: "MATH",
    subjectName: "수학",
    classTypeCode: "ONE_TO_ONE",
    classTypeLabel: "1:1",
    badgeText: "1:1",
    weekday: 1,
    classDate: "2026-08-03",
    startTime: "08:00",
    endTime: "09:00",
    progressStatus: "planned",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

const snapshotEvents = [event()];
const missingMiddleHour = event({ startTime: "09:00", endTime: "10:00" });
const merged = mergeScheduleReviewEvents(snapshotEvents, [event(), missingMiddleHour]);
assert.equal(merged.length, 2, "partial snapshots must be supplemented with missing linked live occurrences");
assert.equal(merged.filter((item) => item.startTime === "08:00").length, 1, "existing occurrences must not be duplicated");

const baseFingerprint = getScheduleReviewFingerprint([event(), missingMiddleHour]);
assert.equal(
  baseFingerprint,
  getScheduleReviewFingerprint([missingMiddleHour, event()]),
  "fingerprints must be independent of response ordering"
);
assert.equal(
  baseFingerprint,
  getScheduleReviewFingerprint([
    event({ classDate: "2026-08-10", studentIds: ["student-a", "student-b"], studentNames: ["김동현b", "다른 학생"] }),
    event({ classDate: "2026-08-10", startTime: "09:00", endTime: "10:00", studentIds: ["student-a", "student-b"], studentNames: ["김동현b", "다른 학생"] })
  ]),
  "a recurring timetable must stay valid across weeks and unrelated roster changes"
);
assert.notEqual(
  baseFingerprint,
  getScheduleReviewFingerprint([event({ startTime: "08:30", endTime: "09:30" }), missingMiddleHour]),
  "time changes must invalidate a prior review"
);
assert.notEqual(
  baseFingerprint,
  getScheduleReviewFingerprint([event({ instructorId: "teacher-b", instructorName: "김광수" }), missingMiddleHour]),
  "instructor changes must invalidate a prior review"
);
assert.equal(createScheduleReviewSnapshot(merged).snapshotEventCount, 2);

const [routeSource, pageSource] = await Promise.all([
  readFile(`${root}app/api/schedule-reviews/route.ts`, "utf8"),
  readFile(`${root}app/synchro-s/page.tsx`, "utf8")
]);
assert.ok(routeSource.includes("historyItems"), "review API must return append-only status history");
assert.ok(!routeSource.includes('.from("special_notes").delete()'), "review saves must not delete earlier status records");
assert.ok(routeSource.includes("snapshotFingerprint"), "review API must persist a server-derived snapshot fingerprint");
assert.ok(routeSource.includes('from("timetable_groups")'), "review API must verify the saved group before accepting a status snapshot");
assert.ok(routeSource.includes("group.target_id !== studentId"), "review API must reject another student's saved group");
assert.ok(routeSource.includes("선택한 시간표 그룹과 검토 태그가 일치하지 않습니다"), "review API must reject cross-tag snapshot writes");
assert.ok(routeSource.includes("snapshotTagName"), "review snapshots must preserve the tag label at judgment time");
assert.ok(routeSource.includes("snapshotGroupName"), "review snapshots must preserve the saved timetable group identity");
assert.ok(routeSource.includes("snapshotEvents: row.parsed.snapshotEvents"), "status history must return its immutable timetable snapshot");
assert.ok(pageSource.includes("mergeScheduleReviewEvents(activeGroup.snapshotEvents ?? [], liveLinkedEvents)"), "review UI must supplement partial group snapshots");
assert.ok(pageSource.includes("selectedReviewIsStale"), "review UI must detect a changed timetable");
assert.ok(pageSource.includes("shouldPreserveReviewSnapshot"), "memo-only saves must not silently revalidate a changed timetable");
assert.ok(pageSource.includes("판정 이력"), "review UI must expose status history beside the selected student");
assert.ok(pageSource.includes("historyItem.snapshotTagName"), "review history must identify the snapshotted tag");
assert.ok(pageSource.includes("historyItem.snapshotGroupName"), "review history must identify the snapshotted timetable group");

console.log("schedule review snapshot verification passed");
