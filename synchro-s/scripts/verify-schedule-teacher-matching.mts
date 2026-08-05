import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  findInstructorByTypedName,
  getInstructorSubjectFamily,
  instructorMatchesSubject
} from "../lib/instructorSubjectMatching";
import { isInstructorRosterActive, parseInstructorRosterActive } from "../lib/instructorRoster";

const instructors = [
  { id: "director", name: "안준성", secondary: "반포관 원장", isActive: true },
  { id: "physics", name: "물리강사", secondary: "물리", isActive: true },
  { id: "biology", name: "생명강사", secondary: "생명과학", isActive: true },
  { id: "former", name: "박종건", secondary: "지구과학", isActive: false }
];

assert.equal(parseInstructorRosterActive("FALSE"), false);
assert.equal(parseInstructorRosterActive("퇴사"), false);
assert.equal(parseInstructorRosterActive("TRUE"), true);
assert.equal(isInstructorRosterActive(true, false), false, "Teachers 시트 퇴사자는 DB가 활성이어도 제외해야 합니다.");
assert.equal(isInstructorRosterActive(true, true), true);

assert.equal(getInstructorSubjectFamily(instructors[0]!), "math");
assert.equal(instructorMatchesSubject(instructors[0]!, "수학"), true, "안준성 원장은 수학 후보여야 합니다.");
assert.equal(instructorMatchesSubject(instructors[1]!, "과학"), true, "물리 강사는 과학 후보여야 합니다.");
assert.equal(instructorMatchesSubject(instructors[2]!, "과학"), true, "생명 강사는 과학 후보여야 합니다.");
assert.equal(findInstructorByTypedName(instructors, "안준성")?.id, "director");
assert.equal(findInstructorByTypedName(instructors, "없는강사"), null);

const [modalSource, optionsSource] = await Promise.all([
  readFile(new URL("../components/schedule/SyncScheduleDraftModal.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/schedules/options/route.ts", import.meta.url), "utf8")
]);

assert.ok(modalSource.includes("useState(false)"), "과목 기준 자동 선택은 기본 해제 상태여야 합니다.");
assert.ok(modalSource.includes("findInstructorByTypedName(activeInstructors, nextQuery)"), "강사명 입력 자동매칭이 있어야 합니다.");
assert.ok(modalSource.includes("입력한 강사명을 활성 강사 명단에서 찾지 못했습니다"), "미매칭 경고가 있어야 합니다.");
assert.ok(modalSource.includes("INSTRUCTOR_TONES"), "과목군별 선택 배경색이 있어야 합니다.");
assert.ok(optionsSource.includes("teacherActiveByName"), "원본 Teachers 재직 상태를 옵션 필터에 반영해야 합니다.");

console.log("schedule teacher matching verification passed");
