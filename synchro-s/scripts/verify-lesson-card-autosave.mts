import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildLessonCardTemplates, createLessonCardTemplateFromEvent, filterLessonCardTemplates } from "../lib/lessonCardTemplates";
import type { ScheduleEvent } from "../types/schedule";

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
    { code: "REGULAR", label: "개별정규", badgeText: "[개별]", maxStudents: 8 },
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
assert.match(paletteSource, /기존 수업을 한 번 눌러 선택하고/, "기존 수업 셀 복사 안내가 있어야 합니다.");
assert.match(pageSource, /lessonPasteQueueRef\.current = lessonPasteQueueRef\.current\.then\(run, run\)/, "연속 붙여넣기는 직렬 저장되어야 합니다.");
assert.match(pageSource, /scheduleTagId: selectedScheduleTagId/, "붙여넣기 저장은 현재 태그를 포함해야 합니다.");
assert.match(pageSource, /saveTimetableGroupSnapshot\(groupId, nextClassIds, nextSnapshot\)/, "수업 저장과 그룹 스냅샷 저장이 함께 이뤄져야 합니다.");
assert.match(pageSource, /result\.status === "created" \|\| result\.status === "enrolled"/, "그룹 저장 실패 시 신규 등록을 보상 삭제해야 합니다.");
assert.match(pageSource, /수업 등록 자동 복구도 완료하지 못했습니다/, "보상 삭제 실패를 거짓 성공으로 숨기지 않아야 합니다.");
assert.match(pageSource, /lessonPasteScopeRef\.current !== queuedScope/, "학생·태그·입력 탭이 바뀐 뒤 대기 중인 붙여넣기는 취소해야 합니다.");
assert.match(pageSource, /lessonPasteScopeRef\.current === scopeKey/, "이전 범위의 저장 결과를 현재 시간표 화면에 섞지 않아야 합니다.");
assert.match(gridSource, /\(event\.metaKey \|\| event\.ctrlKey\).*event\.key\.toLowerCase\(\) === "v"/, "격자에 포커스가 있을 때만 붙여넣기 단축키를 처리해야 합니다.");
assert.match(gridSource, /\(keyboardEvent\.metaKey \|\| keyboardEvent\.ctrlKey\).*keyboardEvent\.key\.toLowerCase\(\) === "c"/, "기존 수업에 포커스가 있을 때 복사 단축키를 처리해야 합니다.");
assert.match(gridSource, /onCopy=\{\(clipboardEvent\)/, "운영체제의 네이티브 복사 이벤트도 처리해야 합니다.");
assert.match(gridSource, /onPaste=\{\(event\)/, "운영체제의 네이티브 붙여넣기 이벤트도 처리해야 합니다.");
assert.match(gridSource, /tabIndex=\{canCopyEvent \? 0 : undefined\}/, "기존 수업은 키보드로 선택 가능해야 합니다.");
assert.match(gridSource, /onDoubleClick=\{\(clickEvent\)/, "기존 수업 편집은 스프레드시트처럼 더블클릭으로 유지해야 합니다.");
assert.match(gridSource, /tabIndex=\{isEmpty && viewMode === "detailed" \? 0 : undefined\}/, "빈 격자는 키보드로 접근 가능해야 합니다.");
assert.match(pageSource, /!selectedStudentId[\s\S]*!selectedScheduleTagId/, "학생과 태그가 없으면 카드 입력을 차단해야 합니다.");

console.log("lesson card autosave verification passed");
