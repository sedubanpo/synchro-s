import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { NextResponse } from "next/server";

type ClassTypePayload = {
  code?: string;
  displayName?: string;
  maxStudents?: number;
  memo?: string;
};

function normalizeCode(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || `CUSTOM_${Date.now()}`;
}

function validateCapacity(value: number | undefined): number | null {
  const capacity = Number(value);
  return Number.isInteger(capacity) && capacity >= 1 && capacity <= 100 ? capacity : null;
}

async function authorize() {
  const context = await getAuthenticatedProfile();
  if (!context.user) return { error: jsonError("Unauthorized", 401) };
  if (!context.profile) return { error: jsonError("Authenticated but no app profile or role mapping in public.users", 403) };
  if (!canManageSchedules(context.profile.role)) return { error: jsonError("Forbidden", 403) };
  return context;
}

export async function GET() {
  try {
    const context = await authorize();
    if ("error" in context) return context.error;
    const { data, error } = await context.supabase
      .from("class_types")
      .select("code,display_name,badge_text,max_students,memo")
      .order("display_name", { ascending: true });
    if (error) throw error;
    return NextResponse.json({
      classTypes: (data ?? []).map((row) => ({
        code: row.code,
        label: row.display_name,
        badgeText: row.badge_text,
        maxStudents: row.max_students,
        memo: row.memo ?? ""
      }))
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function POST(req: Request) {
  try {
    const context = await authorize();
    if ("error" in context) return context.error;
    const body = (await req.json()) as ClassTypePayload;
    const displayName = (body.displayName ?? "").trim();
    const capacity = validateCapacity(body.maxStudents);
    if (!displayName || capacity === null) return jsonError("수업 유형명과 1~100명의 정원을 입력해 주세요.", 400);
    const code = normalizeCode(body.code || `CUSTOM_${displayName}`);
    const { error } = await context.supabase.from("class_types").insert({
      code,
      display_name: displayName,
      badge_text: `[${displayName}]`,
      max_students: capacity,
      memo: (body.memo ?? "").trim()
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, code }, { status: 201 });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const context = await authorize();
    if ("error" in context) return context.error;
    const body = (await req.json()) as ClassTypePayload;
    const code = normalizeCode(body.code ?? "");
    const displayName = (body.displayName ?? "").trim();
    const capacity = validateCapacity(body.maxStudents);
    if (!code || !displayName || capacity === null) return jsonError("수업 유형 코드, 이름, 정원을 확인해 주세요.", 400);
    const { error } = await context.supabase
      .from("class_types")
      .update({
        display_name: displayName,
        badge_text: `[${displayName}]`,
        max_students: capacity,
        memo: (body.memo ?? "").trim()
      })
      .eq("code", code);
    if (error) throw error;
    return NextResponse.json({ ok: true, code });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
