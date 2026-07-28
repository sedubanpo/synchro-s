import assert from "node:assert/strict";
import {
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

console.log("Instructor availability profile summary verification passed.");
