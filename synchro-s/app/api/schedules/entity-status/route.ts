import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { NextResponse } from "next/server";

type EntityStatusPayload = {
  entityType?: "instructor" | "student";
  id?: string;
  isActive?: boolean;
};

export async function PATCH(req: Request) {
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

    const payload = (await req.json()) as EntityStatusPayload;
    if (payload.entityType !== "instructor" && payload.entityType !== "student") {
      return jsonError("entityType must be instructor or student", 400);
    }
    if (!payload.id) {
      return jsonError("id is required", 400);
    }
    if (typeof payload.isActive !== "boolean") {
      return jsonError("isActive must be boolean", 400);
    }

    const table = payload.entityType === "instructor" ? "instructors" : "students";
    const selectClause =
      payload.entityType === "instructor" ? "id,instructor_name,is_active" : "id,student_name,is_active";

    const { data, error } = await supabase
      .from(table)
      .update({ is_active: payload.isActive })
      .eq("id", payload.id)
      .select(selectClause)
      .single();

    if (error || !data) {
      throw error ?? new Error("상태 변경에 실패했습니다.");
    }

    const name =
      payload.entityType === "instructor"
        ? (data as { instructor_name: string }).instructor_name
        : (data as { student_name: string }).student_name;

    return NextResponse.json({
      id: data.id,
      entityType: payload.entityType,
      isActive: data.is_active !== false,
      name
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
