import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase environment variables are required.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

async function findSingle(table, nameColumn, name) {
  const { data, error } = await supabase.from(table).select("*").eq(nameColumn, name).limit(1).single();
  if (error) throw error;
  return data;
}

const [student, instructor, tag] = await Promise.all([
  findSingle("students", "student_name", "최시영"),
  findSingle("instructors", "instructor_name", "박경훈"),
  findSingle("schedule_tags", "name", "여름방학A")
]);

const { data: groups, error: groupsError } = await supabase
  .from("timetable_groups")
  .select("id,week_start,is_active,class_ids")
  .eq("role_view", "student")
  .eq("target_id", student.id)
  .eq("tag_id", tag.id)
  .eq("is_active", true)
  .order("week_start", { ascending: false });

if (groupsError) throw groupsError;
const activeGroup = groups?.[0];
if (!activeGroup) throw new Error("최시영의 여름방학A 활성 그룹을 찾지 못했습니다.");

const { data: classes, error: classesError } = await supabase
  .from("classes")
  .select("id,weekday,start_time,end_time,active_from,instructor_id")
  .in("id", activeGroup.class_ids ?? [])
  .eq("instructor_id", instructor.id)
  .order("weekday")
  .order("start_time");

if (classesError) throw classesError;
if ((classes ?? []).length !== 4) {
  throw new Error(`박경훈T 연결 수업은 4칸이어야 하지만 ${(classes ?? []).length}칸입니다.`);
}

const expectedSlots = new Set(["4:13:00:00", "4:14:00:00", "7:18:00:00", "7:19:00:00"]);
for (const item of classes ?? []) {
  expectedSlots.delete(`${item.weekday}:${item.start_time}`);
}
if (expectedSlots.size > 0) {
  throw new Error(`박경훈T 연결 수업 누락: ${[...expectedSlots].join(", ")}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      student: student.student_name,
      instructor: instructor.instructor_name,
      tag: tag.name,
      activeWeekStart: activeGroup.week_start,
      linkedClassCount: classes.length
    },
    null,
    2
  )
);
