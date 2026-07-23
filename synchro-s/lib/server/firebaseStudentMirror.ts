import type { FirebaseStudentRosterItem } from "@/lib/server/firestoreRoster";

export type SupabaseStudentMirrorRow = {
  id: string;
  student_name: string;
  is_active: boolean | null;
  firebase_student_id?: string | null;
  firebase_uid?: string | null;
};

export type FirebaseStudentPayload = {
  id?: string;
  student_name: string;
  is_active: boolean;
  firebase_student_id: string;
  firebase_uid: string | null;
  firebase_match_key: string;
  firebase_sync_status: "matched";
  firebase_synced_at: string;
};

export type FirebaseStudentSyncPlan = {
  updates: Array<{
    id: string;
    payload: Omit<FirebaseStudentPayload, "id">;
    identityChanged: boolean;
  }>;
  inserts: FirebaseStudentPayload[];
  needsReview: number;
  duplicateRosterEntries: number;
  identityConflictsResolved: number;
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
): FirebaseStudentPayload[] {
  const existingByIdentity = new Map<string, SupabaseStudentMirrorRow>();
  for (const row of existingRows) {
    for (const identity of [row.id, row.firebase_student_id, row.firebase_uid]) {
      if (identity) existingByIdentity.set(identity, row);
    }
  }
  const existingByUniqueName = buildUniqueNameMap(existingRows);
  const plannedIdentities = new Set<string>();
  const inserts: FirebaseStudentPayload[] = [];

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

function firebaseStudentId(student: FirebaseStudentRosterItem): string {
  return student.canonicalStudentId || student.studentId || student.id;
}

function firebaseStudentIdentityIds(student: FirebaseStudentRosterItem): string[] {
  return Array.from(
    new Set(
      [
        firebaseStudentId(student),
        student.studentId,
        student.id,
        ...(student.studentIdAliases ?? []),
        student.firebaseUid,
        student.supabaseStudentId
      ].filter((value): value is string => Boolean(value))
    )
  );
}

function buildUniqueFirebaseNameKeys(students: FirebaseStudentRosterItem[]): Set<string> {
  const counts = new Map<string, number>();
  for (const student of students) {
    const key = normalizeMatchKey(student.name);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count === 1).map(([key]) => key));
}

function deduplicateFirebaseStudents(
  students: FirebaseStudentRosterItem[],
  existingByFirebaseId: Map<string, SupabaseStudentMirrorRow>
): { students: FirebaseStudentRosterItem[]; duplicateCount: number } {
  const grouped = new Map<string, FirebaseStudentRosterItem[]>();
  for (const student of students) {
    const key = firebaseStudentId(student);
    const group = grouped.get(key) ?? [];
    group.push(student);
    grouped.set(key, group);
  }

  let duplicateCount = 0;
  const deduplicated = [...grouped.entries()].map(([identity, group]) => {
    duplicateCount += group.length - 1;
    const currentOwner = existingByFirebaseId.get(identity);
    const selected =
      (currentOwner ? group.find((student) => student.supabaseStudentId === currentOwner.id) : undefined) ??
      group.find((student) => student.active) ??
      group[0];
    return {
      ...selected,
      studentIdAliases: Array.from(new Set(group.flatMap((student) => firebaseStudentIdentityIds(student))))
    };
  });

  return { students: deduplicated, duplicateCount };
}

/**
 * Build an ID-first synchronization plan.
 *
 * The row that already owns firebase_student_id always wins over a stale
 * supabaseStudentId pointer. This preserves timetable foreign keys and avoids
 * moving the same unique Firebase ID onto a second row. A unique name is used
 * only when both rosters contain exactly one student with that name.
 */
