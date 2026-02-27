import { errorMessage, jsonError } from "@/lib/http";
import { getAuthenticatedProfile, canManageSchedules } from "@/lib/server/auth";
import { checkScheduleConflict } from "@/lib/server/scheduleService";
import type { CheckConflictRequest } from "@/types/schedule";
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

    const payload = (await req.json()) as CheckConflictRequest;
    const conflict = await checkScheduleConflict(supabase, payload);

    return NextResponse.json(conflict);
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
