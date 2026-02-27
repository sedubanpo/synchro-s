import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { createScheduleWithEnrollments } from "@/lib/server/scheduleService";
import type { CreateScheduleRequest } from "@/types/schedule";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) {
      return jsonError("Unauthorized", 401);
    }

    if (!profile) {
      return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    }

    if (!canManageSchedules(profile.role)) {
      return jsonError("Forbidden", 403);
    }

    const payload = (await req.json()) as CreateScheduleRequest;
    const result = await createScheduleWithEnrollments(supabase, payload, user.id);

    if (result.conflict.hasConflict) {
      return NextResponse.json(result, { status: 409 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
