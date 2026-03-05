import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { getSessionCookieName, verifySessionToken } from "@/lib/server/sessionToken";

export type AppUserRole = "admin" | "coordinator" | "instructor" | "student";

export async function getAuthenticatedProfile() {
  const serverSupabase = await createSupabaseServerClient();
  const cookieStore = cookies();
  const sheetSession = verifySessionToken(cookieStore.get(getSessionCookieName())?.value);
  if (sheetSession) {
    // Sheet session has no Supabase auth JWT, so use service-role client to avoid RLS empty reads.
    const adminSupabase = createSupabaseAdminClient();
    const supabase = adminSupabase ?? serverSupabase;
    return {
      supabase,
      user: { id: `sheet:${sheetSession.instructorId ?? sheetSession.fullName}` },
      profile: {
        id: sheetSession.instructorId ?? `sheet-profile:${sheetSession.fullName}`,
        role: sheetSession.role as AppUserRole,
        full_name: sheetSession.fullName,
        auth_source: "sheet",
        instructor_id: sheetSession.instructorId ?? null
      },
      profileError: null
    } as const;
  }

  const {
    data: { user },
    error: authError
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return { supabase: serverSupabase, user: null, profile: null, authError: authError?.message ?? null } as const;
  }

  const { data: profile, error: profileError } = await serverSupabase
    .from("users")
    .select("id, role, full_name")
    .eq("id", user.id)
    .single();

  return { supabase: serverSupabase, user, profile, profileError: profileError?.message ?? null } as const;
}

export function canManageSchedules(role?: AppUserRole | null): boolean {
  return role === "admin" || role === "coordinator";
}
