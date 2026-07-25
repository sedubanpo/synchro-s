import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getOverlappingHourSlots } from "../lib/timetableSlots";

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "app/synchro-s/page.tsx"), "utf8");
const grid = fs.readFileSync(path.join(root, "components/schedule/TimetableGrid.tsx"), "utf8");
const moveRoute = fs.readFileSync(path.join(root, "app/api/schedules/[id]/move/route.ts"), "utf8");
const service = fs.readFileSync(path.join(root, "lib/server/scheduleService.ts"), "utf8");

const slots = Array.from({ length: 15 }, (_, index) => `${String(index + 9).padStart(2, "0")}:00`);

assert.deepEqual(
  getOverlappingHourSlots({ startTime: "15:00", endTime: "18:00" }, slots),
  ["15:00", "16:00", "17:00"],
  "15:00-18:00 수업은 세 개 시간 셀에 표시되어야 합니다."
);
assert.deepEqual(
  getOverlappingHourSlots({ startTime: "15:30", endTime: "18:00" }, slots),
  ["15:00", "16:00", "17:00"],
  "30분 시작 수업도 겹치는 모든 시간 셀에 표시되어야 합니다."
);
assert.deepEqual(
  getOverlappingHourSlots({ startTime: "18:00", endTime: "18:00" }, slots),
  [],
  "잘못된 0분 구간은 표시 셀을 만들지 않아야 합니다."
);

assert.ok(grid.includes("for (const displaySlot of displaySlots)"), "학생·강사 표가 모든 겹침 셀에 이벤트를 배치해야 합니다.");
assert.ok(page.includes('SOCIAL2: ["사문", "사회문화"]'), "사회문화는 사문 코드로 정확히 매칭되어야 합니다.");
assert.ok(page.includes(">수업 정보 수정</p>"), "수업 편집창은 과목 편집 목적을 밝혀야 합니다.");
assert.ok(page.includes("subjectCode: selectedSubject?.code"), "선택한 과목 코드가 저장 요청에 포함되어야 합니다.");
assert.ok(moveRoute.includes("subjectCode?: string"), "수정 API가 과목 코드를 받아야 합니다.");
assert.ok(service.includes("subject_code: subjectCode"), "수정 서비스가 기존 수업 또는 분리된 수업의 과목 코드를 갱신해야 합니다.");

console.log("multi-hour timetable and subject editing verification passed");
