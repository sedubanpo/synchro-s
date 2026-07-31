import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatTimeSlotRange, getVisibleTimeSlots } from "../lib/timetableSlots";

const timeSlots = ["08:00", "09:00", "10:00", "11:00"];
const hiddenTimeSlots = ["09:00", "11:00"];

assert.deepEqual(
  getVisibleTimeSlots(timeSlots, hiddenTimeSlots),
  ["08:00", "10:00"],
  "선택한 시간대만 시간표에서 제외되어야 합니다."
);
assert.deepEqual(timeSlots, ["08:00", "09:00", "10:00", "11:00"], "원본 시간대 배열은 변경되면 안 됩니다.");
assert.deepEqual(getVisibleTimeSlots(timeSlots, []), timeSlots, "전체 표시 시 모든 시간대가 복원되어야 합니다.");
assert.deepEqual(getVisibleTimeSlots(timeSlots, timeSlots), [], "모든 시간대를 선택하면 표시 행이 없어야 합니다.");
assert.equal(formatTimeSlotRange("08:00"), "8-9시");
assert.equal(formatTimeSlotRange("08:30"), "8:30-9:30");

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "app/synchro-s/page.tsx"), "utf8");
const grid = fs.readFileSync(path.join(root, "components/schedule/TimetableGrid.tsx"), "utf8");
const creation = fs.readFileSync(path.join(root, "components/schedule/ScheduleCreationWorkspace.tsx"), "utf8");
const control = fs.readFileSync(path.join(root, "components/schedule/TimeSlotVisibilityControl.tsx"), "utf8");

assert.ok(page.includes("synchro-s-hidden-time-slots-v1"), "시간대 숨김 선택은 브라우저에 저장되어야 합니다.");
assert.ok(page.includes("<TimeSlotVisibilityControl"), "강사·학생 시간표 우측 패널에 숨김 컨트롤이 있어야 합니다.");
assert.ok(page.includes("hiddenTimeSlots={hiddenTimeSlots}"), "강사·학생 시간표에 숨김 상태가 전달되어야 합니다.");
assert.ok(creation.includes("<TimeSlotVisibilityControl"), "시간표 생성 우측 패널에 숨김 컨트롤이 있어야 합니다.");
assert.ok(creation.includes("onHiddenTimeSlotsChange"), "시간표 생성은 공통 숨김 상태를 변경해야 합니다.");
assert.ok(grid.includes("getVisibleTimeSlots(timeSlots, hiddenTimeSlots)"), "시간표 행 렌더링 전에 수동 숨김을 적용해야 합니다.");
assert.ok(control.includes("표와 캡처에서만 숨겨지며 저장 데이터는 유지됩니다."), "컨트롤은 데이터 보존 범위를 설명해야 합니다.");
assert.ok(control.includes("aria-pressed={isHidden}"), "시간대 버튼은 선택 상태를 보조기기에 전달해야 합니다.");
assert.ok(control.includes("전체 표시"), "숨긴 시간대를 한 번에 복원할 수 있어야 합니다.");

console.log("hidden timetable time slots verification passed");
