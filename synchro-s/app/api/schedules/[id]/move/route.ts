import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { moveScheduleSlot } from "@/lib/server/scheduleService";
import { NextResponse } from "next/server";

type MovePayload = {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  startTime: string;
  weekStart: string;
};

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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

    const payload = (await req.json()) as MovePayload;
    const result = await moveScheduleSlot(supabase, params.id, payload, user.id);

    if (!result.moved && result.conflict.hasConflict) {
      return NextResponse.json(result, { status: 409 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
