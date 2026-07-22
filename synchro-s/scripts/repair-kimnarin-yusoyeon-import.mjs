import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase environment variables are required");

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const slots = new Set(["3:17:00:00", "3:18:00:00", "3:19:00:00", "6:17:00:00", "6:18:00:00", "6:19:00:00"]);
const slotKey = (row) => `${row.weekday}:${row.start_time}`;

const [{ data: student, error: studentError }, { data: instructors, error: instructorError }] = await Promise.all([
  db.from("students").select("id,student_name").eq("student_name", "김나린").single(),
  db.from("instructors").select("id,instructor_name").in("instructor_name", ["안준성", "유소연"])
]);
if (studentError) throw studentError;
if (instructorError) throw instructorError;

const instructorByName = new Map(instructors.map((row) => [row.instructor_name, row.id]));
const wrongInstructorId = instructorByName.get("안준성");
const correctInstructorId = instructorByName.get("유소연");
if (!wrongInstructorId || !correctInstructorId) throw new Error("안준성 또는 유소연 강사 정보를 찾지 못했습니다");

const { data: enrollments, error: enrollmentError } = await db
  .from("class_enrollments")
  .select("class_id")
  .eq("student_id", student.id);
if (enrollmentError) throw enrollmentError;
const enrolledClassIds = enrollments.map((row) => row.class_id);

const { data: candidateClasses, error: candidateError } = await db
  .from("classes")
  .select("id,instructor_id,subject_code,class_type_code,weekday,start_time,end_time,active_from,created_at")
  .in("id", enrolledClassIds)
  .in("instructor_id", [wrongInstructorId, correctInstructorId])
  .eq("subject_code", "SCIENCE7")
  .eq("class_type_code", "REGULAR_MULTI")
  .in("weekday", [3, 6])
  .gte("start_time", "17:00:00")
  .lt("start_time", "20:00:00");
if (candidateError) throw candidateError;

const wrongClasses = candidateClasses.filter(
  (row) => row.instructor_id === wrongInstructorId && slots.has(slotKey(row)) && row.created_at >= "2026-07-19T10:30:00Z"
);
const correctBySlot = new Map(
  candidateClasses
    .filter((row) => row.instructor_id === correctInstructorId && slots.has(slotKey(row)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((row) => [slotKey(row), row])
);

if (wrongClasses.length === 0) {
  console.log(JSON.stringify({ status: "already-repaired", wrongClassCount: 0 }, null, 2));
  process.exit(0);
}
if (wrongClasses.length !== 6) throw new Error(`예상한 잘못된 수업 6개 대신 ${wrongClasses.length}개를 찾았습니다`);

const replacements = new Map();
for (const wrong of wrongClasses) {
  const correct = correctBySlot.get(slotKey(wrong));
  if (!correct) throw new Error(`${slotKey(wrong)}에 대응하는 유소연 수업을 찾지 못했습니다`);
  replacements.set(wrong.id, correct.id);
}

const wrongIds = [...replacements.keys()];
const { data: wrongEnrollments, error: wrongEnrollmentError } = await db
  .from("class_enrollments")
  .select("class_id,student_id")
  .in("class_id", wrongIds);
if (wrongEnrollmentError) throw wrongEnrollmentError;
if (wrongEnrollments.some((row) => row.student_id !== student.id)) {
  throw new Error("잘못 생성된 수업에 김나린 외 학생이 연결되어 있어 자동 교정을 중단했습니다");
}

const { data: groups, error: groupError } = await db
  .from("timetable_groups")
  .select("id,name,class_ids,snapshot_events")
  .overlaps("class_ids", wrongIds);
if (groupError) throw groupError;

const report = {
  status: apply ? "applying" : "dry-run",
  student: student.student_name,
  replacements: wrongClasses.map((row) => ({
    weekday: row.weekday,
    startTime: row.start_time,
    fromClassId: row.id,
    toClassId: replacements.get(row.id)
  })),
  affectedGroups: groups.map((group) => ({ id: group.id, name: group.name }))
};

if (!apply) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

for (const wrong of wrongClasses) {
  const correctId = replacements.get(wrong.id);
  const correct = candidateClasses.find((row) => row.id === correctId);
  if (correct && wrong.active_from < correct.active_from) {
    const { error } = await db.from("classes").update({ active_from: wrong.active_from }).eq("id", correctId);
    if (error) throw error;
  }
}

for (const group of groups) {
  const classIds = [...new Set(group.class_ids.map((id) => replacements.get(id) ?? id))];
  const snapshotEvents = Array.isArray(group.snapshot_events)
    ? group.snapshot_events.map((event) => {
        if (!event || typeof event !== "object" || typeof event.id !== "string") return event;
        return replacements.has(event.id) ? { ...event, id: replacements.get(event.id), instructorId: correctInstructorId, instructorName: "유소연" } : event;
      })
    : group.snapshot_events;
  const { error } = await db.from("timetable_groups").update({ class_ids: classIds, snapshot_events: snapshotEvents }).eq("id", group.id);
  if (error) throw error;
}

const { error: deleteError } = await db.from("classes").delete().in("id", wrongIds);
if (deleteError) throw deleteError;

console.log(JSON.stringify({ ...report, status: "repaired" }, null, 2));
