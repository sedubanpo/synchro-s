"use client";

import { InstructorAvailabilityAssignmentModal } from "@/components/schedule/InstructorAvailabilityAssignmentModal";
import { DAYS, TIME_SLOTS } from "@/lib/constants";
import {
  formatAvailabilityWeekdays,
  formatInstructorTeacherName,
  summarizeInstructorAvailabilityDays
} from "@/lib/instructorAvailabilityProfile";
import { planningClassTypeTone, resolvePlanningClassTypes } from "@/lib/instructorAvailabilityPlanning";
import type {
  AvailableTimeSlotsByDay,
  ClassTypeOption,
  InstructorAvailabilityDateOverride,
  InstructorAvailabilityDateOverrides,
  InstructorAvailabilityPlannedClass,
  InstructorWeekdayNotes,
  SelectOption,
  Weekday
} from "@/types/schedule";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type AvailabilityGroup = {
  id: string;
  instructorId: string;
  monthStart: string;
  name: string;
  availableTimeSlotsByDay: AvailableTimeSlotsByDay;
  weekdayNotes: InstructorWeekdayNotes;
  dateOverrides: InstructorAvailabilityDateOverrides;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type InstructorAvailabilityWorkspaceProps = {
  instructorId: string;
  instructorName: string;
  instructorSubject: string;
  initialAvailability: AvailableTimeSlotsByDay;
  students: SelectOption[];
  classTypes: ClassTypeOption[];
  onActiveAvailabilityChange: (slotsByDay: AvailableTimeSlotsByDay) => void;
};

type AssignmentEditor = { date: string; slot: string };

type AvailabilityDragScope = "weekly" | "date";
type AvailabilityDragSelection = {
  pointerId: number;
  scope: AvailabilityDragScope;
  selected: boolean;
  visited: Set<string>;
};

const KST_MONTH_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit"
});

function currentMonthStart(): string {
  const parts = KST_MONTH_FORMATTER.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "2026";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}-01`;
}

function shiftMonth(monthStart: string, diff: number): string {
  const [year, month] = monthStart.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + diff, 1));
  return date.toISOString().slice(0, 10);
}

function monthLabel(monthStart: string): string {
  const [year, month] = monthStart.split("-").map(Number);
  return `${year}년 ${month}월`;
}

function cloneSlotsByDay(value: AvailableTimeSlotsByDay): AvailableTimeSlotsByDay {
  const cloned: AvailableTimeSlotsByDay = {};
  for (const day of DAYS) {
    const slots = value[day.key];
    if (slots?.length) cloned[day.key] = [...slots].sort((a, b) => a.localeCompare(b));
  }
  return cloned;
}

function totalSlotCount(value: AvailableTimeSlotsByDay): number {
  return Object.values(value).reduce((sum, slots) => sum + (slots?.length ?? 0), 0);
}

function cloneWeekdayNotes(value?: InstructorWeekdayNotes): InstructorWeekdayNotes {
  const cloned: InstructorWeekdayNotes = {};
  for (const day of DAYS) {
    const note = value?.[day.key]?.trim();
    if (note) cloned[day.key] = note;
  }
  return cloned;
}

function weekdayNoteCount(value?: InstructorWeekdayNotes): number {
  return Object.values(value ?? {}).filter((note) => Boolean(note?.trim())).length;
}

function cloneDateOverrides(value?: InstructorAvailabilityDateOverrides): InstructorAvailabilityDateOverrides {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([date, override]) => [
      date,
      {
        status: override.status,
        slots: [...override.slots].sort((a, b) => a.localeCompare(b)),
        ...(override.note ? { note: override.note } : {}),
        ...(override.plannedClasses
          ? {
              plannedClasses: Object.fromEntries(
                Object.entries(override.plannedClasses).map(([slot, plannedClass]) => [
                  slot,
                  {
                    ...plannedClass,
                    studentIds: [...plannedClass.studentIds],
                    studentNames: [...plannedClass.studentNames]
                  }
                ])
              )
            }
          : {})
      }
    ])
  );
}

function plannedClassToneClass(plannedClass: InstructorAvailabilityPlannedClass): string {
  const tone = planningClassTypeTone(plannedClass.classTypeCode, plannedClass.classTypeLabel);
  if (tone === "one") return "border-blue-200 bg-blue-50 text-blue-900";
  if (tone === "two") return "border-violet-200 bg-violet-50 text-violet-900";
  if (tone === "three") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function dateOverrideCount(value?: InstructorAvailabilityDateOverrides): number {
  return Object.keys(value ?? {}).length;
}

function temporaryOverrideCount(value?: InstructorAvailabilityDateOverrides): number {
  return Object.values(value ?? {}).filter((override) => override.status === "temporary").length;
}

function defaultSelectedDate(monthStart: string): string {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
  return today.startsWith(monthStart.slice(0, 7)) ? today : monthStart;
}

function weekdayForDate(date: string): Weekday {
  const jsDay = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (jsDay === 0 ? 7 : jsDay) as Weekday;
}

function dateDisplayLabel(date: string): string {
  const weekday = weekdayForDate(date);
  const weekdayLabel = DAYS.find((day) => day.key === weekday)?.label ?? "";
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 ${weekdayLabel}요일`;
}

function calendarDates(monthStart: string): Array<string | null> {
  const [year, month] = monthStart.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const leading = firstWeekday === 0 ? 6 : firstWeekday - 1;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const values: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= days; day += 1) {
    values.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  while (values.length % 7 !== 0) values.push(null);
  return values;
}

function rangeLabel(startTime: string): string {
  const hour = Number(startTime.slice(0, 2));
  return `${hour}-${hour + 1}시`;
}

async function apiError(res: Response, fallback: string): Promise<string> {
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  return payload.error ?? fallback;
}

