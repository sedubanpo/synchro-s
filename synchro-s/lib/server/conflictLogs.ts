import type { ConflictLogCreateInput } from "@/types/schedule";

type SupabaseLike = {
  from: (table: string) => any;
};

export async function insertConflictLogs(
  supabase: SupabaseLike,
  items: ConflictLogCreateInput[]
): Promise<void> {
  const rows = items
    .filter(
      (item) =>
        item.studentName.trim() &&
        item.reason.trim() &&
        item.source.trim() &&
        /^\d{2}:\d{2}$/.test(item.startTime) &&
        /^\d{2}:\d{2}$/.test(item.endTime) &&
        item.weekday >= 1 &&
        item.weekday <= 7
    )
    .map((item) => ({
      week_start: item.weekStart ?? null,
      target_type: item.targetType ?? null,
      target_name: item.targetName?.trim() || null,
      student_name: item.studentName.trim(),
      instructor_name: item.instructorName?.trim() || null,
      weekday: item.weekday,
      start_time: item.startTime,
      end_time: item.endTime,
      reason: item.reason.trim(),
      details: item.details?.trim() || null,
      source: item.source.trim(),
      raw_text: item.rawText?.trim() || null
    }));

  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase.from("schedule_conflict_logs").insert(rows);
  if (error) {
    throw error;
  }
}

export async function fetchRecentConflictLogs(supabase: SupabaseLike, limit = 200) {
  const { data, error } = await supabase
    .from("schedule_conflict_logs")
    .select("id,created_at,week_start,target_type,target_name,student_name,instructor_name,weekday,start_time,end_time,reason,details,source,raw_text")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as {
    id: string;
    created_at: string;
    week_start: string | null;
    target_type: "학생" | "강사" | null;
    target_name: string | null;
    student_name: string;
    instructor_name: string | null;
    weekday: number;
    start_time: string;
    end_time: string;
    reason: string;
    details: string | null;
    source: string;
    raw_text: string | null;
  }[];
}
