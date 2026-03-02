type SupabaseLike = {
  from: (table: string) => any;
};

export async function insertSaveHistory(
  supabase: SupabaseLike,
  targetType?: string | null,
  targetName?: string | null
): Promise<void> {
  if ((targetType !== "학생" && targetType !== "강사") || !targetName?.trim()) {
    return;
  }

  const { error } = await supabase.from("save_history").insert({
    target_type: targetType,
    target_name: targetName.trim()
  });

  if (error) {
    throw error;
  }
}

export async function fetchRecentSaveHistory(supabase: SupabaseLike, limit = 20) {
  const { data, error } = await supabase
    .from("save_history")
    .select("id,created_at,target_type,target_name")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as {
    id: string;
    created_at: string;
    target_type: "학생" | "강사";
    target_name: string;
  }[];
}
