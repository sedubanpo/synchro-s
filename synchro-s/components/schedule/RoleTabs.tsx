import type { RoleView } from "@/types/schedule";
import clsx from "clsx";

type RoleTabsProps = {
  value: RoleView;
  onChange: (next: RoleView) => void;
};

export function RoleTabs({ value, onChange }: RoleTabsProps) {
  const accent = value === "instructor" ? "from-blue-400/50 to-indigo-500/45" : "from-emerald-300/55 to-teal-500/45";
  return (
    <div className="relative inline-flex rounded-2xl border border-white/55 bg-white/35 p-1 shadow-[0_12px_34px_rgba(31,38,135,0.20)] backdrop-blur-xl">
      <span
        className={`pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-r ${accent} opacity-35 blur-md`}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => onChange("instructor")}
        className={clsx(
          "relative z-10 rounded-xl px-4 py-2 text-sm font-semibold transition",
          value === "instructor"
            ? "bg-white/90 text-slate-900 shadow-[inset_0_-2px_0_rgba(59,130,246,0.45),0_7px_16px_rgba(59,130,246,0.30)]"
            : "text-slate-700 hover:bg-white/70"
        )}
      >
        강사
      </button>
      <button
        type="button"
        onClick={() => onChange("student")}
        className={clsx(
          "relative z-10 rounded-xl px-4 py-2 text-sm font-semibold transition",
          value === "student"
            ? "bg-white/90 text-slate-900 shadow-[inset_0_-2px_0_rgba(16,185,129,0.45),0_7px_16px_rgba(16,185,129,0.30)]"
            : "text-slate-700 hover:bg-white/70"
        )}
      >
        학생
      </button>
    </div>
  );
}
