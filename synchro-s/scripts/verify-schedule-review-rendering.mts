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
  /targetedReviewEventsByStudentId\[student\.id\]/,
  "student-scoped review events must override the lossy all-students aggregate"
);
assert.match(
  reviewPage,
  /sort\(\(a, b\) => b\.events\.length - a\.events\.length\)\[0\]/,
  "duplicate roster IDs must keep the complete student timetable response"
);

console.log("schedule review multi-hour rendering verification passed");
