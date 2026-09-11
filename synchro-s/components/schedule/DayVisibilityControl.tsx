"use client";

import { DAYS } from "@/lib/constants";
import type { Weekday } from "@/types/schedule";

export function DayVisibilityControl({ hiddenDays, onChange, className = "" }: {
  hiddenDays: Weekday[];
  onChange: (days: Weekday[]) => void;
  className?: string;
}) {
  return (
    <details className={`rounded-xl border border-slate-200 bg-slate-50/80 ${className}`}>
      <summary className="sync-focus flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-xl p-3 text-xs font-bold text-slate-800">
        <span>요일 숨김</span>
        <span className="text-[10px] font-semibold text-slate-600">{hiddenDays.length}개 숨김</span>
      </summary>
      <div className="border-t border-slate-200 p-3">
        <div className="grid grid-cols-4 gap-1.5">
          {DAYS.map((day) => {
            const hidden = hiddenDays.includes(day.key);
            return <button key={day.key} type="button" aria-pressed={hidden}
              aria-label={`${day.label}요일 ${hidden ? "다시 표시" : "숨기기"}`}
              onClick={() => onChange(hidden ? hiddenDays.filter((key) => key !== day.key) : [...hiddenDays, day.key])}
              className={`sync-focus min-h-10 rounded-lg border text-xs font-bold transition-colors ${hidden ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-blue-50"}`}>
              {day.label}
            </button>;
          })}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-600">표와 캡처에서만 숨깁니다. 저장할 때는 숨긴 수업도 모두 포함됩니다. 화면을 다시 열면 전체 표시됩니다.</p>
        {hiddenDays.length > 0 && <button type="button" onClick={() => onChange([])} className="sync-focus mt-2 min-h-10 text-xs font-bold text-blue-700">요일 전체 표시</button>}
      </div>
    </details>
  );
}
