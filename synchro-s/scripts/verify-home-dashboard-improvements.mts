import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  findInteriorScheduleGapEvents,
  mergeHomeInstructorEvents,
  mergeScheduleStudentRosters
} from "../lib/homeDashboardGrouping";
import { mergeScheduleReviewEvents } from "../lib/scheduleReviewSnapshot";
import {
  createDefaultHomeClassroomAssignments,
  getHomeClassroomOccupancy,
  HOME_CLASSROOM_OPTIONS
} from "../lib/homeFullTimetable";
import type { ScheduleEvent } from "../types/schedule";

function event(overrides: Partial<ScheduleEvent>): ScheduleEvent {
  return {
    id: "event",
    scheduleMode: "recurring",
    instructorId: "teacher-yoo",
    instructorName: "유소연",
    studentIds: ["student-1"],
    studentNames: ["류우석"],
    subjectCode: "BIOLOGY",
    subjectName: "생명",
    classTypeCode: "REGULAR_MULTI",
    classTypeLabel: "개별정규",
    badgeText: "[개별정규]",
    weekday: 6,
    classDate: "2026-07-25",
    startTime: "17:00",
    endTime: "18:00",
    progressStatus: "planned",
    createdAt: "2026-07-25T00:00:00.000Z",
    ...overrides
  };
}

const merged = mergeHomeInstructorEvents([
  event({ id: "biology-group", studentIds: ["student-1", "student-2"], studentNames: ["류우석", "김도현"] }),
  event({
    id: "life-science-group",
    subjectCode: "LIFE_SCIENCE",
    subjectName: "생명과학",
    studentIds: ["student-3"],
    studentNames: ["김나린"]
  })
]);
assert.equal(merged.length, 1, "같은 강사·시간의 개별정규 수업은 과목 표기 차이와 관계없이 한 그룹이어야 합니다.");
assert.deepEqual(merged[0]?.studentNames, ["류우석", "김도현", "김나린"]);

const legacyIdMerged = mergeHomeInstructorEvents([
  event({ id: "legacy", instructorId: "legacy-teacher-yoo", studentIds: ["student-1"], studentNames: ["류우석"] }),
  event({ id: "firebase", instructorId: "firebase-teacher-yoo", instructorName: "유소연T", classDate: "2026-08-01", studentIds: ["student-2"], studentNames: ["김도현"] })
]);
assert.equal(legacyIdMerged.length, 1, "이미 한 강사로 확인된 연결 전·후 ID, 별칭, 반복 시작일이 달라도 홈 정규 수업은 한 카드여야 합니다.");
assert.deepEqual(legacyIdMerged[0]?.studentNames, ["류우석", "김도현"]);

const reusedLegacyStudentId = mergeHomeInstructorEvents([
  event({
    id: "legacy-shared-id-a",
    studentIds: ["legacy-shared", "legacy-shared"],
    studentNames: ["백송연", "장지우"]
  }),
  event({
    id: "legacy-shared-id-b",
    studentIds: ["legacy-shared", "student-song"],
    studentNames: ["김동현b", "송정현"]
  })
]);
assert.deepEqual(
  reusedLegacyStudentId[0]?.studentNames,
  ["백송연", "장지우", "김동현b", "송정현"],
  "구형 데이터가 같은 임시 학생 ID를 재사용해도 서로 다른 이름은 모두 강사 폴더에 남아야 합니다."
);
assert.deepEqual(
  mergeScheduleStudentRosters(
    event({ studentIds: ["legacy-shared"], studentNames: ["비활성학생"] }),
    event({ studentIds: ["legacy-shared", "legacy-shared", "legacy-shared"], studentNames: ["백송연", "변준혁", "이예진"] })
  ).studentNames,
  ["비활성학생", "백송연", "변준혁", "이예진"],
  "전체 시간표 원본 병합도 구형 임시 ID가 같더라도 서로 다른 학생 이름을 제거하면 안 됩니다."
);

const strict = mergeHomeInstructorEvents([
  event({ id: "one-to-one-a", classTypeCode: "ONE_TO_ONE", classTypeLabel: "1:1", badgeText: "[1:1]" }),
  event({ id: "one-to-one-b", classTypeCode: "ONE_TO_ONE", classTypeLabel: "1:1", badgeText: "[1:1]" })
]);
assert.equal(strict.length, 2, "서로 다른 1:1 수업은 자동 병합하면 안 됩니다.");

