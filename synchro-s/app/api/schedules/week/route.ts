import { errorMessage, jsonError } from "@/lib/http";
import { getAuthenticatedProfile } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchWeeklySchedule } from "@/lib/server/scheduleService";
import type { RoleView } from "@/types/schedule";
import { NextResponse } from "next/server";

async function findInstructorIdByUserId(supabase: any, userId: string) {
  const { data } = await supabase.from("instructors").select("id").eq("user_id", userId).single();
  return (data?.id as string | undefined) ?? null;
}

async function findStudentIdByUserId(supabase: any, userId: string) {
  const { data } = await supabase.from("students").select("id").eq("user_id", userId).single();
  return (data?.id as string | undefined) ?? null;
}

export async function GET(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) {
      return jsonError("Unauthorized", 401);
    }

    if (!profile) {
      return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    }

    const { searchParams } = new URL(req.url);
    const weekStart = searchParams.get("weekStart");
    const view = (searchParams.get("view") ?? "student") as RoleView;
    let instructorId = searchParams.get("instructorId");
    let studentId = searchParams.get("studentId");

    if (!weekStart) {
      return jsonError("weekStart is required (YYYY-MM-DD)", 400);
    }

    if (view !== "instructor" && view !== "student") {
      return jsonError("view must be instructor or student", 400);
    }

    const profileInstructorId =
      (profile as { instructor_id?: string | null }).instructor_id ?? null;

    if (profile.role === "instructor") {
      instructorId = profileInstructorId || (await findInstructorIdByUserId(supabase, user.id));
      if (!instructorId) {
        return jsonError("No instructor profile linked to this account", 400);
      }
    }

    if (profile.role === "student") {
      studentId = await findStudentIdByUserId(supabase, user.id);
      if (!studentId) {
        return jsonError("No student profile linked to this account", 400);
      }
    }

    const response = await fetchWeeklySchedule(supabase, {
      weekStart,
      view,
      instructorId,
      studentId
    });

    if (profile.role === "instructor" && instructorId) {
      try {
        const adminSupabase = createSupabaseAdminClient();
        if (!adminSupabase) {
          throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for instructor view logging.");
        }
        await adminSupabase.from("instructor_schedule_view_logs").insert({
          instructor_id: instructorId,
          week_start: weekStart,
          viewer_name: (profile as { full_name?: string | null }).full_name ?? null
        });
      } catch (logError) {
        console.error("[view-log] failed to insert instructor view log", logError);
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
