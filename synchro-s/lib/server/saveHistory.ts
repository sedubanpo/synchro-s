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

export type SaveHistorySource = "student_timetable" | "schedule_creation";

const SCHEDULE_CREATION_PREFIX = "__schedule_creation__:";

function encodeTargetName(targetName: string, source: SaveHistorySource): string {
  return source === "schedule_creation" ? `${SCHEDULE_CREATION_PREFIX}${targetName.trim()}` : targetName.trim();
}

function decodeTargetName(targetName: string): { targetName: string; source: SaveHistorySource } {
  return targetName.startsWith(SCHEDULE_CREATION_PREFIX)
    ? { targetName: targetName.slice(SCHEDULE_CREATION_PREFIX.length), source: "schedule_creation" }
    : { targetName, source: "student_timetable" };
}

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
  tagId?: string | null,
  source: SaveHistorySource = "student_timetable"
): Promise<void> {
  if ((targetType !== "학생" && targetType !== "강사") || !targetName?.trim()) {
    return;
  }

  const { error } = await supabase.from("save_history").insert({
    target_type: targetType,
    target_name: encodeTargetName(targetName, source),
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
  const decodedRows = rows.map((row) => ({ row, ...decodeTargetName(row.target_name) }));
  const studentNames = Array.from(new Set(decodedRows.filter(({ row }) => row.target_type === "학생").map(({ targetName }) => targetName)));
  const instructorNames = Array.from(new Set(decodedRows.filter(({ row }) => row.target_type === "강사").map(({ targetName }) => targetName)));
  const [studentResult, instructorResult] = await Promise.all([
    studentNames.length > 0
      ? supabase.from("students").select("id,student_name").in("student_name", studentNames)
      : Promise.resolve({ data: [], error: null }),
    instructorNames.length > 0
      ? supabase.from("instructors").select("id,instructor_name").in("instructor_name", instructorNames)
      : Promise.resolve({ data: [], error: null })
  ]);
  const studentRows = (studentResult.error ? [] : (studentResult.data ?? [])) as { id: string; student_name: string }[];
  const instructorRows = (instructorResult.error ? [] : (instructorResult.data ?? [])) as { id: string; instructor_name: string }[];

  const studentTargets = studentRows.map((row) => ({
    id: row.id,
    name: row.student_name
  }));
  const instructorTargets = instructorRows.map((row) => ({
    id: row.id,
    name: row.instructor_name
  }));

  return decodedRows.map(({ row, targetName, source }) => ({
    ...row,
    target_name: targetName,
    source,
    tag_name: Array.isArray(row.schedule_tags) ? row.schedule_tags[0]?.name ?? null : row.schedule_tags?.name ?? null,
    target_id:
      row.target_type === "학생"
        ? findTargetId(studentTargets, targetName)
        : findTargetId(instructorTargets, targetName)
  }));
}
