import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildLessonCardTemplates, createLessonCardTemplateFromEvent, filterLessonCardTemplates } from "../lib/lessonCardTemplates";
import type { ScheduleEvent } from "../types/schedule";
import { getClassTypeCapacityConflictReason } from "../lib/classTypeCapacity";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const usedMathEvent = {
  id: "class-1",
  scheduleMode: "recurring",
  instructorId: "math-teacher",
  instructorName: "안준성",
  studentIds: ["student-1"],
  studentNames: ["테스트학생"],
  subjectCode: "MATH",
  subjectName: "수학",
  classTypeCode: "REGULAR",
  classTypeLabel: "개별정규",
  badgeText: "[개별]",
  weekday: 1,
  classDate: "2026-08-10",
  startTime: "10:00",
  endTime: "11:00",
  progressStatus: "planned",
  createdAt: "2026-08-10T00:00:00.000Z"
} satisfies ScheduleEvent;

const templates = buildLessonCardTemplates({
  instructors: [
    { id: "math-teacher", name: "안준성", secondary: "반포관 원장", isActive: true },
    { id: "english-teacher", name: "이영재", secondary: "영어", isActive: true },
    { id: "inactive-teacher", name: "중지강사", secondary: "수학", isActive: false }
  ],
  subjects: [
    { code: "MATH", label: "수학" },
    { code: "ENG", label: "영어" }
  ],
  classTypes: [
    { code: "REGULAR", label: "개별정규", badgeText: "[개별]", maxStudents: 8, memo: "동일 진도 학생" },
    { code: "SELF_STUDY", label: "자기주도학습", badgeText: "[자습]", maxStudents: 1 }
  ],
  events: [usedMathEvent]
});

assert.equal(templates.length, 2, "활성 강사의 담당 과목 카드만 생성해야 합니다.");
assert.equal(templates[0]?.instructorName, "안준성", "최근 사용된 카드가 먼저 보여야 합니다.");
assert.equal(templates[0]?.durationMinutes, 60, "카드 붙여넣기 기본 단위는 1시간이어야 합니다.");
assert.equal(filterLessonCardTemplates(templates, "이영재")[0]?.subjectName, "영어", "강사명 검색이 동작해야 합니다.");
assert.equal(filterLessonCardTemplates(templates, "수학")[0]?.instructorName, "안준성", "과목명 검색이 동작해야 합니다.");
assert.equal(filterLessonCardTemplates(templates, "개별").length, 2, "수업 유형 검색이 동작해야 합니다.");
assert.equal(templates[0]?.maxStudents, 8, "빠른 카드에 설정된 정원이 전달되어야 합니다.");
assert.equal(templates[0]?.classTypeMemo, "동일 진도 학생", "빠른 카드에 설정 메모가 전달되어야 합니다.");
assert.equal(getClassTypeCapacityConflictReason({ label: "3:1", maxStudents: 3 }, 2, 1), null, "3:1은 세 번째 학생까지 허용해야 합니다.");
assert.match(getClassTypeCapacityConflictReason({ label: "3:1", maxStudents: 3 }, 3, 1) ?? "", /정원 3명/, "3:1의 네 번째 학생은 정원 충돌이어야 합니다.");

const copiedFromTimetable = createLessonCardTemplateFromEvent({
  ...usedMathEvent,
  id: "class-3-hours",
  startTime: "10:00",
  endTime: "13:00"
});
assert.equal(copiedFromTimetable?.source, "timetable", "기존 시간표 수업은 시간표 복사 원본으로 구분해야 합니다.");
assert.equal(copiedFromTimetable?.durationMinutes, 180, "기존 수업의 실제 길이를 그대로 복사해야 합니다.");
assert.equal(copiedFromTimetable?.instructorId, usedMathEvent.instructorId, "기존 수업의 강사를 보존해야 합니다.");
assert.equal(copiedFromTimetable?.classTypeCode, usedMathEvent.classTypeCode, "기존 수업의 유형을 보존해야 합니다.");

const [pageSource, gridSource, paletteSource] = await Promise.all([
  readFile(path.join(projectRoot, "app/synchro-s/page.tsx"), "utf8"),
  readFile(path.join(projectRoot, "components/schedule/TimetableGrid.tsx"), "utf8"),
  readFile(path.join(projectRoot, "components/schedule/LessonCardPalette.tsx"), "utf8")
]);

