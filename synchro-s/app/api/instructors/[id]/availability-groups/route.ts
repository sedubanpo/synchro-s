import { TIME_SLOTS } from "@/lib/constants";
import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { normalizeInstructorAvailabilityDateOverrides as normalizeDateOverrides } from "@/lib/server/instructorAvailability";
import type {
  AvailableTimeSlotsByDay,
  InstructorAvailabilityDateOverrides,
  InstructorWeekdayNotes,
  Weekday
} from "@/types/schedule";
import { NextResponse } from "next/server";

type GroupCreatePayload = {
  monthStart: string;
  name: string;
  availableTimeSlotsByDay: AvailableTimeSlotsByDay;
  weekdayNotes?: InstructorWeekdayNotes;
  dateOverrides?: InstructorAvailabilityDateOverrides;
  isActive?: boolean;
};

type GroupMutationPayload =
  | {
      action: "save";
      id: string;
      name: string;
      availableTimeSlotsByDay: AvailableTimeSlotsByDay;
      weekdayNotes?: InstructorWeekdayNotes;
      dateOverrides?: InstructorAvailabilityDateOverrides;
    }
  | {
      action: "activate";
      id: string;
    };

const TIME_SLOT_SET = new Set(TIME_SLOTS);

function normalizeMonthStart(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-01$/.test(value)) {
    throw new Error("월 기준일은 YYYY-MM-01 형식이어야 합니다.");
  }
  return value;
}

function normalizeSlotsByDay(value: unknown): AvailableTimeSlotsByDay {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: AvailableTimeSlotsByDay = {};
  for (const [rawWeekday, rawSlots] of Object.entries(value)) {
    const weekday = Number(rawWeekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !Array.isArray(rawSlots)) {
      throw new Error("요일별 가능 시간 형식이 올바르지 않습니다.");
    }
    const slots = Array.from(
      new Set(
        rawSlots.map((slot) => (typeof slot === "string" ? slot.trim() : "")).filter((slot) => TIME_SLOT_SET.has(slot))
      )
    ).sort((a, b) => a.localeCompare(b));
    if (slots.length !== rawSlots.length) {
      throw new Error("가능 시간은 시간표의 정시 슬롯만 저장할 수 있습니다.");
    }
    if (slots.length > 0) normalized[weekday as Weekday] = slots;
  }
  return normalized;
}

function flattenSlots(slotsByDay: AvailableTimeSlotsByDay): string[] {
  return Array.from(new Set(Object.values(slotsByDay).flatMap((slots) => slots ?? []))).sort((a, b) => a.localeCompare(b));
}

function normalizeWeekdayNotes(value: unknown): InstructorWeekdayNotes {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("요일별 메모 형식이 올바르지 않습니다.");
  }

  const normalized: InstructorWeekdayNotes = {};
  for (const [rawWeekday, rawNote] of Object.entries(value)) {
    const weekday = Number(rawWeekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || typeof rawNote !== "string") {
      throw new Error("요일별 메모는 월요일(1)부터 일요일(7)까지 문자로 저장해야 합니다.");
    }
    const note = rawNote.trim();
    if (note.length > 120) throw new Error("요일별 메모는 120자 이하로 입력해 주세요.");
    if (note) normalized[weekday as Weekday] = note;
  }
  return normalized;
}

