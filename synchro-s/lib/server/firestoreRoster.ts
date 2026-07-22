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

export type FirebaseInstructorRosterItem = {
  id: string;
  instructorId: string;
  name: string;
  subject: string;
  status: string;
  active: boolean;
  supabaseInstructorId?: string;
  firebaseUid?: string;
};

export type FirebaseRoster = {
  available: boolean;
  students: FirebaseStudentRosterItem[];
  instructors: FirebaseInstructorRosterItem[];
  error?: string;
};

const DEFAULT_FIREBASE_PROJECT_ID = "fir-lms-prod";
const CACHE_TTL_MS = 60 * 1000;

let rosterCache: { value: FirebaseRoster; expiresAt: number } | null = null;

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

function normalizeInstructor(id: string, data: Record<string, unknown>): FirebaseInstructorRosterItem | null {
  const name = asString(data.name) || asString(data.instructorName) || asString(data.displayName);
  if (!name) return null;
  const instructorId = asString(data.instructorId) || asString(data.id) || id;
  const active = isRosterActive(data);
  return {
    id,
    instructorId,
    name,
    subject: asString(data.subject) || asString(data.department),
    status: normalizeStatus(data.status, active),
    active,
    supabaseInstructorId: asString(data.supabaseInstructorId),
    firebaseUid: asString(data.uid) || asString(data.firebaseUid)
  };
}

export async function loadFirebaseRoster(idToken: string | null, options?: { forceRefresh?: boolean }): Promise<FirebaseRoster> {
  if (!idToken) {
    return { available: false, students: [], instructors: [], error: "missing-firebase-id-token" };
  }

  const now = Date.now();
  if (!options?.forceRefresh && rosterCache && rosterCache.expiresAt > now) {
    return rosterCache.value;
  }

  try {
    const [studentDocs, instructorDocs] = await Promise.all([
      listFirestoreCollection(idToken, "students"),
      listFirestoreCollection(idToken, "instructors")
    ]);
    const value: FirebaseRoster = {
      available: true,
      students: studentDocs.map((doc) => normalizeStudent(doc.id, doc.data)).filter((item): item is FirebaseStudentRosterItem => Boolean(item)),
      instructors: instructorDocs
        .map((doc) => normalizeInstructor(doc.id, doc.data))
        .filter((item): item is FirebaseInstructorRosterItem => Boolean(item))
    };
    rosterCache = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (error) {
    return {
      available: false,
      students: [],
      instructors: [],
      error: error instanceof Error ? error.message : "Firestore 원장을 불러오지 못했습니다."
    };
  }
}
