import assert from "node:assert/strict";
import {
  getEffectiveStudentTimetableGroupMap,
  isTimetableGroupExpired,
  selectEffectiveStudentTimetableGroup,
  type EffectiveStudentTimetableGroup
} from "../lib/timetableGroupSelection";

const base = {
  roleView: "student" as const,
  targetId: "student-hajimin",
  weekStart: "2026-07-20",
  tagId: "summer-a"
};

const timetableA: EffectiveStudentTimetableGroup = {
  ...base,
  id: "a",
  expiresOn: "2026-07-24",
  isActive: true,
  createdAt: "2026-07-20T09:00:00.000Z"
};
const timetableB: EffectiveStudentTimetableGroup = {
  ...base,
  id: "b",
  expiresOn: null,
  isActive: false,
  createdAt: "2026-07-20T10:00:00.000Z"
};

assert.equal(
  isTimetableGroupExpired(timetableA, "2026-07-20", "2026-07-24"),
  false,
  "만료일 당일에는 A 시간표가 적용되어야 합니다."
);
assert.equal(
  selectEffectiveStudentTimetableGroup(
    [timetableA, timetableB],
    "2026-07-20",
    "summer-a",
    "2026-07-24"
  )?.id,
  "a",
  "7월 24일까지는 저장상 활성인 A가 우선이어야 합니다."
);
assert.equal(
  selectEffectiveStudentTimetableGroup(
    [timetableA, timetableB],
    "2026-07-20",
    "summer-a",
    "2026-07-25"
  )?.id,
  "b",
  "A가 만료된 다음 날에는 비활성 대기 시간표 B가 자동 승계되어야 합니다."
);

const manuallyDisabledA = { ...timetableA, isActive: false, expiresOn: null };
assert.equal(
  selectEffectiveStudentTimetableGroup(
    [manuallyDisabledA, timetableB],
    "2026-07-20",
    "summer-a",
    "2026-07-25"
  ),
  null,
  "만료된 활성 선행 그룹이 없는 수동 전체 비활성 상태는 유지되어야 합니다."
);

const futureActive = {
  ...timetableB,
  id: "c",
  weekStart: "2026-07-27",
  isActive: true,
  createdAt: "2026-07-21T10:00:00.000Z"
};
assert.equal(
  selectEffectiveStudentTimetableGroup(
    [timetableA, timetableB, futureActive],
    "2026-07-27",
    "summer-a",
    "2026-07-27"
  )?.id,
  "c",
  "유효한 저장상 활성 시간표가 있으면 자동 승계 후보보다 우선해야 합니다."
);

const map = getEffectiveStudentTimetableGroupMap(
  [timetableA, timetableB],
  "2026-07-20",
  "summer-a",
  "2026-07-25"
);
assert.equal(map.get("student-hajimin")?.id, "b");

console.log("학생 시간표 만료·자동 승계 검증 통과: A(7/24까지) → B(7/25부터)");
