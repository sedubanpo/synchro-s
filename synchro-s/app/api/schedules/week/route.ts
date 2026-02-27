import { errorMessage, jsonError } from "@/lib/http";
import { getAuthenticatedProfile } from "@/lib/server/auth";
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

    if (profile.role === "instructor") {
      instructorId = await findInstructorIdByUserId(supabase, user.id);
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

    return NextResponse.json(response);
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
