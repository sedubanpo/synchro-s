import { errorMessage, jsonError } from "@/lib/http";
import { getAuthenticatedProfile } from "@/lib/server/auth";
import { updateScheduleStatus } from "@/lib/server/scheduleService";
import type { ScheduleStatus, UpdateScheduleStatusRequest } from "@/types/schedule";
import { NextResponse } from "next/server";

const ALLOWED_STATUS: ScheduleStatus[] = ["planned", "confirmed", "completed", "cancelled"];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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

    const updated = await updateScheduleStatus(supabase, params.id, payload.status, user.id, payload.reason);
    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
