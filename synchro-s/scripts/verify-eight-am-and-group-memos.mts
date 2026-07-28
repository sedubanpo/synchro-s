import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TIME_SLOTS } from "../lib/constants";
import { getOverlappingHourSlots } from "../lib/timetableSlots";

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "app/synchro-s/page.tsx"), "utf8");

assert.equal(TIME_SLOTS[0], "08:00", "공통 시간표는 08:00 행부터 시작해야 합니다.");
assert.equal(TIME_SLOTS.at(-1), "23:00", "자정 직전 마지막 수업 행은 그대로 유지되어야 합니다.");
assert.equal(TIME_SLOTS.length, 16, "08:00부터 23:00까지 모든 한 시간 행을 제공해야 합니다.");

assert.deepEqual(
  getOverlappingHourSlots({ startTime: "08:00", endTime: "10:00" }, TIME_SLOTS),
  ["08:00", "09:00"],
  "08:00-10:00 수업은 8-9시와 9-10시 두 행에 표시되어야 합니다."
);
assert.deepEqual(
  getOverlappingHourSlots({ startTime: "08:30", endTime: "09:30" }, TIME_SLOTS),
  ["08:00", "09:00"],
  "30분 단위 오전 수업도 겹치는 모든 행에 표시되어야 합니다."
);

assert.ok(
  page.includes("const totalMinutes = 8 * 60 + index * 30"),
  "수업 시간 수정 선택지는 08:00부터 30분 단위로 제공되어야 합니다."
);
assert.ok(
  page.includes("if (!note.groupId || !note.content.trim()) continue;"),
  "빈 문자열이나 공백뿐인 메모는 저장 그룹 메모 목록에서 제외되어야 합니다."
);
assert.ok(
  page.includes("{groupNotes.length > 0 ? ("),
  "저장 그룹 메모 영역은 실제 메모가 있는 경우에만 표시되어야 합니다."
);
assert.ok(
  !page.includes("{groupNotes.length === 0 ? ("),
  "빈 저장 그룹 카드에 메모 없음 분기를 렌더링하지 않아야 합니다."
);
assert.ok(
  !page.includes('title={groupNotes.length > 0 ? "시간표 메모 보기" : "등록된 시간표 메모 없음"}'),
  "저장 그룹 카드의 메모 컨트롤은 빈 상태 제목을 만들지 않아야 합니다."
);

console.log("08:00 timetable and conditional group memo verification passed");
