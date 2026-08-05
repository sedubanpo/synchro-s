import { createHash } from "node:crypto";

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { mapValue: { fields?: Record<string, FirestoreValue> } }
  | { arrayValue: { values?: FirestoreValue[] } };

type FirestoreDocument = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
};

type FirestoreListResponse = {
  documents?: FirestoreDocument[];
  nextPageToken?: string;
};

export type FirebaseStudentRosterItem = {
  id: string;
  studentId: string;
  canonicalStudentId: string;
  studentIdAliases: string[];
  name: string;
  school: string;
  grade: string;
  secondary: string;
  status: string;
  active: boolean;
  supabaseStudentId?: string;
  firebaseUid?: string;
};

export type FirebaseInstructorAccountItem = {
  uid: string;
  name: string;
  instructorIds: string[];
  status: string;
  active: boolean;
};

export type FirebaseRoster = {
  available: boolean;
  studentsAvailable: boolean;
  students: FirebaseStudentRosterItem[];
  instructorAccountsAvailable: boolean;
  instructorAccounts: FirebaseInstructorAccountItem[];
  duplicateStudentDocuments?: number;
  studentError?: string;
  instructorAccountError?: string;
  error?: string;
};

const DEFAULT_FIREBASE_PROJECT_ID = "fir-lms-prod";
const CACHE_TTL_MS = 60 * 1000;

const rosterCache = new Map<string, { value: FirebaseRoster; expiresAt: number }>();

function rosterCacheKey(idToken: string): string {
  return createHash("sha256").update(idToken).digest("hex");
}

function firebaseProjectId(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID;
}

export function getBearerIdToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function parseFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(parseFirestoreValue);
  if ("mapValue" in value) return parseFirestoreFields(value.mapValue.fields ?? {});
  return undefined;
}

function parseFirestoreFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, parseFirestoreValue(value)]));
}

function docIdFromName(name: string | undefined): string {
  if (!name) return "";
  return decodeURIComponent(name.split("/").pop() ?? "");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(asString).filter(Boolean)));
}

function normalizeStatus(value: unknown, fallbackActive: boolean): string {
  const status = asString(value).toUpperCase();
  if (status) return status;
  return fallbackActive ? "ACTIVE" : "PAUSED";
}

const INACTIVE_ROSTER_STATUSES = new Set([
  "PAUSED",
  "STOPPED",
  "DISABLED",
  "INACTIVE",
  "SUSPENDED",
  "WITHDRAWN",
  "RETURNING",
  "HOLD",
  "중지",
  "보류",
  "퇴원",
  "휴원",
  "미등록",
  "비활성"
]);

export function isFirebaseRosterStudentActive(data: Record<string, unknown>): boolean {
  const explicitActive = data.active !== false && data.isActive !== false;
  const status = normalizeStatus(data.status, explicitActive).replace(/\s+/g, "");
  return explicitActive && !INACTIVE_ROSTER_STATUSES.has(status);
}

export function isFirebaseInstructorAccountActive(...records: Record<string, unknown>[]): boolean {
  return records.every((data) => {
    const explicitActive = data.active !== false && data.isActive !== false;
    const status = normalizeStatus(data.status, explicitActive).replace(/\s+/g, "");
    return explicitActive && !INACTIVE_ROSTER_STATUSES.has(status);
  });
}

export function isStudentActiveFromCanonicalRoster(
  firebaseRosterAvailable: boolean,
  firebaseStudent: FirebaseStudentRosterItem | undefined,
  legacySupabaseActive: boolean | null
): boolean {
  if (firebaseRosterAvailable) {
    return firebaseStudent?.active === true;
  }
  return legacySupabaseActive !== false;
}

function formatStudentSecondary(school: string, grade: string): string {
  const normalizedGrade = grade.replace(/[^0-9]/g, "");
  if (school && normalizedGrade) return `${school} · ${normalizedGrade}학년`;
  return school || (normalizedGrade ? `${normalizedGrade}학년` : "");
}

