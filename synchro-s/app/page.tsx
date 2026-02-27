import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">Synchro-S</h1>
      <p className="max-w-xl text-sm text-slate-600">
        Tutoring academy schedule manager with role-separated Instructor and Student views.
      </p>
      <Link
        href="/synchro-s"
        className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-blue-700"
      >
        Open Timetable
      </Link>
      <Link
        href="/login?next=/synchro-s"
        className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Login
      </Link>
    </main>
  );
}
