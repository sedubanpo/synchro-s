"use client";

import Link from "next/link";
import { getSynchroFirebaseAuth, getSynchroFirestore } from "@/lib/firebase/client";
import { doc, getDoc } from "firebase/firestore";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";

type FeatureItemProps = {
  title: string;
  description: string;
  icon: "calendar" | "users" | "archive";
};

type LoginAliasDoc = {
  active?: boolean;
  email?: string;
};

const LOGIN_TIMEOUTS = {
  alias: 15_000,
  firebaseAuth: 20_000,
  session: 25_000,
  access: 20_000
} as const;

async function withLoginTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchWithLoginTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number, message: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(message);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeFirebaseLoginDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

function canonicalFirebaseLoginId(value: string): string {
  const normalized = normalizeFirebaseLoginDigits(value);
  if (normalized.length === 8) return `010${normalized}`;
  if (normalized.length === 10 && normalized.charAt(0) !== "0") return `0${normalized}`;
  return normalized;
}

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildFirebaseLoginAliasCandidates(value: string): string[] {
  const rawDigits = normalizeFirebaseLoginDigits(value);
  const canonical = canonicalFirebaseLoginId(value);
  return uniqueList([canonical, canonical.startsWith("010") && canonical.length === 11 ? canonical.slice(3) : "", rawDigits]);
}

function buildFirebasePasswordCandidates(value: string): string[] {
  const raw = value.trim();
  const canonical = canonicalFirebaseLoginId(raw);
  return uniqueList([raw, canonical].filter((item) => item.length >= 6));
}

async function sha256Hex(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function findFirebaseLoginAlias(loginId: string): Promise<LoginAliasDoc> {
  const firestore = getSynchroFirestore();
  for (const alias of buildFirebaseLoginAliasCandidates(loginId)) {
    const aliasHash = await sha256Hex(alias);
    const snapshot = await withLoginTimeout(
      getDoc(doc(firestore, "loginAliases", aliasHash)),
      LOGIN_TIMEOUTS.alias,
      "계정 확인 응답이 지연되고 있습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요."
    );
    if (!snapshot.exists()) continue;
    const data = snapshot.data() as LoginAliasDoc;
    if (data.active === false) {
      throw new Error("비활성화된 계정입니다. 관리자에게 문의하세요.");
    }
    if (data.email) return data;
  }
  throw new Error("Firebase 계정을 찾지 못했습니다. S-LMS 계정 정보와 동일한 아이디를 입력해 주세요.");
}

async function signInWithFirebase(loginId: string, password: string): Promise<string> {
  const alias = await findFirebaseLoginAlias(loginId);
  if (!alias.email) {
    throw new Error("Firebase 로그인 이메일이 설정되지 않은 계정입니다.");
  }
  const auth = getSynchroFirebaseAuth();
  const candidates = buildFirebasePasswordCandidates(password);
  if (!candidates.length) {
    throw new Error("비밀번호를 입력해 주세요.");
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const credential = await withLoginTimeout(
        signInWithEmailAndPassword(auth, alias.email, candidate),
        LOGIN_TIMEOUTS.firebaseAuth,
        "Firebase 인증 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
      );
      return await credential.user.getIdToken();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Firebase 로그인에 실패했습니다.");
}

function FeatureIcon({ type }: { type: FeatureItemProps["icon"] }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700">
      {type === "calendar" ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M7 3v3M17 3v3M4 9h16" strokeLinecap="round" />
          <path d="M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
          <path d="M8 13h3M8 16h2M14 13h2" strokeLinecap="round" />
        </svg>
      ) : type === "users" ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4" strokeLinecap="round" />
          <circle cx="12" cy="9" r="3" />
          <path d="M4.5 18c.4-1.6 1.5-2.8 3-3.4M19.5 18c-.4-1.6-1.5-2.8-3-3.4" strokeLinecap="round" />
          <path d="M7 11a2.3 2.3 0 1 1 0-4.6M17 11a2.3 2.3 0 1 0 0-4.6" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3Z" />
          <path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" />
          <path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
        </svg>
      )}
    </span>
  );
}