async function listFirestoreCollection(idToken: string, collectionName: string): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const projectId = firebaseProjectId();
  const rows: Array<{ id: string; data: Record<string, unknown> }> = [];
  let pageToken = "";

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(
        collectionName
      )}`
    );
    url.searchParams.set("pageSize", "500");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Firestore ${collectionName} 목록을 불러오지 못했습니다. (${response.status})`);
    }

    const payload = (await response.json()) as FirestoreListResponse;
    for (const document of payload.documents ?? []) {
      rows.push({
        id: docIdFromName(document.name),
        data: parseFirestoreFields(document.fields ?? {})
      });
    }
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);

  return rows;
}

function normalizeStudent(id: string, data: Record<string, unknown>): FirebaseStudentRosterItem | null {
  const identityStatus = asString(data.identityStatus).toUpperCase();
  if (data.isAlias === true || identityStatus === "ALIAS") return null;
  const name = asString(data.name) || asString(data.studentName);
  if (!name) return null;
  const sourceStudentId = asString(data.studentId) || asString(data.id) || id;
  const canonicalStudentId = asString(data.canonicalStudentId) || sourceStudentId;
  const studentIdAliases = Array.from(
    new Set([canonicalStudentId, sourceStudentId, id, ...asStringArray(data.studentIdAliases)].filter(Boolean))
  );
  const school = asString(data.school);
  const grade = asString(data.grade);
  const active = isFirebaseRosterStudentActive(data);
  return {
    id: canonicalStudentId,
    studentId: canonicalStudentId,
    canonicalStudentId,
    studentIdAliases,
    name,
    school,
    grade,
    secondary: formatStudentSecondary(school, grade),
    status: normalizeStatus(data.status, active),
    active,
    supabaseStudentId: asString(data.supabaseStudentId),
    firebaseUid: asString(data.uid) || asString(data.firebaseUid)
  };
}

function normalizeInstructorAccount(
  uid: string,
  user: Record<string, unknown>,
  profile: Record<string, unknown>
): FirebaseInstructorAccountItem | null {
  const role = (asString(user.role) || asString(profile.role)).toUpperCase();
  const instructorIds = Array.from(
    new Set(
      [
        profile.synchroInstructorId,
        profile.supabaseInstructorId,
        profile.instructorId,
        user.synchroInstructorId,
        user.supabaseInstructorId,
        user.instructorId
      ]
        .map(asString)
        .filter(Boolean)
    )
  );
  const isInstructorRole = ["INSTRUCTOR", "TEACHER", "ADMIN", "COORDINATOR", "STAFF"].includes(role);
  if (instructorIds.length === 0 && !isInstructorRole) return null;

  const name =
    asString(user.name) ||
    asString(user.displayName) ||
    asString(profile.displayName) ||
    asString(profile.name) ||
    asString(profile.synchroInstructorName);
  const status = asString(user.status) || asString(profile.status) || "ACTIVE";
  return {
    uid,
    name,
    instructorIds,
    status,
    active: isFirebaseInstructorAccountActive(user, profile)
  };
}

function rosterItemScore(student: FirebaseStudentRosterItem): number {
  return (
    (student.active ? 16 : 0) +
    (student.school ? 8 : 0) +
    (student.grade ? 4 : 0) +
    (student.supabaseStudentId ? 2 : 0) +
    (student.firebaseUid ? 1 : 0)
  );
}

