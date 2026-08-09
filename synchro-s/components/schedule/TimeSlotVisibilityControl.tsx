"use client";

import { formatTimeSlotRange } from "@/lib/timetableSlots";

type TimeSlotVisibilityControlProps = {
  timeSlots: string[];
  hiddenTimeSlots: string[];
  onChange: (timeSlots: string[]) => void;
  className?: string;
};

export function TimeSlotVisibilityControl({
  timeSlots,
  hiddenTimeSlots,
  onChange,
  className = ""
}: TimeSlotVisibilityControlProps) {
  const hiddenSet = new Set(hiddenTimeSlots);
  const hiddenCount = timeSlots.filter((slot) => hiddenSet.has(slot)).length;

  const toggleTimeSlot = (slot: string) => {
    if (hiddenSet.has(slot)) {
      onChange(hiddenTimeSlots.filter((item) => item !== slot));
      return;
    }
    onChange(timeSlots.filter((item) => hiddenSet.has(item) || item === slot));
  };

  return (
    <details className={`group rounded-xl border border-slate-200 bg-slate-50/80 ${className}`}>
      <summary className="sync-focus flex min-h-12 cursor-pointer list-none items-start justify-between gap-3 rounded-xl p-3 marker:hidden hover:bg-blue-50/60 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5v5l3.25 2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <h3 className="text-xs font-black text-slate-800">
                시간대 숨김
              </h3>
              <p className="mt-0.5 text-[10px] font-semibold text-slate-500">숨길 시간을 선택하세요.</p>
            </div>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <span className="sync-tabular rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-600">
            {hiddenCount}개 숨김
          </span>
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>

      <div className="grid grid-cols-2 gap-1.5 border-t border-slate-200 px-3 pt-3">
        {timeSlots.map((slot) => {
          const isHidden = hiddenSet.has(slot);
          return (
            <button
              key={slot}
              type="button"
              aria-pressed={isHidden}
              aria-label={`${formatTimeSlotRange(slot)} ${isHidden ? "다시 표시" : "숨기기"}`}
              onClick={() => toggleTimeSlot(slot)}
              className={`sync-pressable sync-focus min-h-9 rounded-lg border px-2 py-2 text-[11px] font-black ${
                isHidden
                  ? "border-slate-700 bg-slate-800 text-white shadow-sm"
                  : "border-slate-200 bg-white text-blue-950 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
              }`}
            >
              {formatTimeSlotRange(slot)}
            </button>
          );
        })}
      </div>

      <div className="mx-3 mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pb-3 pt-3">
        <p className="text-[10px] font-semibold leading-4 text-slate-500">
          표와 캡처에서만 숨겨지며 저장 데이터는 유지됩니다.
        </p>
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="sync-pressable sync-focus shrink-0 rounded-full border border-blue-200 bg-white px-2.5 py-1.5 text-[10px] font-black text-blue-700 hover:bg-blue-50"
          >
            전체 표시
          </button>
        ) : null}
      </div>
    </details>
  );
}
