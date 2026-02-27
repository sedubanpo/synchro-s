import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AppUserRole = "admin" | "coordinator" | "instructor" | "student";

export async function getAuthenticatedProfile() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, user: null, profile: null, authError: authError?.message ?? null } as const;
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, role, full_name")
    .eq("id", user.id)
    .single();

  return { supabase, user, profile, profileError: profileError?.message ?? null } as const;
}

export function canManageSchedules(role?: AppUserRole | null): boolean {
  return role === "admin" || role === "coordinator";
}
