import type { FirebaseStudentRosterItem } from "@/lib/server/firestoreRoster";

export type SupabaseStudentMirrorRow = {
  id: string;
  student_name: string;
  is_active: boolean | null;
  firebase_student_id?: string | null;
  firebase_uid?: string | null;
};

type FirebaseStudentInsert = {
  id?: string;
  student_name: string;
  is_active: boolean;
  firebase_student_id: string;
  firebase_uid: string | null;
  firebase_match_key: string;
  firebase_sync_status: "matched";
  firebase_synced_at: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeMatchKey(value: string): string {
  return value.replace(/^\/+/, "").replace(/\s+/g, "").trim().toLowerCase();
}

function buildUniqueNameMap(rows: SupabaseStudentMirrorRow[]): Map<string, SupabaseStudentMirrorRow> {
  const counts = new Map<string, number>();
  const first = new Map<string, SupabaseStudentMirrorRow>();

  for (const row of rows) {
    const key = normalizeMatchKey(row.student_name);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!first.has(key)) first.set(key, row);
  }

  for (const [key, count] of counts.entries()) {
    if (count > 1) first.delete(key);
  }

  return first;
}

/**
 * Firebase is the roster source of truth, while schedule foreign keys still point
 * at public.students. Plan inserts only for genuinely missing Firebase students;
 * existing rows and schedule data are never updated or replaced here.
 */
export function planMissingFirebaseStudentInserts(
  existingRows: SupabaseStudentMirrorRow[],
  firebaseStudents: FirebaseStudentRosterItem[],
  syncedAt = new Date().toISOString()
): FirebaseStudentInsert[] {
  const existingByIdentity = new Map<string, SupabaseStudentMirrorRow>();
  for (const row of existingRows) {
    for (const identity of [row.id, row.firebase_student_id, row.firebase_uid]) {
      if (identity) existingByIdentity.set(identity, row);
    }
  }
  const existingByUniqueName = buildUniqueNameMap(existingRows);
  const plannedIdentities = new Set<string>();
  const inserts: FirebaseStudentInsert[] = [];

  for (const student of firebaseStudents) {
    const identities = Array.from(
      new Set(
        [
          student.supabaseStudentId,
          student.canonicalStudentId,
          student.studentId,
          student.id,
          student.firebaseUid,
          ...(student.studentIdAliases ?? [])
        ].filter((value): value is string => Boolean(value))
      )
    );
    const alreadyMirrored = identities.some((identity) => existingByIdentity.has(identity));
    const uniqueNameMatch = existingByUniqueName.get(normalizeMatchKey(student.name));
    if (alreadyMirrored || uniqueNameMatch || identities.some((identity) => plannedIdentities.has(identity))) {
      continue;
    }

    const firebaseStudentId = student.canonicalStudentId || student.studentId || student.id;
    const preferredId = student.supabaseStudentId || (UUID_PATTERN.test(firebaseStudentId) ? firebaseStudentId : undefined);
    const grade = student.grade.replace(/[^0-9]/g, "");
    inserts.push({
      ...(preferredId ? { id: preferredId } : {}),
      student_name: student.name,
      is_active: student.active,
      firebase_student_id: firebaseStudentId,
      firebase_uid: student.firebaseUid || null,
      firebase_match_key: [normalizeMatchKey(student.name), normalizeMatchKey(student.school), grade].filter(Boolean).join("|"),
      firebase_sync_status: "matched",
      firebase_synced_at: syncedAt
    });
    identities.forEach((identity) => plannedIdentities.add(identity));
  }

  return inserts;
}

/**
 * Plan positive-only reactivation from the registered roster. Missing names are
 * intentionally not treated as inactive here, so this helper cannot suspend or
 * remove an existing student.
 */
export function planRegisteredStudentReactivationIds(
  existingRows: SupabaseStudentMirrorRow[],
  registeredStudentNames: Iterable<string>
): string[] {
  const registeredTokens = new Set([...registeredStudentNames].map(normalizeMatchKey).filter(Boolean));
  return existingRows
    .filter((row) => row.is_active === false && registeredTokens.has(normalizeMatchKey(row.student_name)))
    .map((row) => row.id);
}
