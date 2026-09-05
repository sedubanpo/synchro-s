import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import {
  normalizeStudentAvailabilityByDay,
  normalizeStudentAvailabilityDateOverrides
} from "@/lib/server/studentAvailability";
import type { StudentAvailabilityByDay, StudentAvailabilityDateOverrides } from "@/types/schedule";
import { NextResponse } from "next/server";

type CreatePayload = {
  monthStart: string;
  title: string;
  memo?: string;
  weeklyAvailability?: StudentAvailabilityByDay;
  dateOverrides?: StudentAvailabilityDateOverrides;
  isActive?: boolean;
};

type MutationPayload =
  | {
      action: "save";
      id: string;
      title: string;
      memo?: string;
      weeklyAvailability?: StudentAvailabilityByDay;
      dateOverrides?: StudentAvailabilityDateOverrides;
    }
  | { action: "activate"; id: string };

function normalizeMonthStart(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-01$/.test(value)) {
    throw new Error("월 기준일은 YYYY-MM-01 형식이어야 합니다.");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("유효한 월 기준일을 입력해 주세요.");
  }
  return value;
}

function normalizeText(value: unknown, label: string, maxLength: number, required = false): string {
  if (value == null) {
    if (required) throw new Error(`${label}을 입력해 주세요.`);
    return "";
  }
  if (typeof value !== "string") throw new Error(`${label}은 문자로 입력해 주세요.`);
  const result = value.trim();
  if (required && !result) throw new Error(`${label}을 입력해 주세요.`);
  if (result.length > maxLength) throw new Error(`${label}은 ${maxLength}자 이하로 입력해 주세요.`);
  return result;
}

function mapGroup(row: any) {
  return {
    id: row.id,
    studentId: row.student_id,
    monthStart: row.month_start,
    title: row.title,
    memo: row.memo ?? "",
    weeklyAvailability: normalizeStudentAvailabilityByDay(row.weekly_availability),
    dateOverrides: normalizeStudentAvailabilityDateOverrides(row.date_overrides, row.month_start),
    isActive: row.is_active === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = `${(error as { message?: string } | null)?.message ?? ""}`;
  return code === "42P01" || message.includes("student_availability_groups");
}

async function requireAccess() {
  const auth = await getAuthenticatedProfile();
  if (!auth.user) throw new Error("UNAUTHORIZED");
  if (!auth.profile || !canManageSchedules(auth.profile.role)) throw new Error("FORBIDDEN");
  return auth;
}

function routeError(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
  if (error instanceof Error && error.message === "FORBIDDEN") return jsonError("Forbidden", 403);
  if (isMissingTableError(error)) {
    return jsonError("운영 DB에 학생 가능 일정 그룹 테이블이 없습니다. 0020 마이그레이션을 적용해 주세요.", 503);
  }
  const message = errorMessage(error);
  const isValidation = error instanceof Error && /입력|형식|일정|시간|상태|사유|메모|제목|기준일/.test(message);
  return jsonError(message, isValidation ? 400 : 500);
}

const SELECT_COLUMNS =
  "id,student_id,month_start,title,memo,weekly_availability,date_overrides,is_active,created_at,updated_at";

export async function GET(req: Request, { params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = await pendingParams;
  try {
    const { supabase } = await requireAccess();
    const monthStart = normalizeMonthStart(new URL(req.url).searchParams.get("monthStart"));
    const { data, error } = await supabase
      .from("student_availability_groups")
      .select(SELECT_COLUMNS)
      .eq("student_id", params.id)
      .eq("month_start", monthStart)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ items: (data ?? []).map(mapGroup) });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(req: Request, { params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = await pendingParams;
  try {
    const { supabase, profile } = await requireAccess();
    const payload = (await req.json()) as CreatePayload;
    const monthStart = normalizeMonthStart(payload.monthStart);
    const title = normalizeText(payload.title, "가능 일정 제목", 100, true);
    const memo = normalizeText(payload.memo, "가능 일정 메모", 500);
    const weeklyAvailability = normalizeStudentAvailabilityByDay(payload.weeklyAvailability);
    const dateOverrides = normalizeStudentAvailabilityDateOverrides(payload.dateOverrides, monthStart);
    const setActive = payload.isActive !== false;

    if (setActive) {
      const { error } = await supabase
        .from("student_availability_groups")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("student_id", params.id)
        .eq("month_start", monthStart)
        .eq("is_active", true);
      if (error) throw error;
    }

    const { data, error } = await supabase
      .from("student_availability_groups")
      .insert({
        student_id: params.id,
        month_start: monthStart,
        title,
        memo,
        weekly_availability: weeklyAvailability,
        date_overrides: dateOverrides,
        is_active: setActive,
        created_by_name: (profile as { full_name?: string | null }).full_name ?? null,
        updated_at: new Date().toISOString()
      })
      .select(SELECT_COLUMNS)
      .single();
    if (error || !data) throw error ?? new Error("학생 가능 일정 저장 결과를 찾지 못했습니다.");
    return NextResponse.json({ item: mapGroup(data) });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(req: Request, { params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = await pendingParams;
  try {
    const { supabase } = await requireAccess();
    const payload = (await req.json()) as MutationPayload;
    if (!payload.id) return jsonError("가능 일정 그룹 ID가 필요합니다.", 400);

    const { data: current, error: currentError } = await supabase
      .from("student_availability_groups")
      .select("id,student_id,month_start,is_active")
      .eq("id", payload.id)
      .eq("student_id", params.id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return jsonError("학생 가능 일정 그룹을 찾지 못했습니다.", 404);

    if (payload.action === "save") {
      const title = normalizeText(payload.title, "가능 일정 제목", 100, true);
      const memo = normalizeText(payload.memo, "가능 일정 메모", 500);
      const weeklyAvailability = normalizeStudentAvailabilityByDay(payload.weeklyAvailability);
      const dateOverrides = normalizeStudentAvailabilityDateOverrides(payload.dateOverrides, current.month_start);
      const { data, error } = await supabase
        .from("student_availability_groups")
        .update({
          title,
          memo,
          weekly_availability: weeklyAvailability,
          date_overrides: dateOverrides,
          updated_at: new Date().toISOString()
        })
        .eq("id", payload.id)
        .select(SELECT_COLUMNS)
        .single();
      if (error || !data) throw error ?? new Error("학생 가능 일정 수정 결과를 찾지 못했습니다.");
      return NextResponse.json({ item: mapGroup(data) });
    }

    if (payload.action === "activate") {
      const { error: deactivateError } = await supabase
        .from("student_availability_groups")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("student_id", params.id)
        .eq("month_start", current.month_start)
        .eq("is_active", true);
      if (deactivateError) throw deactivateError;

      const { data, error } = await supabase
        .from("student_availability_groups")
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq("id", payload.id)
        .select(SELECT_COLUMNS)
        .single();
      if (error || !data) throw error ?? new Error("학생 가능 일정 활성화 결과를 찾지 못했습니다.");
      return NextResponse.json({ item: mapGroup(data) });
    }

    return jsonError("지원하지 않는 작업입니다.", 400);
  } catch (error) {
    return routeError(error);
  }
}
