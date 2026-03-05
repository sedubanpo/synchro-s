import crypto from "crypto";
type AppUserRole = "admin" | "coordinator" | "instructor" | "student";

const COOKIE_NAME = "synchro_s_session";
const DEFAULT_TTL_SECONDS = 60 * 60 * 12;

type SessionPayload = {
  role: AppUserRole;
  fullName: string;
  instructorId?: string | null;
  issuedAt: number;
  expiresAt: number;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(data: string): string {
  const secret = process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || "";
  if (!secret) {
    throw new Error("Missing SESSION_SECRET (or NEXTAUTH_SECRET) for sheet-session signing");
  }
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

export function buildSessionToken(input: { fullName: string; role: AppUserRole; instructorId?: string | null }): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    role: input.role,
    fullName: input.fullName,
    instructorId: input.instructorId ?? null,
    issuedAt: now,
    expiresAt: now + DEFAULT_TTL_SECONDS
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(body);
  return `${body}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  if (signature.length !== expected.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(base64UrlDecode(body)) as SessionPayload;
    if (!["admin", "coordinator", "instructor", "student"].includes(payload.role)) return null;
    if (!payload.fullName) return null;
    const now = Math.floor(Date.now() / 1000);
    if (!payload.expiresAt || payload.expiresAt < now) return null;
    return payload;
  } catch {
    return null;
  }
}
