import crypto from "crypto";

type FirebaseJwtHeader = {
  alg?: string;
  kid?: string;
};

type FirebaseJwtPayload = {
  aud?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  firebase?: unknown;
};

type FirestoreValue =
  | { stringValue: string }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { mapValue: { fields?: Record<string, FirestoreValue> } }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { nullValue: null };

type FirestoreDocument = {
  fields?: Record<string, FirestoreValue>;
};

export type SynchroFirebaseIdentity = {
  uid: string;
  email: string;
  role: "admin" | "coordinator" | "instructor" | "student";
  fullName: string;
  instructorId: string | null;
  studentId: string | null;
  rawRole: string;
  staffPosition: string | null;
  actorIconUrl: string | null;
};

const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const DEFAULT_FIREBASE_PROJECT_ID = "fir-lms-prod";

let certCache: { expiresAt: number; certs: Record<string, string> } | null = null;
const FIREBASE_SERVER_TIMEOUT_MS = 15_000;

async function fetchFirebaseResource(input: string, init: RequestInit, label: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FIREBASE_SERVER_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function firebaseProjectId(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID;
}

function decodeBase64UrlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

async function loadFirebaseCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (certCache && certCache.expiresAt > now + 60_000) {
    return certCache.certs;
  }

  const response = await fetchFirebaseResource(CERTS_URL, { cache: "no-store" }, "Firebase 인증서 확인");
  if (!response.ok) {
    throw new Error("Firebase 인증서를 불러오지 못했습니다.");
  }

  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 60 * 60 * 1000;
  const certs = (await response.json()) as Record<string, string>;
  certCache = { certs, expiresAt: now + maxAgeMs };
  return certs;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseJwtPayload & { uid: string }> {
  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Firebase ID 토큰 형식이 올바르지 않습니다.");
  }

  const header = decodeBase64UrlJson<FirebaseJwtHeader>(encodedHeader);
  const payload = decodeBase64UrlJson<FirebaseJwtPayload>(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Firebase ID 토큰 헤더가 올바르지 않습니다.");
  }

  const certs = await loadFirebaseCerts();
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error("Firebase ID 토큰 인증서 키를 찾지 못했습니다.");
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const signature = Buffer.from(encodedSignature, "base64url");
  if (!verifier.verify(cert, signature)) {
    throw new Error("Firebase ID 토큰 서명이 유효하지 않습니다.");
  }

  const projectId = firebaseProjectId();
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error("Firebase ID 토큰 프로젝트가 Synchro-S 설정과 일치하지 않습니다.");
  }
  if (!payload.sub || payload.sub.length > 128) {
    throw new Error("Firebase ID 토큰 사용자 식별자가 올바르지 않습니다.");
  }
  if (!payload.exp || payload.exp < now) {
    throw new Error("Firebase ID 토큰이 만료되었습니다.");
  }
  if (!payload.iat || payload.iat > now + 300) {
    throw new Error("Firebase ID 토큰 발급 시간이 올바르지 않습니다.");
  }

  return { ...payload, uid: payload.sub };
}

function parseFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(parseFirestoreValue);
  if ("mapValue" in value) return parseFirestoreFields(value.mapValue.fields ?? {});
  return undefined;
}

function parseFirestoreFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, parseFirestoreValue(value)]));
}

