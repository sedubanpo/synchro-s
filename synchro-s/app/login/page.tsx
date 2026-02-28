"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/synchro-s", [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const verifyAccess = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/schedules/options", { method: "GET", cache: "no-store" });
    if (res.ok) {
      return true;
    }

    if (res.status === 403) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "로그인 계정은 앱 접근 권한이 없습니다. public.users role 매핑을 확인하세요.");
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
        const supabase = createSupabaseBrowserClient();
        const {
          data: { session }
        } = await supabase.auth.getSession();
        if (session && (await verifyAccess())) {
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
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (signInError) {
        throw signInError;
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

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_22%),radial-gradient(circle_at_90%_10%,#bfdbfe,transparent_18%),linear-gradient(180deg,#d7d9e7,#dfe7ec)] px-4 py-8 md:px-8 md:py-12">
      <section className="mx-auto grid min-h-[82vh] w-full max-w-6xl overflow-hidden rounded-[32px] border border-white/45 bg-white/35 shadow-[0_30px_80px_rgba(30,41,59,0.14)] backdrop-blur-xl md:grid-cols-[1.05fr_0.95fr]">
        <div className="relative flex flex-col justify-between border-b border-white/35 bg-white/45 p-8 backdrop-blur-md md:border-b-0 md:border-r md:p-12">
          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-white/55 bg-white/55 px-4 py-2 text-sm font-black text-slate-900 shadow-sm shadow-slate-900/5">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
              Synchro-S
            </div>
            <h1 className="mt-10 text-5xl font-black tracking-tight text-slate-900">Timetable DB Login</h1>
            <p className="mt-4 text-base font-semibold leading-7 text-slate-500">
              강사/학생 시간표를 조회하고, 노션 데이터를 반영하고, 주간 그룹을 저장하는 운영용 화면입니다.
              관리자/코디네이터 계정으로 로그인해 주세요.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["조회", "강사/학생 기준 주간 시간표 확인"],
                ["반영", "노션 표를 미리보기 후 DB 저장"],
                ["관리", "저장 그룹과 변경 이력 운영"]
              ].map(([title, body]) => (
                <div key={title} className="rounded-3xl border border-white/60 bg-white/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700">{title}</p>
                  <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{body}</p>
                </div>
              ))}
            </div>

            <form className="mt-10 space-y-4" onSubmit={handleSubmit}>
              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">Email</span>
                <input
                  className="w-full rounded-2xl border border-white/60 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-800 outline-none shadow-inner shadow-white/40 focus:border-sky-300"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">Password</span>
                <input
                  className="w-full rounded-2xl border border-white/60 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-800 outline-none shadow-inner shadow-white/40 focus:border-sky-300"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>

              {error ? <p className="text-xs font-semibold text-rose-600">{error}</p> : null}

              <button
                type="submit"
                disabled={submitting || checking}
                className="w-full rounded-2xl bg-[linear-gradient(135deg,#2563eb,#7c3aed,#06b6d4)] px-4 py-3 text-sm font-black text-white shadow-[0_16px_36px_rgba(59,130,246,0.28)] hover:opacity-95 disabled:opacity-60"
              >
                {checking ? "세션 확인 중..." : submitting ? "로그인 중..." : "로그인"}
              </button>
            </form>
          </div>

          <div className="mt-8">
            <p className="text-xs font-semibold text-slate-500">
              로그인 후 <code className="rounded-md bg-white/60 px-1.5 py-0.5">{nextPath}</code> 홈화면으로 이동해 운영 가이드를 먼저 표시합니다.
            </p>
            <Link href="/" className="mt-2 inline-block text-xs font-bold text-sky-700 hover:text-sky-800">
              홈으로
            </Link>
          </div>
        </div>

        <div className="relative hidden overflow-hidden bg-[linear-gradient(160deg,rgba(219,234,254,0.82),rgba(224,242,254,0.64),rgba(191,219,254,0.82))] md:flex">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.75),transparent_24%),radial-gradient(circle_at_80%_75%,rgba(37,99,235,0.24),transparent_28%)]" />
          <div className="relative z-10 flex w-full flex-col justify-between p-12">
            <div className="rounded-[32px] border border-white/55 bg-white/28 p-6 shadow-xl shadow-slate-900/5 backdrop-blur-md">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-700">Synchro-S Platform</p>
              <p className="mt-4 text-3xl font-black tracking-tight text-slate-900">시간표 운영을 위한 단일 워크스페이스</p>
              <p className="mt-4 text-sm font-semibold leading-7 text-slate-600">
                강사/학생 시간표, 노션 반영, 그룹 저장을 분리된 단계로 관리해 입력 실수를 줄이고 주간 운영 속도를 높입니다.
              </p>
            </div>

            <div className="relative mx-auto mt-8 flex h-[340px] w-[340px] items-center justify-center">
              <div className="absolute h-72 w-72 rounded-full bg-[conic-gradient(from_180deg_at_50%_50%,#1d4ed8,#38bdf8,#7c3aed,#1d4ed8)] opacity-95" />
              <div className="absolute h-52 w-80 rounded-[40px] border border-white/35 bg-white/55 backdrop-blur-md" />
              <div className="absolute h-80 w-80 rounded-full bg-blue-500/18 blur-3xl" />
              <div className="absolute inset-10 rounded-[32px] border border-white/35 bg-white/18 p-5 backdrop-blur-sm">
                <div className="flex h-full flex-col justify-between">
                  <div className="rounded-2xl border border-white/30 bg-white/18 p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/80">DB Flow</p>
                    <p className="mt-3 text-sm font-bold text-white">입력 → 검수 → 저장</p>
                  </div>
                  <div className="grid gap-3">
                    {["Instructor / Student", "Notion Preview", "Weekly Group Save"].map((item) => (
                      <div key={item} className="rounded-2xl border border-white/25 bg-white/14 px-4 py-3 text-center text-xs font-bold text-white/90">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/55 bg-white/28 p-5 backdrop-blur-md">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">운영 메모</p>
              <p className="mt-3 text-sm font-semibold leading-7 text-slate-600">
                로그인 후 즉시 편집 화면으로 진입하지 않고, 홈화면에서 안내와 작업 흐름을 먼저 확인하도록 변경되었습니다.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_22%),radial-gradient(circle_at_90%_10%,#bfdbfe,transparent_18%),linear-gradient(180deg,#d7d9e7,#dfe7ec)] px-4 py-8 md:px-8 md:py-12">
          <section className="mx-auto flex min-h-[82vh] w-full max-w-6xl items-center justify-center rounded-[32px] border border-white/45 bg-white/35 shadow-[0_30px_80px_rgba(30,41,59,0.14)] backdrop-blur-xl">
            <p className="text-sm font-semibold text-slate-600">로그인 페이지 로딩 중...</p>
          </section>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
