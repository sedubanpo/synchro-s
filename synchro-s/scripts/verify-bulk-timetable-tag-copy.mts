import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildStudentTimetableBulkCopyPlan,
  shiftSnapshotEventsToWeek,
  type BulkCopyGroup
} from "../lib/timetableGroupBulkCopy";

const group = (input: Partial<BulkCopyGroup> & Pick<BulkCopyGroup, "id" | "targetId" | "tagId">): BulkCopyGroup => ({
  id: input.id,
  targetId: input.targetId,
  tagId: input.tagId,
  weekStart: input.weekStart ?? "2026-08-24",
  name: input.name ?? "시간표",
  classIds: input.classIds ?? [input.id],
  snapshotEvents: input.snapshotEvents ?? [],
  isActive: input.isActive ?? true,
  createdAt: input.createdAt ?? "2026-08-24T00:00:00.000Z",
  updatedAt: input.updatedAt ?? "2026-08-24T00:00:00.000Z"
});

const students = [
  { id: "s1", name: "복사학생" },
  { id: "s2", name: "원본없음" },
  { id: "s3", name: "대상보유" },
  { id: "s4", name: "일회성포함" },
  { id: "s5", name: "비활성원본" }
];
const plan = buildStudentTimetableBulkCopyPlan({
  students,
  sourceTagId: "aug",
  destinationTagId: "sep",
  groups: [
    group({ id: "g1", targetId: "s1", tagId: "aug" }),
    group({ id: "g3-source", targetId: "s3", tagId: "aug" }),
    group({ id: "g3-destination", targetId: "s3", tagId: "sep", isActive: false }),
    group({ id: "g4", targetId: "s4", tagId: "aug", snapshotEvents: [{ scheduleMode: "one_off", classDate: "2026-08-26" }] }),
    group({ id: "g5", targetId: "s5", tagId: "aug", isActive: false })
  ]
});

assert.deepEqual(plan.candidates.map((item) => item.studentId), ["s1"]);
assert.deepEqual(plan.missingSource.map((item) => item.id), ["s2", "s5"]);
assert.deepEqual(plan.destinationExists.map((item) => item.id), ["s3"]);
assert.deepEqual(plan.containsOneOff.map((item) => item.id), ["s4"]);

const shifted = shiftSnapshotEventsToWeek(
  [{ classDate: "2026-08-24", weekday: 1 }, { classDate: "2026-08-30", weekday: 7 }, { note: "날짜 없음" }],
  "2026-08-24",
  "2026-08-31"
) as Array<Record<string, unknown>>;
assert.equal(shifted[0]?.classDate, "2026-08-31");
assert.equal(shifted[1]?.classDate, "2026-09-06");
assert.equal(shifted[2]?.note, "날짜 없음");

const [page, route, dialog] = await Promise.all([
  readFile(new URL("../app/synchro-s/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/schedules/groups/bulk-copy/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../components/schedule/BulkStudentTimetableCopyDialog.tsx", import.meta.url), "utf8")
]);

assert.match(page, /shiftDate\(group\.weekStart, 3\)\.slice\(0, 7\)/, "saved group month must use the representative Thursday");
assert.match(page, /기준 주차/, "saved group card must expose week-start editing");
assert.match(page, /BulkStudentTimetableCopyDialog/, "student widget must expose bulk tag copy");
assert.match(route, /payload\.sourceTagId === payload\.destinationTagId/, "server must reject same-tag copy");
assert.match(route, /previewToken !== token/, "execute must reject stale previews");
assert.match(route, /destinationExists/, "server preview must protect existing destination groups");
assert.match(route, /is_active: true/, "server must use the active student+tag uniqueness guard for the whole insert");
assert.match(route, /\["created", "activated"\]/, "server must preserve created and activated activity history");
assert.match(dialog, /role="dialog"/);
assert.match(dialog, /aria-modal="true"/);
assert.match(dialog, /복사 대상 미리보기/);
assert.match(dialog, /preview\.copyCount === 0/);

console.log("bulk timetable tag copy verification passed");
