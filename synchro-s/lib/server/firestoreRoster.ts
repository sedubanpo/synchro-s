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

export type FirebaseRoster = {
  available: boolean;
  studentsAvailable: boolean;
  students: FirebaseStudentRosterItem[];
  duplicateStudentDocuments?: number;
  studentError?: string;
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

function isRosterActive(data: Record<string, unknown>): boolean {
  const explicitActive = data.active !== false && data.isActive !== false;
  const status = normalizeStatus(data.status, explicitActive);
  return explicitActive && !["PAUSED", "STOPPED", "DISABLED", "INACTIVE", "SUSPENDED"].includes(status);
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
  const active = isRosterActive(data);
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

  try {
    const studentDocuments = await listFirestoreCollection(idToken, "students");
    const normalizedStudents = studentDocuments
      .map((doc) => normalizeStudent(doc.id, doc.data))
      .filter((item): item is FirebaseStudentRosterItem => Boolean(item));
    const deduplicated = deduplicateFirebaseRosterStudents(normalizedStudents);
    const value: FirebaseRoster = {
      available: true,
      studentsAvailable: true,
      students: deduplicated.students,
      duplicateStudentDocuments: deduplicated.duplicateCount
    };
    rosterCache.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  } catch (error) {
    const studentError = error instanceof Error ? error.message : "Firestore students 원장을 불러오지 못했습니다.";
    const value: FirebaseRoster = {
      available: false,
      studentsAvailable: false,
      students: [],
      studentError,
      error: studentError
    };
    rosterCache.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  }
}
