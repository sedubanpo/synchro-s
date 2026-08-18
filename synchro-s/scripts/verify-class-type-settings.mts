import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [api, settings, options, migration, service] = await Promise.all([
  readFile(path.join(projectRoot, "app/api/settings/class-types/route.ts"), "utf8"),
  readFile(path.join(projectRoot, "components/schedule/ScheduleTagManager.tsx"), "utf8"),
  readFile(path.join(projectRoot, "app/api/schedules/options/route.ts"), "utf8"),
  readFile(path.join(projectRoot, "supabase/migrations/0026_class_type_settings.sql"), "utf8"),
  readFile(path.join(projectRoot, "lib/server/scheduleService.ts"), "utf8")
]);

assert.match(api, /export async function POST/, "수업 유형을 추가하는 API가 있어야 합니다.");
assert.match(api, /export async function PATCH/, "수업 유형의 이름·정원·메모를 수정할 수 있어야 합니다.");
assert.match(api, /max_students: capacity/, "저장된 정원이 DB max_students에 연결되어야 합니다.");
assert.match(api, /memo:/, "수업 유형 메모가 저장되어야 합니다.");
assert.match(settings, />수업 유형</, "설정창에 수업 유형 섹션이 있어야 합니다.");
assert.match(settings, /새 유형명/, "설정창에서 새 수업 유형을 입력할 수 있어야 합니다.");
assert.match(settings, /정원은 같은 강사·과목·시간/, "정원 의미를 근무자에게 설명해야 합니다.");
assert.match(options, /maxStudents: row\.max_students,[\s\S]*memo: row\.memo/, "옵션 응답에 정원과 메모가 포함되어야 합니다.");
assert.match(migration, /add column if not exists memo/, "기존 class_types 테이블을 안전하게 확장해야 합니다.");
assert.match(service, /getClassTypeCapacityConflictReason/, "서버 충돌 진단에서 설정 정원을 사용해야 합니다.");

console.log("class type settings verification passed");
