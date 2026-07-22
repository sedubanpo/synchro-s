import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { getBearerIdToken, loadFirebaseRoster, type FirebaseInstructorRosterItem, type FirebaseStudentRosterItem } from "@/lib/server/firestoreRoster";
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

  const [{ data: existingInstructors, error: instructorReadError }, { data: existingStudents, error: studentReadError }] =
    await Promise.all([
      supabase.from("instructors").select("id,instructor_name,is_active,firebase_instructor_id,firebase_uid"),
      supabase.from("students").select("id,student_name,is_active,firebase_student_id,firebase_uid")
    ]);

  if (instructorReadError) throw instructorReadError;
  if (studentReadError) throw studentReadError;

  type ExistingInstructor = {
    id: string;
    instructor_name: string;
    is_active: boolean | null;
    firebase_instructor_id?: string | null;
    firebase_uid?: string | null;
  };
  type ExistingStudent = {
    id: string;
    student_name: string;
    is_active: boolean | null;
    firebase_student_id?: string | null;
    firebase_uid?: string | null;
  };

  const instructorRows = ((existingInstructors ?? []) as ExistingInstructor[]);
  const studentRows = ((existingStudents ?? []) as ExistingStudent[]);
  const instructorsById = new Map(instructorRows.map((row) => [row.id, row]));
  const studentsById = new Map(studentRows.map((row) => [row.id, row]));
  const instructorsByFirebaseId = new Map(instructorRows.filter((row) => row.firebase_instructor_id).map((row) => [row.firebase_instructor_id as string, row]));
  const studentsByFirebaseId = new Map(studentRows.filter((row) => row.firebase_student_id).map((row) => [row.firebase_student_id as string, row]));
  const instructorsByName = buildUniqueNameMap(instructorRows, (row) => row.instructor_name);
  const studentsByName = buildUniqueNameMap(studentRows, (row) => row.student_name);
  const syncedAt = new Date().toISOString();

  let teachersInserted = 0;
  let teachersUpdated = 0;
  let studentsInserted = 0;
  let studentsUpdated = 0;

  const resolveInstructor = (item: FirebaseInstructorRosterItem) =>
    (item.supabaseInstructorId ? instructorsById.get(item.supabaseInstructorId) : undefined) ??
    instructorsById.get(item.instructorId) ??
    instructorsById.get(item.id) ??
    instructorsByFirebaseId.get(item.instructorId) ??
    instructorsByFirebaseId.get(item.id) ??
    instructorsByName.get(normalizeMatchKey(item.name));

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
    return studentsByName.get(normalizeMatchKey(item.name));
  };

  for (const item of roster.instructors) {
    const existing = resolveInstructor(item);
    const firebaseInstructorId = item.instructorId || item.id;
    const payload = {
      instructor_name: item.name,
      is_active: item.active,
      firebase_instructor_id: firebaseInstructorId,
      firebase_uid: item.firebaseUid || null,
      firebase_match_key: normalizeMatchKey(item.name),
      firebase_sync_status: "matched",
      firebase_synced_at: syncedAt
    };
    if (existing) {
      const { error } = await supabase.from("instructors").update(payload).eq("id", existing.id);
      if (error) throw error;
      teachersUpdated += 1;
    } else {
      const { error } = await supabase.from("instructors").insert(payload);
      if (error) throw error;
      teachersInserted += 1;
    }
  }

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
    instructorsAvailable: roster.instructorsAvailable,
    warning: roster.instructorsAvailable
      ? undefined
      : `학생 명단은 동기화했지만 강사 명단은 권한상 기존 Synchro-S 값을 유지했습니다. (${roster.instructorError ?? "원인 미상"})`,
    teachersFetched: roster.instructors.length,
    studentsFetched: roster.students.length,
    teachersInserted,
    teachersUpdated,
    studentsInserted,
    studentsUpdated
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