assert.match(paletteSource, /강사명 또는 과목명 검색/, "카드 검색창 안내가 있어야 합니다.");
assert.match(paletteSource, /SubjectMotif/, "과목별 반투명 배경 모티프가 있어야 합니다.");
assert.match(paletteSource, /ClassTypeSignal/, "수업 유형별 비색상 시각 신호가 있어야 합니다.");
assert.match(paletteSource, /xl:h-\[clamp\(28rem,55vh,38rem\)\]/, "데스크톱 빠른 카드 목록은 충분한 화면 높이를 사용해야 합니다.");
assert.doesNotMatch(paletteSource, /max-h-72/, "빠른 카드 목록이 짧은 고정 높이로 되돌아가면 안 됩니다.");
assert.match(paletteSource, /기존 수업을 한 번 눌러 선택하고/, "기존 수업 셀 복사 안내가 있어야 합니다.");
assert.match(pageSource, /setSyncDraftItems\(\(prev\) => \[/, "카드 붙여넣기는 먼저 로컬 작업본에 추가되어야 합니다.");
assert.match(pageSource, /recordHistory: false/, "수업 추가 단계에서 저장 기록을 중복 생성하지 않아야 합니다.");
assert.match(pageSource, /method: "POST"[\s\S]*\/api\/save-history/, "저장하기 한 번에 최근 저장 기록을 한 건만 남겨야 합니다.");
assert.match(pageSource, /window\.addEventListener\("beforeunload"/, "저장하지 않은 변경이 있으면 창 닫기 경고를 등록해야 합니다.");
assert.match(pageSource, /stagedEventUpdates/, "기존 수업 수정은 저장 전 작업본에 유지되어야 합니다.");
assert.match(pageSource, /stagedDeletedEventIds/, "기존 수업 삭제는 저장 전 작업본에 유지되어야 합니다.");
assert.match(pageSource, /저장하기 · \$\{pendingTimetableChangeCount\}건/, "캡처 버튼 옆 저장하기가 변경 건수를 표시해야 합니다.");
assert.match(pageSource, /visibleSaveHistoryGroups\.map/, "동일 대상의 최근 저장 기록은 묶음 카드로 페이지별 표시해야 합니다.");
assert.match(gridSource, /\(event\.metaKey \|\| event\.ctrlKey\).*event\.key\.toLowerCase\(\) === "v"/, "격자에 포커스가 있을 때만 붙여넣기 단축키를 처리해야 합니다.");
assert.match(gridSource, /\(keyboardEvent\.metaKey \|\| keyboardEvent\.ctrlKey\).*keyboardEvent\.key\.toLowerCase\(\) === "c"/, "기존 수업에 포커스가 있을 때 복사 단축키를 처리해야 합니다.");
assert.match(gridSource, /onCopy=\{\(clipboardEvent\)/, "운영체제의 네이티브 복사 이벤트도 처리해야 합니다.");
assert.match(gridSource, /onPaste=\{\(event\)/, "운영체제의 네이티브 붙여넣기 이벤트도 처리해야 합니다.");
assert.match(gridSource, /tabIndex=\{canCopyEvent \? 0 : undefined\}/, "기존 수업은 키보드로 선택 가능해야 합니다.");
assert.match(gridSource, /onDoubleClick=\{\(clickEvent\)/, "기존 수업 편집은 스프레드시트처럼 더블클릭으로 유지해야 합니다.");
assert.match(gridSource, /tabIndex=\{isEmpty && viewMode === "detailed" \? 0 : undefined\}/, "빈 격자는 키보드로 접근 가능해야 합니다.");
assert.match(pageSource, /!selectedStudentId[\s\S]*!selectedScheduleTagId/, "학생과 태그가 없으면 카드 입력을 차단해야 합니다.");
assert.match(gridSource, /setRangeAnchorKey/, "시간표 셀 범위 선택의 시작점을 보존해야 합니다.");
assert.match(gridSource, /setRangeFocusKey/, "포인터 드래그로 시간표 선택 범위를 확장해야 합니다.");
assert.match(gridSource, /rowCount === 1 && columnCount === 1 && eventCount === 0[\s\S]*return null/, "빈 단일 셀 선택 요약은 숨겨야 합니다.");
assert.match(gridSource, /선택 \{rowCount\}행 × \{columnCount\}열 · 수업 \{eventCount\}개/, "의미 있는 선택 요약은 시간표 상태 영역에 표시해야 합니다.");
assert.doesNotMatch(gridSource, /top-\[49px\][\s\S]*rangeSelection\.rowCount/, "선택 요약이 시간표 셀 위에 떠 있으면 안 됩니다.");
assert.match(gridSource, /role="menu"[\s\S]*시간표 선택 메뉴/, "우클릭 시 접근 가능한 시간표 선택 메뉴를 제공해야 합니다.");
assert.match(gridSource, /오려두기[\s\S]*붙여넣기[\s\S]*선택 수업 삭제/, "컨텍스트 메뉴에 복사·오려두기·붙여넣기·삭제가 있어야 합니다.");
assert.match(gridSource, /key === "x"[\s\S]*key === "v"/, "범위 오려두기와 붙여넣기 단축키를 처리해야 합니다.");
assert.match(pageSource, /type LessonRangeClipboard/, "시간표 범위의 상대 좌표를 보존하는 클립보드 모델이 있어야 합니다.");
assert.match(pageSource, /columnOffset[\s\S]*rowOffset/, "범위 붙여넣기는 요일과 시간 간격을 보존해야 합니다.");
assert.match(pageSource, /targetOccupied[\s\S]*빈 범위를 선택해 주세요/, "범위 붙여넣기는 기존 수업을 조용히 덮어쓰지 않아야 합니다.");
assert.match(pageSource, /cutPersistedIds[\s\S]*setStagedDeletedEventIds/, "오려두기는 붙여넣기 성공 후 원본 삭제를 작업본에 기록해야 합니다.");

console.log("staged timetable editing verification passed");