export function deduplicateFirebaseRosterStudents(students: FirebaseStudentRosterItem[]): {
  students: FirebaseStudentRosterItem[];
  duplicateCount: number;
} {
  const grouped = new Map<string, FirebaseStudentRosterItem[]>();
  for (const student of students) {
    const key = student.canonicalStudentId || student.studentId || student.id;
    const group = grouped.get(key) ?? [];
    group.push(student);
    grouped.set(key, group);
  }

  let duplicateCount = 0;
  const uniqueStudents = [...grouped.values()].map((group) => {
    duplicateCount += group.length - 1;
    const selected = [...group].sort((a, b) => rosterItemScore(b) - rosterItemScore(a))[0];
    const school = selected.school || group.find((student) => student.school)?.school || "";
    const grade = selected.grade || group.find((student) => student.grade)?.grade || "";
    return {
      ...selected,
      school,
      grade,
      secondary: formatStudentSecondary(school, grade),
      active: group.some((student) => student.active),
      supabaseStudentId:
        selected.supabaseStudentId || group.find((student) => student.supabaseStudentId)?.supabaseStudentId,
      firebaseUid: selected.firebaseUid || group.find((student) => student.firebaseUid)?.firebaseUid,
      studentIdAliases: Array.from(
        new Set(
          group.flatMap((student) => [
            student.id,
            student.studentId,
            student.canonicalStudentId,
            ...(student.studentIdAliases ?? [])
          ])
        )
      )
    };
  });

  return { students: uniqueStudents, duplicateCount };
}

export async function loadFirebaseRoster(idToken: string | null, options?: { forceRefresh?: boolean }): Promise<FirebaseRoster> {
  if (!idToken) {
    return {
      available: false,
      studentsAvailable: false,
      students: [],
      instructorAccountsAvailable: false,
      instructorAccounts: [],
      error: "missing-firebase-id-token"
    };
  }

  const now = Date.now();
  for (const [key, entry] of rosterCache.entries()) {
    if (entry.expiresAt <= now) rosterCache.delete(key);
  }
  const cacheKey = rosterCacheKey(idToken);
  const cached = rosterCache.get(cacheKey);
  if (!options?.forceRefresh && cached && cached.expiresAt > now) {
    return cached.value;
  }

  const [studentResult, userResult, profileResult] = await Promise.allSettled([
    listFirestoreCollection(idToken, "students"),
    listFirestoreCollection(idToken, "users"),
    listFirestoreCollection(idToken, "userProfiles")
  ]);

  const studentDocuments = studentResult.status === "fulfilled" ? studentResult.value : [];
  const normalizedStudents = studentDocuments
    .map((doc) => normalizeStudent(doc.id, doc.data))
    .filter((item): item is FirebaseStudentRosterItem => Boolean(item));
  const deduplicated = deduplicateFirebaseRosterStudents(normalizedStudents);

  const userDocuments = userResult.status === "fulfilled" ? userResult.value : [];
  const profileDocuments = profileResult.status === "fulfilled" ? profileResult.value : [];
  const usersByUid = new Map(userDocuments.map((doc) => [doc.id, doc.data]));
  const profilesByUid = new Map(profileDocuments.map((doc) => [doc.id, doc.data]));
  const accountUids = new Set([...usersByUid.keys(), ...profilesByUid.keys()]);
  const instructorAccounts = [...accountUids]
    .map((uid) => normalizeInstructorAccount(uid, usersByUid.get(uid) ?? {}, profilesByUid.get(uid) ?? {}))
    .filter((item): item is FirebaseInstructorAccountItem => Boolean(item));

  const studentsAvailable = studentResult.status === "fulfilled";
  const instructorAccountsAvailable = userResult.status === "fulfilled" || profileResult.status === "fulfilled";
  const studentError = studentResult.status === "rejected"
    ? studentResult.reason instanceof Error
      ? studentResult.reason.message
      : "Firestore students 원장을 불러오지 못했습니다."
    : undefined;
  const accountErrors = [userResult, profileResult]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => (result.reason instanceof Error ? result.reason.message : "Firebase 강사 계정 상태를 불러오지 못했습니다."));
  const instructorAccountError = !instructorAccountsAvailable ? accountErrors.join(" / ") : undefined;
  const value: FirebaseRoster = {
    available: studentsAvailable || instructorAccountsAvailable,
    studentsAvailable,
    students: deduplicated.students,
    instructorAccountsAvailable,
    instructorAccounts,
    duplicateStudentDocuments: deduplicated.duplicateCount,
    studentError,
    instructorAccountError,
    error: studentError ?? instructorAccountError
  };
  rosterCache.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}
