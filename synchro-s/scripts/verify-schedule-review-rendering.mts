import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getOverlappingHourSlots } from "../lib/timetableSlots";

const hourlySlots = ["08:00", "09:00", "10:00", "11:00"];

assert.deepEqual(
  getOverlappingHourSlots({ startTime: "08:00", endTime: "10:00" }, hourlySlots),
  ["08:00", "09:00"],
  "a two-hour class must occupy both visible timetable rows"
);

assert.deepEqual(
  getOverlappingHourSlots({ startTime: "09:00", endTime: "10:00" }, hourlySlots),
  ["09:00"],
  "a one-hour class must occupy exactly one timetable row"
);

assert.deepEqual(
  getOverlappingHourSlots({ startTime: "09:30", endTime: "11:30" }, hourlySlots),
  ["09:00", "10:00", "11:00"],
  "partial-hour classes must appear in every row they overlap"
);

const reviewPage = readFileSync(new URL("../app/synchro-s/page.tsx", import.meta.url), "utf8");
assert.match(
  reviewPage,
  /event\.weekday === day\.key\s*&&\s*getOverlappingHourSlots\(event, \[slot\]\)\.length > 0/,
  "schedule review grid must use the same overlap helper as the student timetable"
);
assert.doesNotMatch(
  reviewPage,
  /event\.weekday === day\.key && event\.startTime === slot/,
  "schedule review must not hide the continuation rows of multi-hour classes"
);
assert.doesNotMatch(
  reviewPage,
  /getReviewEventDedupeKey|seenKeys\.has\(eventKey\)/,
  "schedule review must preserve the same saved occurrences shown by the student timetable"
);
assert.match(
  reviewPage,
  /if \(!activeGroup && !hasCanonicalStudent\)/,
  "saved student-group snapshots must not lose classes with incomplete embedded student links"
);
assert.match(
  reviewPage,
  /targetsCanonicalStudent && !existingTargetsCanonicalStudent/,
  "when duplicate roster aliases share a review card, the canonical student's own group must win"
);
assert.match(
  reviewPage,
  /normalizedGroupName\.includes\(normalizedStudentName\)/,
  "legacy student-group target IDs must fall back to the saved group's student name"
);
assert.match(
  reviewPage,
  /groupEventCount > existingGroupEventCount/,
  "duplicate roster aliases must keep the complete saved timetable group"
);
assert.match(
  reviewPage,
  /\(group\.snapshotEvents\?\.length \?\? 0\) > 0[\s\S]*?: group\.classIds\.length/,
  "groups without a snapshot must use their linked class count instead of being treated as empty"
);
assert.match(
  reviewPage,
  /for \(const group of timetableGroups\)/,
  "review grouping must inspect every active saved group instead of losing legacy target IDs in a pre-keyed map"
);
assert.match(
  reviewPage,
  /candidateStudentIds\.map\(async \(studentId\)/,
  "duplicate roster IDs must each be checked with the same student-scoped weekly API as the student timetable"
);
assert.match(
  reviewPage,
  /filter\(\(student\) => normalizePersonName\(student\.name\) === selectedName\)/,
  "legacy duplicate IDs must be compared by student name even when school metadata differs"
);
assert.match(
  reviewPage,
  /selectedReviewGroup = reviewActiveGroupByStudentId\.get\(selectedReviewStudentId\)[\s\S]*?savedGroupTargetId = selectedReviewGroup\.targetId/,
  "the saved timetable group's legacy target ID must be queried with the student-scoped weekly API"
);
assert.match(
  reviewPage,
  /fetch\(`\/api\/schedules\/groups\?\$\{groupQuery\.toString\(\)\}`/,
  "review must load the selected student's saved groups instead of relying on the all-student group aggregate"
);
assert.match(
  reviewPage,
  /const selectedGroup = selectEffectiveStudentTimetableGroup\([\s\S]*?const snapshotEvents = selectedGroup\?\.snapshotEvents \?\? \[\]/,
  "review must select and render the same effective saved-group snapshot as the student timetable"
);
assert.match(
  reviewPage,
  /targetedReviewEventsByStudentId\[student\.id\]/,
  "student-scoped review events must override the lossy all-students aggregate"
);
assert.match(
  reviewPage,
  /sort\(\(a, b\) => b\.events\.length - a\.events\.length\)\[0\]/,
  "duplicate roster IDs must keep the complete student timetable response"
);
assert.match(
  reviewPage,
  /reviewStudents\.filter\(\(student\) => reviewActiveGroupByStudentId\.has\(student\.id\)\)/,
  "review roster must contain only students with an effective group in the selected tag"
);
assert.match(
  reviewPage,
  /selectedGroup\s*\?\s*weekData\.events\.filter[\s\S]*?: \[\]/,
  "a missing selected-tag group must never fall back to another tag's weekly events"
);
assert.match(
  reviewPage,
  /tagId: selectedScheduleTagId \?\? ""/,
  "student-scoped group requests must be filtered by the selected review tag"
);

console.log("schedule review multi-hour rendering verification passed");
