import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { groupInstructorCellEntries } from "../components/schedule/TimetableGrid";
import type { ScheduleEvent } from "../types/schedule";

function lesson(input: Partial<ScheduleEvent> & Pick<ScheduleEvent, "id" | "studentIds" | "studentNames" | "startTime" | "endTime">): ScheduleEvent {
  return {
    scheduleMode: "recurring",
    instructorId: "teacher-1",
    instructorName: "김이천",
    subjectCode: "SCIENCE",
    subjectName: "과학",
    classTypeCode: "REGULAR",
    classTypeLabel: "개별정규",
    badgeText: "[개별정규]",
    weekday: 6,
    classDate: "",
    progressStatus: "confirmed",
    createdAt: "2026-08-22T00:00:00.000Z",
    ...input
  };
}

const grouped = groupInstructorCellEntries(
  [
    lesson({ id: "regular-a", studentIds: ["student-a"], studentNames: ["이선호"], startTime: "13:00", endTime: "15:00" }),
    lesson({ id: "regular-b", studentIds: ["student-b"], studentNames: ["이화현"], startTime: "13:00", endTime: "16:00", subjectName: "물리" })
  ],
  "13:00"
);

assert.equal(grouped.length, 1, "같은 시간 칸의 개별정규는 원본 수업 길이나 과목과 무관하게 한 카드로 묶여야 합니다.");
assert.deepEqual(grouped[0]?.studentNames, ["이선호", "이화현"]);

const legacyRegular = groupInstructorCellEntries(
  [
    lesson({
      id: "legacy-regular",
      studentIds: ["student-c"],
      studentNames: ["오지석"],
      startTime: "13:00",
      endTime: "14:00",
      classTypeCode: "CUSTOM_31_REGULAR"
    }),
    lesson({ id: "regular-c", studentIds: ["student-d"], studentNames: ["박성준"], startTime: "13:00", endTime: "15:00" })
  ],
  "13:00"
);

assert.equal(legacyRegular.length, 1, "레거시 코드 안의 숫자 31을 3:1 수업으로 오인하면 안 됩니다.");

const mixed = groupInstructorCellEntries(
  [
    lesson({ id: "regular", studentIds: ["student-a"], studentNames: ["이선호"], startTime: "13:00", endTime: "14:00" }),
    lesson({
      id: "ratio",
      studentIds: ["student-b"],
      studentNames: ["박시율"],
      startTime: "13:00",
      endTime: "14:00",
      classTypeCode: "ONE_TO_ONE",
      classTypeLabel: "1:1",
      badgeText: "[1:1]"
    })
  ],
  "13:00"
);

assert.equal(mixed.length, 2, "1:1과 개별정규는 서로 다른 카드로 유지되어야 합니다.");

const blockSource = fs.readFileSync(path.join(process.cwd(), "components/schedule/ScheduleBlock.tsx"), "utf8");
assert.match(blockSource, /\{isSelected && secondary \? \(/, "학교·학년은 선택된 학생에게만 노출되어야 합니다.");
assert.match(blockSource, /\{studentBadges\.length\}명/, "강사 수업 카드는 학생 수를 빠르게 확인할 수 있어야 합니다.");
assert.match(blockSource, /data-instructor-highlight-match/, "선택 학생이 포함된 카드를 명시적으로 강조해야 합니다.");

const gridSource = fs.readFileSync(path.join(process.cwd(), "components/schedule/TimetableGrid.tsx"), "utf8");
assert.match(gridSource, /\{highlightedStudentName\} 학생 강조 중/, "강조 중인 학생과 해제 동작을 격자 상단에서 확인할 수 있어야 합니다.");

console.log("instructor timetable UI verification passed");
