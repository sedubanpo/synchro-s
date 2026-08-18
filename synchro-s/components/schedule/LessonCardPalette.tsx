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

type SubjectFamily = "korean" | "math" | "english" | "science" | "physics" | "chemistry" | "biology" | "social" | "other";

function getSubjectFamily(subjectName: string): SubjectFamily {
  if (/국어|논술|문학/.test(subjectName)) return "korean";
  if (/수학|수리/.test(subjectName)) return "math";
  if (/영어|영문/.test(subjectName)) return "english";
  if (/물리/.test(subjectName)) return "physics";
  if (/화학/.test(subjectName)) return "chemistry";
  if (/생명|생물/.test(subjectName)) return "biology";
  if (/과학|통과|통합과학/.test(subjectName)) return "science";
  if (/사회|사탐|역사|지리|윤리/.test(subjectName)) return "social";
  return "other";
}

function SubjectMotif({ subjectName }: { subjectName: string }) {
  const family = getSubjectFamily(subjectName);
  return (
    <svg aria-hidden="true" viewBox="0 0 120 72" className="pointer-events-none absolute -right-2 -top-1 h-[5.25rem] w-[8.75rem] opacity-[0.09]" fill="none" stroke="currentColor" strokeWidth="2">
      {family === "math" ? <><circle cx="80" cy="35" r="23" /><path d="M50 58 75 12l30 46M57 45h42M73 22l15 31" /></> : null}
      {family === "korean" ? <><path d="M54 12h45v48H54zM62 23h29M62 33h29M62 43h22" /><path d="M45 19h9v34h-9z" /></> : null}
      {family === "english" ? <><path d="m55 57 17-43 17 43M62 40h20" /><path d="M94 20h13M100 20v37" /></> : null}
      {family === "science" ? <><ellipse cx="82" cy="36" rx="34" ry="13" /><ellipse cx="82" cy="36" rx="13" ry="34" transform="rotate(32 82 36)" /><circle cx="82" cy="36" r="4" fill="currentColor" stroke="none" /></> : null}
      {family === "physics" ? <><path d="M44 39c8-24 16 24 24 0s16 24 24 0 16 24 24 0" /><path d="M48 57h62M105 52l7 5-7 5" /></> : null}
      {family === "chemistry" ? <><path d="M72 10v18L53 59h48L82 28V10M66 10h22M60 47h34" /><circle cx="72" cy="42" r="3" /><circle cx="84" cy="52" r="2" /></> : null}
      {family === "biology" ? <><path d="M82 10c-22 12-28 33-16 52M82 10c21 13 27 34 15 52M64 24h36M59 38h44M60 52h38" /></> : null}
      {family === "social" ? <><circle cx="82" cy="36" r="27" /><path d="M55 36h54M82 9c-13 14-13 40 0 54M82 9c13 14 13 40 0 54" /></> : null}
      {family === "other" ? <><path d="M55 17h52v42H55zM65 28h32M65 38h24M65 48h28" /></> : null}
    </svg>
  );
}

function ClassTypeSignal({ label, capacity }: { label: string; capacity?: number }) {
  const normalized = label.replace(/\s/g, "");
  const isSpecial = /특강/.test(normalized);
  const isRegular = /개별|정규/.test(normalized);
  const dots = Math.min(3, Math.max(1, capacity ?? 1));
  return (
    <span aria-hidden="true" className="flex h-5 min-w-7 items-center justify-center gap-0.5 rounded-md border border-current/20 bg-white/55 px-1">
      {isSpecial ? <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m10 2 1.6 5.1L17 6l-3.8 4 3.8 4-5.4-1.1L10 18l-1.6-5.1L3 14l3.8-4L3 6l5.4 1.1Z" /></svg> : null}
      {isRegular ? <svg viewBox="0 0 24 12" className="h-3 w-6" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M1 8c3-6 5 2 8-3s5 5 8 0 4 1 6-3" strokeLinecap="round" /></svg> : null}
      {!isSpecial && !isRegular ? Array.from({ length: dots }, (_, index) => <span key={index} className="h-1.5 w-1.5 rounded-full bg-current" />) : null}
    </span>
  );
}

const fallbackTone: SubjectTone = {
  card: "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100/70",
  selected: "border-slate-400 bg-slate-50 ring-2 ring-slate-200",
  badge: "border-slate-200 bg-slate-100 text-slate-800",
  meta: "text-slate-600"
};

function getTone(subjectName: string): SubjectTone {
  const family = getSubjectFamily(subjectName);
  const toneKey = family === "korean" ? "국어" : family === "math" ? "수학" : family === "english" ? "영어" : family === "social" ? "사회" : ["science", "physics", "chemistry", "biology"].includes(family) ? "과학" : "";
  const entry = Object.entries(subjectTone).find(([key]) => key === toneKey);
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
        카드 입력은 <strong className="font-black text-slate-800">입력·붙여넣기</strong>에서 빈 셀을 누르세요. 여러 수업은 <strong className="font-black text-slate-800">범위 선택</strong>에서 드래그한 뒤 <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[10px]">⌘/Ctrl+C</kbd>로 복사합니다.
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
        <div
          className="mt-3 h-80 space-y-1.5 overflow-y-auto overscroll-contain pr-1 xl:h-[clamp(28rem,55vh,38rem)]"
          aria-label="수업 카드 검색 결과"
        >
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
                title={template.classTypeMemo || undefined}
                className={`sync-pressable sync-focus relative w-full overflow-hidden rounded-lg border p-2.5 text-left transition-[background-color,border-color,box-shadow,transform] ${
                  selected ? `${tone.selected} shadow-[0_8px_20px_-16px_rgba(15,23,42,0.45)]` : tone.card
                }`}
              >
                <SubjectMotif subjectName={template.subjectName} />
                <div className="relative flex items-center justify-between gap-2">
                  <span className="truncate text-[15px] font-black leading-5 tracking-[-0.01em] text-slate-950">{template.instructorName}</span>
                  <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-black ${tone.badge}`}>{template.subjectName}</span>
                </div>
                <div className={`relative mt-1.5 flex items-center justify-between gap-2 text-[10px] font-bold ${tone.meta}`}>
                  <span className="flex min-w-0 items-center gap-1.5"><ClassTypeSignal label={template.classTypeLabel} capacity={template.maxStudents} /><span className="truncate">{template.classTypeLabel}{template.maxStudents ? ` · 정원 ${template.maxStudents}명` : ""}</span></span>
                  <span className="shrink-0 text-slate-500">복사</span>
                </div>
                {template.classTypeMemo ? <p className="relative mt-1 truncate text-[9px] font-semibold text-slate-500">{template.classTypeMemo}</p> : null}
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
