/* eslint-disable @next/next/no-img-element */
import { ScheduleBlock } from "@/components/schedule/ScheduleBlock";
import { formatTimeSlotRange, getOverlappingHourSlots, getVisibleTimeSlots } from "@/lib/timetableSlots";
import { timeToMinutes } from "@/lib/time";
import type { RoleView, ScheduleEvent, TimetableViewMode, Weekday } from "@/types/schedule";
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";

type TimetableGridProps = {
  roleView: RoleView;
  days: { key: Weekday; label: string }[];
  timeSlots: string[];
  events: ScheduleEvent[];
  daysOff?: Weekday[];
  hideEmptyDays?: boolean;
  hideEmptyTimes?: boolean;
  hiddenTimeSlots?: string[];
  viewMode?: TimetableViewMode;
  onCellClick: (ctx: { weekday: Weekday; startTime: string; classDate?: string; scheduleMode: "recurring" | "one_off" }) => void;
  onCellPaste?: (ctx: { weekday: Weekday; startTime: string; classDate?: string; scheduleMode: "recurring" | "one_off" }) => void;
  pasteArmed?: boolean;
  dayDateOverrides?: Partial<Record<Weekday, string>>;
  onDayDateChange?: (weekday: Weekday, classDate: string | null) => void;
  onEventMove?: (ctx: { classId: string; weekday: Weekday; startTime: string; endTime: string }) => Promise<void>;
  onEventClick?: (event: ScheduleEvent) => void;
  onEventCopy?: (event: ScheduleEvent) => void;
  copiedEventKey?: string | null;
  onEventSave?: (event: ScheduleEvent) => Promise<void>;
  onEventDelete?: (event: ScheduleEvent) => Promise<void>;
  studentSecondaryLookup?: Readonly<Record<string, string>>;
  inactive?: boolean;
  emptyMessage?: string;
};

