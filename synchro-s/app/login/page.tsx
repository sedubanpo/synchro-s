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
    <main className="min-h-screen bg-[#d6d3e3] px-4 py-8 md:px-8 md:py-12">
      <section className="mx-auto grid min-h-[82vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-white/50 bg-white/70 shadow-[0_30px_80px_rgba(30,41,59,0.18)] backdrop-blur-xl md:grid-cols-2">
        <div className="relative flex flex-col justify-between border-b border-slate-200/70 bg-white/85 p-8 md:border-b-0 md:border-r md:p-12">
          <div>
            <p className="text-sm font-extrabold text-slate-900">● Synchro-S</p>
            <h1 className="mt-12 text-4xl font-black tracking-tight text-slate-900">Welcome back</h1>
            <p className="mt-3 text-sm font-medium text-slate-500">관리자/코디네이터 계정으로 로그인해 주세요.</p>

            <form className="mt-10 space-y-4" onSubmit={handleSubmit}>
              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">Email</span>
                <input
                  className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-violet-400"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">Password</span>
                <input
                  className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-violet-400"
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
                className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2.5 text-sm font-bold text-white shadow-[0_10px_25px_rgba(139,92,246,0.35)] hover:opacity-95 disabled:opacity-60"
              >
                {checking ? "세션 확인 중..." : submitting ? "로그인 중..." : "로그인"}
              </button>
            </form>
          </div>

          <div className="mt-8">
            <p className="text-xs font-semibold text-slate-500">
              로그인 후 <code>{nextPath}</code>로 이동합니다.
            </p>
            <Link href="/" className="mt-2 inline-block text-xs font-bold text-violet-700 hover:text-violet-800">
              홈으로
            </Link>
          </div>
        </div>

        <div className="relative hidden items-center justify-center bg-[#f6f5fb] md:flex">
          <div className="absolute h-64 w-64 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600" />
          <div className="absolute h-16 w-80 rounded-full bg-[#f6f5fb]/90 backdrop-blur-sm" />
          <div className="absolute top-1/2 h-40 w-40 -translate-y-2 rounded-full bg-violet-600/40 blur-2xl" />
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#d6d3e3] px-4 py-8 md:px-8 md:py-12">
          <section className="mx-auto flex min-h-[82vh] w-full max-w-6xl items-center justify-center rounded-2xl border border-white/50 bg-white/70 shadow-[0_30px_80px_rgba(30,41,59,0.18)] backdrop-blur-xl">
            <p className="text-sm font-semibold text-slate-600">로그인 페이지 로딩 중...</p>
          </section>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
