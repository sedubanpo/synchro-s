import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { NextResponse } from "next/server";

type DaysOffPayload = {
  daysOff?: number[];
};

function normalizeDaysOff(input: unknown): number[] {
  if (!Array.isArray(input)) {
    throw new Error("휴무일 데이터 형식이 올바르지 않습니다.");
  }

  const normalized = Array.from(
    new Set(
      input
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7)
    )
  ).sort((a, b) => a - b);

  if (normalized.length !== input.length) {
    throw new Error("휴무일은 월요일(1)부터 일요일(7)까지만 저장할 수 있습니다.");
  }

  return normalized;
}

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

    const payload = (await req.json()) as DaysOffPayload;
    const daysOff = normalizeDaysOff(payload.daysOff ?? []);

    const { data, error } = await supabase
      .from("instructors")
      .update({
        days_off: daysOff
      })
      .eq("id", params.id)
      .select("id,days_off")
      .single();

    if (error || !data) {
      throw error ?? new Error("강사 휴무일 저장에 실패했습니다.");
    }

    return NextResponse.json({
      id: data.id,
      daysOff: (data.days_off ?? []) as number[]
    });
  } catch (error) {
    return jsonError(errorMessage(error), 400);
  }
}
