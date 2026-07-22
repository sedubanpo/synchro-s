import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase environment variables are required.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

const expectedRanges = [
  [1, "MATH", "안준성", 10, 14],
  [2, "MATH", "박은채", 10, 14],
  [2, "ENGLISH", "송경석", 15, 17],
  [2, "KOREAN", "남종언", 18, 22],
  [3, "MATH", "안준성", 10, 14],
  [3, "MATH", "김미라", 15, 17],
  [3, "SCIENCE7", "유소연", 17, 20],
  [4, "MATH", "박은채", 10, 14],
  [4, "MATH", "김미라", 15, 17],
  [5, "MATH", "김미라", 10, 13],
  [5, "ENGLISH", "송경석", 14, 16],
  [6, "MATH", "박은채", 12, 14],
  [6, "MATH", "안준성", 14, 16],
  [6, "SCIENCE7", "유소연", 17, 20],
  [7, "KOREAN", "남종언", 12, 15]
];

function key(weekday, subjectCode, instructorName, startHour) {
  const start = `${String(startHour).padStart(2, "0")}:00`;
  const end = `${String(startHour + 1).padStart(2, "0")}:00`;
  return `${weekday}|${start}|${end}|${subjectCode}|${instructorName}`;
}

const expected = new Set(
  expectedRanges.flatMap(([weekday, subjectCode, instructorName, startHour, endHour]) =>
    Array.from({ length: endHour - startHour }, (_, offset) =>
      key(weekday, subjectCode, instructorName, startHour + offset)
    )
  )
);

const { data: student, error: studentError } = await supabase
  .from("students")
  .select("id")
  .eq("student_name", "김나린")
  .single();
if (studentError) throw studentError;

const { data: tag, error: tagError } = await supabase
  .from("schedule_tags")
  .select("id")
  .eq("name", "여름방학A")
  .single();
if (tagError) throw tagError;

const { data: group, error: groupError } = await supabase
  .from("timetable_groups")
  .select("id,class_ids")
  .eq("role_view", "student")
  .eq("target_id", student.id)
  .eq("tag_id", tag.id)
  .eq("week_start", "2026-07-13")
  .single();
if (groupError) throw groupError;

const { data: classes, error: classesError } = await supabase
  .from("classes")
  .select("id,weekday,start_time,end_time,subject_code,instructors(instructor_name)")
  .in("id", group.class_ids);
if (classesError) throw classesError;

const actual = new Set(
  (classes ?? []).map((item) =>
    `${item.weekday}|${item.start_time.slice(0, 5)}|${item.end_time.slice(0, 5)}|${item.subject_code}|${item.instructors?.instructor_name ?? ""}`
  )
);
const missing = [...expected].filter((item) => !actual.has(item));
const unexpected = [...actual].filter((item) => !expected.has(item));

if (expected.size !== 44 || actual.size !== 44 || missing.length > 0 || unexpected.length > 0) {
  throw new Error(
    `김나린 원본 시간표 대조 실패: expected=${expected.size}, actual=${actual.size}, missing=${missing.join(",")}, unexpected=${unexpected.join(",")}`
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      student: "김나린",
      tag: "여름방학A",
      weekStart: "2026-07-13",
      groupId: group.id,
      verifiedCells: actual.size
    },
    null,
    2
  )
);