function minutesToTime(totalMinutes: number): string {
  const safe = Math.max(0, totalMinutes);
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addMinutes(time: string, durationMinutes: number): string {
  const [h, m] = time.split(":").map(Number);
  return minutesToTime(h * 60 + m + durationMinutes);
}

function isStrictDotClass(event: ScheduleEvent): boolean {
  const normalized = `${event.classTypeCode} ${event.classTypeLabel}`.replace(/[^0-9a-z가-힣:]/gi, "").toLowerCase();
  return (
    normalized.includes("onetone") ||
    normalized.includes("onetoone") ||
    normalized.includes("11") ||
    normalized.includes("1:1") ||
    normalized.includes("1대1") ||
    normalized.includes("twotone") ||
    normalized.includes("twotoone") ||
    normalized.includes("21") ||
    normalized.includes("2:1") ||
    normalized.includes("2대1") ||
    normalized.includes("threetone") ||
    normalized.includes("threetoone") ||
    normalized.includes("31") ||
    normalized.includes("3:1") ||
    normalized.includes("3대1")
  );
}

const INSTRUCTOR_REGULAR_GROUP_ID_PREFIX = "instructor-regular-group:";
const SELF_STUDY_EVENT_ID_PREFIX = "self-study:";
const SYNC_DRAFT_EVENT_ID_PREFIX = "sync-draft:";
const ACADEMY_LOGO_URL = "https://raw.githubusercontent.com/whdtjd5294/whdtjd5294.github.io/main/sedu_logo.png";

function normalizeClassToken(value: string): string {
  return value.replace(/[^0-9a-z가-힣:]/gi, "").toLowerCase();
}

function isIndividualRegularClass(event: ScheduleEvent): boolean {
  if (isStrictDotClass(event)) return false;

  const normalized = normalizeClassToken(`${event.classTypeCode} ${event.classTypeLabel} ${event.badgeText}`);
  return ["개별정규", "개별", "정규", "regular", "multi"].some((token) => normalized.includes(normalizeClassToken(token)));
}

function isInstructorRegularGroupEvent(event: ScheduleEvent): boolean {
  return event.id.startsWith(INSTRUCTOR_REGULAR_GROUP_ID_PREFIX);
}

function isSelfStudyEvent(event: ScheduleEvent): boolean {
  return event.id.startsWith(SELF_STUDY_EVENT_ID_PREFIX);
}

function isDraftEvent(event: ScheduleEvent): boolean {
  return event.id.startsWith("draft-") || event.id.startsWith(SYNC_DRAFT_EVENT_ID_PREFIX);
}

function summaryBadgeText(event: ScheduleEvent): string {
  const raw = event.badgeText?.replace(/^\[|\]$/g, "").trim();
  if (raw) {
    return raw;
  }
  return event.classTypeLabel;
}

function summaryClassTypeTone(event: ScheduleEvent): string {
  const normalized = normalizeClassToken(`${event.classTypeCode} ${event.classTypeLabel} ${event.badgeText}`);
  if (normalized.includes("3:1") || normalized.includes("3대1") || normalized.includes("threetoone")) return "border-rose-200 bg-rose-500";
  if (normalized.includes("2:1") || normalized.includes("2대1") || normalized.includes("twotoone")) return "border-violet-200 bg-violet-500";
  if (normalized.includes("1:1") || normalized.includes("1대1") || normalized.includes("onetoone")) return "border-blue-200 bg-blue-500";
  if (normalized.includes("개별정규") || normalized.includes("개별") || normalized.includes("regular") || normalized.includes("multi")) return "border-amber-200 bg-amber-500";
  return "border-slate-200 bg-slate-500";
}

function normalizeStudentName(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase().trim();
}

function normalizeChainToken(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase().trim();
}

function instructorRegularGroupKey(event: ScheduleEvent, slot: string): string {
  return [event.weekday, slot, event.startTime, event.endTime].join("::");
}

function mergeInstructorRegularGroup(base: ScheduleEvent, next: ScheduleEvent): ScheduleEvent {
  return {
    ...base,
    studentIds: [...base.studentIds, ...next.studentIds],
    studentNames: [...base.studentNames, ...next.studentNames],
    startTime: timeToMinutes(next.startTime) < timeToMinutes(base.startTime) ? next.startTime : base.startTime,
    endTime: timeToMinutes(next.endTime) > timeToMinutes(base.endTime) ? next.endTime : base.endTime,
    note: [base.note, next.note].filter(Boolean).join("\n") || undefined
  };
}

function sortInstructorCellEntries(a: ScheduleEvent, b: ScheduleEvent): number {
  const startDiff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  if (startDiff !== 0) return startDiff;
  const strictDiff = Number(isStrictDotClass(b)) - Number(isStrictDotClass(a));
  if (strictDiff !== 0) return strictDiff;
  return a.studentNames.join("").localeCompare(b.studentNames.join(""), "ko");
}

function dedupeInstructorCellEntries(entries: ScheduleEvent[], slot: string): ScheduleEvent[] {
  const seenStudents = new Set<string>();
  const regularGroups = new Map<string, ScheduleEvent>();
  const cleaned: ScheduleEvent[] = [];

  for (const event of [...entries].sort(sortInstructorCellEntries)) {
    const studentIds: string[] = [];
    const studentNames: string[] = [];
    const maxLength = Math.max(event.studentIds.length, event.studentNames.length);

    for (let index = 0; index < maxLength; index += 1) {
      const id = (event.studentIds[index] ?? "").trim();
      const name = (event.studentNames[index] ?? "").trim();
      const studentKey = normalizeStudentName(name) || id;
      if (!studentKey || seenStudents.has(studentKey)) continue;

      seenStudents.add(studentKey);
      studentIds.push(id);
      studentNames.push(name || id);
    }

    if (studentNames.length === 0) continue;

    const normalizedEvent = { ...event, studentIds, studentNames };
    if (isIndividualRegularClass(normalizedEvent)) {
      const groupKey = instructorRegularGroupKey(normalizedEvent, slot);
      const existing = regularGroups.get(groupKey);

      regularGroups.set(
        groupKey,
        existing
          ? mergeInstructorRegularGroup(existing, normalizedEvent)
          : {
              ...normalizedEvent,
              id: `${INSTRUCTOR_REGULAR_GROUP_ID_PREFIX}${groupKey}`,
              startTime: timeToMinutes(normalizedEvent.startTime) < timeToMinutes(slot) + 60 ? normalizedEvent.startTime : slot
            }
      );
      continue;
    }

    cleaned.push(normalizedEvent);
  }

  return [...regularGroups.values(), ...cleaned].sort(sortInstructorCellEntries);
}

export function TimetableGrid({
  roleView,
  days,
  timeSlots,
  events,
  daysOff = [],
  hideEmptyDays = false,
  hideEmptyTimes = false,
  hiddenTimeSlots = [],
  viewMode = "detailed",
  onCellClick,
  onCellPaste,
  pasteArmed = false,
  onEventMove,
  onEventClick,
  onEventCopy,
  copiedEventKey = null,
  onEventSave,
  onEventDelete,
  studentSecondaryLookup = {},
  inactive = false,
  emptyMessage,
  dayDateOverrides = {},
  onDayDateChange
}: TimetableGridProps) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);
  const [highlightedStudentName, setHighlightedStudentName] = useState<string | null>(null);
  const [editingDateDay, setEditingDateDay] = useState<Weekday | null>(null);
  const [dateSelectionError, setDateSelectionError] = useState<string | null>(null);
  const [activeCellKey, setActiveCellKey] = useState<string | null>(null);
  const dragPayloadRef = useRef<{ classId: string; durationMinutes: number } | null>(null);
  const dropHandledRef = useRef(false);
  const progressByEventKey = new Map<string, { index: number; total: number }>();
  const eventMap = new Map<string, ScheduleEvent[]>();
  const activeDaySet = new Set<Weekday>();
  const daysOffSet = new Set(daysOff);
  const canMoveEvents = Boolean(onEventMove && viewMode === "detailed");

  for (const event of events) {
    const overlappingSlots = getOverlappingHourSlots(event, timeSlots);
    const displaySlots = overlappingSlots.length > 0 ? overlappingSlots : [event.startTime];
    for (const displaySlot of displaySlots) {
      const key = `${event.weekday}-${displaySlot}`;
      const bucket = eventMap.get(key) ?? [];
      bucket.push(event);
      eventMap.set(key, bucket);
    }
    activeDaySet.add(event.weekday);
  }

  const chainBaseKey = (event: ScheduleEvent): string => {
    const studentsKey = [...event.studentNames].sort().join("|");
    return [
      event.weekday,
      normalizeChainToken(event.subjectName) || normalizeChainToken(event.subjectCode),
      normalizeChainToken(event.classTypeLabel) || normalizeChainToken(event.classTypeCode),
      normalizeChainToken(event.instructorName) || normalizeChainToken(event.instructorId),
      normalizeChainToken(studentsKey)
    ].join("::");
  };

  const eventGroups = new Map<string, ScheduleEvent[]>();
  for (const event of events) {
    const key = chainBaseKey(event);
    const bucket = eventGroups.get(key) ?? [];
    bucket.push(event);
    eventGroups.set(key, bucket);
  }

  for (const [, group] of eventGroups) {
    const ordered = [...group].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    let chainStart = 0;
    while (chainStart < ordered.length) {
      let chainEnd = chainStart;
      while (chainEnd + 1 < ordered.length) {
        const current = ordered[chainEnd];
        const next = ordered[chainEnd + 1];
        if (timeToMinutes(current.endTime) !== timeToMinutes(next.startTime)) break;
        chainEnd += 1;
      }
      const total = chainEnd - chainStart + 1;
      for (let idx = chainStart; idx <= chainEnd; idx += 1) {
        const event = ordered[idx];
        progressByEventKey.set(`${event.id}-${event.classDate}-${event.startTime}`, {
          index: idx - chainStart + 1,
          total
        });
      }
      chainStart = chainEnd + 1;
    }
  }

  const visibleDays = hideEmptyDays ? days.filter((day) => activeDaySet.has(day.key)) : days;
  const renderDays = visibleDays.length > 0 ? visibleDays : days;
  const manuallyVisibleTimeSlots = getVisibleTimeSlots(timeSlots, hiddenTimeSlots);
  const visibleTimeSlots = hideEmptyTimes
    ? manuallyVisibleTimeSlots.filter((slot) => renderDays.some((day) => (eventMap.get(`${day.key}-${slot}`) ?? []).length > 0))
    : manuallyVisibleTimeSlots;
  const renderTimeSlots =
    visibleTimeSlots.length > 0 || manuallyVisibleTimeSlots.length === 0
      ? visibleTimeSlots
      : manuallyVisibleTimeSlots;

  const moveByPayload = async (payload: { classId: string; durationMinutes: number }, weekday: Weekday, startTime: string) => {
    if (!canMoveEvents || !onEventMove) return;
    if (!payload.classId || Number.isNaN(payload.durationMinutes)) return;
    const endTime = addMinutes(startTime, payload.durationMinutes);
    if (timeToMinutes(endTime) > 24 * 60) return;
    await onEventMove({
      classId: payload.classId,
      weekday,
      startTime,
      endTime
    });
  };

  useEffect(() => {
    const clearDragState = () => {
      dragPayloadRef.current = null;
      setDragOverCell(null);
      setDraggingKey(null);
    };

    window.addEventListener("dragend", clearDragState);
    window.addEventListener("drop", clearDragState);
    window.addEventListener("mouseup", clearDragState);
    return () => {
      window.removeEventListener("dragend", clearDragState);
      window.removeEventListener("drop", clearDragState);
      window.removeEventListener("mouseup", clearDragState);
    };
  }, []);

  useEffect(() => {
    if (roleView !== "instructor" || !highlightedStudentName) return;
    const selectedKey = normalizeStudentName(highlightedStudentName);
    const stillVisible = events.some((event) => event.studentNames.some((name) => normalizeStudentName(name) === selectedKey));
    if (!stillVisible) setHighlightedStudentName(null);
  }, [events, highlightedStudentName, roleView]);

  useEffect(() => {
    if (!highlightedStudentName) return;
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHighlightedStudentName(null);
    };
    window.addEventListener("keydown", clearOnEscape);
    return () => window.removeEventListener("keydown", clearOnEscape);
  }, [highlightedStudentName]);

  const handleDrop = async (event: DragEvent<HTMLElement>, weekday: Weekday, startTime: string) => {
    if (!canMoveEvents || !onEventMove) return;
    event.preventDefault();
    event.stopPropagation();
    dropHandledRef.current = true;
    try {
      let payload = dragPayloadRef.current;
      if (!payload) {
        const payloadRaw = event.dataTransfer.getData("application/json");
        if (payloadRaw) {
          payload = JSON.parse(payloadRaw) as { classId: string; durationMinutes: number };
        }
      }
      if (!payload) return;
      await moveByPayload(payload, weekday, startTime);
    } finally {
      dragPayloadRef.current = null;
      setDragOverCell(null);
      setDraggingKey(null);
    }
  };

  return (
    <div
      data-timetable-grid="true"
      className={`sync-surface grid-scrollbar relative w-fit max-w-full overflow-auto rounded-xl ${inactive ? "bg-slate-200" : "bg-white"}`}
    >
      <img
        aria-hidden="true"
        src={ACADEMY_LOGO_URL}
        crossOrigin="anonymous"
        alt=""
        data-timetable-watermark="true"
        className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-auto w-[min(36%,360px)] -translate-x-1/2 -translate-y-1/2 select-none opacity-[0.055] grayscale"
      />
      {emptyMessage ? (
        <div className="pointer-events-none absolute bottom-0 left-20 right-0 top-[49px] z-30 flex items-center justify-center px-8">
          <p className="sync-copy max-w-md rounded-xl border border-slate-200 bg-white/95 px-5 py-4 text-center text-sm font-bold leading-6 text-slate-600 shadow-[0_14px_32px_-20px_rgba(15,23,42,0.4)] backdrop-blur-sm">
            {emptyMessage}
          </p>
        </div>
      ) : null}
      <table
        data-timetable-table="true"
        className={`sync-tabular relative z-10 w-max min-w-max table-fixed border-collapse text-xs [--timetable-day-width:165.714px] 2xl:[--timetable-day-width:177.143px] ${inactive ? "opacity-75 grayscale-[0.15]" : ""}`}
      >
        <colgroup>
          <col className="w-20 min-w-20" />
          {renderDays.map((day) => (
            <col
              key={`timetable-column-${day.key}`}
              data-timetable-day-column={day.key}
              style={{ width: "var(--timetable-day-width)", minWidth: "var(--timetable-day-width)" }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 w-20 border-b border-r border-slate-200 bg-white px-1.5 py-3 text-center font-extrabold text-slate-700 shadow-[0_1px_0_rgba(148,163,184,0.24)]">
              시간
            </th>
            {renderDays.map((day) => (
              <th
                key={day.key}
                className={`sticky top-0 z-20 border-b border-r px-2 py-3 text-center text-sm font-bold transition-[background-color,border-color,box-shadow,color] duration-150 ease-out ${
                  daysOffSet.has(day.key)
                    ? "border-slate-300 bg-slate-100 text-slate-600 shadow-[inset_0_-1px_0_rgba(100,116,139,0.28)]"
                    : activeDaySet.has(day.key)
                    ? "border-blue-200 bg-blue-50 text-blue-800 shadow-[inset_0_-2px_0_rgba(37,99,235,0.5)]"
                    : "border-slate-200 bg-white text-slate-700 shadow-[0_1px_0_rgba(148,163,184,0.18)]"
                }`}
                style={
                  daysOffSet.has(day.key)
                    ? {
                        backgroundImage:
                          "repeating-linear-gradient(135deg, rgba(148,163,184,0.12) 0px, rgba(148,163,184,0.12) 10px, rgba(255,255,255,0) 10px, rgba(255,255,255,0) 20px)"
                      }
                    : undefined
                }
              >
                <div className="flex flex-col items-center gap-1">
                  {onDayDateChange ? (
                    <button
                      type="button"
                      aria-expanded={editingDateDay === day.key}
                      aria-label={`${day.label}요일 특정 일자 지정`}
                      onClick={() => {
                        setEditingDateDay((current) => (current === day.key ? null : day.key));
                        setDateSelectionError(null);
                      }}
                      className="sync-pressable sync-focus inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-sm font-extrabold tracking-wide hover:bg-white/70"
                    >
                      <span>{day.label}</span>
                      {dayDateOverrides[day.key] ? (
                        <span className="sync-tabular rounded-full border border-blue-200 bg-white px-1.5 py-0.5 text-[10px] font-black text-blue-700">
                          {Number(dayDateOverrides[day.key]?.slice(5, 7))}/{Number(dayDateOverrides[day.key]?.slice(8, 10))}
                        </span>
                      ) : (
                        <span aria-hidden="true" className="text-[10px] text-slate-400">＋</span>
                      )}
                    </button>
                  ) : (
                    <span
                      className={
                        daysOffSet.has(day.key)
                          ? "font-extrabold tracking-wide"
                          : activeDaySet.has(day.key)
                            ? "font-extrabold tracking-wide"
                            : ""
                      }
                    >
                      {day.label}
                    </span>
                  )}
                  {onDayDateChange && editingDateDay === day.key ? (
                    <div className="flex flex-col items-center gap-1 rounded-lg border border-blue-200 bg-white p-1.5 shadow-lg">
                      <input
                        type="date"
                        autoFocus
                        value={dayDateOverrides[day.key] ?? ""}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (!value) {
                            onDayDateChange(day.key, null);
                            setDateSelectionError(null);
                            return;
                          }
                          const selectedWeekday = new Date(`${value}T12:00:00Z`).getUTCDay() || 7;
                          if (selectedWeekday !== day.key) {
                            setDateSelectionError(`${day.label}요일 날짜를 선택해 주세요.`);
                            return;
                          }
                          onDayDateChange(day.key, value);
                          setDateSelectionError(null);
                          setEditingDateDay(null);
                        }}
                        className="sync-input h-8 w-[126px] rounded-md border border-slate-200 px-1.5 text-[11px] font-bold text-slate-700"
                      />
                      {dayDateOverrides[day.key] ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDayDateChange(day.key, null);
                            setEditingDateDay(null);
                            setDateSelectionError(null);
                          }}
                          className="sync-pressable sync-focus min-h-7 rounded-md px-2 text-[10px] font-black text-slate-500 hover:bg-slate-100"
                        >
                          주간 반복으로 되돌리기
                        </button>
                      ) : null}
                      {dateSelectionError ? <span className="text-[10px] font-bold text-rose-600">{dateSelectionError}</span> : null}
                    </div>
                  ) : null}
                  {daysOffSet.has(day.key) ? (
                    <span className="inline-flex rounded-full border border-slate-300/80 bg-white/80 px-2 py-0.5 text-[10px] font-black tracking-[0.16em] text-slate-600 shadow-sm">
                      휴무
                    </span>
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {renderTimeSlots.map((slot) => {
            const isSelectedRow = selectedTimeSlot === slot;

            return (
              <tr key={slot}>
                <td
                  className={`sticky left-0 z-10 border-b border-r px-2 py-2 text-center text-xs font-bold transition-[background-color,border-color] duration-150 ease-out ${
                    isSelectedRow ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <button
                    type="button"
                    aria-pressed={isSelectedRow}
                    data-timetable-time-button="true"
                    onClick={() => setSelectedTimeSlot((prev) => (prev === slot ? null : slot))}
                    className={`sync-pressable sync-focus w-full rounded-md border px-1.5 py-1.5 text-[11px] font-bold ${
                      isSelectedRow
                        ? "border-blue-600 bg-blue-600 text-white shadow-sm ring-2 ring-blue-200 hover:bg-blue-600"
                        : "border-transparent bg-white/70 text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                    }`}
                  >
                    {formatTimeSlotRange(slot)}
                  </button>
                </td>

                {renderDays.map((day) => {
                  const cellKey = `${day.key}-${slot}`;
                  const entries = eventMap.get(cellKey) ?? [];
                  const cellEntries = roleView === "instructor" ? dedupeInstructorCellEntries(entries, slot) : entries;
                  const isEmpty = cellEntries.length === 0;
                  const isDropTarget = dragOverCell === cellKey;
                  const isActiveDay = activeDaySet.has(day.key);
                  const isPasteTarget = isEmpty && pasteArmed && activeCellKey === cellKey;
                  const classDate = dayDateOverrides[day.key];
                  const cellContext = {
                    weekday: day.key,
                    startTime: slot,
                    classDate,
                    scheduleMode: classDate ? "one_off" as const : "recurring" as const
                  };

                  return (
                    <td
                      key={cellKey}
                      tabIndex={isEmpty && viewMode === "detailed" ? 0 : undefined}
                      aria-label={
                        isEmpty && viewMode === "detailed"
                          ? `${day.label}요일 ${formatTimeSlotRange(slot)} 빈 시간, ${pasteArmed ? "복사한 수업 붙여넣기" : "수업 입력"}`
                          : undefined
                      }
                      className={`border-b border-r align-top transition-[background-color,border-color,box-shadow] duration-150 ease-out ${
                        isDropTarget
                          ? "border-sky-300 bg-sky-100/80"
                          : isPasteTarget
                            ? "border-blue-500 bg-blue-100/80 shadow-[inset_0_0_0_2px_rgba(37,99,235,0.55)]"
                          : isSelectedRow
                            ? daysOffSet.has(day.key)
                              ? "border-blue-200 bg-blue-50/80 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.08)]"
                              : "border-blue-200 bg-blue-50/70 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.08)]"
                          : daysOffSet.has(day.key)
                            ? "border-slate-200 bg-slate-50"
                            : isActiveDay
                              ? "border-blue-100 bg-blue-50/40"
                              : "border-slate-100 bg-white"
                      }`}
                      style={
                        daysOffSet.has(day.key)
                          ? {
                              backgroundImage: isSelectedRow
                                ? "linear-gradient(rgba(239,246,255,0.82), rgba(239,246,255,0.82)), repeating-linear-gradient(135deg, rgba(148,163,184,0.12) 0px, rgba(148,163,184,0.12) 11px, rgba(255,255,255,0) 11px, rgba(255,255,255,0) 22px)"
                                : "repeating-linear-gradient(135deg, rgba(148,163,184,0.12) 0px, rgba(148,163,184,0.12) 11px, rgba(255,255,255,0) 11px, rgba(255,255,255,0) 22px)"
                            }
                          : undefined
                      }
                      onClick={() => {
                        if (isEmpty && viewMode === "detailed") {
                          setActiveCellKey(cellKey);
                          if (pasteArmed && onCellPaste) onCellPaste(cellContext);
                          else onCellClick(cellContext);
                        }
                      }}
                      onFocus={() => {
                        if (isEmpty && viewMode === "detailed") setActiveCellKey(cellKey);
                      }}
                      onKeyDown={(event) => {
                        if (!isEmpty || viewMode !== "detailed") return;
                        const wantsPaste = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v";
                        const wantsActivate = event.key === "Enter" || event.key === " ";
                        if (!wantsPaste && !wantsActivate) return;
                        event.preventDefault();
                        if (pasteArmed && onCellPaste) onCellPaste(cellContext);
                        else if (wantsActivate) onCellClick(cellContext);
                      }}
                      onPaste={(event) => {
                        if (!isEmpty || viewMode !== "detailed" || !pasteArmed || !onCellPaste) return;
                        event.preventDefault();
                        onCellPaste(cellContext);
                      }}
                      onDragOver={(event) => {
                        if (!canMoveEvents) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        if (dragOverCell !== cellKey) {
                          setDragOverCell(cellKey);
                        }
                      }}
                      onDragEnter={(event) => {
                        if (!canMoveEvents) return;
                        event.preventDefault();
                        setDragOverCell(cellKey);
                      }}
                      onDragLeave={(event) => {
                        if (!canMoveEvents) return;
                        const nextTarget = event.relatedTarget as Node | null;
                        if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                        if (dragOverCell === cellKey) {
                          setDragOverCell(null);
                        }
                      }}
                      onDrop={(event) => {
                        event.stopPropagation();
                        void handleDrop(event, day.key, slot);
                      }}
                    >
                      <div className="p-1">
                        {isEmpty ? (
                          <div
                            className={`min-h-[46px] rounded-md border border-dashed transition-[background-color,border-color,box-shadow] duration-150 ease-out ${
                              isDropTarget
                                ? "border-sky-400 bg-sky-100/40 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.35)]"
                                : isPasteTarget
                                  ? "border-blue-500 bg-white shadow-[inset_0_0_0_1px_rgba(37,99,235,0.2)]"
                                : isSelectedRow
                                  ? "border-blue-200 bg-white/35"
                                  : daysOffSet.has(day.key)
                                    ? "border-transparent bg-transparent hover:border-slate-200 hover:bg-slate-200/20"
                                    : isActiveDay
                                      ? "border-transparent bg-transparent hover:border-sky-200 hover:bg-white/55"
                                      : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            {isPasteTarget ? (
                              <span className="flex min-h-[46px] items-center justify-center text-[10px] font-black text-blue-700">붙여넣기</span>
                            ) : null}
                          </div>
                        ) : viewMode === "summary" ? (
                          <div className="flex min-h-[46px] flex-wrap items-center justify-center gap-1.5 px-1 py-2">
                            {cellEntries.map((event) => (
                              <span
                                key={`${event.id}-${event.classDate}`}
                                title={`${event.instructorName} · ${event.classTypeLabel} · ${event.studentNames.join(", ")}`}
                                className={`inline-flex min-h-[28px] items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-black tracking-[0.02em] text-white shadow-[0_6px_18px_rgba(148,163,184,0.18)] ${summaryClassTypeTone(event)}`}
                              >
                                {summaryBadgeText(event)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="flex min-h-[46px] flex-col gap-1">
                            {cellEntries.map((event) => {
                              const eventKey = `${event.id}-${event.classDate}-${event.startTime}`;
                              const isGroupedRegular = isInstructorRegularGroupEvent(event);
                              const isSyntheticSelfStudy = isSelfStudyEvent(event);
                              const canDragEvent = canMoveEvents && !isGroupedRegular && !isSyntheticSelfStudy;
                              const canCopyEvent = Boolean(onEventCopy) && !isGroupedRegular && !isSyntheticSelfStudy && !isDraftEvent(event);
                              const copyKey = `${event.id}-${event.classDate}-${event.startTime}`;
                              const isCopiedEvent = copiedEventKey === copyKey;

                              return (
                                <div
                                  key={`${event.id}-${event.classDate}-${event.startTime}`}
                                  draggable={canDragEvent}
                                  tabIndex={canCopyEvent ? 0 : undefined}
                                  aria-keyshortcuts={canCopyEvent ? "Meta+C Control+C" : undefined}
                                  aria-label={
                                    canCopyEvent
                                      ? `${event.subjectName} ${event.instructorName} ${event.classTypeLabel} ${event.startTime}-${event.endTime}, Command 또는 Control C로 복사`
                                      : undefined
                                  }
                                  onDragStart={(dragEvent) => {
                                    if (!canDragEvent || !onEventMove) return;
                                    setDraggingKey(eventKey);
                                    dropHandledRef.current = false;
                                    const payload = JSON.stringify({
                                      classId: event.id,
                                      durationMinutes: timeToMinutes(event.endTime) - timeToMinutes(event.startTime)
                                    });
                                    dragPayloadRef.current = {
                                      classId: event.id,
                                      durationMinutes: timeToMinutes(event.endTime) - timeToMinutes(event.startTime)
                                    };
                                    dragEvent.dataTransfer.setData("application/json", payload);
                                    dragEvent.dataTransfer.setData("text/plain", payload);
                                    dragEvent.dataTransfer.effectAllowed = "move";
                                  }}
                                  onDragEnd={() => {
                                    if (!canDragEvent || !onEventMove) return;
                                    const hovered = dragOverCell;
                                    const payload = dragPayloadRef.current;
                                    if (!dropHandledRef.current && hovered && payload) {
                                      const [weekdayRaw, startTime] = hovered.split("-");
                                      const weekday = Number(weekdayRaw) as Weekday;
                                      if (weekday >= 1 && weekday <= 7 && startTime) {
                                        void moveByPayload(payload, weekday, startTime);
                                      }
                                    }
                                    dragPayloadRef.current = null;
                                    setDragOverCell(null);
                                    setDraggingKey(null);
                                  }}
                                  className={`rounded-lg outline-none transition-[box-shadow,opacity] ${
                                    draggingKey === eventKey ? "opacity-60" : ""
                                  } ${
                                    isCopiedEvent
                                      ? "shadow-[0_0_0_3px_rgba(37,99,235,0.75),0_0_0_6px_rgba(219,234,254,0.95)]"
                                      : canCopyEvent ? "focus:shadow-[0_0_0_3px_rgba(37,99,235,0.45)]" : ""
                                  }`}
                                  onKeyDown={(keyboardEvent) => {
                                    const wantsCopy = (keyboardEvent.metaKey || keyboardEvent.ctrlKey) && keyboardEvent.key.toLowerCase() === "c";
                                    if (!wantsCopy || !canCopyEvent || !onEventCopy) return;
                                    keyboardEvent.preventDefault();
                                    keyboardEvent.stopPropagation();
                                    onEventCopy(event);
                                  }}
                                  onCopy={(clipboardEvent) => {
                                    if (!canCopyEvent || !onEventCopy) return;
                                    clipboardEvent.preventDefault();
                                    clipboardEvent.stopPropagation();
                                    clipboardEvent.clipboardData.setData(
                                      "text/plain",
                                      `${event.subjectName}\t${event.instructorName}\t${event.classTypeLabel}\t${event.startTime}-${event.endTime}`
                                    );
                                    onEventCopy(event);
                                  }}
                                  onClick={(clickEvent) => {
                                    if (canCopyEvent) {
                                      clickEvent.stopPropagation();
                                      clickEvent.currentTarget.focus();
                                      return;
                                    }
                                    if (!onEventClick || isGroupedRegular || isDraftEvent(event)) return;
                                    clickEvent.stopPropagation();
                                    onEventClick(event);
                                  }}
                                  onDoubleClick={(clickEvent) => {
                                    if (!onEventClick || isGroupedRegular || isDraftEvent(event)) return;
                                    clickEvent.stopPropagation();
                                    onEventClick(event);
                                  }}
                                >
                                  <ScheduleBlock
                                    event={event}
                                    roleView={roleView}
                                    chainProgress={isGroupedRegular ? undefined : progressByEventKey.get(eventKey)}
                                    showSaveAction={!isGroupedRegular && event.id.startsWith("draft-")}
                                    onSave={!isGroupedRegular && !isSyntheticSelfStudy && onEventSave ? (item) => void onEventSave(item) : undefined}
                                    onDelete={!isGroupedRegular && !isSyntheticSelfStudy && onEventDelete ? (item) => void onEventDelete(item) : undefined}
                                    highlightedStudentName={roleView === "instructor" ? highlightedStudentName : null}
                                    onStudentHighlight={roleView === "instructor" ? (studentName) => {
                                      setHighlightedStudentName((current) =>
                                        current && normalizeStudentName(current) === normalizeStudentName(studentName) ? null : studentName
                                      );
                                    } : undefined}
                                    studentSecondaryLookup={studentSecondaryLookup}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
