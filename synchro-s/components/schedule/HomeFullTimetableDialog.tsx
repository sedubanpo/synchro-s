"use client";

import { TIME_SLOTS } from "@/lib/constants";
import {
  createDefaultHomeClassroomAssignments,
  getHomeClassroomOccupancy,
  HOME_CLASSROOM_OPTIONS,
  type HomeClassroomAssignment
} from "@/lib/homeFullTimetable";
import { mergeHomeInstructorEvents } from "@/lib/homeDashboardGrouping";
import type { ScheduleEvent } from "@/types/schedule";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HomeDashboardPersonSummary } from "@/components/schedule/HomeInstructorFolderDashboard";

type Props = {
  open: boolean;
  dateISO: string;
  weekdayLabel: string;
  selectedTagLabel: string;
  instructorSummaries: HomeDashboardPersonSummary[];
  onClose: () => void;
};

function hourRange(startTime: string, endTime?: string): string {
  const start = Number(startTime.slice(0, 2));
  const end = endTime ? Number(endTime.slice(0, 2)) : start + 1;
  return `${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}시`;
}

function eventTitle(event: ScheduleEvent): string {
  return [event.classTypeLabel || event.badgeText, event.subjectName].filter(Boolean).join(" · ");
}

export function HomeFullTimetableDialog({
  open,
  dateISO,
  weekdayLabel,
  selectedTagLabel,
  instructorSummaries,
  onClose
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [assignments, setAssignments] = useState<HomeClassroomAssignment>({});
  const instructorIds = useMemo(() => instructorSummaries.map((item) => item.id), [instructorSummaries]);

  useEffect(() => {
    if (!open) return;
    setAssignments((current) => {
      const defaults = createDefaultHomeClassroomAssignments(instructorIds);
      return Object.fromEntries(instructorIds.map((id) => [id, current[id] ?? defaults[id]!])) as HomeClassroomAssignment;
    });
  }, [instructorIds, open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = closeButtonRef.current?.closest<HTMLElement>("[role='dialog']");
      const focusable = [...(dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  const mergedByInstructor = useMemo(
    () => new Map(instructorSummaries.map((item) => [item.id, mergeHomeInstructorEvents(item.events)])),
    [instructorSummaries]
  );
  const occupancy = useMemo(
    () => getHomeClassroomOccupancy(instructorIds, assignments),
    [assignments, instructorIds]
  );
  const visibleClassrooms = useMemo(
    () => HOME_CLASSROOM_OPTIONS.filter((classroom) => occupancy.has(classroom)),
    [occupancy]
  );
  const collisionClassrooms = useMemo(() => {
    const collisions = new Set<string>();
    for (const [classroom, ids] of occupancy) {
      const hasOverlap = TIME_SLOTS.some((slot) =>
        ids.filter((id) => (mergedByInstructor.get(id) ?? []).some((event) => event.startTime === slot)).length > 1
      );
      if (hasOverlap) collisions.add(classroom);
    }
    return collisions;
  }, [mergedByInstructor, occupancy]);
  const collisionCount = collisionClassrooms.size;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/65 p-2 backdrop-blur-sm sm:p-4" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-full-timetable-title"
        className="flex max-h-[96vh] w-full max-w-[1780px] flex-col overflow-hidden rounded-2xl border border-white/20 bg-slate-100 shadow-2xl"
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-700 bg-slate-950 px-4 py-3 text-white sm:px-5">
          <div>
            <p className="text-[11px] font-black tracking-[0.14em] text-blue-300">FULL TIMETABLE REVIEW</p>
            <h2 id="home-full-timetable-title" className="mt-1 text-xl font-black">전체 시간표로 보기</h2>
            <p className="mt-1 text-xs font-semibold text-slate-300">{dateISO} ({weekdayLabel}요일) · #{selectedTagLabel} · 강사 {instructorSummaries.length}명</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAssignments(createDefaultHomeClassroomAssignments(instructorIds))}
              className="sync-pressable sync-focus min-h-10 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-black text-white hover:bg-white/20"
            >
              강의실 자동 배정
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="전체 시간표 닫기"
              className="sync-pressable sync-focus flex min-h-10 min-w-10 items-center justify-center rounded-lg bg-white text-xl font-black text-slate-950 hover:bg-blue-50"
            >
              ×
            </button>
          </div>
        </header>

        <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-black text-slate-900">강사별 강의실 지정</p>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-500">강의실을 바꾸면 아래 전체 시간표에 즉시 반영됩니다.</p>
            </div>
            <p role="status" className={`rounded-md px-2 py-1 text-[11px] font-black ${collisionCount ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
              {collisionCount ? `강의실 중복 ${collisionCount}곳` : "강의실 중복 없음"}
            </p>
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {instructorSummaries.map((instructor) => (
              <label key={instructor.id} className="min-w-44 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <span className="block truncate text-xs font-black text-slate-900">{instructor.name}</span>
                <span className="block truncate text-[10px] font-semibold text-slate-500">{instructor.secondary || "과목 정보 없음"}</span>
                <select
                  aria-label={`${instructor.name} 강의실`}
                  value={assignments[instructor.id] ?? ""}
                  onChange={(event) => setAssignments((current) => ({ ...current, [instructor.id]: event.target.value }))}
                  className="sync-focus mt-1.5 min-h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800"
                >
                  {HOME_CLASSROOM_OPTIONS.map((classroom) => <option key={classroom} value={classroom}>{classroom}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-200" data-testid="home-full-timetable-grid">
          {visibleClassrooms.length === 0 ? (
            <div className="flex min-h-80 items-center justify-center p-8 text-center text-sm font-bold text-slate-500">표시할 강사 수업이 없습니다.</div>
          ) : (
            <div className="min-w-max" style={{ width: `${Math.max(100, visibleClassrooms.length * 220 + 84)}px` }}>
              <div className="sticky top-0 z-30 grid border-b border-slate-300 bg-slate-950 text-white" style={{ gridTemplateColumns: `84px repeat(${visibleClassrooms.length}, minmax(220px, 1fr))` }}>
                <div className="sticky left-0 z-40 flex items-center justify-center border-r border-slate-700 bg-slate-950 px-2 py-3 text-xs font-black">시간</div>
                {visibleClassrooms.map((classroom) => {
                  const ids = occupancy.get(classroom) ?? [];
                  const collision = collisionClassrooms.has(classroom);
                  return (
                    <div key={classroom} className={`border-r border-slate-700 px-3 py-2 ${collision ? "bg-rose-950" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black">{classroom}</span>
                        {collision ? <span className="rounded bg-rose-400 px-1.5 py-0.5 text-[9px] font-black text-rose-950">중복</span> : null}
                      </div>
                      <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-300">{ids.map((id) => instructorSummaries.find((item) => item.id === id)?.name).filter(Boolean).join(" · ")}</p>
                    </div>
                  );
                })}
              </div>

              {TIME_SLOTS.map((slot) => (
                <div key={slot} className="grid border-b border-slate-300" style={{ gridTemplateColumns: `84px repeat(${visibleClassrooms.length}, minmax(220px, 1fr))` }}>
                  <div className="sticky left-0 z-20 flex min-h-24 items-start justify-center border-r border-slate-300 bg-slate-100 px-2 py-3 text-xs font-black tabular-nums text-slate-600">{hourRange(slot)}</div>
                  {visibleClassrooms.map((classroom) => {
                    const ids = occupancy.get(classroom) ?? [];
                    const placements = ids.flatMap((id) => {
                      const instructor = instructorSummaries.find((item) => item.id === id);
                      return (mergedByInstructor.get(id) ?? [])
                        .filter((event) => event.startTime === slot)
                        .map((event) => ({ instructor, event }));
                    });
                    return (
                      <div key={`${slot}-${classroom}`} className="min-h-24 border-r border-slate-300 bg-white p-1.5">
                        {placements.length === 0 ? (
                          <span className="flex min-h-20 items-center justify-center text-[10px] font-semibold text-slate-300">수업 없음</span>
                        ) : (
                          <div className="space-y-1.5">
                            {placements.map(({ instructor, event }, index) => (
                              <article key={`${instructor?.id}-${event.id}-${index}`} className="rounded-md border border-blue-200 bg-blue-50 p-2 shadow-sm">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-black text-slate-950">{instructor?.name || event.instructorName}</p>
                                    <p className="mt-0.5 truncate text-[10px] font-black text-blue-700">{eventTitle(event)}</p>
                                  </div>
                                  <span className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[9px] font-black text-white">{event.studentNames.length}명</span>
                                </div>
                                <p className="mt-1.5 line-clamp-2 text-[10px] font-semibold leading-4 text-slate-600">{event.studentNames.join(" · ") || "학생 미지정"}</p>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
