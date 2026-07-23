import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { planFirebaseStudentSync } from "@/lib/server/firebaseStudentMirror";
import { getBearerIdToken, loadFirebaseRoster } from "@/lib/server/firestoreRoster";
import { fetchAllSupabaseRows } from "@/lib/server/supabasePagination";
import { NextResponse } from "next/server";

function isFirebaseStudentIdConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string; details?: string };
  return (
    candidate.code === "23505" &&
    `${candidate.message ?? ""} ${candidate.details ?? ""}`.includes("students_firebase_student_id_unique")
  );
}

async function findStudentByFirebaseId(supabase: any, firebaseStudentId: string) {
  const { data, error } = await supabase
    .from("students")
    .select("id")
    .eq("firebase_student_id", firebaseStudentId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string } | null;
}

async function updateStudentRow(supabase: any, id: string, payload: Record<string, unknown>) {
  const { error } = await supabase.from("students").update(payload).eq("id", id);
  if (error) throw error;
}

async function applyIdentityChangingUpdate(
  supabase: any,
  update: { id: string; payload: { firebase_student_id: string } & Record<string, unknown> }
) {
  const existingOwner = await findStudentByFirebaseId(supabase, update.payload.firebase_student_id);
  const targetId = existingOwner?.id ?? update.id;

  try {
    await updateStudentRow(supabase, targetId, update.payload);
  } catch (error) {
    if (!isFirebaseStudentIdConflict(error)) throw error;
    const concurrentOwner = await findStudentByFirebaseId(supabase, update.payload.firebase_student_id);
    if (!concurrentOwner) throw error;
    await updateStudentRow(supabase, concurrentOwner.id, update.payload);
  }
}

async function applyStudentInsert(supabase: any, payload: { firebase_student_id: string } & Record<string, unknown>) {
  const existingOwner = await findStudentByFirebaseId(supabase, payload.firebase_student_id);
  if (existingOwner) {
    const { id: _preferredId, ...updatePayload } = payload;
    await updateStudentRow(supabase, existingOwner.id, updatePayload);
    return "updated";
  }

  const { error } = await supabase.from("students").insert(payload);
  if (!error) return "inserted";
  if (!isFirebaseStudentIdConflict(error)) throw error;

  const concurrentOwner = await findStudentByFirebaseId(supabase, payload.firebase_student_id);
  if (!concurrentOwner) throw error;
  const { id: _preferredId, ...updatePayload } = payload;
  await updateStudentRow(supabase, concurrentOwner.id, updatePayload);
  return "updated";
}

async function syncFirebaseRosterToSupabase(supabase: any, idToken: string) {
  const roster = await loadFirebaseRoster(idToken, { forceRefresh: true });
  if (!roster.studentsAvailable) {
    return { available: false, error: roster.studentError ?? roster.error };
  }

  type ExistingStudent = {
    id: string;
    student_name: string;
    is_active: boolean | null;
    firebase_student_id?: string | null;
    firebase_uid?: string | null;
  };

  const studentRows = await fetchAllSupabaseRows<ExistingStudent>(async (from, to) => {
    const result = await supabase
      .from("students")
      .select("id,student_name,is_active,firebase_student_id,firebase_uid")
      .order("id")
      .range(from, to);
    return {
      data: (result.data ?? []) as ExistingStudent[],
      error: result.error
    };
  });
  const syncedAt = new Date().toISOString();
  const plan = planFirebaseStudentSync(studentRows, roster.students, syncedAt);

  const stableUpdates = plan.updates.filter((update) => !update.identityChanged);
  const identityChangingUpdates = plan.updates.filter((update) => update.identityChanged);
  let insertedCount = 0;
  let updatedCount = stableUpdates.length;

  if (stableUpdates.length > 0) {
    const updateRows = stableUpdates.map((update) => ({ id: update.id, ...update.payload }));
    const { error } = await supabase.from("students").upsert(updateRows, { onConflict: "id" });
    if (error) throw error;
  }

  for (const update of identityChangingUpdates) {
    await applyIdentityChangingUpdate(supabase, update);
    updatedCount += 1;
  }

  for (const insert of plan.inserts) {
    const result = await applyStudentInsert(supabase, insert);
    if (result === "inserted") insertedCount += 1;
    else updatedCount += 1;
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
    warningParts.push(
      `학생 계정 ${plan.needsReview}건은 동명이인 또는 ID 충돌로 자동 연결하지 않았습니다. 계정 관리에서 대표 ID를 확인해 주세요.`
    );
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
    studentsInserted: insertedCount,
    studentsUpdated: updatedCount,
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
