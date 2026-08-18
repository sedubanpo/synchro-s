import assert from "node:assert/strict";
import {
  createTimetableRangeClipboard,
  translateTimetableRangeClipboard,
  type TimetableRangeCell,
  type TimetableRangeSourceEvent
} from "../lib/timetableRangeClipboard";
import { createSyncDraftUndoSnapshot, restoreSyncDraftUndoSnapshot } from "../lib/syncDraftUndo";

type TestEvent = TimetableRangeSourceEvent & { id: string };
type TestTemplate = { id: string; durationMinutes: number };

const selectionWithBlankLeadingMonday: TimetableRangeCell[] = [
  { weekday: 1, startTime: "12:00" },
  { weekday: 1, startTime: "13:00" },
  { weekday: 1, startTime: "14:00" },
  { weekday: 2, startTime: "12:00" },
  { weekday: 2, startTime: "13:00" },
  { weekday: 2, startTime: "14:00" }
];

const toTemplate = (event: TestEvent): TestTemplate => ({
  id: event.id,
  durationMinutes:
    Number(event.endTime.slice(0, 2)) * 60 + Number(event.endTime.slice(3, 5)) -
    (Number(event.startTime.slice(0, 2)) * 60 + Number(event.startTime.slice(3, 5)))
});

const threeHourTuesdayEvent: TestEvent = {
  id: "tuesday-three-hour",
  weekday: 2,
  startTime: "12:00",
  endTime: "15:00"
};

const threeHourClipboard = createTimetableRangeClipboard({
  cells: selectionWithBlankLeadingMonday,
  events: [threeHourTuesdayEvent],
  createTemplate: toTemplate
});

assert.ok(threeHourClipboard, "복사 가능한 수업이 있으면 범위 클립보드를 만들어야 합니다.");
assert.deepEqual(
  threeHourClipboard.sourceAnchor,
  { weekday: 2, startTime: "12:00" },
  "빈 월요일 열이 선택되어도 실제 첫 수업인 화요일 12시를 기준점으로 삼아야 합니다."
);
assert.deepEqual(
  threeHourClipboard.items.map(({ columnOffset, rowOffset }) => ({ columnOffset, rowOffset })),
  [{ columnOffset: 0, rowOffset: 0 }],
  "빈 선행 셀 때문에 붙여넣기 좌표가 밀리면 안 됩니다."
);

const translatedThreeHour = translateTimetableRangeClipboard(threeHourClipboard, {
  weekday: 3,
  startTime: "13:00"
});
assert.ok(translatedThreeHour, "수요일 13시에 들어가는 3시간 수업은 유효해야 합니다.");
assert.deepEqual(
  translatedThreeHour.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })),
  [{ weekday: 3, startTime: "13:00", endTime: "16:00" }],
  "화요일 3시간 수업을 수요일 13시에 붙이면 수요일 13-16시가 되어야 합니다."
);

const hourlyTuesdayEvents: TestEvent[] = [
  { id: "tuesday-12", weekday: 2, startTime: "12:00", endTime: "13:00" },
  { id: "tuesday-13", weekday: 2, startTime: "13:00", endTime: "14:00" },
  { id: "tuesday-14", weekday: 2, startTime: "14:00", endTime: "15:00" }
];
const hourlyClipboard = createTimetableRangeClipboard({
  cells: selectionWithBlankLeadingMonday,
  events: hourlyTuesdayEvents,
  createTemplate: toTemplate
});
assert.ok(hourlyClipboard, "세 개의 시간 단위 수업을 함께 복사할 수 있어야 합니다.");
assert.deepEqual(
  hourlyClipboard.items.map(({ columnOffset, rowOffset }) => ({ columnOffset, rowOffset })),
  [
    { columnOffset: 0, rowOffset: 0 },
    { columnOffset: 0, rowOffset: 1 },
    { columnOffset: 0, rowOffset: 2 }
  ],
  "시간 단위 수업의 상대 행 간격을 보존해야 합니다."
);

const translatedHourly = translateTimetableRangeClipboard(hourlyClipboard, {
  weekday: 3,
  startTime: "13:00"
});
assert.ok(translatedHourly, "수요일 13시부터 세 칸은 시간표 범위 안이어야 합니다.");
assert.deepEqual(
  translatedHourly.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })),
  [
    { weekday: 3, startTime: "13:00", endTime: "14:00" },
    { weekday: 3, startTime: "14:00", endTime: "15:00" },
    { weekday: 3, startTime: "15:00", endTime: "16:00" }
  ],
  "세 개의 화요일 시간 단위 수업은 수요일 13/14/15시에 붙어야 합니다."
);

const clipboardWithGap = createTimetableRangeClipboard({
  cells: selectionWithBlankLeadingMonday,
  events: [hourlyTuesdayEvents[0], hourlyTuesdayEvents[2]],
  createTemplate: toTemplate
});
assert.ok(clipboardWithGap, "중간에 빈 시간이 있는 범위도 복사할 수 있어야 합니다.");
assert.deepEqual(
  clipboardWithGap.items.map((item) => item.rowOffset),
  [0, 2],
  "수업 사이의 내부 빈 시간은 압축하지 않고 보존해야 합니다."
);

const outOfBounds = translateTimetableRangeClipboard(threeHourClipboard, {
  weekday: 7,
  startTime: "22:00"
});
assert.equal(outOfBounds, null, "한 항목이라도 운영 시간 밖으로 나가면 부분 결과 없이 실패해야 합니다.");

const beforePaste = {
  syncDraftItems: [{ id: "draft-before" }],
  stagedEventUpdates: { "persisted-1": { startTime: "12:00" } },
  stagedDeletedEventIds: ["persisted-2"]
};
const undoSnapshot = createSyncDraftUndoSnapshot("student-a:week-1", "수업 3개 붙여넣기", beforePaste);
beforePaste.syncDraftItems.push({ id: "draft-after" });
beforePaste.stagedEventUpdates["persisted-1"] = { startTime: "15:00" };
beforePaste.stagedDeletedEventIds.push("persisted-3");

assert.deepEqual(
  restoreSyncDraftUndoSnapshot(undoSnapshot, "student-a:week-1"),
  {
    syncDraftItems: [{ id: "draft-before" }],
    stagedEventUpdates: { "persisted-1": { startTime: "12:00" } },
    stagedDeletedEventIds: ["persisted-2"]
  },
  "한 단계 실행 취소는 신규·수정·삭제 작업본을 한 명령 단위로 복원해야 합니다."
);
assert.equal(
  restoreSyncDraftUndoSnapshot(undoSnapshot, "student-b:week-1"),
  null,
  "학생이나 주차 범위가 바뀐 실행 취소 기록은 적용하면 안 됩니다."
);

const crossDayClipboard = createTimetableRangeClipboard({
  cells: [
    { weekday: 2, startTime: "12:00" },
    { weekday: 3, startTime: "12:00" }
  ],
  events: [
    { id: "tuesday-cross-day", weekday: 2, startTime: "12:00", endTime: "13:00" },
    { id: "wednesday-cross-day", weekday: 3, startTime: "12:00", endTime: "13:00" }
  ] satisfies TestEvent[],
  createTemplate: toTemplate
});
assert.ok(crossDayClipboard, "요일 간격이 있는 범위를 복사할 수 있어야 합니다.");
assert.equal(
  translateTimetableRangeClipboard(crossDayClipboard, { weekday: 7, startTime: "12:00" }),
  null,
  "첫 항목이 유효해도 뒤 항목이 일요일을 넘으면 부분 붙여넣기 없이 전체 실패해야 합니다."
);

console.log("student timetable range clipboard verification passed");