function FeatureItem({ title, description, icon }: FeatureItemProps) {
  return (
    <div className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <FeatureIcon type={icon} />
      <div>
        <p className="text-sm font-bold text-slate-900">{title}</p>
        <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
      </div>
    </div>
  );
}

function TimetablePreview() {
  const days = ["월", "화", "수", "목", "금"];
  const rows = ["10-11시", "13-14시", "16-17시", "19-20시"];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Weekly Preview</p>
          <p className="mt-1 text-sm font-bold text-slate-900">주간 시간표 관리</p>
        </div>
        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">저장됨</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <div className="grid grid-cols-[72px_repeat(5,minmax(0,1fr))] border-b border-slate-200 bg-slate-50 text-center text-[11px] font-bold text-slate-600">
          <div className="border-r border-slate-200 px-2 py-2">시간</div>
          {days.map((day) => (
            <div key={day} className="border-r border-slate-200 px-2 py-2 last:border-r-0">
              {day}
            </div>
          ))}
        </div>

        {rows.map((row, rowIndex) => (
          <div key={row} className="grid min-h-[52px] grid-cols-[72px_repeat(5,minmax(0,1fr))] border-b border-slate-100 last:border-b-0">
            <div className="flex items-center justify-center border-r border-slate-100 bg-slate-50 px-2 text-[11px] font-semibold text-slate-600">
              {row}
            </div>
            {days.map((day, dayIndex) => {
              const showBlue = rowIndex === 0 && dayIndex === 2;
              const showEmerald = rowIndex === 1 && dayIndex === 1;
              const showAmber = rowIndex === 2 && dayIndex === 3;
              const showViolet = rowIndex === 3 && dayIndex === 2;
              const hasClass = showBlue || showEmerald || showAmber || showViolet;
              const className = showBlue
                ? "border-blue-200 bg-blue-50 text-blue-900"
                : showEmerald
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : showAmber
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-violet-200 bg-violet-50 text-violet-900";

              return (
                <div key={`${row}-${day}`} className="border-r border-slate-100 p-1 last:border-r-0">
                  {hasClass ? (
                    <div className={`rounded-md border px-2 py-1.5 text-[10px] font-bold ${className}`}>
                      <p>{showBlue ? "수학" : showEmerald ? "국어" : showAmber ? "사탐" : "영어"}</p>
                      <p className="mt-0.5 font-semibold opacity-75">{row.replace("시", ":00")}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/synchro-s", [searchParams]);

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const verifyAccess = useCallback(async (): Promise<boolean> => {
    const res = await fetchWithLoginTimeout(
      "/api/schedules/options",
      { method: "GET", cache: "no-store" },
      LOGIN_TIMEOUTS.access,
      "로그인 권한 확인이 지연되고 있습니다. 다시 시도해 주세요."
    );
    if (res.ok) {
      return true;
    }

    if (res.status === 403) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "로그인 계정은 앱 접근 권한이 없습니다.");
      return false;
    }

    if (res.status === 401) {
      return false;
    }

    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setError(payload.error ?? "권한 확인 중 오류가 발생했습니다.");
    return false;
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const sessionRes = await fetchWithLoginTimeout(
          "/api/auth/session",
          { method: "GET", cache: "no-store" },
          LOGIN_TIMEOUTS.access,
          "기존 로그인 상태 확인이 지연되고 있습니다."
        );
        if (sessionRes.ok && (await verifyAccess())) {
          router.replace(nextPath);
        }
      } catch {
        // Ignore auto-session check failures and allow manual login.
      } finally {
        setChecking(false);
      }
    };
    void bootstrap();
  }, [nextPath, router, verifyAccess]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      let loginRes: Response;
      try {
        const idToken = await signInWithFirebase(loginId, password);
        loginRes = await fetchWithLoginTimeout(
          "/api/auth/login",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken })
          },
          LOGIN_TIMEOUTS.session,
          "로그인 세션 생성이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
        );
      } catch (firebaseError) {
        if (process.env.NEXT_PUBLIC_ENABLE_LEGACY_SHEET_LOGIN !== "true") {
          throw firebaseError instanceof Error ? firebaseError : new Error("Firebase 로그인에 실패했습니다.");
        }
        loginRes = await fetchWithLoginTimeout(
          "/api/auth/login",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: loginId,
              password
            })
          },
          LOGIN_TIMEOUTS.session,
          "로그인 세션 생성이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
        );
      }

      if (!loginRes.ok) {
        const payload = (await loginRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "로그인에 실패했습니다.");
      }

      if (await verifyAccess()) {
        router.replace(nextPath);
        router.refresh();
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "로그인에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const isBusy = submitting || checking;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-7xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[1.05fr_0.95fr]">
        <section className="order-2 flex flex-col border-t border-slate-200 bg-slate-50/60 p-6 sm:p-8 lg:order-1 lg:border-r lg:border-t-0 lg:p-12">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-2xl font-black text-white shadow-sm">
                S
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-2xl font-black tracking-tight text-slate-950">Synchro-S</p>
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                    Timetable DB
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-500">학원 시간표 운영 관리 시스템</p>
              </div>
            </div>

            <div className="mt-12 max-w-2xl">
              <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                시간표 운영을 더 쉽고 <span className="text-blue-600">정확하게</span>
              </h1>
              <p className="mt-4 text-base font-medium leading-7 text-slate-600">
                강사·학생 시간표 조회, 노션 반영, 그룹 저장과 변경 이력을 한 화면에서 관리합니다.
              </p>
            </div>

            <div className="mt-8 grid gap-3">
              <FeatureItem
                icon="calendar"
                title="주간 시간표 통합 관리"
                description="주간 시간표를 한눈에 확인하고 강사·학생별로 체계적으로 관리합니다."
              />
              <FeatureItem
                icon="users"
                title="강사·학생 기준 조회"
                description="담당 강사와 학생 기준으로 수업 배치와 변경을 빠르게 확인합니다."
              />
              <FeatureItem
                icon="archive"
                title="저장 그룹 관리"
                description="저장된 시간표 그룹과 변경 이력을 안전하게 관리합니다."
              />
            </div>
          </div>

          <div className="mt-8">
            <TimetablePreview />
          </div>
        </section>

        <section className="order-1 flex items-start justify-center bg-white p-6 sm:p-8 lg:order-2 lg:p-12">
          <div className="w-full max-w-md">
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Secure Access</p>
                <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">Synchro-S 로그인</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  아이디와 비밀번호를 입력하고 시간표 관리 시스템에 로그인하세요.
                </p>
              </div>

              <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="login-id" className="block text-sm font-semibold text-slate-700">
                    아이디
                  </label>
                  <input
                    id="login-id"
                    className={`mt-2 h-11 w-full rounded-lg border bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 ${
                      error
                        ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                        : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"
                    }`}
                    type="text"
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    placeholder="예: 01012345678"
                    autoComplete="username"
                    required
                  />
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">
                    휴대전화 번호를 입력하세요. 하이픈은 생략할 수 있습니다.
                  </p>
                </div>

                <div>
                  <label htmlFor="login-password" className="block text-sm font-semibold text-slate-700">
                    비밀번호
                  </label>
                  <input
                    id="login-password"
                    className={`mt-2 h-11 w-full rounded-lg border bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 ${
                      error
                        ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                        : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"
                    }`}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="비밀번호 입력"
                    autoComplete="current-password"
                    required
                  />
                </div>

                {error ? (
                  <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={isBusy}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {isBusy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
                  {checking ? "세션 확인 중..." : submitting ? "로그인 중..." : "로그인"}
                </button>
              </form>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-700">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 3 5 6v5c0 4.4 2.8 8.4 7 10 4.2-1.6 7-5.6 7-10V6l-7-3Z" />
                    <path d="m9 12 2 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-900">운영 안내</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    로그인 후 즉시 편집 화면으로 이동하지 않고, 홈 화면에서 안내와 작업 흐름을 먼저 확인할 수 있습니다.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-slate-500">
              <p>© 2026 Synchro-S</p>
              <Link href="/" className="text-blue-700 hover:text-blue-800">
                홈으로 이동
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
          <section className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
            <p className="text-sm font-semibold text-slate-600">로그인 페이지 로딩 중...</p>
          </section>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
