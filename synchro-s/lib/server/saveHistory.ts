import { fetchAllSupabaseRows } from "@/lib/server/supabasePagination";

type SupabaseLike = {
  from: (table: string) => any;
};

type SaveHistoryRow = {
  id: string;
  created_at: string;
  target_type: "학생" | "강사";
  target_name: string;
  target_id?: string | null;
  tag_id?: string | null;
  schedule_tags?: { name?: string | null } | { name?: string | null }[] | null;
};

function normalizeTargetName(value: string): string {
  return value
    .replace(/T$/i, "")
    .replace(/^\/+/, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();
}

function findTargetId(
  items: { id: string; name: string }[],
  targetName: string
): string | null {
  const target = normalizeTargetName(targetName);
  if (!target) {
    return null;
  }

  const exact = items.find((item) => normalizeTargetName(item.name) === target);
  if (exact) {
    return exact.id;
  }

  const partial = items.find((item) => {
    const token = normalizeTargetName(item.name);
    return Boolean(token) && (token.includes(target) || target.includes(token));
  });
  return partial?.id ?? null;
}

export async function insertSaveHistory(
  supabase: SupabaseLike,
  targetType?: string | null,
  targetName?: string | null,
  tagId?: string | null
): Promise<void> {
  if ((targetType !== "학생" && targetType !== "강사") || !targetName?.trim()) {
    return;
  }

  const { error } = await supabase.from("save_history").insert({
    target_type: targetType,
    target_name: targetName.trim(),
    tag_id: tagId?.trim() || null
  });

  if (error) {
    throw error;
  }
}

export async function fetchRecentSaveHistory(supabase: SupabaseLike, limit = 20) {
  const { data, error } = await supabase
    .from("save_history")
    .select("id,created_at,target_type,target_name,tag_id,schedule_tags(name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as SaveHistoryRow[];

  // Target resolution is supplemental metadata. Preserve save-history rendering
  // even when either roster lookup is temporarily unavailable.
  const [studentRows, instructorRows] = await Promise.all([
    fetchAllSupabaseRows<{ id: string; student_name: string }>(async (from, to) => {
      const result = await supabase.from("students").select("id,student_name").order("id").range(from, to);
      return {
        data: (result.data ?? []) as { id: string; student_name: string }[],
        error: result.error
      };
    }).catch(() => []),
    fetchAllSupabaseRows<{ id: string; instructor_name: string }>(async (from, to) => {
      const result = await supabase.from("instructors").select("id,instructor_name").order("id").range(from, to);
      return {
        data: (result.data ?? []) as { id: string; instructor_name: string }[],
        error: result.error
      };
    }).catch(() => [])
  ]);

  const studentTargets = studentRows.map((row) => ({
    id: row.id,
    name: row.student_name
  }));
  const instructorTargets = instructorRows.map((row) => ({
    id: row.id,
    name: row.instructor_name
  }));

  return rows.map((row) => ({
    ...row,
    tag_name: Array.isArray(row.schedule_tags) ? row.schedule_tags[0]?.name ?? null : row.schedule_tags?.name ?? null,
    target_id:
      row.target_type === "학생"
        ? findTargetId(studentTargets, row.target_name)
        : findTargetId(instructorTargets, row.target_name)
  }));
}
