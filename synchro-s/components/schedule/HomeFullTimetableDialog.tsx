"use client";

import { TIME_SLOTS } from "@/lib/constants";
import {
  createDefaultHomeClassroomAssignments,
  getHomeClassroomOccupancy,
  HOME_CLASSROOM_OPTIONS,
  sanitizeHomeClassroomAssignments,
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

type ClassroomSaveState = "idle" | "loading" | "saving" | "saved" | "error";
type ClassroomSettingsScope = "fixed" | "day";

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

function subjectTone(subjectName: string): { card: string; text: string; badge: string } {
  const value = subjectName.replace(/\s+/g, "").toLowerCase();
  if (value.includes("국어") || value.includes("언매") || value.includes("화작")) {
    return { card: "border-rose-200 bg-rose-50", text: "text-rose-700", badge: "bg-rose-100 text-rose-800" };
  }
  if (value.includes("영어")) {
    return { card: "border-violet-200 bg-violet-50", text: "text-violet-700", badge: "bg-violet-100 text-violet-800" };
  }
  if (value.includes("수학") || value.includes("수1") || value.includes("수2") || value.includes("미적") || value.includes("확통") || value.includes("기하")) {
    return { card: "border-blue-200 bg-blue-50", text: "text-blue-700", badge: "bg-blue-100 text-blue-800" };
  }
  if (value.includes("물리") || value.includes("화학") || value.includes("생명") || value.includes("지구") || value.includes("과학")) {
    return { card: "border-emerald-200 bg-emerald-50", text: "text-emerald-700", badge: "bg-emerald-100 text-emerald-800" };
  }
  if (value.includes("사회") || value.includes("사탐") || value.includes("사문") || value.includes("세지") || value.includes("한국지리") || value.includes("윤리")) {
    return { card: "border-amber-200 bg-amber-50", text: "text-amber-800", badge: "bg-amber-100 text-amber-900" };
  }
  return { card: "border-slate-200 bg-slate-50", text: "text-slate-700", badge: "bg-slate-200 text-slate-800" };
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
  const [fixedAssignments, setFixedAssignments] = useState<HomeClassroomAssignment>({});
  const [dayOverrides, setDayOverrides] = useState<HomeClassroomAssignment>({});
  const [assignmentsReady, setAssignmentsReady] = useState(false);
  const [saveState, setSaveState] = useState<ClassroomSaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [highlightedStudent, setHighlightedStudent] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsScope, setSettingsScope] = useState<ClassroomSettingsScope>("fixed");
  const [selectedDateISO, setSelectedDateISO] = useState(dateISO);
  const instructorIds = useMemo(() => instructorSummaries.map((item) => item.id), [instructorSummaries]);
  const defaultSelectedDateISO = weekDateOptions.find((item) => item.weekdayLabel === weekdayLabel)?.dateISO ?? dateISO;
  const selectedDate = useMemo(
    () => weekDateOptions.find((item) => item.dateISO === selectedDateISO) ?? weekDateOptions.find((item) => item.weekdayLabel === weekdayLabel) ?? weekDateOptions[0],
    [selectedDateISO, weekDateOptions, weekdayLabel]
  );
  const selectedWeekday = selectedDate?.weekday;

  useEffect(() => {
    if (!open) return;
    setHighlightedStudent(null);
    setSettingsOpen(false);
    setSettingsScope("fixed");
    setSelectedDateISO(defaultSelectedDateISO);
  }, [defaultSelectedDateISO, open]);

  useEffect(() => {
    if (!open || !selectedDateISO) return;
    const controller = new AbortController();
    const defaults = createDefaultHomeClassroomAssignments(instructorIds);

    async function loadAssignments() {
      setAssignmentsReady(false);
      setDayOverrides({});
      setSaveState("loading");
      setSaveMessage("서버 배정을 불러오는 중입니다.");
      try {
        const response = await fetch(`/api/settings/classrooms?dateISO=${encodeURIComponent(selectedDateISO)}`, {
          signal: controller.signal,
          cache: "no-store"
        });
        if (!response.ok) throw new Error("강의실 배정을 불러오지 못했습니다.");
        const payload = (await response.json()) as { fixedAssignments?: unknown; dayOverrides?: unknown };
        const serverFixed = sanitizeHomeClassroomAssignments(payload.fixedAssignments);
        const loadedDayOverrides = sanitizeHomeClassroomAssignments(payload.dayOverrides);
        let legacyAssignments: HomeClassroomAssignment = {};
        try {
          legacyAssignments = sanitizeHomeClassroomAssignments(JSON.parse(window.localStorage.getItem(CLASSROOM_STORAGE_KEY) ?? "{}"));
        } catch {
          legacyAssignments = {};
        }
        const missingAssignments = Object.fromEntries(
          instructorIds
            .filter((id) => !serverFixed[id])
            .map((id) => [id, legacyAssignments[id] ?? defaults[id]!])
        );
        const mergedFixed = { ...missingAssignments, ...serverFixed };
        if (controller.signal.aborted) return;
        setFixedAssignments(mergedFixed);
        setDayOverrides(loadedDayOverrides);
        setAssignmentsReady(true);

        if (Object.keys(missingAssignments).length > 0) {
          setSaveState("saving");
          setSaveMessage(Object.keys(serverFixed).length === 0 ? "기존 브라우저 배정을 서버로 옮기는 중입니다." : "새 강사의 기본 강의실을 서버에 저장하는 중입니다.");
          const seedResponse = await fetch("/api/settings/classrooms", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope: "fixed", assignments: missingAssignments }),
            signal: controller.signal
          });
          if (!seedResponse.ok) throw new Error("초기 강의실 배정을 서버에 저장하지 못했습니다.");
        }
        if (!controller.signal.aborted) {
          setSaveState("saved");
          setSaveMessage("서버 저장됨 · 다른 PC에도 동일하게 표시됩니다.");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setFixedAssignments((current) => Object.keys(current).length > 0 ? current : defaults);
        setAssignmentsReady(true);
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "강의실 배정 처리 중 오류가 발생했습니다.");
      }
    }

    void loadAssignments();
    return () => controller.abort();
  }, [instructorIds, open, selectedDateISO]);

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
  const assignments = useMemo(
    () => ({ ...fixedAssignments, ...dayOverrides }),
    [dayOverrides, fixedAssignments]
  );
  const settingsInstructors = settingsScope === "fixed" ? instructorSummaries : dayInstructorSummaries;

  async function persistClassroomChange(scope: ClassroomSettingsScope, instructorId: string, classroom: string) {
    setSaveState("saving");
    setSaveMessage(scope === "fixed" ? "고정 강의실을 서버에 저장하는 중입니다." : `${selectedDateISO} 하루 배정을 저장하는 중입니다.`);
    const response = await fetch("/api/settings/classrooms", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, dateISO: scope === "day" ? selectedDateISO : undefined, instructorId, classroom })
    });
    if (!response.ok) throw new Error("강의실 배정을 서버에 저장하지 못했습니다.");
    setSaveState("saved");
    setSaveMessage(scope === "fixed" ? "고정 강의실 서버 저장 완료 · 다른 PC에도 적용됩니다." : `${selectedDateISO} 하루 배정 서버 저장 완료`);
  }

  async function updateFixedAssignment(instructorId: string, classroom: string) {
    const previous = fixedAssignments[instructorId];
    setFixedAssignments((current) => ({ ...current, [instructorId]: classroom }));
    try {
      await persistClassroomChange("fixed", instructorId, classroom);
    } catch (error) {
      setFixedAssignments((current) => previous ? { ...current, [instructorId]: previous } : current);
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "고정 강의실 저장에 실패했습니다.");
    }
  }

  async function updateDayOverride(instructorId: string, classroom: string) {
    const previous = dayOverrides[instructorId];
    if (!classroom) {
      setDayOverrides((current) => {
        const next = { ...current };
        delete next[instructorId];
        return next;
      });
      setSaveState("saving");
      setSaveMessage(`${selectedDateISO} 임시 배정을 해제하는 중입니다.`);
      try {
        const response = await fetch("/api/settings/classrooms", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "day", dateISO: selectedDateISO, instructorId })
        });
        if (!response.ok) throw new Error("하루 배정 해제에 실패했습니다.");
        setSaveState("saved");
        setSaveMessage(`${selectedDateISO}에는 고정 강의실을 사용합니다.`);
      } catch (error) {
        if (previous) setDayOverrides((current) => ({ ...current, [instructorId]: previous }));
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "하루 배정 해제에 실패했습니다.");
      }
      return;
    }

    setDayOverrides((current) => ({ ...current, [instructorId]: classroom }));
    try {
      await persistClassroomChange("day", instructorId, classroom);
    } catch (error) {
      setDayOverrides((current) => {
        const next = { ...current };
        if (previous) next[instructorId] = previous;
        else delete next[instructorId];
        return next;
      });
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "하루 배정 저장에 실패했습니다.");
    }
  }

  async function autoAssignFixedClassrooms() {
    const previous = fixedAssignments;
    const next = createDefaultHomeClassroomAssignments(instructorIds);
    setFixedAssignments(next);
    setSaveState("saving");
    setSaveMessage("자동 배정 결과를 서버에 저장하는 중입니다.");
    try {
      const response = await fetch("/api/settings/classrooms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "fixed", assignments: next })
      });
      if (!response.ok) throw new Error("자동 배정 저장에 실패했습니다.");
      setSaveState("saved");
      setSaveMessage("자동 배정이 서버에 저장되었습니다.");
    } catch (error) {
      setFixedAssignments(previous);
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "자동 배정 저장에 실패했습니다.");
    }
  }

  async function resetDayOverrides() {
    const previous = dayOverrides;
    setDayOverrides({});
    setSaveState("saving");
    setSaveMessage(`${selectedDateISO} 하루 배정을 초기화하는 중입니다.`);
    try {
      const response = await fetch("/api/settings/classrooms", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "day", dateISO: selectedDateISO })
      });
      if (!response.ok) throw new Error("하루 배정 초기화에 실패했습니다.");
      setSaveState("saved");
      setSaveMessage(`${selectedDateISO}의 모든 강사가 고정 강의실을 사용합니다.`);
    } catch (error) {
      setDayOverrides(previous);
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "하루 배정 초기화에 실패했습니다.");
    }
  }
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
              {Object.keys(dayOverrides).length > 0 ? (
                <span className="rounded-md bg-blue-100 px-2 py-1 text-[11px] font-black text-blue-700">이 날짜만 조정 {Object.keys(dayOverrides).length}명</span>
              ) : null}
            </div>
          </div>
        </div>

        {settingsOpen ? (
          <section id="home-fixed-classroom-settings" aria-label="고정 강의실 설정" className="shrink-0 border-b border-blue-200 bg-blue-50 px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-950">강사별 강의실 배정</h3>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-600">
                  강의실을 바꾸면 아래 전체 시간표에 즉시 반영됩니다. {" "}
                  {settingsScope === "fixed"
                    ? "고정 배정은 서버에 자동 저장되어 다른 PC와 모든 요일에 동일하게 적용됩니다."
                    : `${selectedDateISO}에만 적용할 강의실입니다. 비워 두면 고정 강의실을 사용합니다.`}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <p
                  role="status"
                  aria-live="polite"
                  className={`rounded-md px-2 py-1 text-[11px] font-black ${
                    saveState === "error"
                      ? "bg-rose-100 text-rose-700"
                      : saveState === "saving" || saveState === "loading"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {saveMessage || "서버 저장 준비됨"}
                </p>
                <button
                  type="button"
                  disabled={!assignmentsReady || saveState === "saving"}
                  onClick={() => void (settingsScope === "fixed" ? autoAssignFixedClassrooms() : resetDayOverrides())}
                  className="sync-pressable sync-focus min-h-9 rounded-lg bg-white px-3 text-xs font-black text-blue-700 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.22)] hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {settingsScope === "fixed" ? "순서대로 자동 배정" : "이 날짜 조정 초기화"}
                </button>
              </div>
            </div>
            <div role="tablist" aria-label="강의실 설정 범위" className="mt-2 inline-grid grid-cols-2 rounded-lg bg-blue-100 p-1">
              <button
                type="button"
                role="tab"
                aria-selected={settingsScope === "fixed"}
                onClick={() => setSettingsScope("fixed")}
                className={`sync-pressable sync-focus min-h-9 rounded-md px-3 text-xs font-black ${settingsScope === "fixed" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-blue-700"}`}
              >
                고정 배정
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settingsScope === "day"}
                onClick={() => setSettingsScope("day")}
                className={`sync-pressable sync-focus min-h-9 rounded-md px-3 text-xs font-black ${settingsScope === "day" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-blue-700"}`}
              >
                {selectedDate?.weekdayLabel ?? weekdayLabel}요일 하루 조정
              </button>
            </div>
            <div className="mt-2 grid max-h-44 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
              {settingsInstructors.map((instructor) => (
                <label key={instructor.id} className="rounded-lg bg-white p-2 shadow-sm">
                  <span className="block truncate text-xs font-black text-slate-900">{instructor.name}</span>
                  <span className="block truncate text-[10px] font-semibold text-slate-500">{instructor.secondary || "과목 정보 없음"}</span>
                  <select
                    aria-label={`${instructor.name} ${settingsScope === "fixed" ? "고정 강의실" : `${selectedDateISO} 하루 강의실`}`}
                    disabled={!assignmentsReady || saveState === "loading"}
                    value={settingsScope === "fixed" ? fixedAssignments[instructor.id] ?? "" : dayOverrides[instructor.id] ?? ""}
                    onChange={(event) => void (settingsScope === "fixed"
                      ? updateFixedAssignment(instructor.id, event.target.value)
                      : updateDayOverride(instructor.id, event.target.value))}
                    className="sync-focus mt-1.5 min-h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800"
                  >
                    {settingsScope === "day" ? <option value="">고정값 사용 · {fixedAssignments[instructor.id] ?? "미지정"}</option> : null}
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
            <div className="w-full" style={{ minWidth: `${visibleClassrooms.length * 174 + 72}px` }}>
              <div className="sticky top-0 z-30 grid border-b border-slate-300 bg-slate-950 text-white" style={{ gridTemplateColumns: `72px repeat(${visibleClassrooms.length}, minmax(174px, 1fr))` }}>
                <div className="sticky left-0 z-40 flex items-center justify-center border-r border-slate-700 bg-slate-950 px-2 py-3 text-xs font-black">시간</div>
                {visibleClassrooms.map((classroom) => {
                  const ids = occupancy.get(classroom) ?? [];
                  const collision = collisionClassrooms.has(classroom);
                  const hasDayOverride = ids.some((id) => Boolean(dayOverrides[id]));
                  return (
                    <div key={classroom} className={`border-r border-slate-700 px-3 py-2 ${collision ? "bg-rose-950" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black">{classroom}</span>
                        <span className="flex items-center gap-1">
                          {hasDayOverride ? <span className="rounded bg-blue-300 px-1.5 py-0.5 text-[9px] font-black text-blue-950">하루 조정</span> : null}
                          {collision ? <span className="rounded bg-rose-400 px-1.5 py-0.5 text-[9px] font-black text-rose-950">중복</span> : null}
                        </span>
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
                              const tone = subjectTone(event.subjectName);
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
                                        ? `${tone.card} border-2 border-amber-400 shadow-[0_3px_10px_rgba(180,120,0,0.14)]`
                                        : tone.card
                                  } ${dimmed ? "opacity-45" : ""}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="truncate text-xs font-black text-slate-950">{instructor?.name || event.instructorName}</p>
                                      <p className={`mt-0.5 truncate text-[10px] font-black ${oneToOne ? "text-amber-800" : tone.text}`}>{event.subjectName}</p>
                                    </div>
                                    <span className="flex shrink-0 items-center gap-1">
                                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${oneToOne ? "bg-amber-300 text-amber-950" : tone.badge}`}>{typeLabel}</span>
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
                                              selected ? "bg-amber-400 text-amber-950" : oneToOne ? "bg-white text-amber-950 hover:bg-amber-100" : `bg-white ${tone.text} hover:bg-white/70`
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