const baekSongyeonThreeHours = [
  event({ id: "anseong-math", weekday: 5, classDate: "2026-08-14", startTime: "10:00", endTime: "11:00", studentNames: ["백송연"] }),
  event({ id: "anseong-math", weekday: 5, classDate: "2026-08-14", startTime: "11:00", endTime: "12:00", studentNames: ["백송연"] }),
  event({ id: "anseong-math", weekday: 5, classDate: "2026-08-14", startTime: "12:00", endTime: "13:00", studentNames: ["백송연"] })
];
const baekSongyeonMerged = mergeScheduleReviewEvents(
  [baekSongyeonThreeHours[0]!, baekSongyeonThreeHours[2]!],
  baekSongyeonThreeHours
);
assert.deepEqual(
  baekSongyeonMerged.map((item) => item.startTime).sort(),
  ["10:00", "11:00", "12:00"],
  "부분 스냅샷에 빠진 11-12시를 같은 수업 ID의 실시간 기록으로 보충해야 합니다."
);
assert.deepEqual(
  findInteriorScheduleGapEvents(
    [baekSongyeonThreeHours[0]!, baekSongyeonThreeHours[2]!],
    baekSongyeonThreeHours.map((item, index) => ({ ...item, id: `hour-${index}`, studentIds: ["student-baek"] })),
    "student-baek",
    "백송연"
  ).map((item) => item.startTime),
  ["11:00"],
  "저장 그룹 classIds에 중간 시간이 빠져도 같은 학생·수업의 저장 구간 내부 시간만 복구해야 합니다."
);
assert.deepEqual(
  findInteriorScheduleGapEvents(
    [baekSongyeonThreeHours[0]!, baekSongyeonThreeHours[2]!],
    [],
    "student-baek",
    "백송연"
  ).map((item) => [item.startTime, item.endTime, item.studentNames]),
  [["11:00", "12:00", ["백송연"]]],
  "현재 주간 레코드가 없어도 같은 개별정규의 앞뒤 블록 사이 한 시간은 안전하게 복원해야 합니다."
);
assert.deepEqual(
  findInteriorScheduleGapEvents(
    [
      baekSongyeonThreeHours[0]!,
      { ...baekSongyeonThreeHours[2]!, studentNames: ["백송연", "다른학생"] }
    ],
    [],
    "student-baek",
    "백송연"
  ),
  [],
  "앞뒤 수업 명단이 다르면 실제 공강일 수 있으므로 중간 시간을 임의로 만들면 안 됩니다."
);

const classroomAssignments = createDefaultHomeClassroomAssignments(["teacher-1", "teacher-2", "teacher-3"]);
assert.deepEqual(classroomAssignments, {
  "teacher-1": HOME_CLASSROOM_OPTIONS[0],
  "teacher-2": HOME_CLASSROOM_OPTIONS[1],
  "teacher-3": HOME_CLASSROOM_OPTIONS[2]
});
const changedAssignments = { ...classroomAssignments, "teacher-2": HOME_CLASSROOM_OPTIONS[0] };
assert.deepEqual(
  getHomeClassroomOccupancy(["teacher-1", "teacher-2", "teacher-3"], changedAssignments).get(HOME_CLASSROOM_OPTIONS[0]),
  ["teacher-1", "teacher-2"],
  "강의실을 바꾸면 같은 방의 강사 배치와 중복 감지가 즉시 다시 계산되어야 합니다."
);

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "app/synchro-s/page.tsx"), "utf8");
const workspace = fs.readFileSync(path.join(root, "components/schedule/ScheduleCreationWorkspace.tsx"), "utf8");
const history = fs.readFileSync(path.join(root, "lib/server/saveHistory.ts"), "utf8");
const prospectRoute = fs.readFileSync(path.join(root, "app/api/schedule-creation/prospects/route.ts"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "components/schedule/HomeInstructorFolderDashboard.tsx"), "utf8");
const fullTimetable = fs.readFileSync(path.join(root, "components/schedule/HomeFullTimetableDialog.tsx"), "utf8");

