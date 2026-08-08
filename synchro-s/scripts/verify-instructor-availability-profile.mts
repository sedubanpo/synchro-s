import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  findIncompleteInstructorAvailabilityDate,
  formatAvailabilityWeekdays,
  formatInstructorTeacherName,
  summarizeInstructorAvailabilityDays
} from "../lib/instructorAvailabilityProfile";

const weekdaySummary = summarizeInstructorAvailabilityDays({
  1: ["10:00", "11:00"],
  2: ["16:00"],
  3: ["15:00"],
  4: ["10:00"],
  5: ["10:00"],
  6: [],
  7: []
});

assert.deepEqual(weekdaySummary.availableDays, [1, 2, 3, 4, 5]);
assert.deepEqual(weekdaySummary.unavailableDays, [6, 7]);
assert.equal(weekdaySummary.selectedHours, 6);
assert.equal(formatAvailabilityWeekdays(weekdaySummary.availableDays), "월 · 화 · 수 · 목 · 금");
assert.equal(formatAvailabilityWeekdays(weekdaySummary.unavailableDays), "토 · 일");

const emptySummary = summarizeInstructorAvailabilityDays({});
assert.deepEqual(emptySummary.availableDays, []);
assert.deepEqual(emptySummary.unavailableDays, [1, 2, 3, 4, 5, 6, 7]);
assert.equal(emptySummary.selectedHours, 0);
assert.equal(formatAvailabilityWeekdays(emptySummary.availableDays), "없음");

assert.equal(formatInstructorTeacherName("현재"), "현재T");
assert.equal(formatInstructorTeacherName("현재T"), "현재T");
assert.equal(formatInstructorTeacherName(""), "강사");

assert.equal(
  findIncompleteInstructorAvailabilityDate({
    "2026-08-14": { status: "temporary", slots: [] },
    "2026-08-15": { status: "unavailable", slots: [] }
  }),
  "2026-08-14"
);
assert.equal(
  findIncompleteInstructorAvailabilityDate({
    "2026-08-14": { status: "temporary", slots: ["10:00"] },
    "2026-08-15": { status: "unavailable", slots: [] }
  }),
  null
);

const workspaceSource = readFileSync(
  new URL("../components/schedule/InstructorAvailabilityWorkspace.tsx", import.meta.url),
  "utf8"
);
assert.equal(
  workspaceSource.includes("disabled={loading || saving || invalidDateOverride}"),
  false,
  "저장 버튼은 미완성 한시 일정 때문에 선제적으로 비활성화되면 안 됩니다."
);
assert.ok(
  workspaceSource.includes("if (invalidDateOverrideDate)"),
  "저장 시 미완성 날짜를 선택하고 구체적인 오류를 안내해야 합니다."
);

console.log("Instructor availability profile summary verification passed.");
