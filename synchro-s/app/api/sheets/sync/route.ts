import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { getBearerIdToken, loadFirebaseRoster, type FirebaseStudentRosterItem } from "@/lib/server/firestoreRoster";
import { NextResponse } from "next/server";

function normalizeName(value: string): string {
  return value.replace(/^\/+/, "").replace(/\s+/g, " ").trim();
}

function normalizeMatchKey(value: string): string {
  return normalizeName(value).replace(/\s+/g, "").toLowerCase();
}

function buildUniqueNameMap<T>(rows: T[], getName: (row: T) => string): Map<string, T> {
  const counts = new Map<string, number>();
  const first = new Map<string, T>();
  for (const row of rows) {
    const key = normalizeMatchKey(getName(row));
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!first.has(key)) first.set(key, row);
  }
  for (const [key, count] of counts.entries()) {
    if (count > 1) first.delete(key);
  }
  return first;
}

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
  const studentsById = new Map(studentRows.map((row) => [row.id, row]));
  const studentsByFirebaseId = new Map(studentRows.filter((row) => row.firebase_student_id).map((row) => [row.firebase_student_id as string, row]));
  const studentsByName = buildUniqueNameMap(studentRows, (row) => row.student_name);
  const syncedAt = new Date().toISOString();

  let studentsInserted = 0;
  let studentsUpdated = 0;
  let studentsNeedsReview = 0;

  const resolveStudent = (item: FirebaseStudentRosterItem) => {
    const identityIds = Array.from(new Set([
      item.supabaseStudentId,
      item.canonicalStudentId,
      item.studentId,
      item.id,
      ...(item.studentIdAliases ?? [])
    ].filter((value): value is string => Boolean(value))));
    for (const identityId of identityIds) {
      const existing = studentsById.get(identityId) ?? studentsByFirebaseId.get(identityId);
      if (existing) return existing;
    }
    return undefined;
  };

  for (const item of roster.students) {
    const existing = resolveStudent(item);
    const firebaseStudentId = item.canonicalStudentId || item.studentId || item.id;
    const payload = {
      student_name: item.name,
      is_active: item.active,
      firebase_student_id: firebaseStudentId,
      firebase_uid: item.firebaseUid || null,
      firebase_match_key: [normalizeMatchKey(item.name), normalizeMatchKey(item.school), item.grade.replace(/[^0-9]/g, "")].filter(Boolean).join("|"),
      firebase_sync_status: "matched",
      firebase_synced_at: syncedAt
    };
    if (existing) {
      const { error } = await supabase.from("students").update(payload).eq("id", existing.id);
      if (error) throw error;
      studentsUpdated += 1;
    } else {
      if (studentsByName.has(normalizeMatchKey(item.name))) {
        studentsNeedsReview += 1;
        continue;
      }
      const preferredId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(firebaseStudentId)
        ? firebaseStudentId
        : undefined;
      const { error } = await supabase.from("students").insert({ ...(preferredId ? { id: preferredId } : {}), ...payload });
      if (error) throw error;
      studentsInserted += 1;
    }
  }

  return {
    available: true,
    studentsAvailable: roster.studentsAvailable,
    instructorSource: "supabase-account-projection",
    warning:
      studentsNeedsReview > 0
        ? `동명이인 또는 기존 ID 연결이 없는 학생 ${studentsNeedsReview}명은 자동 연결하지 않았습니다. 계정 관리에서 대표 ID를 확인해 주세요.`
        : undefined,
    teachersFetched: 0,
    studentsFetched: roster.students.length,
    teachersInserted: 0,
    teachersUpdated: 0,
    studentsInserted,
    studentsUpdated,
    studentsNeedsReview
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
