import assert from "node:assert/strict";
import {
  normalizeStudentAvailabilityByDay,
  normalizeStudentAvailabilityDateOverrides
} from "../lib/server/studentAvailability";
import { nextStudentAvailabilitySlot } from "../lib/studentAvailabilityPaint";
import { studentAvailabilityComparisonCell } from "../lib/studentAvailabilityComparison";

assert.deepEqual(nextStudentAvailabilitySlot(undefined, "available"), { status: "available" });
assert.equal(nextStudentAvailabilitySlot({ status: "available" }, "available"), null);
assert.equal(nextStudentAvailabilitySlot({ status: "unavailable", note: "타 학원" }, "unavailable"), null);
assert.deepEqual(nextStudentAvailabilitySlot({ status: "available", note: "타 수학학원 전후" }, "unavailable"), {
  status: "unavailable",
  note: "타 수학학원 전후"
});
assert.equal(nextStudentAvailabilitySlot({ status: "available", note: "메모" }, "clear"), null);

const weekly = normalizeStudentAvailabilityByDay({
  1: {
    "10:00": { status: "available", note: "  타 수학학원 전후 가능  " },
    "11:00": { status: "unavailable", reason: "  타 학원  " }
  },
  7: {
    "19:00": { status: "available" }
  }
});

assert.deepEqual(weekly[1]?.["10:00"], { status: "available", note: "타 수학학원 전후 가능" });
assert.deepEqual(weekly[1]?.["11:00"], { status: "unavailable", note: "타 학원" });
assert.deepEqual(weekly[7]?.["19:00"], { status: "available" });

assert.throws(
  () => normalizeStudentAvailabilityByDay({ 1: { "10:30": { status: "available" } } }),
  /정시 슬롯/
);

const comparisonWeekly = {
  1: {
    "10:00": { status: "available" as const },
    "11:00": { status: "unavailable" as const, note: "정규 불가" }
  }
};
const comparisonOverrides = {
  "2026-07-27": { status: "temporary" as const, slots: ["13:00"], note: "방학 특강" },
  "2026-07-28": { status: "unavailable" as const, slots: [], note: "가족 일정" }
};

assert.deepEqual(
  studentAvailabilityComparisonCell(comparisonWeekly, comparisonOverrides, "2026-07-27", "13:00"),
  { status: "available", source: "temporary", note: "방학 특강" }
);
assert.deepEqual(
  studentAvailabilityComparisonCell(comparisonWeekly, comparisonOverrides, "2026-07-27", "10:00"),
  { status: "unset", source: "temporary" }
);
assert.deepEqual(
  studentAvailabilityComparisonCell(comparisonWeekly, comparisonOverrides, "2026-07-28", "10:00"),
  { status: "unavailable", source: "date-unavailable", note: "가족 일정" }
);
assert.deepEqual(
  studentAvailabilityComparisonCell(comparisonWeekly, comparisonOverrides, "2026-08-03", "11:00"),
  { status: "unavailable", source: "weekly", note: "정규 불가" }
);
assert.throws(
  () => normalizeStudentAvailabilityByDay({ 1: { "10:00": { status: "maybe" } } }),
  /수업 가능 또는 수업 불가/
);

const overrides = normalizeStudentAvailabilityDateOverrides(
  {
    "2026-07-22": { status: "temporary", slots: ["13:00", "12:00"], note: "  방학 일정  " },
    "2026-07-25": { status: "unavailable", slots: ["10:00"], note: "  가족여행  " }
  },
  "2026-07-01"
);

assert.deepEqual(overrides["2026-07-22"], {
  status: "temporary",
  slots: ["12:00", "13:00"],
  note: "방학 일정"
});
assert.deepEqual(overrides["2026-07-25"], {
  status: "unavailable",
  slots: [],
  note: "가족여행"
});
assert.throws(
  () => normalizeStudentAvailabilityDateOverrides({ "2026-07-23": { status: "temporary", slots: [] } }, "2026-07-01"),
  /한 개 이상의 가능 시간/
);
assert.throws(
  () => normalizeStudentAvailabilityDateOverrides({ "2026-08-01": { status: "unavailable", slots: [] } }, "2026-07-01"),
  /선택한 달/
);

console.log("student availability normalization: ok");
