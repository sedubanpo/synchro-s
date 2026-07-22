import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase environment variables are required.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

const STUDENT_NAME = "김나린";
const TAG_NAME = "여름방학A";
const WEEK_START = "2026-07-13";

const replacements = new Map([
  ["70f8e685-538c-431b-a91e-40fc4a183c85", "d5343aca-1153-4ef1-ba29-4f428d2d652b"],
  ["e69d9f52-fcb7-483c-97e7-57439a14a8e4", "7d06c248-cd14-4979-9829-37af26943391"],
  ["9045aa95-c22c-4af6-b35b-c31a97656b80", "f7cb40f7-d2a6-4da4-a7e5-d9cfc1bc7546"],
  ["c2565b29-2182-415c-927d-4611734203e0", "a87fb2ca-9d6a-49eb-955c-97f1ca3416b5"],
  ["7de7c54b-9bb9-4444-afe1-c1db716d9889", "e5e92700-3def-4e89-a69a-39652213232f"],
  ["28ebafae-e78b-455b-bcb7-2fd812a5a978", "583cdddf-7c42-4c19-be52-6cd3f8c9882a"]
]);
const correctInstructorNamesByClassId = new Map([
  ["d5343aca-1153-4ef1-ba29-4f428d2d652b", "남종언"],
  ["7d06c248-cd14-4979-9829-37af26943391", "남종언"],
  ["f7cb40f7-d2a6-4da4-a7e5-d9cfc1bc7546", "남종언"],
  ["a87fb2ca-9d6a-49eb-955c-97f1ca3416b5", "남종언"],
  ["e5e92700-3def-4e89-a69a-39652213232f", "박은채"],
  ["583cdddf-7c42-4c19-be52-6cd3f8c9882a", "박은채"]
]);

async function findSingle(table, column, value, select = "*") {
  const { data, error } = await supabase.from(table).select(select).eq(column, value).limit(1).single();
  if (error) throw error;
  return data;
}

const [student, tag] = await Promise.all([
  findSingle("students", "student_name", STUDENT_NAME, "id,student_name"),
  findSingle("schedule_tags", "name", TAG_NAME, "id,name")
]);

const { data: group, error: groupError } = await supabase
  .from("timetable_groups")
  .select("id,name,class_ids,snapshot_events,is_active")
  .eq("role_view", "student")
  .eq("target_id", student.id)
  .eq("tag_id", tag.id)
  .eq("week_start", WEEK_START)
  .limit(1)
  .single();
if (groupError) throw groupError;

const wrongClassIds = [...replacements.keys()];
const correctClassIds = [...replacements.values()];
const allClassIds = [...wrongClassIds, ...correctClassIds];
const { data: classes, error: classesError } = await supabase
  .from("classes")
  .select("id,instructor_id,subject_code,class_type_code,weekday,start_time,end_time")
  .in("id", allClassIds);
if (classesError) throw classesError;
if ((classes ?? []).length !== allClassIds.length) {
  throw new Error("복구에 필요한 원본 또는 대상 수업을 모두 찾지 못했습니다.");
}

const currentClassIds = Array.isArray(group.class_ids) ? group.class_ids : [];
const pendingWrongIds = wrongClassIds.filter((id) => currentClassIds.includes(id));
const alreadyRepaired = pendingWrongIds.length === 0 && correctClassIds.every((id) => currentClassIds.includes(id));

if (!alreadyRepaired) {
  if (pendingWrongIds.length !== wrongClassIds.length) {
    throw new Error(`일부 잘못된 수업만 남아 있어 자동 복구를 중단했습니다: ${pendingWrongIds.join(", ")}`);
  }

  const { data: existingCorrectEnrollments, error: correctEnrollmentError } = await supabase
    .from("class_enrollments")
    .select("class_id")
    .eq("student_id", student.id)
    .in("class_id", correctClassIds);
  if (correctEnrollmentError) throw correctEnrollmentError;

  const enrolledCorrectIds = new Set((existingCorrectEnrollments ?? []).map((row) => row.class_id));
  const missingEnrollmentRows = correctClassIds
    .filter((classId) => !enrolledCorrectIds.has(classId))
    .map((classId) => ({ class_id: classId, student_id: student.id }));
  if (missingEnrollmentRows.length > 0) {
    const { error } = await supabase.from("class_enrollments").insert(missingEnrollmentRows);
    if (error) throw error;
  }

  const nextClassIds = Array.from(new Set(currentClassIds.map((id) => replacements.get(id) ?? id)));
  const nextSnapshotEvents = (Array.isArray(group.snapshot_events) ? group.snapshot_events : []).map((event) => {
    const nextId = replacements.get(event.id);
    if (!nextId) return event;
    const targetClass = classes.find((item) => item.id === nextId);
    return targetClass
      ? {
          ...event,
          id: nextId,
          instructorId: targetClass.instructor_id,
          instructorName: correctInstructorNamesByClassId.get(nextId) ?? event.instructorName
        }
      : event;
  });

  const { error: groupUpdateError } = await supabase
    .from("timetable_groups")
    .update({
      class_ids: nextClassIds,
      snapshot_events: nextSnapshotEvents,
      updated_at: new Date().toISOString()
    })
    .eq("id", group.id);
  if (groupUpdateError) throw groupUpdateError;

}

const { error: wrongEnrollmentDeleteError } = await supabase
  .from("class_enrollments")
  .delete()
  .eq("student_id", student.id)
  .in("class_id", wrongClassIds);
if (wrongEnrollmentDeleteError) throw wrongEnrollmentDeleteError;

const { data: repairedGroup, error: repairedGroupError } = await supabase
  .from("timetable_groups")
  .select("id,class_ids")
  .eq("id", group.id)
  .single();
if (repairedGroupError) throw repairedGroupError;

const unresolvedWrongIds = wrongClassIds.filter((id) => repairedGroup.class_ids.includes(id));
const missingCorrectIds = correctClassIds.filter((id) => !repairedGroup.class_ids.includes(id));
if (unresolvedWrongIds.length > 0 || missingCorrectIds.length > 0) {
  throw new Error(`복구 검증 실패: wrong=${unresolvedWrongIds.join(",")} missing=${missingCorrectIds.join(",")}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      alreadyRepaired,
      student: STUDENT_NAME,
      tag: TAG_NAME,
      weekStart: WEEK_START,
      groupId: group.id,
      replacedClassCount: replacements.size,
      classCount: repairedGroup.class_ids.length
    },
    null,
    2
  )
);
