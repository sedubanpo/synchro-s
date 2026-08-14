import { errorMessage, jsonError } from "@/lib/http";
import {
  isHomeClassroomOption,
  sanitizeHomeClassroomAssignments,
  type HomeClassroomAssignment
} from "@/lib/homeFullTimetable";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { NextResponse } from "next/server";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ClassroomPayload = {
  scope?: "fixed" | "day";
  dateISO?: string;
  instructorId?: string;
  classroom?: string;
  assignments?: HomeClassroomAssignment;
};

function mapRows(rows: Array<{ instructor_id: string; classroom: string }> | null): HomeClassroomAssignment {
  return Object.fromEntries((rows ?? []).map((row) => [row.instructor_id, row.classroom]));
}

function validateDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value) ? value : null;
}

function validateInstructorId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

async function requireManager() {
  const auth = await getAuthenticatedProfile();
  if (!auth.user) throw new Error("UNAUTHORIZED");
  if (!auth.profile || !canManageSchedules(auth.profile.role)) throw new Error("FORBIDDEN");
  return auth;
}

function apiError(error: unknown) {
  const message = errorMessage(error);
  if (message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
  if (message === "FORBIDDEN") return jsonError("Forbidden", 403);
  return jsonError(message, 500);
}

export async function GET(req: Request) {
  try {
    const { supabase } = await requireManager();
    const dateISO = validateDate(new URL(req.url).searchParams.get("dateISO"));
    if (!dateISO) return jsonError("dateISO는 YYYY-MM-DD 형식이어야 합니다.", 400);

    const [fixedResult, dayResult] = await Promise.all([
      supabase.from("instructor_fixed_classrooms").select("instructor_id,classroom"),
      supabase
        .from("instructor_classroom_day_overrides")
        .select("instructor_id,classroom")
        .eq("assignment_date", dateISO)
    ]);
    if (fixedResult.error) throw fixedResult.error;
    if (dayResult.error) throw dayResult.error;

    return NextResponse.json({
      fixedAssignments: mapRows(fixedResult.data),
      dayOverrides: mapRows(dayResult.data)
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: Request) {
  try {
    const { supabase, user } = await requireManager();
    const payload = (await req.json()) as ClassroomPayload;
    const assignments = sanitizeHomeClassroomAssignments(payload.assignments);
    const entries = Object.entries(assignments).filter(([id]) => validateInstructorId(id));
    if (entries.length === 0) return jsonError("저장할 강의실 배정이 없습니다.", 400);

    if (payload.scope === "fixed") {
      const { error } = await supabase.from("instructor_fixed_classrooms").upsert(
        entries.map(([instructorId, classroom]) => ({
          instructor_id: instructorId,
          classroom,
          updated_at: new Date().toISOString(),
          updated_by: user.id
        })),
        { onConflict: "instructor_id" }
      );
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    const dateISO = validateDate(payload.dateISO);
    if (payload.scope !== "day" || !dateISO) return jsonError("scope 또는 dateISO가 올바르지 않습니다.", 400);
    const { error } = await supabase.from("instructor_classroom_day_overrides").upsert(
      entries.map(([instructorId, classroom]) => ({
        assignment_date: dateISO,
        instructor_id: instructorId,
        classroom,
        updated_at: new Date().toISOString(),
        updated_by: user.id
      })),
      { onConflict: "assignment_date,instructor_id" }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const { supabase, user } = await requireManager();
    const payload = (await req.json()) as ClassroomPayload;
    const instructorId = validateInstructorId(payload.instructorId);
    if (!instructorId || !isHomeClassroomOption(payload.classroom)) {
      return jsonError("강사 또는 강의실 값이 올바르지 않습니다.", 400);
    }
    const common = {
      instructor_id: instructorId,
      classroom: payload.classroom,
      updated_at: new Date().toISOString(),
      updated_by: user.id
    };

    if (payload.scope === "fixed") {
      const { error } = await supabase.from("instructor_fixed_classrooms").upsert(common, { onConflict: "instructor_id" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    const dateISO = validateDate(payload.dateISO);
    if (payload.scope !== "day" || !dateISO) return jsonError("scope 또는 dateISO가 올바르지 않습니다.", 400);
    const { error } = await supabase.from("instructor_classroom_day_overrides").upsert(
      { ...common, assignment_date: dateISO },
      { onConflict: "assignment_date,instructor_id" }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const { supabase } = await requireManager();
    const payload = (await req.json()) as ClassroomPayload;
    const dateISO = validateDate(payload.dateISO);
    if (payload.scope !== "day" || !dateISO) return jsonError("삭제할 날짜가 올바르지 않습니다.", 400);

    let query = supabase.from("instructor_classroom_day_overrides").delete().eq("assignment_date", dateISO);
    if (payload.instructorId !== undefined) {
      const instructorId = validateInstructorId(payload.instructorId);
      if (!instructorId) return jsonError("강사 값이 올바르지 않습니다.", 400);
      query = query.eq("instructor_id", instructorId);
    }
    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
