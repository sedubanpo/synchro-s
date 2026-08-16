import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getEffectiveStudentTimetableGroupMap,
  selectEffectiveStudentTimetableGroup,
  type EffectiveStudentTimetableGroup
} from "../lib/timetableGroupSelection";

const hongGroups: EffectiveStudentTimetableGroup[] = [
  {
    id: "older-week",
    roleView: "student",
    targetId: "hong-jaebeom",
    weekStart: "2026-08-10",
    tagId: "august-2026",
    expiresOn: null,
    isActive: false,
    createdAt: "2026-08-10T10:00:00.000Z"
  },
  {
    id: "active-future-week",
    roleView: "student",
    targetId: "hong-jaebeom",
    weekStart: "2026-08-24",
    tagId: "august-2026",
    expiresOn: null,
    isActive: true,
    createdAt: "2026-08-18T10:00:00.000Z"
  }
];

for (const viewedWeek of ["2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"]) {
  assert.equal(
    selectEffectiveStudentTimetableGroup(hongGroups, viewedWeek, "august-2026", viewedWeek)?.id,
    "active-future-week",
    `${viewedWeek} 조회에서도 같은 태그의 활성 시간표가 선택되어야 합니다.`
  );
  assert.equal(
    getEffectiveStudentTimetableGroupMap(hongGroups, viewedWeek, "august-2026", viewedWeek).get("hong-jaebeom")?.id,
    "active-future-week",
    `${viewedWeek} 홈/전체 시간표 맵에서도 홍재범이 누락되면 안 됩니다.`
  );
}

const expiredActive = hongGroups.map((group) =>
  group.id === "active-future-week" ? { ...group, expiresOn: "2026-08-23" } : group
);
assert.equal(
  selectEffectiveStudentTimetableGroup(expiredActive, "2026-08-24", "august-2026", "2026-08-24")?.id,
  "older-week",
  "활성 시간표가 만료되면 같은 태그의 대기 시간표가 승계되어야 합니다."
);

const [pageSource, weekRouteSource, serviceSource, groupRouteSource, migrationSource] = await Promise.all([
  readFile(new URL("../app/synchro-s/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/schedules/week/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/server/scheduleService.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/schedules/groups/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/0025_student_timetable_tag_scope.sql", import.meta.url), "utf8")
]);

assert.match(pageSource, /query\.set\("tagId", selectedScheduleTagId \?\? ""\)/, "학생/강사 주간 조회에 선택 태그를 전달해야 합니다.");
assert.match(pageSource, /view: "student", tagId: requestedTagId \?\? ""/, "검토 주간 조회에 선택 태그를 전달해야 합니다.");
assert.match(pageSource, /view: targetView,[\s\S]*tagId: selectedScheduleTagId \?\? ""/, "홈/전체 시간표 조회에 선택 태그를 전달해야 합니다.");
assert.match(weekRouteSource, /scheduleTagId = searchParams\.has\("tagId"\)/, "주간 API가 태그 범위를 해석해야 합니다.");
assert.match(serviceSource, /params\.scheduleTagId[\s\S]*params\.scheduleTagId !== undefined/, "주간 서비스가 태그 범위의 활성 그룹만 사용해야 합니다.");
assert.doesNotMatch(groupRouteSource, /query\.lte\("week_start", effectiveWeekStart\)/, "그룹 API는 저장 주차로 태그 그룹을 잘라내면 안 됩니다.");
assert.match(migrationSource, /timetable_groups_one_active_student_per_tag/, "DB에 학생+태그 단일 활성 불변식이 있어야 합니다.");
assert.match(migrationSource, /v_group\.role_view = 'student' and v_group\.tag_id is not null or week_start = v_group\.week_start/, "태그가 있는 학생 활성화는 주차와 무관하게 같은 태그를 교체해야 합니다.");

console.log("학생 시간표 태그 범위 검증 통과: 저장 주차와 무관한 활성 그룹 선택 및 홈·검토·전체시간표 태그 전달");