async function getFirestoreDoc(idToken: string, collection: string, docId: string): Promise<Record<string, unknown>> {
  const projectId = firebaseProjectId();
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(
    collection
  )}/${encodeURIComponent(docId)}`;
  const response = await fetchFirebaseResource(
    url,
    {
      headers: {
        Authorization: `Bearer ${idToken}`
      },
      cache: "no-store"
    },
    "Firebase 계정 정보 확인"
  );
  if (response.status === 404) return {};
  if (!response.ok) {
    throw new Error(`Firestore ${collection}/${docId} 문서를 확인하지 못했습니다.`);
  }
  const doc = (await response.json()) as FirestoreDocument;
  return parseFirestoreFields(doc.fields ?? {});
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mapFirebaseRole(rawRole: string): SynchroFirebaseIdentity["role"] {
  const role = rawRole.trim().toUpperCase();
  if (role === "ADMIN") return "admin";
  if (role === "COORDINATOR" || role === "STAFF") return "coordinator";
  if (role === "STUDENT") return "student";
  return "instructor";
}

function sharedIconDocumentId(lookupKey: string): string {
  return crypto.createHash("sha256").update(lookupKey).digest("hex").slice(0, 32);
}

async function resolveStaffIconUrl(
  idToken: string,
  uid: string,
  staffPosition: string,
  profileImageUrl: string
): Promise<string | null> {
  const lookupKeys = [`user:${uid}`, staffPosition ? `staff-position:${staffPosition}` : ""].filter(Boolean);
  for (const lookupKey of lookupKeys) {
    const iconDoc = await getFirestoreDoc(idToken, "sharedIconAssets", sharedIconDocumentId(lookupKey));
    const status = asString(iconDoc.status).toUpperCase();
    const imageUrl = asString(iconDoc.imageUrl);
    if (imageUrl && status !== "DISABLED" && status !== "INACTIVE") return imageUrl;
  }
  return profileImageUrl || null;
}

export async function resolveSynchroFirebaseIdentity(idToken: string): Promise<SynchroFirebaseIdentity> {
  const verified = await verifyFirebaseIdToken(idToken);
  const [userDoc, profileDoc, accessDoc] = await Promise.all([
    getFirestoreDoc(idToken, "users", verified.uid),
    getFirestoreDoc(idToken, "userProfiles", verified.uid),
    getFirestoreDoc(idToken, "userAppAccess", verified.uid)
  ]);

  const apps = asRecord(accessDoc.apps);
  const synchroAccess = asRecord(accessDoc.synchroS);
  const rawRole = asString(userDoc.role) || asString(profileDoc.role) || asString(synchroAccess.role) || "INSTRUCTOR";
  const mappedRole = mapFirebaseRole(rawRole);
  const status = (asString(userDoc.status) || asString(profileDoc.status) || rawRole).toUpperCase();
  const staffPosition = asString(userDoc.staffPosition) || asString(profileDoc.staffPosition);
  const profileImageUrl =
    asString(userDoc.profileImageUrl) ||
    asString(profileDoc.profileImageUrl) ||
    asString(profileDoc.photoURL) ||
    asString(profileDoc.photoUrl);

  if (status === "DISABLED" || rawRole.toUpperCase() === "DISABLED") {
    throw new Error("비활성화된 Firebase 계정입니다.");
  }
  if (apps.synchroS !== true && mappedRole !== "admin" && mappedRole !== "coordinator") {
    throw new Error("Synchro-S 접근 권한이 없는 Firebase 계정입니다.");
  }

  const actorIconUrl =
    mappedRole === "admin" || mappedRole === "coordinator"
      ? await resolveStaffIconUrl(idToken, verified.uid, staffPosition, profileImageUrl)
      : profileImageUrl || null;

  return {
    uid: verified.uid,
    email: asString(verified.email) || asString(userDoc.email),
    role: mappedRole,
    rawRole,
    fullName: asString(userDoc.name) || asString(profileDoc.displayName) || asString(synchroAccess.instructorName) || asString(verified.email) || verified.uid,
    instructorId:
      asString(profileDoc.synchroInstructorId) ||
      asString(profileDoc.supabaseInstructorId) ||
      asString(synchroAccess.supabaseInstructorId) ||
      asString(synchroAccess.instructorId) ||
      null,
    studentId:
      asString(profileDoc.synchroStudentId) ||
      asString(profileDoc.supabaseStudentId) ||
      asString(profileDoc.studentId) ||
      asString(synchroAccess.supabaseStudentId) ||
      null,
    staffPosition: staffPosition || null,
    actorIconUrl
  };
}
