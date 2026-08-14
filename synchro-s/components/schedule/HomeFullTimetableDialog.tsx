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
import type {
  HomeDashboardPersonSummary,
  HomeDashboardWeekDateOption
} from "@/components/schedule/HomeInstructorFolderDashboard";

type Props = {
  open: boolean;
  dateISO: string;
  weekdayLabel: string;
  selectedTagLabel: string;
  instructorSummaries: HomeDashboardPersonSummary[];
  weekDateOptions: HomeDashboardWeekDateOption[];
  onClose: () => void;
};

const CLASSROOM_STORAGE_KEY = "synchro-s:home-full-timetable:fixed-classrooms:v1";

function hourRange(startTime: string, endTime?: string): string {
  const start = Number(startTime.slice(0, 2));
  const end = endTime ? Number(endTime.slice(0, 2)) : start + 1;
  return `${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}시`;
}

function classTypeLabel(event: ScheduleEvent): string {
  const value = `${event.classTypeCode} ${event.classTypeLabel} ${event.badgeText}`.toLowerCase();
  if (value.includes("one_to_one") || value.includes("1:1") || value.includes("1대1")) return "1:1";
  if (value.includes("two_to_one") || value.includes("2:1") || value.includes("2대1")) return "2:1";
  if (value.includes("three_to_one") || value.includes("3:1") || value.includes("3대1")) return "3:1";
  if (value.includes("개별")) return "개별";
  return event.classTypeLabel || event.badgeText || "수업";
}

function isOneToOne(event: ScheduleEvent): boolean {
  return classTypeLabel(event) === "1:1";
}

function validSavedAssignments(value: unknown): HomeClassroomAssignment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([id, classroom]) => Boolean(id) && typeof classroom === "string" && HOME_CLASSROOM_OPTIONS.includes(classroom as (typeof HOME_CLASSROOM_OPTIONS)[number])
    )
  );
}

