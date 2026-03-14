import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { fetchRecentConflictLogs, insertConflictLogs } from "@/lib/server/conflictLogs";
import type { ConflictLogCreateInput, ConflictLogEntry, Weekday } from "@/types/schedule";
import { NextResponse } from "next/server";

type ConflictLogsPayload = {
  items?: ConflictLogCreateInput[];
};

export async function GET() {
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

    const items = await fetchRecentConflictLogs(supabase, 200);
    const mapped: ConflictLogEntry[] = items.map((item) => ({
      id: item.id,
      createdAt: item.created_at,
      weekStart: item.week_start,
      targetType: item.target_type,
      targetName: item.target_name,
      studentName: item.student_name,
      instructorName: item.instructor_name,
      weekday: item.weekday as Weekday,
      startTime: item.start_time,
      endTime: item.end_time,
      reason: item.reason,
      details: item.details,
      source: item.source,
      rawText: item.raw_text
    }));

    return NextResponse.json({ items: mapped });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

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

    const payload = (await req.json()) as ConflictLogsPayload;
    await insertConflictLogs(supabase, payload.items ?? []);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error), 400);
  }
}
