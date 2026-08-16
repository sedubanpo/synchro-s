"use client";

import { filterLessonCardTemplates, type LessonCardTemplate } from "@/lib/lessonCardTemplates";
import { useMemo, useState } from "react";

export type LessonAutosaveState = {
  state: "idle" | "saving" | "saved" | "error";
  message: string;
};

type LessonCardPaletteProps = {
  templates: LessonCardTemplate[];
  selectedTemplate: LessonCardTemplate | null;
  onCopy: (template: LessonCardTemplate) => void;
  autosave: LessonAutosaveState;
  disabled?: boolean;
  disabledReason?: string;
};

type SubjectTone = {
  card: string;
  selected: string;
  badge: string;
  meta: string;
};

const subjectTone: Record<string, SubjectTone> = {
  국어: {
    card: "border-rose-200 bg-rose-50/70 hover:border-rose-300 hover:bg-rose-50",
    selected: "border-rose-400 bg-rose-50 ring-2 ring-rose-100",
    badge: "border-rose-200 bg-rose-100 text-rose-800",
    meta: "text-rose-700"
  },
  수학: {
    card: "border-blue-200 bg-blue-50/70 hover:border-blue-300 hover:bg-blue-50",
    selected: "border-blue-500 bg-blue-50 ring-2 ring-blue-100",
    badge: "border-blue-200 bg-blue-100 text-blue-800",
    meta: "text-blue-700"
  },
  영어: {
    card: "border-violet-200 bg-violet-50/70 hover:border-violet-300 hover:bg-violet-50",
    selected: "border-violet-400 bg-violet-50 ring-2 ring-violet-100",
    badge: "border-violet-200 bg-violet-100 text-violet-800",
    meta: "text-violet-700"
  },
  과학: {
    card: "border-emerald-200 bg-emerald-50/70 hover:border-emerald-300 hover:bg-emerald-50",
    selected: "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100",
    badge: "border-emerald-200 bg-emerald-100 text-emerald-800",
    meta: "text-emerald-700"
  },
  사회: {
    card: "border-amber-200 bg-amber-50/70 hover:border-amber-300 hover:bg-amber-50",
    selected: "border-amber-400 bg-amber-50 ring-2 ring-amber-100",
    badge: "border-amber-200 bg-amber-100 text-amber-900",
    meta: "text-amber-800"
  }
};

const fallbackTone: SubjectTone = {
  card: "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100/70",
  selected: "border-slate-400 bg-slate-50 ring-2 ring-slate-200",
  badge: "border-slate-200 bg-slate-100 text-slate-800",
  meta: "text-slate-600"
};

function getTone(subjectName: string): SubjectTone {
  const entry = Object.entries(subjectTone).find(([key]) => subjectName.includes(key));
  return entry?.[1] ?? fallbackTone;
}

function getAutosaveTone(state: LessonAutosaveState["state"]): string {
  if (state === "error") return "border-rose-200 bg-rose-50 text-rose-700";
  if (state === "saving") return "border-amber-200 bg-amber-50 text-amber-800";
  if (state === "saved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function formatDuration(durationMinutes: number): string {
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}시간 ${minutes}분`;
  if (hours > 0) return `${hours}시간`;
  return `${minutes}분`;
}

export function LessonCardPalette({
  templates,
  selectedTemplate,
  onCopy,
  autosave,
  disabled = false,
  disabledReason
}: LessonCardPaletteProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterLessonCardTemplates(templates, query), [query, templates]);
  const visible = filtered.slice(0, query.trim() ? 80 : 24);

  return (
    <section aria-label="시간표 복사·붙여넣기" className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_12px_30px_-26px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900">시간표 복사·붙여넣기</h2>
          <p className="mt-0.5 text-[10px] font-semibold text-slate-500">강사·과목별 빠른 수업 카드</p>
        </div>
        <span className="sync-tabular rounded-full border border-blue-200 bg-white px-2 py-1 text-[10px] font-black text-blue-700">{filtered.length}개</span>
      </div>

      <label className="relative mt-3 block">
        <span className="sr-only">수업 카드 검색</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m16.5 16.5 3.5 3.5" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="강사명 또는 과목명 검색"
          className="sync-input h-10 w-full rounded-lg border-2 border-blue-400 bg-white pl-9 pr-9 text-xs font-bold text-slate-800 outline-none placeholder:text-blue-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
        />
        {query ? (
          <button type="button" aria-label="수업 카드 검색어 지우기" onClick={() => setQuery("")} className="sync-focus absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-sm font-black text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button>
        ) : null}
      </label>

      <p className="mt-2 text-[11px] font-semibold leading-4 text-slate-600">
        기존 수업을 한 번 눌러 선택하고 <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[10px]">⌘/Ctrl+C</kbd> 후, 빈 칸에서 <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[10px]">⌘/Ctrl+V</kbd>를 누르세요. 수업 편집은 두 번 누릅니다.
      </p>

      {selectedTemplate ? (
        <div className="mt-3 rounded-lg border-2 border-blue-500 bg-blue-600 px-3 py-2 text-white shadow-sm" aria-live="polite">
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-blue-100">
            {selectedTemplate.source === "timetable" ? "시간표에서 복사한 수업" : "복사한 카드"}
          </p>
          <p className="mt-0.5 truncate text-xs font-black">{selectedTemplate.subjectName} · {selectedTemplate.instructorName}</p>
          <p className="mt-0.5 text-[10px] font-bold text-blue-100">{selectedTemplate.classTypeLabel} · {formatDuration(selectedTemplate.durationMinutes)}</p>
        </div>
      ) : null}

      {disabled ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-4 text-amber-800">{disabledReason ?? "학생과 시간표 분류를 먼저 선택해 주세요."}</p>
      ) : (
        <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1" aria-label="수업 카드 검색 결과">
          {visible.map((template) => {
            const selected = selectedTemplate?.key === template.key;
            const tone = getTone(template.subjectName);
            return (
              <button
                key={template.key}
                type="button"
                aria-pressed={selected}
                onClick={() => onCopy(template)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
                    event.preventDefault();
                    onCopy(template);
                  }
                }}
                className={`sync-pressable sync-focus w-full rounded-lg border p-2.5 text-left transition-[background-color,border-color,box-shadow,transform] ${
                  selected ? `${tone.selected} shadow-[0_8px_20px_-16px_rgba(15,23,42,0.45)]` : tone.card
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[15px] font-black leading-5 tracking-[-0.01em] text-slate-950">{template.instructorName}</span>
                  <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-black ${tone.badge}`}>{template.subjectName}</span>
                </div>
                <div className={`mt-1.5 flex items-center justify-between gap-2 text-[10px] font-bold ${tone.meta}`}>
                  <span className="truncate">{template.classTypeLabel}</span>
                  <span className="shrink-0 text-slate-500">복사</span>
                </div>
              </button>
            );
          })}
          {visible.length === 0 ? <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs font-bold text-slate-500">일치하는 수업 카드가 없습니다.</p> : null}
          {!query.trim() && filtered.length > visible.length ? <p className="py-1 text-center text-[10px] font-semibold text-slate-400">검색하면 전체 {filtered.length}개 카드를 찾을 수 있습니다.</p> : null}
        </div>
      )}

      <div aria-live="polite" className={`mt-3 rounded-lg border px-3 py-2 text-[11px] font-bold ${getAutosaveTone(autosave.state)}`}>
        {autosave.state === "saving" ? "● " : autosave.state === "saved" ? "✓ " : autosave.state === "error" ? "! " : ""}{autosave.message}
      </div>
    </section>
  );
}