export function InstructorAvailabilityWorkspace({
  instructorId,
  instructorName,
  instructorSubject,
  initialAvailability,
  students,
  classTypes,
  onActiveAvailabilityChange
}: InstructorAvailabilityWorkspaceProps) {
  const [monthStart, setMonthStart] = useState(currentMonthStart);
  const [groups, setGroups] = useState<AvailabilityGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSlotsByDay, setDraftSlotsByDay] = useState<AvailableTimeSlotsByDay>({});
  const [draftWeekdayNotes, setDraftWeekdayNotes] = useState<InstructorWeekdayNotes>({});
  const [draftDateOverrides, setDraftDateOverrides] = useState<InstructorAvailabilityDateOverrides>({});
  const [selectedDate, setSelectedDate] = useState(() => defaultSelectedDate(currentMonthStart()));
  const [selectedDates, setSelectedDates] = useState<string[]>(() => [defaultSelectedDate(currentMonthStart())]);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [assignmentEditor, setAssignmentEditor] = useState<AssignmentEditor | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dragSelectionRef = useRef<AvailabilityDragSelection | null>(null);
  const temporaryDraftCacheRef = useRef<Record<string, InstructorAvailabilityDateOverride>>({});

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId]
  );
  const activeGroup = useMemo(() => groups.find((group) => group.isActive) ?? null, [groups]);
  const selectedCount = useMemo(() => totalSlotCount(draftSlotsByDay), [draftSlotsByDay]);
  const availabilityDaySummary = useMemo(
    () => summarizeInstructorAvailabilityDays(draftSlotsByDay),
    [draftSlotsByDay]
  );
  const calendarValues = useMemo(() => calendarDates(monthStart), [monthStart]);
  const activeStudents = useMemo(() => students.filter((student) => student.isActive !== false), [students]);
  const planningClassTypes = useMemo(() => resolvePlanningClassTypes(classTypes), [classTypes]);
  const selectedDateOverride = draftDateOverrides[selectedDate];
  const selectedDateWeekday = weekdayForDate(selectedDate);
  const selectedDateDefaultSlots = draftSlotsByDay[selectedDateWeekday] ?? [];
  const selectedDateDisplay = dateDisplayLabel(selectedDate);
  const isTemporaryFocus = selectedDateOverride?.status === "temporary";
  const planningDates = multiSelectMode ? selectedDates : isTemporaryFocus ? [selectedDate] : [];
  const assignmentDateOverride = assignmentEditor ? draftDateOverrides[assignmentEditor.date] : undefined;
  const assignmentInitialClass = assignmentEditor ? assignmentDateOverride?.plannedClasses?.[assignmentEditor.slot] : undefined;
  const invalidDateOverride = Object.values(draftDateOverrides).some(
    (override) => (override.status === "available" || override.status === "temporary") && override.slots.length === 0
  );

  const selectGroup = useCallback((group: AvailabilityGroup) => {
    setSelectedGroupId(group.id);
    setDraftName(group.name);
    setDraftSlotsByDay(cloneSlotsByDay(group.availableTimeSlotsByDay));
    setDraftWeekdayNotes(cloneWeekdayNotes(group.weekdayNotes));
    setDraftDateOverrides(cloneDateOverrides(group.dateOverrides));
    setError(null);
    setNotice(null);
  }, []);

  const loadGroups = useCallback(async () => {
    if (!instructorId) return;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ monthStart });
      const res = await fetch(`/api/instructors/${instructorId}/availability-groups?${query.toString()}`, {
        method: "GET",
        cache: "no-store"
      });
      if (!res.ok) throw new Error(await apiError(res, "월별 가능 일정을 불러오지 못했습니다."));
      const payload = (await res.json().catch(() => ({}))) as { items?: AvailabilityGroup[] };
      const items = payload.items ?? [];
      setGroups(items);
      const first = items.find((group) => group.isActive) ?? items[0] ?? null;
      if (first) {
        setSelectedGroupId(first.id);
        setDraftName(first.name);
        setDraftSlotsByDay(cloneSlotsByDay(first.availableTimeSlotsByDay));
        setDraftWeekdayNotes(cloneWeekdayNotes(first.weekdayNotes));
        setDraftDateOverrides(cloneDateOverrides(first.dateOverrides));
      } else {
        setSelectedGroupId(null);
        setDraftName(`${monthLabel(monthStart)} 가능 일정`);
        setDraftSlotsByDay(cloneSlotsByDay(initialAvailability));
        setDraftWeekdayNotes({});
        setDraftDateOverrides({});
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "월별 가능 일정을 불러오지 못했습니다.");
      setGroups([]);
      setSelectedGroupId(null);
    } finally {
      setLoading(false);
    }
  }, [initialAvailability, instructorId, monthStart]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const nextDate = defaultSelectedDate(monthStart);
    setSelectedDate(nextDate);
    setSelectedDates([nextDate]);
    setMultiSelectMode(false);
    setAssignmentEditor(null);
  }, [monthStart]);

  const setWeeklySlotSelection = useCallback((weekday: Weekday, slot: string, selected: boolean) => {
    if (saving) return;
    setDraftSlotsByDay((prev) => {
      const current = prev[weekday] ?? [];
      if (current.includes(slot) === selected) return prev;
      const next = selected ? [...current, slot].sort((a, b) => a.localeCompare(b)) : current.filter((item) => item !== slot);
      const result = cloneSlotsByDay(prev);
      if (next.length > 0) result[weekday] = next;
      else delete result[weekday];
      return result;
    });
    setNotice(null);
  }, [saving]);

  const toggleSlot = useCallback((weekday: Weekday, slot: string) => {
    setWeeklySlotSelection(weekday, slot, draftSlotsByDay[weekday]?.includes(slot) !== true);
  }, [draftSlotsByDay, setWeeklySlotSelection]);

  const setDateStatus = useCallback((date: string, status: InstructorAvailabilityDateOverride["status"] | "default") => {
    const cacheKey = `${selectedGroupId ?? "draft"}:${monthStart}:${date}`;
    const currentOverride = draftDateOverrides[date];
    if (currentOverride?.status === "temporary" && status !== "temporary") {
      temporaryDraftCacheRef.current[cacheKey] = cloneDateOverrides({ [date]: currentOverride })[date];
    }
    const cachedTemporary = status === "temporary" ? temporaryDraftCacheRef.current[cacheKey] : undefined;

    setDraftDateOverrides((prev) => {
      const next = cloneDateOverrides(prev);
      const existingOverride = next[date];
      if (status === "default") {
        delete next[date];
      } else if (status === "unavailable") {
        next[date] = { status, slots: [], ...(next[date]?.note ? { note: next[date].note } : {}) };
      } else {
        const defaultSlots = draftSlotsByDay[weekdayForDate(date)] ?? [];
        if (cachedTemporary) {
          next[date] = {
            ...cloneDateOverrides({ [date]: cachedTemporary })[date],
            ...(existingOverride?.note ? { note: existingOverride.note } : {})
          };
          return next;
        }
        const existingSlots =
          existingOverride?.status === "available" || existingOverride?.status === "temporary"
            ? existingOverride.slots
            : defaultSlots;
        next[date] = {
          status,
          slots: [...existingSlots],
          ...(existingOverride?.note ? { note: existingOverride.note } : {}),
          ...(status === "temporary" && existingOverride?.status === "temporary" && existingOverride.plannedClasses
            ? { plannedClasses: existingOverride.plannedClasses }
            : {})
        };
      }
      return next;
    });
    setNotice(null);
  }, [draftDateOverrides, draftSlotsByDay, monthStart, selectedGroupId]);

  const setSelectedDateStatus = (status: InstructorAvailabilityDateOverride["status"] | "default") => {
    setDateStatus(selectedDate, status);
  };

  const setDateSlotSelection = useCallback((date: string, slot: string, selected: boolean) => {
    if (saving) return;
    setDraftDateOverrides((prev) => {
      const next = cloneDateOverrides(prev);
      const existingOverride = next[date];
      const current =
        existingOverride?.status === "available" || existingOverride?.status === "temporary" ? existingOverride.slots : [];
      if (current.includes(slot) === selected) return prev;
      const slots = selected ? [...current, slot].sort((a, b) => a.localeCompare(b)) : current.filter((item) => item !== slot);
      const status = existingOverride?.status === "temporary" ? "temporary" : "available";
      const plannedClasses = { ...(existingOverride?.plannedClasses ?? {}) };
      if (!selected) delete plannedClasses[slot];
      next[date] = {
        status,
        slots,
        ...(existingOverride?.note ? { note: existingOverride.note } : {}),
        ...(Object.keys(plannedClasses).length > 0 ? { plannedClasses } : {})
      };
      return next;
    });
    setNotice(null);
  }, [saving]);

  const setSelectedDateSlotSelection = useCallback((slot: string, selected: boolean) => {
    setDateSlotSelection(selectedDate, slot, selected);
  }, [selectedDate, setDateSlotSelection]);

  const toggleSelectedDateSlot = useCallback((slot: string) => {
    setSelectedDateSlotSelection(slot, selectedDateOverride?.slots.includes(slot) !== true);
  }, [selectedDateOverride, setSelectedDateSlotSelection]);

  const applyDragSelection = useCallback(
    (drag: AvailabilityDragSelection, weekday: Weekday | null, slot: string, date = selectedDate) => {
      const key = drag.scope === "weekly" ? `${weekday}:${slot}` : `${date}:${slot}`;
      if (drag.visited.has(key)) return;
      drag.visited.add(key);
      if (drag.scope === "weekly" && weekday) setWeeklySlotSelection(weekday, slot, drag.selected);
      if (drag.scope === "date") setDateSlotSelection(date, slot, drag.selected);
    },
    [selectedDate, setDateSlotSelection, setWeeklySlotSelection]
  );

  const startDragSelection = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      scope: AvailabilityDragScope,
      weekday: Weekday | null,
      slot: string,
      currentlySelected: boolean,
      date?: string
    ) => {
      if (loading || saving || event.button !== 0) return;
      event.preventDefault();
      const drag: AvailabilityDragSelection = {
        pointerId: event.pointerId,
        scope,
        selected: !currentlySelected,
        visited: new Set()
      };
      dragSelectionRef.current = drag;
      applyDragSelection(drag, weekday, slot, date);
    },
    [applyDragSelection, loading, saving]
  );

  const continueDragSelection = useCallback(
    (event: ReactPointerEvent<HTMLElement>, scope: AvailabilityDragScope) => {
      const drag = dragSelectionRef.current;
      if (!drag || drag.pointerId !== event.pointerId || drag.scope !== scope) return;
      event.preventDefault();
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-availability-drag-cell]");
      if (!target || target.dataset.dragScope !== scope) return;
      const slot = target.dataset.slot;
      const date = target.dataset.date;
      const weekdayValue = Number(target.dataset.weekday);
      if (!slot) return;
      applyDragSelection(
        drag,
        scope === "weekly" && weekdayValue >= 1 && weekdayValue <= 7 ? (weekdayValue as Weekday) : null,
        slot,
        date
      );
    },
    [applyDragSelection]
  );

  const stopDragSelection = useCallback((pointerId?: number) => {
    const drag = dragSelectionRef.current;
    if (!drag || (pointerId != null && drag.pointerId !== pointerId)) return;
    dragSelectionRef.current = null;
  }, []);

  useEffect(() => {
    const stop = () => stopDragSelection();
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [stopDragSelection]);

  const handleCalendarDateClick = useCallback((date: string) => {
    if (!multiSelectMode) {
      setSelectedDate(date);
      setSelectedDates([date]);
      return;
    }

    const alreadySelected = selectedDates.includes(date);
    if (alreadySelected) {
      setSelectedDates((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((item) => item !== date);
        setSelectedDate(next[0]);
        return next;
      });
      return;
    }

    setSelectedDate(date);
    setSelectedDates((prev) => [...prev, date].sort((a, b) => a.localeCompare(b)));
    if (!draftDateOverrides[date]) setDateStatus(date, "temporary");
  }, [draftDateOverrides, multiSelectMode, selectedDates, setDateStatus]);

  const toggleMultiSelectMode = () => {
    const next = !multiSelectMode;
    setMultiSelectMode(next);
    setSelectedDates([selectedDate]);
    if (next && !draftDateOverrides[selectedDate]) setDateStatus(selectedDate, "temporary");
    setAssignmentEditor(null);
  };

  const savePlannedClass = (date: string, plannedClass: InstructorAvailabilityPlannedClass) => {
    setDraftDateOverrides((prev) => {
      const next = cloneDateOverrides(prev);
      const override = next[date];
      if (override?.status !== "temporary" || !override.slots.includes(plannedClass.slot)) return prev;
      next[date] = {
        ...override,
        plannedClasses: {
          ...(override.plannedClasses ?? {}),
          [plannedClass.slot]: plannedClass
        }
      };
      return next;
    });
    setAssignmentEditor(null);
    setNotice(null);
  };

  const deletePlannedClass = (date: string, slot: string) => {
    setDraftDateOverrides((prev) => {
      const next = cloneDateOverrides(prev);
      const override = next[date];
      if (!override?.plannedClasses?.[slot]) return prev;
      const plannedClasses = { ...override.plannedClasses };
      delete plannedClasses[slot];
      next[date] = {
        ...override,
        ...(Object.keys(plannedClasses).length > 0 ? { plannedClasses } : { plannedClasses: undefined })
      };
      return next;
    });
    setAssignmentEditor(null);
    setNotice(null);
  };

  const createGroup = async () => {
    if (!draftName.trim()) {
      setError("일정 이름을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/instructors/${instructorId}/availability-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthStart,
          name: draftName.trim(),
          availableTimeSlotsByDay: draftSlotsByDay,
          weekdayNotes: draftWeekdayNotes,
          dateOverrides: draftDateOverrides,
          isActive: true
        })
      });
      if (!res.ok) throw new Error(await apiError(res, "새 가능 일정을 저장하지 못했습니다."));
      onActiveAvailabilityChange(cloneSlotsByDay(draftSlotsByDay));
      setNotice(`${monthLabel(monthStart)} 새 일정을 활성 상태로 저장했습니다.`);
      await loadGroups();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "새 가능 일정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const saveSelectedGroup = async () => {
    if (!selectedGroup || !draftName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/instructors/${instructorId}/availability-groups`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          id: selectedGroup.id,
          name: draftName.trim(),
          availableTimeSlotsByDay: draftSlotsByDay,
          weekdayNotes: draftWeekdayNotes,
          dateOverrides: draftDateOverrides
        })
      });
      if (!res.ok) throw new Error(await apiError(res, "가능 일정 변경을 저장하지 못했습니다."));
      if (selectedGroup.isActive) onActiveAvailabilityChange(cloneSlotsByDay(draftSlotsByDay));
      setNotice("선택한 가능 일정의 변경사항을 저장했습니다.");
      await loadGroups();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "가능 일정 변경을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const activateGroup = async (group: AvailabilityGroup) => {
    if (group.isActive || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/instructors/${instructorId}/availability-groups`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", id: group.id })
      });
      if (!res.ok) throw new Error(await apiError(res, "가능 일정을 활성화하지 못했습니다."));
      onActiveAvailabilityChange(cloneSlotsByDay(group.availableTimeSlotsByDay));
      setNotice(`'${group.name}' 일정을 활성화했습니다.`);
      await loadGroups();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "가능 일정을 활성화하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-instructor-availability-workspace="true" className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="sync-surface min-w-0 rounded-xl bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <p className="sync-heading text-base font-black text-slate-950">{instructorName} 강사 수업 가능 일정</p>
            <p className="sync-copy mt-1 text-xs font-semibold text-slate-500">
              반복되는 기본 시간을 정하고, 날짜별 변동이 있는 날만 캘린더에서 따로 지정합니다.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setMonthStart((prev) => shiftMonth(prev, -1))}
              className="sync-pressable sync-focus h-8 rounded-md px-3 text-xs font-bold text-slate-600 hover:bg-white"
              aria-label="이전 달"
            >
              이전
            </button>
            <span className="sync-tabular min-w-[92px] text-center text-xs font-black text-slate-800">{monthLabel(monthStart)}</span>
            <button
              type="button"
              onClick={() => setMonthStart((prev) => shiftMonth(prev, 1))}
              className="sync-pressable sync-focus h-8 rounded-md px-3 text-xs font-bold text-slate-600 hover:bg-white"
              aria-label="다음 달"
            >
              다음
            </button>
          </div>
        </div>

        {error ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p> : null}
        {notice ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{notice}</p> : null}

        <section
          data-instructor-availability-profile="true"
          aria-label={`${instructorName} 강사 기본 가능 요일 요약`}
          className="mt-3 flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3 text-white shadow-sm sm:flex-row sm:items-stretch"
        >
          <div className="flex min-w-[180px] items-center gap-3 sm:border-r sm:border-slate-700 sm:pr-4">
            <div
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg font-black text-white shadow-sm"
            >
              {instructorName.trim().slice(0, 1) || "강"}
            </div>
            <div className="min-w-0">
              <p className="sync-heading truncate text-lg font-black tracking-tight text-white">
                {formatInstructorTeacherName(instructorName)}
              </p>
              <p className="mt-0.5 truncate text-xs font-bold text-slate-300">
                {instructorSubject.trim() || "담당 과목 미지정"}
              </p>
            </div>
          </div>

          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2.5">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-300">기본 가능 요일</p>
              <p className="sync-tabular mt-1 text-sm font-black text-white">
                {formatAvailabilityWeekdays(availabilityDaySummary.availableDays)}
              </p>
            </div>
            <div className="rounded-lg border border-rose-300/20 bg-rose-300/10 px-3 py-2.5">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-rose-200">기본 불가능 요일</p>
              <p className="sync-tabular mt-1 text-sm font-black text-white">
                {formatAvailabilityWeekdays(availabilityDaySummary.unavailableDays)}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 sm:min-w-[108px] sm:flex-col sm:items-end sm:justify-center">
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">주간 가능</span>
            <span className="sync-tabular text-base font-black text-blue-300">{availabilityDaySummary.selectedHours}시간</span>
          </div>
        </section>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <label className="min-w-[240px] flex-1 space-y-1 text-xs font-bold text-slate-600">
            일정 이름
            <input
              value={draftName}
              disabled={loading || saving}
              onChange={(event) => setDraftName(event.target.value)}
              className="sync-input w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="sync-tabular rounded-full bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">선택 {selectedCount}시간</span>
            <button
              type="button"
              disabled={loading || saving || selectedCount === 0}
              onClick={() => setDraftSlotsByDay({})}
              className="sync-pressable sync-focus min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              선택 지우기
            </button>
            {selectedGroup ? (
              <button
                type="button"
                disabled={loading || saving || invalidDateOverride}
                onClick={() => void saveSelectedGroup()}
                className="sync-pressable sync-focus min-h-9 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-black text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                변경 저장
              </button>
            ) : null}
            <button
              type="button"
              disabled={loading || saving || invalidDateOverride}
              onClick={() => void createGroup()}
              className="sync-pressable sync-focus min-h-9 rounded-lg bg-blue-600 px-3 text-xs font-black text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {selectedGroup ? "새 버전으로 저장" : "새 일정 저장"}
            </button>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black text-slate-800">요일별 메모</p>
              <p className="mt-0.5 text-[10px] font-semibold text-slate-500">종료 시간 미정, 특정 시간 제외 등 요일별 참고사항을 남길 수 있습니다.</p>
            </div>
            <span className="rounded-md bg-white px-2 py-1 text-[10px] font-black text-slate-500">메모 {weekdayNoteCount(draftWeekdayNotes)}개</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
            {DAYS.map((day) => (
              <label key={`availability-note-${day.key}`} className="space-y-1 text-[10px] font-black text-slate-600">
                {day.label}요일
                <input
                  value={draftWeekdayNotes[day.key] ?? ""}
                  maxLength={120}
                  disabled={loading || saving}
                  onChange={(event) => {
                    const note = event.target.value;
                    setDraftWeekdayNotes((prev) => {
                      const next = { ...prev };
                      if (note) next[day.key] = note;
                      else delete next[day.key];
                      return next;
                    });
                    setNotice(null);
                  }}
                  placeholder="메모 없음"
                  className="sync-input w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="mt-3 grid items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            {planningDates.length > 0 ? (
              <>
                <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="sync-tabular text-sm font-black text-slate-900">
                      {multiSelectMode ? `한시 시간표 ${planningDates.length}일 편성` : `${selectedDateDisplay} 한시 시간표`}
                    </p>
                    <p className="sync-copy mt-0.5 text-[10px] font-bold text-emerald-700">가능 시간을 정한 뒤 학생 배치를 눌러 수업 유형과 학생을 입력합니다.</p>
                  </div>
                  <span className="sync-tabular rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">
                    날짜 {planningDates.length}일
                  </span>
                </div>
                <div
                  className="overflow-x-auto rounded-lg border border-emerald-200 select-none"
                  onPointerMove={(event) => continueDragSelection(event, "date")}
                  onPointerUp={(event) => stopDragSelection(event.pointerId)}
                  onPointerCancel={(event) => stopDragSelection(event.pointerId)}
                >
                  <table className={`sync-tabular min-w-max border-collapse text-xs ${multiSelectMode ? "table-auto" : "w-full table-fixed"}`}>
                    <thead>
                      <tr>
                        <th className="w-24 border-b border-r border-emerald-200 bg-emerald-50 px-2 py-3 text-center font-black text-emerald-800">시간</th>
                        {planningDates.map((date) => {
                          const override = draftDateOverrides[date];
                          return (
                            <th
                              key={`planning-date-head-${date}`}
                              className={`border-b border-r px-2 py-2 text-center last:border-r-0 ${
                                multiSelectMode ? "min-w-[9.5rem]" : "min-w-44"
                              } ${
                                override?.status === "unavailable"
                                  ? "border-rose-200 bg-rose-50"
                                  : override?.status === "temporary"
                                    ? "border-emerald-200 bg-emerald-50"
                                    : "border-slate-200 bg-white"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedDate(date)}
                                className={`sync-pressable sync-focus min-h-10 w-full rounded-md px-2 text-slate-800 ${
                                  override?.status === "unavailable" ? "hover:bg-rose-100" : "hover:bg-emerald-100"
                                }`}
                              >
                                <span className="block font-black">{dateDisplayLabel(date)}</span>
                                <span className={`mt-0.5 block text-[10px] font-bold ${override?.status === "unavailable" ? "text-rose-700" : "text-emerald-700"}`}>
                                  {override?.status === "temporary"
                                    ? `한시 ${override.slots.length}시간`
                                    : override?.status === "unavailable"
                                      ? "수업 불가"
                                      : override?.status === "available"
                                        ? `변동 가능 ${override.slots.length}시간`
                                        : "기본 적용"}
                                </span>
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {TIME_SLOTS.map((slot) => (
                        <tr key={`temporary-date-row-${slot}`}>
                          <th className="border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-center text-[11px] font-black text-slate-600">{rangeLabel(slot)}</th>
                          {planningDates.map((date) => {
                            const override = draftDateOverrides[date];
                            const isTemporary = override?.status === "temporary";
                            const isUnavailable = override?.status === "unavailable";
                            const isVariableAvailable = override?.status === "available" && override.slots.includes(slot);
                            const selected = isTemporary && override.slots.includes(slot);
                            const plannedClass = isTemporary ? override.plannedClasses?.[slot] : undefined;
                            return (
                              <td
                                key={`temporary-date-cell-${date}-${slot}`}
                                aria-label={isUnavailable ? `${dateDisplayLabel(date)} ${rangeLabel(slot)} 수업 불가` : undefined}
                                className={`border-b border-r p-1 align-middle last:border-r-0 ${multiSelectMode ? "min-w-[9.5rem]" : "min-w-44"} ${
                                  multiSelectMode && isUnavailable
                                    ? "border-rose-100 bg-rose-50"
                                    : multiSelectMode && selected
                                      ? "border-emerald-100 bg-emerald-50"
                                      : multiSelectMode && isVariableAvailable
                                        ? "border-blue-100 bg-blue-50"
                                        : "border-slate-100 bg-white"
                                }`}
                              >
                                {multiSelectMode && isUnavailable ? (
                                  <span className="block min-h-10" aria-hidden="true" />
                                ) : !isTemporary ? (
                                  multiSelectMode ? (
                                    <span className="block min-h-10" aria-hidden="true" />
                                  ) :
                                  slot === TIME_SLOTS[0] ? (
                                    <button type="button" onClick={() => setDateStatus(date, "temporary")} className="sync-pressable sync-focus min-h-10 w-full rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[10px] font-black text-emerald-700 hover:bg-emerald-100">
                                      한시 적용으로 전환
                                    </button>
                                  ) : (
                                    <span className="flex min-h-10 items-center justify-center text-[10px] font-bold text-slate-300">한시 적용 필요</span>
                                  )
                                ) : (
                                  <div className={`grid gap-1 ${multiSelectMode ? "grid-cols-[40px_minmax(0,1fr)]" : "grid-cols-[76px_minmax(0,1fr)]"}`}>
                                    <button
                                      type="button"
                                      aria-pressed={selected}
                                      aria-label={`${dateDisplayLabel(date)} ${rangeLabel(slot)} ${selected ? "한시 가능" : "선택 안 됨"}`}
                                      disabled={loading || saving}
                                      data-availability-drag-cell="true"
                                      data-drag-scope="date"
                                      data-date={date}
                                      data-slot={slot}
                                      onPointerDown={(event) => startDragSelection(event, "date", null, slot, selected, date)}
                                      onClick={(event) => {
                                        if (event.detail === 0) setDateSlotSelection(date, slot, !selected);
                                      }}
                                      className={`sync-pressable sync-focus flex min-h-10 w-full touch-none items-center justify-center rounded-md border px-1 text-[10px] font-black transition-[background-color,border-color,box-shadow,color] duration-150 ease-out ${
                                        selected
                                          ? multiSelectMode
                                            ? "border-transparent bg-transparent text-emerald-800"
                                            : "border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm"
                                          : "border-transparent bg-slate-50 text-slate-500 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
                                      } disabled:opacity-50`}
                                    >
                                      {multiSelectMode ? (selected ? "✓" : "+") : selected ? "한시 가능" : slot}
                                    </button>
                                    {selected || !multiSelectMode ? (
                                      <button
                                        type="button"
                                        disabled={!selected || loading || saving}
                                        onClick={() => setAssignmentEditor({ date, slot })}
                                        className={`sync-pressable sync-focus min-h-10 min-w-0 rounded-md border px-2 text-left text-[10px] font-black ${
                                          plannedClass
                                            ? plannedClassToneClass(plannedClass)
                                            : selected
                                              ? "border-dashed border-slate-300 bg-white text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                                              : "border-transparent bg-slate-50 text-slate-300"
                                        } disabled:cursor-not-allowed`}
                                      >
                                        {plannedClass ? (
                                          <span className="flex min-w-0 items-center justify-between gap-1">
                                            <span className="truncate">{plannedClass.studentNames.join(", ")}</span>
                                            <span className="shrink-0 text-[9px] font-bold opacity-75">{plannedClass.classTypeLabel}</span>
                                          </span>
                                        ) : "학생 배치"}
                                      </button>
                                    ) : (
                                      <span className="block min-h-10" aria-hidden="true" />
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {planningDates.some((date) => draftDateOverrides[date]?.status === "temporary" && draftDateOverrides[date]?.slots.length === 0) ? (
                  <p className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-[10px] font-bold text-rose-700">한시 적용한 모든 날짜에 가능 시간을 한 개 이상 선택해 주세요.</p>
                ) : null}
              </>
            ) : (
              <>
                <p className="sync-copy mb-1.5 text-[10px] font-bold text-slate-500">한 칸을 누르거나 여러 칸을 드래그해 같은 상태로 선택·해제할 수 있습니다.</p>
                <div
                  className="overflow-x-auto rounded-lg border border-slate-200 select-none"
                  onPointerMove={(event) => continueDragSelection(event, "weekly")}
                  onPointerUp={(event) => stopDragSelection(event.pointerId)}
                  onPointerCancel={(event) => stopDragSelection(event.pointerId)}
                >
                  <table className="sync-tabular min-w-[760px] table-fixed border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="w-20 border-b border-r border-slate-200 bg-slate-50 px-2 py-3 text-center font-black text-slate-600">시간</th>
                        {DAYS.map((day) => (
                          <th key={`availability-head-${day.key}`} className="border-b border-r border-slate-200 bg-white px-2 py-3 text-center font-black text-slate-700 last:border-r-0">
                            {day.label}
                            <span className="ml-1 text-[10px] font-bold text-slate-400">{draftSlotsByDay[day.key]?.length ?? 0}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {TIME_SLOTS.map((slot) => (
                        <tr key={`availability-row-${slot}`}>
                          <th className="border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-center text-[11px] font-black text-slate-600">
                            {rangeLabel(slot)}
                          </th>
                          {DAYS.map((day) => {
                            const selected = draftSlotsByDay[day.key]?.includes(slot) === true;
                            return (
                              <td key={`availability-cell-${day.key}-${slot}`} className="border-b border-r border-slate-100 p-1 last:border-r-0">
                                <button
                                  type="button"
                                  aria-pressed={selected}
                                  disabled={loading || saving}
                                  data-availability-drag-cell="true"
                                  data-drag-scope="weekly"
                                  data-weekday={day.key}
                                  data-slot={slot}
                                  onPointerDown={(event) => startDragSelection(event, "weekly", day.key, slot, selected)}
                                  onClick={(event) => {
                                    if (event.detail === 0) toggleSlot(day.key, slot);
                                  }}
                                  className={`sync-pressable sync-focus flex min-h-9 w-full touch-none items-center justify-center rounded-md border text-[11px] font-black transition-[background-color,border-color,box-shadow,color] duration-150 ease-out ${
                                    selected
                                      ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                                      : "border-transparent bg-slate-50 text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                                  } disabled:opacity-50`}
                                >
                                  {selected ? "가능" : slot}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-black text-slate-900">날짜별 변동 일정</p>
                <p className="sync-copy mt-1 text-[10px] font-semibold leading-4 text-slate-500">
                  기본 일정과 다른 날짜만 지정합니다. 한시 적용은 선택한 날짜에만 유효합니다.
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={toggleMultiSelectMode}
                  aria-pressed={multiSelectMode}
                  className={`sync-pressable sync-focus min-h-8 rounded-md border px-2 text-[10px] font-black ${
                    multiSelectMode
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
                  } disabled:opacity-50`}
                >
                  {multiSelectMode ? "다중 선택 종료" : "다중 선택"}
                </button>
                <span className="sync-tabular rounded-md bg-white px-2 py-1 text-[10px] font-black text-slate-600">
                  {multiSelectMode ? `선택 ${selectedDates.length}일` : `일자별 ${dateOverrideCount(draftDateOverrides)}일`}
                </span>
              </div>
            </div>

            {multiSelectMode ? (
              <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-bold leading-4 text-emerald-800">
                캘린더에서 날짜를 눌러 편성 표의 일자 열을 추가하거나 제외합니다.
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold text-slate-600">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" />변동 가능</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-emerald-300 bg-emerald-100" />한시 적용</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-600" />수업 불가</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-slate-300 bg-white" />기본 적용</span>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-black text-slate-500">
              {DAYS.map((day) => <span key={`calendar-weekday-${day.key}`}>{day.label}</span>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {calendarValues.map((date, index) => {
                if (!date) return <span key={`calendar-empty-${index}`} className="aspect-square" aria-hidden="true" />;
                const override = draftDateOverrides[date];
                const selected = date === selectedDate;
                const includedInPlanning = multiSelectMode && selectedDates.includes(date);
                const dayNumber = Number(date.slice(-2));
                return (
                  <button
                    key={date}
                    type="button"
                    disabled={loading || saving}
                    onClick={() => handleCalendarDateClick(date)}
                    aria-label={`${date} ${override?.status === "available" ? "변동 가능" : override?.status === "temporary" ? "한시 적용" : override?.status === "unavailable" ? "수업 불가" : "기본 일정 적용"}`}
                    aria-pressed={selected}
                    className={`sync-pressable sync-focus sync-tabular aspect-square rounded-md border text-[11px] font-black ${
                      override?.status === "available"
                        ? "border-blue-600 bg-blue-600 text-white"
                        : override?.status === "temporary"
                          ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                        : override?.status === "unavailable"
                          ? "border-rose-600 bg-rose-600 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                    } ${includedInPlanning ? "ring-2 ring-emerald-500 ring-offset-1" : selected ? "ring-2 ring-slate-800 ring-offset-1" : ""} disabled:opacity-50`}
                  >
                    {dayNumber}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="sync-tabular text-xs font-black text-slate-900">
                    {selectedDateDisplay}
                  </p>
                  <p className="mt-0.5 text-[10px] font-semibold text-slate-500">
                    {selectedDateOverride?.status === "available"
                      ? `변동 가능 ${selectedDateOverride.slots.length}시간`
                      : selectedDateOverride?.status === "temporary"
                        ? `한시 적용 ${selectedDateOverride.slots.length}시간`
                      : selectedDateOverride?.status === "unavailable"
                        ? "종일 수업 불가"
                        : `기본 ${selectedDateDefaultSlots.length}시간 적용`}
                  </p>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={() => setSelectedDateStatus("default")}
                  className={`sync-pressable sync-focus min-h-8 rounded-md border px-1 text-[10px] font-black ${!selectedDateOverride ? "border-slate-700 bg-slate-700 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                >
                  기본 적용
                </button>
                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={() => setSelectedDateStatus("available")}
                  className={`sync-pressable sync-focus min-h-8 rounded-md border px-1 text-[10px] font-black ${selectedDateOverride?.status === "available" ? "border-blue-600 bg-blue-600 text-white" : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"}`}
                >
                  변동 가능
                </button>
                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={() => setSelectedDateStatus("temporary")}
                  className={`sync-pressable sync-focus min-h-8 rounded-md border px-1 text-[10px] font-black ${selectedDateOverride?.status === "temporary" ? "border-emerald-500 bg-emerald-500 text-white" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                >
                  한시 적용
                </button>
                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={() => setSelectedDateStatus("unavailable")}
                  className={`sync-pressable sync-focus min-h-8 rounded-md border px-1 text-[10px] font-black ${selectedDateOverride?.status === "unavailable" ? "border-rose-600 bg-rose-600 text-white" : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"}`}
                >
                  수업 불가
                </button>
              </div>

              {selectedDateOverride?.status === "available" ? (
                <div className="mt-2">
                  <p className="mb-1 text-[10px] font-black text-slate-600">
                    가능 시간 <span className="font-semibold text-slate-400">(누르거나 드래그)</span>
                  </p>
                  <div
                    className="grid select-none grid-cols-3 gap-1"
                    onPointerMove={(event) => continueDragSelection(event, "date")}
                    onPointerUp={(event) => stopDragSelection(event.pointerId)}
                    onPointerCancel={(event) => stopDragSelection(event.pointerId)}
                  >
                    {TIME_SLOTS.map((slot) => {
                      const selected = selectedDateOverride.slots.includes(slot);
                      return (
                        <button
                          key={`date-override-${selectedDate}-${slot}`}
                          type="button"
                          disabled={loading || saving}
                          aria-pressed={selected}
                          data-availability-drag-cell="true"
                          data-drag-scope="date"
                          data-slot={slot}
                          onPointerDown={(event) => startDragSelection(event, "date", null, slot, selected)}
                          onClick={(event) => {
                            if (event.detail === 0) toggleSelectedDateSlot(slot);
                          }}
                          className={`sync-pressable sync-focus sync-tabular min-h-7 touch-none rounded-md border text-[10px] font-black ${
                            selected
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-200 hover:bg-blue-50"
                          }`}
                        >
                          {slot}
                        </button>
                      );
                    })}
                  </div>
                  {selectedDateOverride.slots.length === 0 ? (
                    <p className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-[10px] font-bold text-rose-700">한 개 이상의 가능 시간을 선택해 주세요.</p>
                  ) : null}
                </div>
              ) : selectedDateOverride?.status === "temporary" ? (
                <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1.5 text-[10px] font-bold leading-4 text-emerald-800">
                  왼쪽의 {selectedDateDisplay} 한시 시간표에서 가능 시간을 입력해 주세요.
                </p>
              ) : null}

              {selectedDateOverride ? (
                <label className="mt-2 block space-y-1 text-[10px] font-black text-slate-600">
                  일자 메모
                  <input
                    value={selectedDateOverride.note ?? ""}
                    maxLength={120}
                    disabled={loading || saving}
                    onChange={(event) => {
                      const note = event.target.value;
                      setDraftDateOverrides((prev) => ({
                        ...prev,
                        [selectedDate]: { ...prev[selectedDate], note }
                      }));
                      setNotice(null);
                    }}
                    placeholder="변동 사유 또는 참고사항"
                    className="sync-input w-full rounded-md border border-slate-200 px-2 py-2 text-[11px] font-semibold text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                  />
                </label>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <aside className="sync-surface min-w-0 rounded-xl bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-black text-slate-900">저장된 가능 일정</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">활성 일정이 목록의 맨 위에 표시됩니다.</p>
          </div>
          <span className="sync-tabular rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">{groups.length}개</span>
        </div>

        <div className="mt-3 space-y-2">
          {loading ? (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs font-bold text-slate-500">불러오는 중...</p>
          ) : groups.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs font-semibold leading-5 text-slate-500">
              {monthLabel(monthStart)}에 저장된 일정이 없습니다. 왼쪽 격자에서 시간을 선택해 첫 일정을 저장해 주세요.
            </div>
          ) : (
            groups.map((group) => {
              const selected = group.id === selectedGroupId;
              const count = totalSlotCount(group.availableTimeSlotsByDay);
              const noteCount = weekdayNoteCount(group.weekdayNotes);
              const overrideCount = dateOverrideCount(group.dateOverrides);
              const temporaryCount = temporaryOverrideCount(group.dateOverrides);
              return (
                <div
                  key={group.id}
                  className={`rounded-lg border p-2.5 transition-[background-color,border-color,box-shadow] duration-150 ease-out ${
                    group.isActive
                      ? "border-blue-300 bg-blue-50 shadow-sm"
                      : selected
                        ? "border-slate-400 bg-slate-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <button type="button" onClick={() => selectGroup(group)} className="sync-focus block w-full rounded-md text-left">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-black text-slate-900">{group.name}</span>
                        <span className="sync-tabular mt-1 block text-[10px] font-bold text-slate-500">
                          주 {count}시간{overrideCount > 0 ? `, 일자별 ${overrideCount}일` : ""}{temporaryCount > 0 ? ` (한시 ${temporaryCount}일)` : ""}{noteCount > 0 ? `, 메모 ${noteCount}개` : ""}
                        </span>
                      </span>
                      {group.isActive ? (
                        <span className="shrink-0 rounded-full bg-blue-600 px-2 py-1 text-[9px] font-black text-white">활성</span>
                      ) : null}
                    </span>
                  </button>
                  {!group.isActive ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void activateGroup(group)}
                      className="sync-pressable sync-focus mt-2 min-h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[10px] font-black text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                    >
                      활성 일정으로 지정
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {activeGroup ? (
          <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-bold leading-5 text-blue-700">
            현재 활성: {activeGroup.name}
          </p>
        ) : null}
      </aside>

      <InstructorAvailabilityAssignmentModal
        open={Boolean(assignmentEditor)}
        dateLabel={assignmentEditor ? dateDisplayLabel(assignmentEditor.date) : ""}
        slot={assignmentEditor?.slot ?? ""}
        students={activeStudents}
        classTypes={planningClassTypes}
        initialClass={assignmentInitialClass}
        onSave={(plannedClass) => {
          if (assignmentEditor) savePlannedClass(assignmentEditor.date, plannedClass);
        }}
        onDelete={() => {
          if (assignmentEditor) deletePlannedClass(assignmentEditor.date, assignmentEditor.slot);
        }}
        onClose={() => setAssignmentEditor(null)}
      />
    </section>
  );
}
