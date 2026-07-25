import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mergeHomeInstructorEvents } from "../lib/homeDashboardGrouping";
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

const strict = mergeHomeInstructorEvents([
  event({ id: "one-to-one-a", classTypeCode: "ONE_TO_ONE", classTypeLabel: "1:1", badgeText: "[1:1]" }),
  event({ id: "one-to-one-b", classTypeCode: "ONE_TO_ONE", classTypeLabel: "1:1", badgeText: "[1:1]" })
]);
assert.equal(strict.length, 2, "서로 다른 1:1 수업은 자동 병합하면 안 됩니다.");

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "app/synchro-s/page.tsx"), "utf8");
const workspace = fs.readFileSync(path.join(root, "components/schedule/ScheduleCreationWorkspace.tsx"), "utf8");
const history = fs.readFileSync(path.join(root, "lib/server/saveHistory.ts"), "utf8");
const prospectRoute = fs.readFileSync(path.join(root, "app/api/schedule-creation/prospects/route.ts"), "utf8");

assert.match(page, /!scheduleTagSelectionReady \|\| overviewLoading \|\| timetableGroupsLoading/, "초기 홈은 태그 선택이 끝난 뒤 그룹을 표시해야 합니다.");
assert.match(page, /if \(!viewerRoleResolved \|\| !scheduleTagSelectionReady\) return;/, "태그 확정 전 대용량 그룹 중복 요청을 막아야 합니다.");
assert.match(page, /isScheduleCreation[\s\S]*?bg-emerald-600[\s\S]*?bg-blue-600/, "최근 기록은 시간표 생성=초록, 학생 시간표=파랑이어야 합니다.");
assert.match(page, /bg-amber-300[\s\S]*?분류:/, "최근 기록의 분류는 노란색 배지여야 합니다.");
assert.match(workspace, /recordHistory: false/, "시간표 생성의 수업 저장 단계에서는 이력을 조기에 남기면 안 됩니다.");
assert.match(workspace, /historySource: "schedule_creation"/, "그룹 저장 성공 시 시간표 생성 출처를 기록해야 합니다.");
assert.match(prospectRoute, /"schedule_creation"/, "신규문의 시간표 생성도 최근 기록에 남아야 합니다.");
assert.match(history, /\.in\("student_name", studentNames\)/, "최근 20건의 대상 확인에 학생 전체 명단을 다시 훑으면 안 됩니다.");
assert.doesNotMatch(history, /fetchAllSupabaseRows/, "최근 기록 조회는 전체 명단 페이지 순회를 사용하지 않아야 합니다.");

console.log("Home dashboard improvements verification passed.");
