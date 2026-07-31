import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mergeScheduleEventsByIdentity } from "../lib/scheduleEventMerge";
import type { ScheduleEvent } from "../types/schedule";

const source = fs.readFileSync(path.join(process.cwd(), "app/synchro-s/page.tsx"), "utf8");
const handlerStart = source.indexOf("const handleImportNotionToServer");
const handlerEnd = source.indexOf("const handleSaveSingleSchedule", handlerStart);

assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "노션 DB 저장 핸들러를 찾을 수 없습니다.");

const handler = source.slice(handlerStart, handlerEnd);

assert.ok(
  handler.includes("const confirmedSavedEvents: ScheduleEvent[] = []"),
  "DB 저장 성공 결과를 즉시 표시할 이벤트로 구성해야 합니다."
);
assert.ok(
  handler.includes("snapshotEvents: confirmedSavedEvents"),
  "새 시간표 그룹은 저장 성공 이벤트를 스냅샷으로 즉시 가져야 합니다."
);
assert.ok(
  handler.includes("setEvents((prev) => mergeScheduleEventsByIdentity(prev, confirmedSavedEvents))"),
  "저장 성공 이벤트를 현재 화면 상태에 즉시 합쳐야 합니다."
);
assert.ok(
  handler.includes("await loadWeek({ silent: true })"),
  "DB 저장 완료 전 주간 시간표 재조회를 기다려야 합니다."
);
assert.ok(
  !handler.includes("void loadWeek({ silent: true })"),
  "저장 후 갱신을 백그라운드 작업으로 남기면 성공 안내와 화면 반영이 어긋날 수 있습니다."
);

const baseEvent: ScheduleEvent = {
  id: "existing-class",
  scheduleMode: "recurring",
  instructorId: "instructor-1",
  instructorName: "기존 강사",
  studentIds: ["student-1"],
  studentNames: ["테스트 학생"],
  subjectCode: "MATH",
  subjectName: "수학",
  classTypeCode: "ONE_TO_ONE",
  classTypeLabel: "1:1",
  badgeText: "[1:1]",
  weekday: 1,
  classDate: "2026-07-27",
  startTime: "14:00",
  endTime: "16:00",
  progressStatus: "planned",
  createdAt: "2026-07-31T00:00:00.000Z"
};
const confirmedEvent: ScheduleEvent = {
  ...baseEvent,
  id: "confirmed-class",
  instructorName: "저장 확인 강사",
  weekday: 3,
  classDate: "2026-07-29"
};
const merged = mergeScheduleEventsByIdentity([baseEvent], [confirmedEvent]);
assert.deepEqual(
  merged.map((event) => event.id),
  ["existing-class", "confirmed-class"],
  "재조회 결과가 저장 직후 행을 아직 포함하지 않아도 서버 저장 성공 행은 화면 상태에 유지해야 합니다."
);
assert.equal(
  mergeScheduleEventsByIdentity([baseEvent], [{ ...baseEvent, instructorName: "최신 강사" }])[0]?.instructorName,
  "최신 강사",
  "동일 수업·날짜는 저장 성공 데이터가 최신 값으로 교체해야 합니다."
);

console.log("notion timetable immediate refresh verification passed");