function mapGroup(row: any) {
  return {
    id: row.id,
    instructorId: row.instructor_id,
    monthStart: row.month_start,
    name: row.name,
    availableTimeSlotsByDay: normalizeSlotsByDay(row.available_time_slots_by_day),
    weekdayNotes: normalizeWeekdayNotes(row.weekday_notes),
    dateOverrides: normalizeDateOverrides(row.date_overrides, row.month_start),
    isActive: row.is_active === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = `${(error as { message?: string } | null)?.message ?? ""}`;
  return code === "42P01" || message.includes("instructor_availability_groups");
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = `${(error as { message?: string } | null)?.message ?? ""} ${(error as { details?: string } | null)?.details ?? ""}`;
  return code === "42703" || code === "PGRST204" || message.includes(columnName);
}

async function syncInstructorAvailability(supabase: any, instructorId: string, slotsByDay: AvailableTimeSlotsByDay) {
  const byDayResult = await supabase
    .from("instructors")
    .update({ available_time_slots_by_day: slotsByDay })
    .eq("id", instructorId);
  if (byDayResult.error && !isMissingColumnError(byDayResult.error, "available_time_slots_by_day")) {
    throw byDayResult.error;
  }

  const legacyResult = await supabase
    .from("instructors")
    .update({ available_time_slots: flattenSlots(slotsByDay) })
    .eq("id", instructorId);
  if (legacyResult.error && !isMissingColumnError(legacyResult.error, "available_time_slots")) {
    throw legacyResult.error;
  }

  if (byDayResult.error && legacyResult.error) {
    throw new Error("강사 가능 시간 컬럼을 찾지 못했습니다.");
  }
}

function normalizeNameToken(value: string): string {
  return value.replace(/^\/+/, "").replace(/\s+/g, "").trim().toLowerCase();
}

async function findOwnInstructorId(supabase: any, userId: string, fullName: string): Promise<string | null> {
  const byUser = await supabase.from("instructors").select("id").eq("user_id", userId).maybeSingle();
  if (byUser.data?.id) return byUser.data.id as string;

  const token = normalizeNameToken(fullName);
  if (!token) return null;
  const byName = await supabase.from("instructors").select("id,instructor_name").eq("is_active", true);
  const rows = (byName.data ?? []) as Array<{ id: string; instructor_name: string }>;
  const match =
    rows.find((row) => normalizeNameToken(row.instructor_name) === token) ??
    rows.find((row) => {
      const rowToken = normalizeNameToken(row.instructor_name);
      return rowToken.includes(token) || token.includes(rowToken);
    });
  return match?.id ?? null;
}

async function requireAvailabilityAccess(instructorId: string) {
  const auth = await getAuthenticatedProfile();
  if (!auth.user) throw new Error("UNAUTHORIZED");
  if (!auth.profile) throw new Error("FORBIDDEN");
  if (canManageSchedules(auth.profile.role)) return auth;

  const ownInstructorId =
    (auth.profile as { instructor_id?: string | null }).instructor_id ??
    (auth.profile.role === "instructor"
      ? await findOwnInstructorId(
          auth.supabase,
          auth.user.id,
          (auth.profile as { full_name?: string | null }).full_name ?? ""
        )
      : null);
  if (auth.profile.role !== "instructor" || ownInstructorId !== instructorId) throw new Error("FORBIDDEN");
  return auth;
}

function authErrorResponse(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
  if (error instanceof Error && error.message === "FORBIDDEN") return jsonError("Forbidden", 403);
  if (isMissingTableError(error)) {
    return jsonError("운영 DB에 강사 가능 일정 그룹 테이블이 없습니다. 0012 마이그레이션을 적용해 주세요.", 503);
  }
  return jsonError(errorMessage(error), 500);
}

export async function GET(req: Request, { params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = await pendingParams;
  try {
    const { supabase } = await requireAvailabilityAccess(params.id);
    const monthStart = normalizeMonthStart(new URL(req.url).searchParams.get("monthStart"));
    const { data, error } = await supabase
      .from("instructor_availability_groups")
      .select("id,instructor_id,month_start,name,available_time_slots_by_day,weekday_notes,date_overrides,is_active,created_at,updated_at")
      .eq("instructor_id", params.id)
      .eq("month_start", monthStart)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ items: (data ?? []).map(mapGroup) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(req: Request, { params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = await pendingParams;
  try {
    const { supabase, profile } = await requireAvailabilityAccess(params.id);
    const payload = (await req.json()) as GroupCreatePayload;
    const monthStart = normalizeMonthStart(payload.monthStart);
    const name = payload.name?.trim();
    if (!name) return jsonError("일정 이름을 입력해 주세요.", 400);
    const slotsByDay = normalizeSlotsByDay(payload.availableTimeSlotsByDay);
    const weekdayNotes = normalizeWeekdayNotes(payload.weekdayNotes);
    const dateOverrides = normalizeDateOverrides(payload.dateOverrides, monthStart);
    const setActive = payload.isActive !== false;

    if (setActive) {
      const { error: deactivateError } = await supabase
        .from("instructor_availability_groups")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("instructor_id", params.id)
        .eq("month_start", monthStart)
        .eq("is_active", true);
      if (deactivateError) throw deactivateError;
    }

    const { data, error } = await supabase
      .from("instructor_availability_groups")
      .insert({
        instructor_id: params.id,
        month_start: monthStart,
        name,
        available_time_slots_by_day: slotsByDay,
        weekday_notes: weekdayNotes,
        date_overrides: dateOverrides,
        is_active: setActive,
        created_by_name: (profile as { full_name?: string | null }).full_name ?? null,
        updated_at: new Date().toISOString()
      })
      .select("id,instructor_id,month_start,name,available_time_slots_by_day,weekday_notes,date_overrides,is_active,created_at,updated_at")
      .single();
    if (error || !data) throw error ?? new Error("가능 일정 저장 결과를 찾지 못했습니다.");
    if (setActive) await syncInstructorAvailability(supabase, params.id, slotsByDay);
    return NextResponse.json({ item: mapGroup(data) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(req: Request, { params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = await pendingParams;
  try {
    const { supabase } = await requireAvailabilityAccess(params.id);
    const payload = (await req.json()) as GroupMutationPayload;
    if (!payload.id) return jsonError("일정 그룹 ID가 필요합니다.", 400);

    const { data: current, error: currentError } = await supabase
      .from("instructor_availability_groups")
      .select("id,instructor_id,month_start,is_active")
      .eq("id", payload.id)
      .eq("instructor_id", params.id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return jsonError("가능 일정 그룹을 찾지 못했습니다.", 404);

    if (payload.action === "save") {
      const name = payload.name?.trim();
      if (!name) return jsonError("일정 이름을 입력해 주세요.", 400);
      const slotsByDay = normalizeSlotsByDay(payload.availableTimeSlotsByDay);
      const weekdayNotes = normalizeWeekdayNotes(payload.weekdayNotes);
      const dateOverrides = normalizeDateOverrides(payload.dateOverrides, current.month_start);
      const { data, error } = await supabase
        .from("instructor_availability_groups")
        .update({
          name,
          available_time_slots_by_day: slotsByDay,
          weekday_notes: weekdayNotes,
          date_overrides: dateOverrides,
          updated_at: new Date().toISOString()
        })
        .eq("id", payload.id)
        .select("id,instructor_id,month_start,name,available_time_slots_by_day,weekday_notes,date_overrides,is_active,created_at,updated_at")
        .single();
      if (error || !data) throw error ?? new Error("가능 일정 수정 결과를 찾지 못했습니다.");
      if (current.is_active) await syncInstructorAvailability(supabase, params.id, slotsByDay);
      return NextResponse.json({ item: mapGroup(data) });
    }

    if (payload.action === "activate") {
      const { error: deactivateError } = await supabase
        .from("instructor_availability_groups")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("instructor_id", params.id)
        .eq("month_start", current.month_start)
        .eq("is_active", true);
      if (deactivateError) throw deactivateError;

      const { data, error } = await supabase
        .from("instructor_availability_groups")
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq("id", payload.id)
        .select("id,instructor_id,month_start,name,available_time_slots_by_day,weekday_notes,date_overrides,is_active,created_at,updated_at")
        .single();
      if (error || !data) throw error ?? new Error("가능 일정 활성화 결과를 찾지 못했습니다.");
      const group = mapGroup(data);
      await syncInstructorAvailability(supabase, params.id, group.availableTimeSlotsByDay);
      return NextResponse.json({ item: group });
    }

    return jsonError("지원하지 않는 작업입니다.", 400);
  } catch (error) {
    return authErrorResponse(error);
  }
}
