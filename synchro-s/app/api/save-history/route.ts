import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { fetchRecentSaveHistory, insertSaveHistory } from "@/lib/server/saveHistory";
import { getStaffAttribution } from "@/lib/server/staffAttribution";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) {
      return jsonError("Unauthorized", 401);
    }

    if (!profile) {
      return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    }

    const items = await fetchRecentSaveHistory(supabase, 20);
    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();
    if (!user) return jsonError("Unauthorized", 401);
    if (!profile) return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    if (!canManageSchedules(profile.role)) return jsonError("Forbidden", 403);

    const payload = (await req.json()) as {
      targetType?: "학생" | "강사";
      targetName?: string;
      tagId?: string | null;
    };
    if (!payload.targetType || !payload.targetName?.trim()) return jsonError("Invalid save history payload", 400);

    await insertSaveHistory(
      supabase,
      payload.targetType,
      payload.targetName,
      payload.tagId ?? null,
      "student_timetable",
      getStaffAttribution(user, profile)
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
