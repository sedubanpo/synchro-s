import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase environment variables are required.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

const { data: activeGroups, error: activeGroupsError } = await supabase
  .from("timetable_groups")
  .select("id,role_view,target_id,week_start,tag_id,is_active");
if (activeGroupsError) throw activeGroupsError;

const activeScopeIds = new Map();
for (const group of (activeGroups ?? []).filter((item) => item.is_active === true)) {
  const scopeKey = group.role_view === "student" && group.tag_id
    ? [group.role_view, group.target_id, group.tag_id ?? "untagged"].join("|")
    : [group.role_view, group.target_id, group.week_start, group.tag_id ?? "untagged"].join("|");
  const ids = activeScopeIds.get(scopeKey) ?? [];
  ids.push(group.id);
  activeScopeIds.set(scopeKey, ids);
}

const duplicateScopes = [...activeScopeIds.entries()].filter(([, ids]) => ids.length > 1);
if (duplicateScopes.length > 0) {
  throw new Error(`중복 활성 시간표 범위가 있습니다: ${JSON.stringify(duplicateScopes)}`);
}

const [{ data: student, error: studentError }, { data: tag, error: tagError }] = await Promise.all([
  supabase.from("students").select("id,student_name").eq("student_name", "권나현").single(),
  supabase.from("schedule_tags").select("id,name,is_current").eq("name", "여름방학A").single()
]);
if (studentError) throw studentError;
if (tagError) throw tagError;

const { data: groups, error: groupsError } = await supabase
  .from("timetable_groups")
  .select("id,week_start,tag_id,is_active,class_ids")
  .eq("role_view", "student")
  .eq("target_id", student.id)
  .eq("tag_id", tag.id)
  .order("created_at", { ascending: false });
if (groupsError) throw groupsError;

const activeGroup = (groups ?? []).find((group) => group.is_active === true);
if (!activeGroup) throw new Error("권나현의 여름방학A 활성 시간표를 찾지 못했습니다.");

// Repeating the same desired state must be idempotent. This is the retry path
// that previously toggled an active group back to inactive.
for (let attempt = 0; attempt < 2; attempt += 1) {
  const { data, error } = await supabase.rpc("set_timetable_group_active", {
    p_group_id: activeGroup.id,
    p_is_active: true
  });
  if (error) throw error;
  if (data !== true) throw new Error(`활성 상태 재적용 ${attempt + 1}회차가 true를 반환하지 않았습니다.`);
}

const { data: verifiedGroups, error: verifyError } = await supabase
  .from("timetable_groups")
  .select("id,is_active")
  .eq("role_view", "student")
  .eq("target_id", student.id)
  .eq("tag_id", tag.id);
if (verifyError) throw verifyError;
const verifiedActive = (verifiedGroups ?? []).filter((group) => group.is_active === true);
if (verifiedActive.length !== 1 || verifiedActive[0]?.id !== activeGroup.id) {
  throw new Error("반복 활성화 뒤 단일 활성 그룹 불변식이 깨졌습니다.");
}

const classIds = Array.isArray(activeGroup.class_ids) ? activeGroup.class_ids : [];
const { data: classes, error: classesError } = await supabase
  .from("classes")
  .select("id,instructor_id,instructors(instructor_name),class_enrollments(student_id)")
  .in("id", classIds);
if (classesError) throw classesError;
const studentLinkedClasses = (classes ?? []).filter((item) =>
  (item.class_enrollments ?? []).some((enrollment) => enrollment.student_id === student.id)
);
if (studentLinkedClasses.length !== classIds.length) {
  throw new Error(`활성 그룹 ${classIds.length}개 중 학생 연결을 확인한 수업은 ${studentLinkedClasses.length}개입니다.`);
}

console.log(JSON.stringify({
  ok: true,
  duplicateActiveScopes: duplicateScopes.length,
  student: student.student_name,
  tag: tag.name,
  activeGroupId: activeGroup.id,
  activeGroupCountAfterRetry: verifiedActive.length,
  linkedClassCount: studentLinkedClasses.length,
  instructorNames: [...new Set(studentLinkedClasses.map((item) => item.instructors?.instructor_name).filter(Boolean))]
}, null, 2));