export function planFirebaseStudentSync(
  existingRows: SupabaseStudentMirrorRow[],
  firebaseStudents: FirebaseStudentRosterItem[],
  syncedAt = new Date().toISOString()
): FirebaseStudentSyncPlan {
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const existingByFirebaseId = new Map(
    existingRows.filter((row) => row.firebase_student_id).map((row) => [row.firebase_student_id as string, row])
  );
  const existingByFirebaseUid = new Map(
    existingRows.filter((row) => row.firebase_uid).map((row) => [row.firebase_uid as string, row])
  );
  const existingByUniqueName = buildUniqueNameMap(existingRows);
  const existingNameKeys = new Set(existingRows.map((row) => normalizeMatchKey(row.student_name)).filter(Boolean));
  const { students, duplicateCount } = deduplicateFirebaseStudents(firebaseStudents, existingByFirebaseId);
  const uniqueFirebaseNameKeys = buildUniqueFirebaseNameKeys(students);

  const updatesByTargetId = new Map<string, FirebaseStudentSyncPlan["updates"][number]>();
  const blockedTargetIds = new Set<string>();
  const inserts: FirebaseStudentSyncPlan["inserts"] = [];
  let needsReview = 0;
  let identityConflictsResolved = 0;

  for (const student of students) {
    const canonicalId = firebaseStudentId(student);
    const currentOwner = existingByFirebaseId.get(canonicalId);
    const preferredRow = student.supabaseStudentId ? existingById.get(student.supabaseStudentId) : undefined;
    if (currentOwner && preferredRow && currentOwner.id !== preferredRow.id) {
      identityConflictsResolved += 1;
    }

    let existing = currentOwner ?? (student.firebaseUid ? existingByFirebaseUid.get(student.firebaseUid) : undefined);
    if (!existing) {
      for (const identity of firebaseStudentIdentityIds(student)) {
        existing = existingById.get(identity) ?? existingByFirebaseId.get(identity);
        if (existing) break;
      }
    }
    existing ??= preferredRow;

    const nameKey = normalizeMatchKey(student.name);
    if (!existing && uniqueFirebaseNameKeys.has(nameKey)) {
      existing = existingByUniqueName.get(nameKey);
    }

    const firebaseUidOwner = student.firebaseUid ? existingByFirebaseUid.get(student.firebaseUid) : undefined;
    const safeFirebaseUid =
      !student.firebaseUid || !firebaseUidOwner || firebaseUidOwner.id === existing?.id ? student.firebaseUid || null : null;
    if (student.firebaseUid && firebaseUidOwner && firebaseUidOwner.id !== existing?.id) {
      identityConflictsResolved += 1;
    }

    const payload: Omit<FirebaseStudentPayload, "id"> = {
      student_name: student.name,
      is_active: student.active,
      firebase_student_id: canonicalId,
      firebase_uid: safeFirebaseUid,
      firebase_match_key: [nameKey, normalizeMatchKey(student.school), student.grade.replace(/[^0-9]/g, "")]
        .filter(Boolean)
        .join("|"),
      firebase_sync_status: "matched",
      firebase_synced_at: syncedAt
    };

    if (existing) {
      if (blockedTargetIds.has(existing.id)) {
        needsReview += 1;
        continue;
      }

      const plannedUpdate = {
        id: existing.id,
        payload,
        identityChanged: existing.firebase_student_id !== canonicalId
      };
      const previousUpdate = updatesByTargetId.get(existing.id);
      if (previousUpdate && previousUpdate.payload.firebase_student_id !== canonicalId) {
        const currentIdentity = existing.firebase_student_id;
        if (currentIdentity === canonicalId) {
          updatesByTargetId.set(existing.id, plannedUpdate);
          needsReview += 1;
        } else if (currentIdentity === previousUpdate.payload.firebase_student_id) {
          needsReview += 1;
        } else {
          updatesByTargetId.delete(existing.id);
          blockedTargetIds.add(existing.id);
          needsReview += 2;
        }
        identityConflictsResolved += 1;
        continue;
      }

      updatesByTargetId.set(existing.id, plannedUpdate);
      existingByFirebaseId.set(canonicalId, existing);
      continue;
    }

    if (!uniqueFirebaseNameKeys.has(nameKey) || (existingNameKeys.has(nameKey) && !existingByUniqueName.has(nameKey))) {
      needsReview += 1;
      continue;
    }

    const preferredId =
      student.supabaseStudentId || (UUID_PATTERN.test(canonicalId) && !existingById.has(canonicalId) ? canonicalId : undefined);
    inserts.push({ ...(preferredId ? { id: preferredId } : {}), ...payload });
  }

  return {
    updates: [...updatesByTargetId.values()],
    inserts,
    needsReview,
    duplicateRosterEntries: duplicateCount,
    identityConflictsResolved
  };
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
