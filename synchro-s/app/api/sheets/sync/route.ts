import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { planFirebaseStudentSync } from "@/lib/server/firebaseStudentMirror";
import { getBearerIdToken, loadFirebaseRoster } from "@/lib/server/firestoreRoster";
import { NextResponse } from "next/server";

async function syncFirebaseRosterToSupabase(supabase: any, idToken: string) {
  const roster = await loadFirebaseRoster(idToken, { forceRefresh: true });
  if (!roster.studentsAvailable) {
    return { available: false, error: roster.studentError ?? roster.error };
  }

  const { data: existingStudents, error: studentReadError } = await supabase
    .from("students")
    .select("id,student_name,is_active,firebase_student_id,firebase_uid");

  if (studentReadError) throw studentReadError;

  type ExistingStudent = {
    id: string;
    student_name: string;
    is_active: boolean | null;
    firebase_student_id?: string | null;
    firebase_uid?: string | null;
  };

  const studentRows = ((existingStudents ?? []) as ExistingStudent[]);
  const syncedAt = new Date().toISOString();
  const plan = planFirebaseStudentSync(studentRows, roster.students, syncedAt);

  if (plan.updates.length > 0) {
    const updateRows = plan.updates.map((update) => ({ id: update.id, ...update.payload }));
    const { error } = await supabase.from("students").upsert(updateRows, { onConflict: "id" });
    if (error) throw error;
  }
  if (plan.inserts.length > 0) {
    const { error } = await supabase.from("students").insert(plan.inserts);
    if (error) throw error;
  }

  const warningParts = [];
  if (plan.identityConflictsResolved > 0) {
    warningParts.push(`기존 시간표 행을 유지하며 Firebase ID 충돌 ${plan.identityConflictsResolved}건을 정리했습니다.`);
  }
  const duplicateRosterEntries = (roster.duplicateStudentDocuments ?? 0) + plan.duplicateRosterEntries;
  if (duplicateRosterEntries > 0) {
    warningParts.push(`Firebase 중복 명단 ${duplicateRosterEntries}건을 대표 ID로 통합했습니다.`);
  }
  if (plan.needsReview > 0) {
    warningParts.push(`동명이인 ${plan.needsReview}명은 자동 연결하지 않았습니다. 계정 관리에서 대표 ID를 확인해 주세요.`);
  }
  return {
    available: true,
    studentsAvailable: roster.studentsAvailable,
    instructorSource: "supabase-account-projection",
    warning: warningParts.length > 0 ? warningParts.join(" ") : undefined,
    teachersFetched: 0,
    studentsFetched: roster.students.length,
    teachersInserted: 0,
    teachersUpdated: 0,
    studentsInserted: plan.inserts.length,
    studentsUpdated: plan.updates.length,
    studentsNeedsReview: plan.needsReview,
    duplicateRosterEntries,
    identityConflictsResolved: plan.identityConflictsResolved
  };
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

    const idToken = getBearerIdToken(req);
    if (!idToken) {
      return jsonError("Firebase 인증 상태를 확인할 수 없습니다. 다시 로그인한 뒤 명단 동기화를 실행해 주세요.", 409);
    }

    const firebaseSync = await syncFirebaseRosterToSupabase(supabase, idToken);
    if (!firebaseSync.available) {
      return jsonError(
        `Firebase 명단을 불러오지 못했습니다. 기존 명단은 유지되었습니다. (${firebaseSync.error ?? "원인 미상"})`,
        502
      );
    }

    return NextResponse.json({
      source: "firebase",
      ...firebaseSync
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
