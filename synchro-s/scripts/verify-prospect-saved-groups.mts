import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  filterProspectTimetableGroups,
  formatProspectSchoolGrade
} from "../lib/prospectTimetableGroups";

const prospects = [
  { id: "p1", name: "운영검증", school: "검증학교", grade: "1", memo: "평일 저녁 희망" },
  { id: "p2", name: "이로운", school: "세화고", grade: "3학년", memo: "수학 상담 예정" }
];
const groups = [
  { id: "g1", name: "운영검증 A안", targetId: "p1", weekStart: "2026-07-20" },
  { id: "g2", name: "이로운 B안", targetId: "p2", weekStart: "2026-07-20" },
  { id: "g3", name: "지난주 시간표", targetId: "p1", weekStart: "2026-07-13" }
];

assert.deepEqual(
  filterProspectTimetableGroups(groups, prospects, "").map((group) => group.id),
  ["g1", "g2", "g3"],
  "신규문의 목록은 현재 주차에 한정하지 않고 DB에 누적된 모든 저장 버전을 표시해야 합니다."
);
assert.deepEqual(filterProspectTimetableGroups(groups, prospects, "세화고").map((group) => group.id), ["g2"]);
assert.deepEqual(filterProspectTimetableGroups(groups, prospects, "저녁").map((group) => group.id), ["g1", "g3"]);
assert.equal(formatProspectSchoolGrade(prospects[0]), "검증학교 · 1학년");
assert.equal(formatProspectSchoolGrade(prospects[1]), "세화고 · 3학년");

const root = process.cwd();
const workspace = fs.readFileSync(path.join(root, "components/schedule/ScheduleCreationWorkspace.tsx"), "utf8");
const route = fs.readFileSync(path.join(root, "app/api/schedule-creation/prospects/route.ts"), "utf8");

assert.ok(workspace.includes("저장된 신규문의 시간표 검색"));
assert.ok(workspace.includes("이름·학교·학년·메모 검색"));
assert.ok(workspace.includes('fetch("/api/schedule-creation/prospects"'), "저장 목록 조회에서 현재 주차 필터를 제거해야 합니다.");
assert.ok(workspace.includes("적용 주차 {group.weekStart}"), "누적 목록에는 각 저장 버전의 적용 주차를 표시해야 합니다.");
assert.ok(workspace.includes('prospect.memo?.trim() || "메모 없음"'));
assert.ok(workspace.includes("setProspectId(group.targetId)"));
assert.ok(route.includes("prospect_timetable_groups"));
assert.ok(route.includes("prospect_schedule_items"));
assert.ok(route.includes("return NextResponse.json({ prospectId, group: mapGroup(group) })"));

console.log("prospect saved timetable group verification passed");
