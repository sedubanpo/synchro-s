import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveSubjectOption } from "../lib/subjectResolver";
import { buildProspectTimetableBannerProfile } from "../lib/scheduleCreationBanner";
import { getOverlappingHourSlots } from "../lib/timetableSlots";

const subjects = [
  { code: "SOCIAL", label: "세지" },
  { code: "SOCIAL2", label: "사문" },
  { code: "SOCIAL8", label: "통사" },
  { code: "SCIENCE7", label: "통과" }
];

assert.equal(resolveSubjectOption(subjects, "통합사회")?.code, "SOCIAL8");
assert.equal(resolveSubjectOption(subjects, "사회문화")?.code, "SOCIAL2");
assert.equal(resolveSubjectOption(subjects, "세계지리")?.code, "SOCIAL");
assert.equal(resolveSubjectOption(subjects, "통합과학")?.code, "SCIENCE7");

const slots = Array.from({ length: 15 }, (_, index) => `${String(index + 9).padStart(2, "0")}:00`);
assert.deepEqual(
  getOverlappingHourSlots({ startTime: "15:00", endTime: "18:00" }, slots),
  ["15:00", "16:00", "17:00"],
  "시간표 생성의 3시간 수업은 세 개 시간 행에 표시되어야 합니다."
);

const prospectBanner = buildProspectTimetableBannerProfile(
  { id: "prospect-1", name: " 김학생 ", school: " 반포고 ", grade: "2" },
  new Map([["반포고", "https://example.com/banpo.png"]])
);
assert.equal(prospectBanner.name, "김학생");
assert.equal(prospectBanner.school, "반포고");
assert.equal(prospectBanner.secondary, "반포고 · 2학년");
assert.equal(prospectBanner.schoolIconUrl, "https://example.com/banpo.png");

const root = process.cwd();
const workspace = fs.readFileSync(path.join(root, "components/schedule/ScheduleCreationWorkspace.tsx"), "utf8");
const modal = fs.readFileSync(path.join(root, "components/schedule/SyncScheduleDraftModal.tsx"), "utf8");
const grid = fs.readFileSync(path.join(root, "components/schedule/TimetableGrid.tsx"), "utf8");
const page = fs.readFileSync(path.join(root, "app/synchro-s/page.tsx"), "utf8");
const prospectRoute = fs.readFileSync(path.join(root, "app/api/schedule-creation/prospects/route.ts"), "utf8");
const groupRoute = fs.readFileSync(path.join(root, "app/api/schedules/groups/route.ts"), "utf8");

assert.ok(workspace.includes("resolveSubjectOption(subjects, input.subjectLabel)"));
assert.ok(workspace.includes("hideEmptyDays={hideEmptyDays}"));
assert.ok(workspace.includes("hideEmptyTimes={hideEmptyTimes}"));
assert.ok(workspace.includes("빈 요일 숨기기"));
assert.ok(workspace.includes("빈 시간 숨기기"));
assert.ok(workspace.includes('aria-label="Student Timetable 대상 정보"'), "시간표 생성 격자 위에 Student Timetable 배너가 있어야 합니다.");
assert.ok(workspace.includes("buildProspectTimetableBannerProfile"), "신규문의 학교 입력도 배너 프로필과 엠블럼에 연결되어야 합니다.");
assert.ok(workspace.includes('mode === "resident" ? "재원생" : "신규문의 가안"'), "배너는 재원생과 신규문의 모드를 모두 표시해야 합니다.");
assert.ok(modal.includes("if (accepted !== false) onClose()"), "검증 실패 시 입력창을 닫지 않아야 합니다.");
assert.ok(workspace.includes("scheduleTagId: effectiveScheduleTagId"), "재원생 수업 저장 요청에도 선택 태그를 전달해야 합니다.");
assert.ok(workspace.includes('event.note?.trim() || "시간표 생성"'), "빈 수업 메모는 저장 가능한 기본 메모로 정규화해야 합니다.");
assert.ok(workspace.includes('placeholder="이름 또는 학교 검색"'), "재원생을 이름으로 검색할 수 있어야 합니다.");
assert.ok(workspace.includes("시간표 태그"));
assert.ok(workspace.includes("onScheduleTagChange(tag.id)"), "초안 위 태그 버튼은 전역 태그 선택과 같은 상태를 갱신해야 합니다.");
assert.ok(grid.includes("dayDateOverrides"));
assert.ok(grid.includes("onDayDateChange"));
assert.ok(grid.includes("주간 반복으로 되돌리기"));
assert.ok(grid.includes("selectedWeekday !== day.key"), "요일과 다른 날짜는 특정 일자 지정으로 허용하면 안 됩니다.");
assert.ok(modal.includes('scheduleMode: initialCell.scheduleMode ?? "recurring"'));
assert.ok(page.includes('scheduleMode: draft.scheduleMode'));
assert.ok(page.includes('classDate: draft.scheduleMode === "one_off" ? draft.classDate : undefined'));
assert.ok(prospectRoute.includes('scheduleMode: item.scheduleMode === "one_off" ? "one_off" : "recurring"'));
assert.ok(prospectRoute.includes('item.scheduleMode === "one_off" && item.classDate'));
assert.ok(workspace.includes('action: "rename"'), "저장된 시간표 이름은 서버 수정 API로 저장해야 합니다.");
assert.ok(workspace.includes('isActive: !group.isActive'), "재원생 시간표 활성/비활성 요청은 목표 상태를 서버에 전달해야 합니다.");
assert.ok(workspace.includes("await loadResidentGroups(group.targetId)"), "재원생 시간표 이름 저장 후 서버 값을 다시 불러와야 합니다.");
assert.ok(workspace.includes("else await loadProspects()"), "가안 시간표 이름 저장 후 서버 값을 다시 불러와야 합니다.");
assert.ok(prospectRoute.includes('payload.action === "rename"'), "가안 시간표 이름 수정 API가 있어야 합니다.");
assert.ok(prospectRoute.includes('.from("prospect_timetable_groups")'), "가안 시간표 이름은 서버 테이블에 저장해야 합니다.");
assert.ok(prospectRoute.includes("시간표 이름은 100자 이하로 입력해 주세요."), "가안 시간표 이름 길이는 서버에서 검증해야 합니다.");
assert.ok(groupRoute.includes('payload.action === "rename"'), "재원생 시간표 이름 수정 API가 있어야 합니다.");
assert.ok(groupRoute.includes("시간표 이름은 100자 이하로 입력해 주세요."), "재원생 시간표 이름 길이는 서버에서 검증해야 합니다.");

console.log("schedule creation draft verification passed");
