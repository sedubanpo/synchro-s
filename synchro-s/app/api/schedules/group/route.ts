import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { NextResponse } from "next/server";

type DeleteGroupPayload = {
  classIds: string[];
  roleView: "student" | "instructor";
  targetId: string;
};

export async function DELETE(req: Request) {
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

    const payload = (await req.json()) as DeleteGroupPayload;
    const classIds = Array.from(new Set((payload.classIds ?? []).filter(Boolean)));
    if (classIds.length === 0) {
      return NextResponse.json({ deletedClasses: 0, deletedEnrollments: 0 });
    }

    if (!payload.targetId || (payload.roleView !== "student" && payload.roleView !== "instructor")) {
      return jsonError("Invalid delete payload", 400);
    }

    if (payload.roleView === "instructor") {
      const { error: deleteError, count } = await supabase
        .from("classes")
        .delete({ count: "exact" })
        .in("id", classIds)
        .eq("instructor_id", payload.targetId);

      if (deleteError) throw deleteError;

      return NextResponse.json({
        deletedClasses: count ?? 0,
        deletedEnrollments: 0
      });
    }

    const { error: enrollmentDeleteError, count: deletedEnrollments } = await supabase
      .from("class_enrollments")
      .delete({ count: "exact" })
      .in("class_id", classIds)
      .eq("student_id", payload.targetId);

    if (enrollmentDeleteError) throw enrollmentDeleteError;

    const { data: remainingEnrollments, error: remainingError } = await supabase
      .from("class_enrollments")
      .select("class_id")
      .in("class_id", classIds);

    if (remainingError) throw remainingError;

    const classIdsWithEnrollment = new Set((remainingEnrollments ?? []).map((row: { class_id: string }) => row.class_id));
    const orphanClassIds = classIds.filter((id) => !classIdsWithEnrollment.has(id));

    let deletedClasses = 0;
    if (orphanClassIds.length > 0) {
      const { error: classDeleteError, count: classDeleteCount } = await supabase
        .from("classes")
        .delete({ count: "exact" })
        .in("id", orphanClassIds);
      if (classDeleteError) throw classDeleteError;
      deletedClasses = classDeleteCount ?? 0;
    }

    return NextResponse.json({
      deletedClasses,
      deletedEnrollments: deletedEnrollments ?? 0
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