assert.match(page, /!scheduleTagSelectionReady \|\| overviewLoading \|\| timetableGroupsLoading/, "초기 홈은 태그 선택이 끝난 뒤 그룹을 표시해야 합니다.");
assert.match(page, /mergeScheduleReviewEvents\(snapshot, \[\.\.\.linkedLiveEvents, \.\.\.interiorGapEvents\]\)/, "홈 전체 시간표는 부분 스냅샷의 누락 시간대를 연결된 실시간 수업으로 보충해야 합니다.");
assert.match(page, /findInteriorScheduleGapEvents\(/, "저장 그룹 ID에서 빠진 연속 수업의 중간 시간도 안전하게 복구해야 합니다.");
assert.match(page, /candidate\.tagId[\s\S]*?sameTagHistoricalEvents/, "중간 시간 복구는 반드시 동일 시간표 태그의 저장 이력으로 제한해야 합니다.");
assert.match(page, /return mergeScheduleStudentRosters\(a, b\)/, "홈 전체 시간표 원본 병합은 재사용된 구형 학생 ID보다 이름을 우선해야 합니다.");
assert.match(page, /if \(!viewerRoleResolved \|\| !scheduleTagSelectionReady\) return;/, "태그 확정 전 대용량 그룹 중복 요청을 막아야 합니다.");
assert.match(page, /isScheduleCreation[\s\S]*?bg-emerald-600[\s\S]*?bg-blue-600/, "최근 기록은 시간표 생성=초록, 학생 시간표=파랑이어야 합니다.");
assert.match(page, /historyTypeLabel[\s\S]*?시간표 생성[\s\S]*?entry\.targetType.*시간표/, "최근 기록마다 저장 유형을 독립된 라벨로 표시해야 합니다.");
assert.match(page, /bg-amber-300[\s\S]*?분류:/, "최근 기록의 분류는 노란색 배지여야 합니다.");
assert.match(workspace, /recordHistory: false/, "시간표 생성의 수업 저장 단계에서는 이력을 조기에 남기면 안 됩니다.");
assert.match(workspace, /historySource: "schedule_creation"/, "그룹 저장 성공 시 시간표 생성 출처를 기록해야 합니다.");
assert.match(prospectRoute, /"schedule_creation"/, "신규문의 시간표 생성도 최근 기록에 남아야 합니다.");
assert.match(history, /\.in\("student_name", studentNames\)/, "최근 20건의 대상 확인에 학생 전체 명단을 다시 훑으면 안 됩니다.");
assert.doesNotMatch(history, /fetchAllSupabaseRows/, "최근 기록 조회는 전체 명단 페이지 순회를 사용하지 않아야 합니다.");
assert.match(dashboard, /전체 시간표로 보기/, "강사 폴더에서 전체 시간표 팝업을 열 수 있어야 합니다.");
assert.match(fullTimetable, /role="dialog"/, "전체 시간표는 대화상자 의미를 제공해야 합니다.");
assert.match(fullTimetable, /aria-modal="true"/, "전체 시간표는 모달 상태를 보조기기에 알려야 합니다.");
assert.match(fullTimetable, /event\.key === "Escape"/, "전체 시간표는 Escape 키로 닫혀야 합니다.");
assert.match(fullTimetable, /강의실을 바꾸면 아래 전체 시간표에 즉시 반영됩니다/, "강의실 변경 결과를 명확히 안내해야 합니다.");
assert.match(fullTimetable, /h-\[100dvh\][\s\S]*?w-screen[\s\S]*?max-w-none/, "전체 시간표 팝업은 화면 전체를 검토 공간으로 사용해야 합니다.");
assert.match(fullTimetable, /전체 시간표 요일 선택/, "전체 시간표에서 월요일부터 일요일까지 날짜를 전환할 수 있어야 합니다.");
assert.match(fullTimetable, /시간표 분류 \$\{selectedTagLabel\}/, "선택한 시간표 태그를 보조기기에 명확히 설명해야 합니다.");
assert.match(fullTimetable, /bg-amber-300[\s\S]*?text-base[\s\S]*?#\{selectedTagLabel\}/, "선택한 시간표 태그를 최상단에 크고 노란색으로 강조해야 합니다.");
assert.match(fullTimetable, /고정 강의실 설정/, "강사별 고정 강의실 설정창을 열 수 있어야 합니다.");
assert.match(fullTimetable, /localStorage\.setItem\(CLASSROOM_STORAGE_KEY/, "고정 강의실은 브라우저에 저장되어 요일 전환 후에도 유지되어야 합니다.");
assert.match(fullTimetable, /border-2 border-amber-400/, "1:1 수업 카드는 금색 테두리로 구분해야 합니다.");
assert.match(fullTimetable, /\{typeLabel\}[\s\S]*?\{event\.studentNames\.length\}명/, "수업 유형은 학생 명수 왼쪽에 배치해야 합니다.");
assert.match(fullTimetable, /highlightedStudent/, "전체 시간표에서 선택한 학생을 모든 강의실에 걸쳐 강조할 수 있어야 합니다.");
assert.match(fullTimetable, /aria-pressed=\{selected\}/, "학생 강조 선택 상태를 보조기기에 전달해야 합니다.");
assert.match(fullTimetable, /if \(!open\) return;[\s\S]*?setHighlightedStudent\(null\);[\s\S]*?setSelectedDateISO/, "팝업을 새로 열면 학생 강조와 기준 요일을 함께 초기화해야 합니다.");
assert.match(fullTimetable, /setSelectedDateISO\(item\.dateISO\);[\s\S]*?setHighlightedStudent\(null\);/, "요일을 바꾸면 이전 요일의 학생 강조를 초기화해야 합니다.");
assert.match(page, /border-2 border-blue-300[\s\S]*?Global Search/, "전역 검색창은 명확한 파란색 테두리로 검색 위치를 강조해야 합니다.");
assert.match(page, /이 날짜가 지나면 현재 시간표는 자동으로 적용 대상에서 제외되고/, "만료일 이후 동작을 저장 그룹에서 설명해야 합니다.");

console.log("Home dashboard improvements verification passed.");
