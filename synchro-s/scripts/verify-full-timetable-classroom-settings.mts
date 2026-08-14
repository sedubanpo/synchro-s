import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createDefaultHomeClassroomAssignments,
  sanitizeHomeClassroomAssignments
} from "../lib/homeFullTimetable";

const component = await readFile(new URL("../components/schedule/HomeFullTimetableDialog.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../app/api/settings/classrooms/route.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/0024_full_timetable_classroom_assignments.sql", import.meta.url), "utf8");

assert.deepEqual(
  sanitizeHomeClassroomAssignments({ teacherA: "1강의실", teacherB: "없는 방", teacherC: 3 }),
  { teacherA: "1강의실" },
  "서버와 브라우저 입력에서 허용된 강의실만 유지해야 합니다."
);
assert.deepEqual(
  createDefaultHomeClassroomAssignments(["a", "b", "c"]),
  { a: "1강의실", b: "2강의실", c: "3강의실" },
  "신규 강사의 초기 배정이 안정적이어야 합니다."
);

assert.match(component, /\/api\/settings\/classrooms\?dateISO=/, "요일 변경 시 서버 배정을 조회해야 합니다.");
assert.match(component, /기존 브라우저 배정을 서버로 옮기는 중입니다/, "기존 localStorage 값을 서버로 이관해야 합니다.");
assert.match(component, /scope: "fixed"/, "고정 배정은 fixed 범위로 저장해야 합니다.");
assert.match(component, /scope: "day"/, "하루 배정은 day 범위로 분리해야 합니다.");
assert.match(component, /고정값 사용 ·/, "하루 조정에서 고정값으로 복귀할 수 있어야 합니다.");
assert.match(component, /\[defaultSelectedDateISO, open\]/, "서버 로딩 중 부모가 다시 렌더링되어도 설정 패널이 임의로 접히지 않아야 합니다.");
assert.match(component, /setFixedAssignments\(previous\)/, "고정 자동 배정 저장 실패 시 이전 값을 복구해야 합니다.");
assert.match(component, /setDayOverrides\(previous\)/, "하루 배정 초기화 실패 시 이전 값을 복구해야 합니다.");
assert.match(component, /subjectTone\(event\.subjectName\)/, "수업 카드가 과목별 톤을 사용해야 합니다.");
assert.match(component, /border-2 border-amber-400/, "1:1 수업의 금색 강조는 유지되어야 합니다.");
assert.match(component, /className="w-full" style=\{\{ minWidth:/, "강의실 수가 적을 때도 시간표 격자가 화면 너비를 채워야 합니다.");

assert.match(api, /canManageSchedules\(auth\.profile\.role\)/, "강의실 설정 API는 운영 권한을 확인해야 합니다.");
assert.match(api, /instructor_fixed_classrooms/, "고정 강의실 테이블을 사용해야 합니다.");
assert.match(api, /instructor_classroom_day_overrides/, "날짜별 임시 배정 테이블을 사용해야 합니다.");
assert.match(api, /UUID_PATTERN/, "강사 식별자를 서버에서 검증해야 합니다.");
assert.match(api, /ISO_DATE_PATTERN/, "날짜를 서버에서 검증해야 합니다.");

assert.match(migration, /primary key \(assignment_date, instructor_id\)/, "하루 배정은 날짜와 강사 조합으로 유일해야 합니다.");
assert.match(migration, /enable row level security/g, "신규 설정 테이블에 RLS가 적용되어야 합니다.");
assert.match(migration, /is_admin_or_coordinator/, "운영자만 서버 배정을 변경할 수 있어야 합니다.");

console.log("full timetable classroom settings verification passed");
