import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import type { Weekday } from "@/types/schedule";
import { NextResponse } from "next/server";

type AvailabilityPayload = {
  availableTimeSlots?: string[];
  availableTimeSlotsByDay?: Partial<Record<string, string[]>>;
};

function normalizeAvailableTimeSlots(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new Error("가능 시간 데이터 형식이 올바르지 않습니다.");
  }

  const normalized = Array.from(
    new Set(
      input
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => /^\d{2}:\d{2}$/.test(value))
    )
  ).sort((a, b) => a.localeCompare(b));

  if (normalized.length !== input.length) {
    throw new Error("가능 시간은 HH:mm 형식으로만 저장할 수 있습니다.");
  }

  return normalized;
}

function normalizeAvailableTimeSlotsByDay(input: unknown): Partial<Record<Weekday, string[]>> {
  if (input == null) {
    return {};
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("요일별 가능 시간 데이터 형식이 올바르지 않습니다.");
  }

  const normalized: Partial<Record<Weekday, string[]>> = {};

  for (const [rawWeekday, rawSlots] of Object.entries(input)) {
    const weekday = Number(rawWeekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      throw new Error("요일별 가능 시간은 월요일(1)부터 일요일(7)까지만 저장할 수 있습니다.");
    }

    const slots = normalizeAvailableTimeSlots(rawSlots);
    if (slots.length > 0) {
      normalized[weekday as Weekday] = slots;
    }
  }

  return normalized;
}

function flattenAvailableTimeSlots(byDay: Partial<Record<Weekday, string[]>>, fallback: string[]): string[] {
  const merged = new Set<string>();

  for (const slots of Object.values(byDay)) {
    for (const slot of slots ?? []) {
      merged.add(slot);
    }
  }

  if (merged.size === 0) {
    for (const slot of fallback) {
      merged.add(slot);
    }
  }

  return [...merged].sort((a, b) => a.localeCompare(b));
}

async function findOwnInstructorId(supabase: any, userId: string, fullName?: string | null): Promise<string | null> {
  const byUser = await supabase.from("instructors").select("id").eq("user_id", userId).maybeSingle();
  if (!byUser.error && byUser.data?.id) {
    return byUser.data.id as string;
  }

  const normalizedName = (fullName ?? "").replace(/^\/+/, "").replace(/\s+/g, "").trim().toLowerCase();
  if (!normalizedName) {
    return null;
  }

  const byName = await supabase.from("instructors").select("id,instructor_name").eq("is_active", true);
  if (byName.error) {
    throw byName.error;
  }

  const match =
    (byName.data ?? []).find(
      (row: { instructor_name: string }) =>
        row.instructor_name.replace(/^\/+/, "").replace(/\s+/g, "").trim().toLowerCase() === normalizedName
    ) ??
    (byName.data ?? []).find((row: { instructor_name: string }) => {
      const rowName = row.instructor_name.replace(/^\/+/, "").replace(/\s+/g, "").trim().toLowerCase();
      return rowName.includes(normalizedName) || normalizedName.includes(rowName);
    });

  return (match?.id as string | undefined) ?? null;
}

function isMissingByDayColumn(error: unknown): boolean {
  const message = `${(error as { message?: string })?.message ?? ""} ${(error as { details?: string })?.details ?? ""}`;
  return message.includes("available_time_slots_by_day");
}

function isMissingLegacyColumn(error: unknown): boolean {
  const message = `${(error as { message?: string })?.message ?? ""} ${(error as { details?: string })?.details ?? ""}`;
  return /['"]available_time_slots['"]/.test(message) || message.includes(" available_time_slots ");
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

    const ownInstructorId =
      (profile as { instructor_id?: string | null }).instructor_id ??
      (profile.role === "instructor"
        ? await findOwnInstructorId(supabase, user.id, (profile as { full_name?: string | null }).full_name ?? "")
        : null);

    const canEditOwnAvailability = profile.role === "instructor" && ownInstructorId === params.id;
    if (!canManageSchedules(profile.role) && !canEditOwnAvailability) {
      return jsonError("Forbidden", 403);
    }

    const payload = (await req.json()) as AvailabilityPayload;
    const normalizedByDay = normalizeAvailableTimeSlotsByDay(payload.availableTimeSlotsByDay ?? {});
    const normalizedLegacySlots = normalizeAvailableTimeSlots(payload.availableTimeSlots ?? []);
    const flattenedSlots = flattenAvailableTimeSlots(normalizedByDay, normalizedLegacySlots);

    const primary = await supabase
      .from("instructors")
      .update({
        available_time_slots: flattenedSlots,
        available_time_slots_by_day: normalizedByDay
      })
      .eq("id", params.id)
      .select("id,available_time_slots,available_time_slots_by_day")
      .single();

    let data = primary.data;
    let error = primary.error;

    if (error && isMissingLegacyColumn(error) && !isMissingByDayColumn(error)) {
      const byDayOnly = await supabase
        .from("instructors")
        .update({
          available_time_slots_by_day: normalizedByDay
        })
        .eq("id", params.id)
        .select("id,available_time_slots_by_day")
        .single();

      data = byDayOnly.data
        ? {
            ...byDayOnly.data,
            available_time_slots: flattenedSlots
          }
        : null;
      error = byDayOnly.error;
    }

    if (error || !data) {
      if (isMissingByDayColumn(error) && !isMissingLegacyColumn(error)) {
        const legacyOnly = await supabase
          .from("instructors")
          .update({
            available_time_slots: flattenedSlots
          })
          .eq("id", params.id)
          .select("id,available_time_slots")
          .single();

        data = legacyOnly.data
          ? {
              ...legacyOnly.data,
              available_time_slots_by_day: normalizedByDay
            }
          : null;
        error = legacyOnly.error;
      }
    }

    if (error || !data) {
      if (isMissingByDayColumn(error) && !isMissingLegacyColumn(error)) {
        return jsonError(
          "instructors.available_time_slots_by_day 컬럼이 없습니다. Supabase에 0008_instructor_available_time_slots_by_day.sql 마이그레이션을 적용해 주세요.",
          400
        );
      }
      if (isMissingLegacyColumn(error) && !isMissingByDayColumn(error)) {
        return jsonError(
          "instructors.available_time_slots 컬럼이 없습니다. 운영 DB에 0007_instructor_available_time_slots.sql이 누락된 상태입니다. 현재 코드는 0008만으로도 저장되도록 보정됐으니, 이 메시지가 계속 보이면 새 배포가 반영됐는지 확인해 주세요.",
          400
        );
      }
      throw error ?? new Error("강사 가능 시간 저장에 실패했습니다.");
    }

    const resolvedByDay = normalizeAvailableTimeSlotsByDay(data.available_time_slots_by_day ?? {});
    const resolvedSlots = flattenAvailableTimeSlots(
      resolvedByDay,
      normalizeAvailableTimeSlots(data.available_time_slots ?? flattenedSlots)
    );

    return NextResponse.json({
      id: data.id,
      availableTimeSlots: resolvedSlots,
      availableTimeSlotsByDay: resolvedByDay
    });
  } catch (error) {
    return jsonError(errorMessage(error), 400);
  }
}
