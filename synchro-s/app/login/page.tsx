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
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Synchro-S Login</h1>
        <p className="mt-1 text-sm text-slate-500">관리자/코디네이터 계정으로 로그인하세요.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">Email</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">Password</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
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
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {checking ? "세션 확인 중..." : submitting ? "로그인 중..." : "로그인"}
          </button>
        </form>

        <div className="mt-4 text-center text-xs text-slate-500">
          로그인 후 <code>{nextPath}</code>로 이동합니다.
        </div>
        <div className="mt-2 text-center">
          <Link href="/" className="text-xs font-semibold text-blue-600 hover:text-blue-700">
            홈으로
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
          <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-600">로그인 페이지 로딩 중...</p>
          </section>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
