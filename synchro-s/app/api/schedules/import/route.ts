import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { insertSaveHistory } from "@/lib/server/saveHistory";
import { importScheduleRow, INSTRUCTOR_DAY_OFF_MESSAGE } from "@/lib/server/scheduleService";
import type { CreateScheduleRequest } from "@/types/schedule";
import { NextResponse } from "next/server";

type ImportBatchRequest = {
  items: CreateScheduleRequest[];
  targetType?: "학생" | "강사";
  targetName?: string;
};

function isImportBatchRequest(payload: unknown): payload is ImportBatchRequest {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  return Array.isArray((payload as { items?: unknown }).items);
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

    const payload = (await req.json()) as CreateScheduleRequest | ImportBatchRequest;

    if (isImportBatchRequest(payload)) {
      const results = [];
      for (const item of payload.items) {
        results.push(await importScheduleRow(supabase, item, user.id));
      }
      if (results.some((result) => result.status === "created" || result.status === "enrolled" || result.status === "existing")) {
        try {
          await insertSaveHistory(supabase, payload.targetType, payload.targetName);
        } catch (historyError) {
          console.error("[save-history] insert failed", historyError);
        }
      }
      return NextResponse.json({ results });
    }

    const result = await importScheduleRow(supabase, payload, user.id);

    if (result.status === "conflict") {
      return NextResponse.json(result, { status: 409 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (errorMessage(error) === INSTRUCTOR_DAY_OFF_MESSAGE) {
      return jsonError(INSTRUCTOR_DAY_OFF_MESSAGE, 400);
    }
    return jsonError(errorMessage(error), 500);
  }
}
