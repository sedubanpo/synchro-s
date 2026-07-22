import type { FirebaseInstructorRosterItem } from "@/lib/server/firestoreRoster";

export type SupabaseInstructorMirrorRow = {
  id: string;
  instructor_name: string;
  is_active?: boolean | null;
  firebase_instructor_id?: string | null;
  firebase_uid?: string | null;
};

type FirebaseInstructorInsert = {
  id?: string;
  instructor_name: string;
  is_active: boolean;
  firebase_instructor_id: string;
  firebase_uid: string | null;
  firebase_match_key: string;
  firebase_sync_status: "matched";
  firebase_synced_at: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeMatchKey(value: string): string {
  return value.replace(/^\/+/, "").replace(/\s+/g, "").trim().toLowerCase();
}

function buildUniqueNameMap(rows: SupabaseInstructorMirrorRow[]): Map<string, SupabaseInstructorMirrorRow> {
  const counts = new Map<string, number>();
  const first = new Map<string, SupabaseInstructorMirrorRow>();
  for (const row of rows) {
    const key = normalizeMatchKey(row.instructor_name);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!first.has(key)) first.set(key, row);
  }
  for (const [key, count] of counts.entries()) {
    if (count > 1) first.delete(key);
  }
  return first;
}

/** Create only missing schedule mirror rows. Firebase/Auth records and existing instructors are never changed. */
export function planMissingFirebaseInstructorInserts(
  existingRows: SupabaseInstructorMirrorRow[],
  firebaseInstructors: FirebaseInstructorRosterItem[],
  syncedAt = new Date().toISOString()
): FirebaseInstructorInsert[] {
  const existingByIdentity = new Map<string, SupabaseInstructorMirrorRow>();
  for (const row of existingRows) {
    for (const identity of [row.id, row.firebase_instructor_id, row.firebase_uid]) {
      if (identity) existingByIdentity.set(identity, row);
    }
  }
  const existingByUniqueName = buildUniqueNameMap(existingRows);
  const plannedIdentities = new Set<string>();
  const inserts: FirebaseInstructorInsert[] = [];

  for (const instructor of firebaseInstructors) {
    const identities = Array.from(
      new Set(
        [instructor.supabaseInstructorId, instructor.instructorId, instructor.id, instructor.firebaseUid].filter(
          (value): value is string => Boolean(value)
        )
      )
    );
    if (
      identities.some((identity) => existingByIdentity.has(identity) || plannedIdentities.has(identity)) ||
      existingByUniqueName.has(normalizeMatchKey(instructor.name))
    ) {
      continue;
    }

    const firebaseInstructorId = instructor.instructorId || instructor.id;
    const preferredId =
      instructor.supabaseInstructorId || (UUID_PATTERN.test(firebaseInstructorId) ? firebaseInstructorId : undefined);
    inserts.push({
      ...(preferredId ? { id: preferredId } : {}),
      instructor_name: instructor.name,
      is_active: instructor.active,
      firebase_instructor_id: firebaseInstructorId,
      firebase_uid: instructor.firebaseUid || null,
      firebase_match_key: normalizeMatchKey(instructor.name),
      firebase_sync_status: "matched",
      firebase_synced_at: syncedAt
    });
    identities.forEach((identity) => plannedIdentities.add(identity));
  }

  return inserts;
}
