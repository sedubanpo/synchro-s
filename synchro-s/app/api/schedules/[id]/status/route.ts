import { errorMessage, jsonError } from "@/lib/http";
import { getAuthenticatedProfile } from "@/lib/server/auth";
import { updateScheduleStatus } from "@/lib/server/scheduleService";
import type { ScheduleStatus, UpdateScheduleStatusRequest } from "@/types/schedule";
import { NextResponse } from "next/server";

const ALLOWED_STATUS: ScheduleStatus[] = ["planned", "confirmed", "completed", "cancelled"];

export async function PATCH(req: Request, { params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = await pendingParams;
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) {
      return jsonError("Unauthorized", 401);
    }

    if (!profile) {
      return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    }

    const payload = (await req.json()) as UpdateScheduleStatusRequest;

    if (!ALLOWED_STATUS.includes(payload.status)) {
      return jsonError("Invalid status value", 400);
    }

    if (profile.role === "student") {
      return jsonError("Forbidden", 403);
    }

    // Sheet/Firebase sessions use a service-role client, so RLS cannot enforce ownership here.
    if (profile.role === "instructor") {
      let ownInstructorId = (profile as { instructor_id?: string | null }).instructor_id;
      if (!ownInstructorId) {
        const { data: instructor, error } = await supabase.from("instructors").select("id").eq("user_id", user.id).maybeSingle();
        if (error) throw error;
        ownInstructorId = instructor?.id;
      }
      if (!ownInstructorId) return jsonError("Forbidden", 403);
      const { data: lesson, error } = await supabase.from("classes").select("instructor_id").eq("id", params.id).maybeSingle();
      if (error) throw error;
      if (!lesson || lesson.instructor_id !== ownInstructorId) return jsonError("Forbidden", 403);
    }

    const updated = await updateScheduleStatus(supabase, params.id, payload.status, user.id, payload.reason);
    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