export function HomeFullTimetableDialog({
  open,
  dateISO,
  weekdayLabel,
  selectedTagLabel,
  instructorSummaries,
  weekDateOptions,
  onClose
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [assignments, setAssignments] = useState<HomeClassroomAssignment>({});
  const [assignmentsReady, setAssignmentsReady] = useState(false);
  const [highlightedStudent, setHighlightedStudent] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedDateISO, setSelectedDateISO] = useState(dateISO);
  const instructorIds = useMemo(() => instructorSummaries.map((item) => item.id), [instructorSummaries]);
  const selectedDate = useMemo(
    () => weekDateOptions.find((item) => item.dateISO === selectedDateISO) ?? weekDateOptions.find((item) => item.weekdayLabel === weekdayLabel) ?? weekDateOptions[0],
    [selectedDateISO, weekDateOptions, weekdayLabel]
  );
  const selectedWeekday = selectedDate?.weekday;

  useEffect(() => {
    if (!open) return;
    setHighlightedStudent(null);
    setSettingsOpen(false);
    setSelectedDateISO(weekDateOptions.find((item) => item.weekdayLabel === weekdayLabel)?.dateISO ?? dateISO);
  }, [dateISO, open, weekDateOptions, weekdayLabel]);

  useEffect(() => {
    if (!open) return;
    const defaults = createDefaultHomeClassroomAssignments(instructorIds);
    let saved: HomeClassroomAssignment = {};
    try {
      saved = validSavedAssignments(JSON.parse(window.localStorage.getItem(CLASSROOM_STORAGE_KEY) ?? "{}"));
    } catch {
      saved = {};
    }
    setAssignments(Object.fromEntries(instructorIds.map((id) => [id, saved[id] ?? defaults[id]!])));
    setAssignmentsReady(true);
  }, [instructorIds, open]);

  useEffect(() => {
    if (!assignmentsReady) return;
    try {
      window.localStorage.setItem(CLASSROOM_STORAGE_KEY, JSON.stringify(assignments));
    } catch {
      // 브라우저 저장소를 사용할 수 없어도 현재 세션의 배정은 유지합니다.
    }
  }, [assignments, assignmentsReady]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        else onClose();
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
  }, [onClose, open, settingsOpen]);

  const dayInstructorSummaries = useMemo(
    () =>
      instructorSummaries
        .map((item) => ({
          ...item,
          events: mergeHomeInstructorEvents(
            item.events.filter((event) =>
              event.scheduleMode === "one_off"
                ? event.classDate === selectedDate?.dateISO
                : event.weekday === selectedWeekday
            )
          )
        }))
        .filter((item) => item.events.length > 0),
    [instructorSummaries, selectedDate?.dateISO, selectedWeekday]
  );
  const dayInstructorIds = useMemo(() => dayInstructorSummaries.map((item) => item.id), [dayInstructorSummaries]);
  const mergedByInstructor = useMemo(
    () => new Map(dayInstructorSummaries.map((item) => [item.id, item.events])),
    [dayInstructorSummaries]
  );
  const occupancy = useMemo(
    () => getHomeClassroomOccupancy(dayInstructorIds, assignments),
    [assignments, dayInstructorIds]
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
    <div className="fixed inset-0 z-[120] bg-slate-950/70 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-full-timetable-title"
        className="flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden bg-slate-100 shadow-2xl"
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-950 px-4 py-3 text-white sm:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 id="home-full-timetable-title" className="truncate text-xl font-black">전체 시간표로 보기</h2>
              <p className="mt-1 text-xs font-semibold text-slate-300">
                {selectedDate?.dateISO ?? dateISO} ({selectedDate?.weekdayLabel ?? weekdayLabel}요일) · 강사 {dayInstructorSummaries.length}명
              </p>
            </div>
            <span
              aria-label={`시간표 분류 ${selectedTagLabel}`}
              className="inline-flex min-h-10 items-center rounded-lg border border-amber-200 bg-amber-300 px-4 py-2 text-base font-black text-amber-950 shadow-[0_4px_14px_rgba(245,158,11,0.22)]"
            >
              #{selectedTagLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-expanded={settingsOpen}
              aria-controls="home-fixed-classroom-settings"
              onClick={() => setSettingsOpen((current) => !current)}
              className="sync-pressable sync-focus min-h-10 rounded-lg border border-white/25 bg-white/10 px-3 text-xs font-black text-white hover:bg-white/20"
            >
              고정 강의실 설정
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="전체 시간표 닫기"
              className="sync-pressable sync-focus flex min-h-10 min-w-10 items-center justify-center rounded-lg bg-white text-xl font-black text-blue-950 hover:bg-blue-50"
            >
              ×
            </button>
          </div>
        </header>

        <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="전체 시간표 요일 선택" className="grid min-w-[420px] flex-1 grid-cols-7 gap-1 sm:max-w-3xl">
              {weekDateOptions.map((item) => {
                const active = item.dateISO === selectedDate?.dateISO;
                return (
                  <button
                    key={item.dateISO}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setSelectedDateISO(item.dateISO);
                      setHighlightedStudent(null);
                    }}
                    className={`sync-pressable sync-focus min-h-10 rounded-lg px-2 py-1.5 text-xs font-black transition-colors ${
                      active ? "bg-blue-600 text-white shadow-sm" : "bg-blue-50 text-blue-950 hover:bg-blue-100 hover:text-blue-700"
                    }`}
                  >
                    <span className="block">{item.weekdayLabel}</span>
                    <span className={`block text-[9px] tabular-nums ${active ? "text-blue-100" : "text-slate-400"}`}>{item.dateISO.slice(5).replace("-", ".")}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {highlightedStudent ? (
                <button type="button" onClick={() => setHighlightedStudent(null)} className="sync-pressable sync-focus rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900 hover:bg-amber-100">
                  {highlightedStudent} 강조 해제
                </button>
              ) : (
                <span className="text-[11px] font-semibold text-slate-600">학생명을 누르면 같은 학생을 강조합니다.</span>
              )}
              <p role="status" className={`rounded-md px-2 py-1 text-[11px] font-black ${collisionCount ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                {collisionCount ? `강의실 중복 ${collisionCount}곳` : "강의실 중복 없음"}
              </p>
            </div>
          </div>
        </div>

        {settingsOpen ? (
          <section id="home-fixed-classroom-settings" aria-label="고정 강의실 설정" className="shrink-0 border-b border-blue-200 bg-blue-50 px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-950">강사별 고정 강의실</h3>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-600">강의실을 바꾸면 아래 전체 시간표에 즉시 반영됩니다. 한 번 지정하면 이 브라우저에 저장되어 모든 요일에 자동 적용됩니다.</p>
              </div>
              <button
                type="button"
                onClick={() => setAssignments(createDefaultHomeClassroomAssignments(instructorIds))}
                className="sync-pressable sync-focus min-h-9 rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-blue-700 hover:bg-blue-100"
              >
                순서대로 자동 배정
              </button>
            </div>
            <div className="mt-2 grid max-h-44 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
              {instructorSummaries.map((instructor) => (
                <label key={instructor.id} className="rounded-lg bg-white p-2 shadow-sm">
                  <span className="block truncate text-xs font-black text-slate-900">{instructor.name}</span>
                  <span className="block truncate text-[10px] font-semibold text-slate-500">{instructor.secondary || "과목 정보 없음"}</span>
                  <select
                    aria-label={`${instructor.name} 고정 강의실`}
                    value={assignments[instructor.id] ?? ""}
                    onChange={(event) => setAssignments((current) => ({ ...current, [instructor.id]: event.target.value }))}
                    className="sync-focus mt-1.5 min-h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800"
                  >
                    {HOME_CLASSROOM_OPTIONS.map((classroom) => <option key={classroom} value={classroom}>{classroom}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </section>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto bg-slate-200" data-testid="home-full-timetable-grid">
          {visibleClassrooms.length === 0 ? (
            <div className="flex min-h-full items-center justify-center p-8 text-center text-sm font-bold text-slate-500">선택한 요일에 표시할 강사 수업이 없습니다.</div>
          ) : (
            <div className="min-w-max" style={{ width: `${Math.max(100, visibleClassrooms.length * 174 + 72)}px` }}>
              <div className="sticky top-0 z-30 grid border-b border-slate-300 bg-slate-950 text-white" style={{ gridTemplateColumns: `72px repeat(${visibleClassrooms.length}, minmax(174px, 1fr))` }}>
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
                      <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-300">{ids.map((id) => dayInstructorSummaries.find((item) => item.id === id)?.name).filter(Boolean).join(" · ")}</p>
                    </div>
                  );
                })}
              </div>

              {TIME_SLOTS.map((slot) => (
                <div key={slot} className="grid border-b border-slate-300" style={{ gridTemplateColumns: `72px repeat(${visibleClassrooms.length}, minmax(174px, 1fr))` }}>
                  <div className="sticky left-0 z-20 flex min-h-20 items-start justify-center border-r border-slate-300 bg-slate-100 px-2 py-3 text-[11px] font-black tabular-nums text-slate-600">{hourRange(slot)}</div>
                  {visibleClassrooms.map((classroom) => {
                    const ids = occupancy.get(classroom) ?? [];
                    const placements = ids.flatMap((id) => {
                      const instructor = dayInstructorSummaries.find((item) => item.id === id);
                      return (mergedByInstructor.get(id) ?? []).filter((event) => event.startTime === slot).map((event) => ({ instructor, event }));
                    });
                    return (
                      <div key={`${slot}-${classroom}`} className="min-h-20 border-r border-slate-300 bg-white p-1.5">
                        {placements.length === 0 ? (
                          <span className="flex min-h-16 items-center justify-center text-[10px] font-semibold text-slate-300">수업 없음</span>
                        ) : (
                          <div className="space-y-1.5">
                            {placements.map(({ instructor, event }, index) => {
                              const oneToOne = isOneToOne(event);
                              const typeLabel = classTypeLabel(event);
                              const containsHighlightedStudent = Boolean(highlightedStudent && event.studentNames.some((name) => name.trim() === highlightedStudent));
                              const dimmed = Boolean(highlightedStudent && !containsHighlightedStudent);
                              return (
                                <article
                                  key={`${instructor?.id}-${event.id}-${index}`}
                                  data-class-type={typeLabel}
                                  className={`rounded-md border p-2 shadow-sm transition-[background-color,border-color,box-shadow,opacity] ${
                                    containsHighlightedStudent
                                      ? "border-amber-500 bg-amber-50 ring-2 ring-amber-300"
                                      : oneToOne
                                        ? "border-2 border-amber-400 bg-[#fff9e8] shadow-[0_3px_10px_rgba(180,120,0,0.14)]"
                                        : "border-blue-200 bg-blue-50"
                                  } ${dimmed ? "opacity-45" : ""}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="truncate text-xs font-black text-slate-950">{instructor?.name || event.instructorName}</p>
                                      <p className={`mt-0.5 truncate text-[10px] font-black ${oneToOne ? "text-amber-800" : "text-blue-700"}`}>{event.subjectName}</p>
                                    </div>
                                    <span className="flex shrink-0 items-center gap-1">
                                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${oneToOne ? "bg-amber-300 text-amber-950" : "bg-blue-100 text-blue-800"}`}>{typeLabel}</span>
                                      <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[9px] font-black text-white">{event.studentNames.length}명</span>
                                    </span>
                                  </div>
                                  {event.studentNames.length > 0 ? (
                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                      {event.studentNames.map((studentName, studentIndex) => {
                                        const selected = highlightedStudent === studentName.trim();
                                        return (
                                          <button
                                            key={`${studentName}-${studentIndex}`}
                                            type="button"
                                            aria-pressed={selected}
                                            onClick={() => setHighlightedStudent(selected ? null : studentName.trim())}
                                            className={`sync-focus rounded px-1.5 py-1 text-[10px] font-bold leading-none transition ${
                                              selected ? "bg-amber-400 text-amber-950" : oneToOne ? "bg-white text-amber-950 hover:bg-amber-100" : "bg-white text-blue-950 hover:bg-blue-100"
                                            }`}
                                          >
                                            {studentName}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <p className="mt-1.5 text-[10px] font-semibold text-slate-500">학생 미지정</p>
                                  )}
                                </article>
                              );
                            })}
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
