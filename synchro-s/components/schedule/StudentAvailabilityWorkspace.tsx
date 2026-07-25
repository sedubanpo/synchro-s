"use client";

import { DAYS, TIME_SLOTS } from "@/lib/constants";
import { nextStudentAvailabilitySlot, type StudentAvailabilityPaintMode } from "@/lib/studentAvailabilityPaint";
import { studentAvailabilityComparisonCell } from "@/lib/studentAvailabilityComparison";
import type {
  StudentAvailabilityByDay,
  StudentAvailabilityDateOverride,
  StudentAvailabilityDateOverrides,
  StudentAvailabilitySlot,
  Weekday
} from "@/types/schedule";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type AvailabilityGroup = {
  id: string;
  studentId: string;
  monthStart: string;
  title: string;
  memo: string;
  weeklyAvailability: StudentAvailabilityByDay;
  dateOverrides: StudentAvailabilityDateOverrides;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  studentId: string;
  studentName: string;
  studentSecondary?: string;
};

type CellEditor = { weekday: Weekday; slot: string };
type DragScope = "weekly" | "date";
type DragSelection = {
  pointerId: number;
  scope: DragScope;
  visited: Set<string>;
  weeklyPaintMode?: StudentAvailabilityPaintMode;
};

const KST_DATE_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function currentMonthStart(): string {
  return `${KST_DATE_FORMATTER.format(new Date()).slice(0, 7)}-01`;
}

function shiftMonth(monthStart: string, diff: number): string {
  const [year, month] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + diff, 1)).toISOString().slice(0, 10);
}

function monthLabel(monthStart: string): string {
  const [year, month] = monthStart.split("-").map(Number);
  return `${year}년 ${month}월`;
}

function defaultSelectedDate(monthStart: string): string {
  const today = KST_DATE_FORMATTER.format(new Date());
  return today.startsWith(monthStart.slice(0, 7)) ? today : monthStart;
}

function weekdayForDate(date: string): Weekday {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
}

function dateLabel(date: string): string {
  const weekday = DAYS.find((item) => item.key === weekdayForDate(date))?.label ?? "";
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 ${weekday}요일`;
}

function calendarDates(monthStart: string): Array<string | null> {
  const [year, month] = monthStart.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const leading = firstDay === 0 ? 6 : firstDay - 1;
  const lastDate = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const result: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= lastDate; day += 1) {
    result.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  while (result.length % 7 !== 0) result.push(null);
  return result;
}

function timeRange(slot: string): string {
  const hour = Number(slot.slice(0, 2));
  return `${hour}-${hour + 1}시`;
}

function cloneWeekly(value?: StudentAvailabilityByDay): StudentAvailabilityByDay {
  const result: StudentAvailabilityByDay = {};
  for (const day of DAYS) {
    const source = value?.[day.key];
    if (!source) continue;
    const slots: Partial<Record<string, StudentAvailabilitySlot>> = {};
    for (const [slot, item] of Object.entries(source)) {
      if (item) slots[slot] = { ...item };
    }
    if (Object.keys(slots).length > 0) result[day.key] = slots;
  }
  return result;
}

function cloneOverrides(value?: StudentAvailabilityDateOverrides): StudentAvailabilityDateOverrides {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([date, item]) => [
      date,
      { status: item.status, slots: [...item.slots].sort(), ...(item.note ? { note: item.note } : {}) }
    ])
  );
}

function weeklyCount(value: StudentAvailabilityByDay, status?: StudentAvailabilitySlot["status"]): number {
  return Object.values(value).reduce(
    (sum, slots) => sum + Object.values(slots ?? {}).filter((item) => item && (!status || item.status === status)).length,
    0
  );
}

async function apiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error ?? fallback;
}

export function StudentAvailabilityWorkspace({ studentId, studentName, studentSecondary }: Props) {
  const [monthStart, setMonthStart] = useState(currentMonthStart);
  const [groups, setGroups] = useState<AvailabilityGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftMemo, setDraftMemo] = useState("");
  const [draftWeekly, setDraftWeekly] = useState<StudentAvailabilityByDay>({});
  const [draftOverrides, setDraftOverrides] = useState<StudentAvailabilityDateOverrides>({});
  const [selectedDate, setSelectedDate] = useState(() => defaultSelectedDate(currentMonthStart()));
  const [compareMode, setCompareMode] = useState(false);
  const [comparisonDates, setComparisonDates] = useState<string[]>([]);
  const [cellEditor, setCellEditor] = useState<CellEditor | null>(null);
  const [weeklyPaintMode, setWeeklyPaintMode] = useState<StudentAvailabilityPaintMode>("available");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dragRef = useRef<DragSelection | null>(null);

  const selectedGroup = useMemo(() => groups.find((item) => item.id === selectedGroupId) ?? null, [groups, selectedGroupId]);
  const calendarValues = useMemo(() => calendarDates(monthStart), [monthStart]);
  const selectedOverride = draftOverrides[selectedDate];
  const selectedWeekday = weekdayForDate(selectedDate);
  const selectedWeeklyCell = cellEditor ? draftWeekly[cellEditor.weekday]?.[cellEditor.slot] : undefined;
  const invalidTemporary = Object.values(draftOverrides).some((item) => item.status === "temporary" && item.slots.length === 0);

  const applyGroup = useCallback((group: AvailabilityGroup, preserveNotice = false) => {
    setSelectedGroupId(group.id);
    setDraftTitle(group.title);
    setDraftMemo(group.memo);
    setDraftWeekly(cloneWeekly(group.weeklyAvailability));
    setDraftOverrides(cloneOverrides(group.dateOverrides));
    setCompareMode(false);
    setComparisonDates([]);
    setCellEditor(null);
    setError(null);
    if (!preserveNotice) setNotice(null);
  }, []);

  const resetDraft = useCallback(() => {
    setSelectedGroupId(null);
    setDraftTitle(`${monthLabel(monthStart)} ${studentName} 가능 일정`);
    setDraftMemo("");
    setDraftWeekly({});
    setDraftOverrides({});
    setCompareMode(false);
    setComparisonDates([]);
    setCellEditor(null);
    setError(null);
    setNotice("새 가능 일정 초안을 시작했습니다.");
  }, [monthStart, studentName]);

  const loadGroups = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ monthStart });
      const response = await fetch(`/api/students/${studentId}/availability-groups?${query.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(await apiError(response, "학생 가능 일정을 불러오지 못했습니다."));
      const payload = (await response.json().catch(() => ({}))) as { items?: AvailabilityGroup[] };
      const items = payload.items ?? [];
      setGroups(items);
      const initial = items.find((item) => item.isActive) ?? items[0] ?? null;
      if (initial) applyGroup(initial, true);
      else {
        setSelectedGroupId(null);
        setDraftTitle(`${monthLabel(monthStart)} ${studentName} 가능 일정`);
        setDraftMemo("");
        setDraftWeekly({});
        setDraftOverrides({});
      }
    } catch (loadError) {
      setGroups([]);
      setSelectedGroupId(null);
      setError(loadError instanceof Error ? loadError.message : "학생 가능 일정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [applyGroup, monthStart, studentId, studentName]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    setSelectedDate(defaultSelectedDate(monthStart));
    setCompareMode(false);
    setComparisonDates([]);
    setCellEditor(null);
  }, [monthStart]);

  const toggleCompareMode = useCallback(() => {
    setCompareMode((current) => {
      if (!current) setComparisonDates([selectedDate]);
      return !current;
    });
    setCellEditor(null);
  }, [selectedDate]);

  const toggleComparisonDate = useCallback((date: string) => {
    setComparisonDates((current) => (
      current.includes(date)
        ? current.filter((item) => item !== date)
        : [...current, date].sort()
    ));
  }, []);

  const selectAllOverrideDates = useCallback(() => {
    setComparisonDates(
      Object.keys(draftOverrides)
        .filter((date) => date.startsWith(monthStart.slice(0, 7)))
        .sort()
    );
  }, [draftOverrides, monthStart]);

  const setWeeklyCell = useCallback((weekday: Weekday, slot: string, value: StudentAvailabilitySlot | null) => {
    if (saving) return;
    setDraftWeekly((previous) => {
      const next = cloneWeekly(previous);
      const slots = { ...(next[weekday] ?? {}) };
      if (value) slots[slot] = value;
      else delete slots[slot];
      if (Object.keys(slots).length > 0) next[weekday] = slots;
      else delete next[weekday];
      return next;
    });
    setNotice(null);
  }, [saving]);

  const applyWeeklyPaint = useCallback((weekday: Weekday, slot: string, mode: StudentAvailabilityPaintMode) => {
    const current = draftWeekly[weekday]?.[slot];
    setWeeklyCell(weekday, slot, nextStudentAvailabilitySlot(current, mode));
  }, [draftWeekly, setWeeklyCell]);

  const setDateOverride = useCallback((status: StudentAvailabilityDateOverride["status"] | "default") => {
    setDraftOverrides((previous) => {
      const next = cloneOverrides(previous);
      if (status === "default") delete next[selectedDate];
      else if (status === "unavailable") {
        next[selectedDate] = {
          status,
          slots: [],
          ...(next[selectedDate]?.note ? { note: next[selectedDate]!.note } : {})
        };
      } else {
        const existing = next[selectedDate];
        const baseSlots = Object.entries(draftWeekly[selectedWeekday] ?? {})
          .filter(([, item]) => item?.status === "available")
          .map(([slot]) => slot)
          .sort();
        next[selectedDate] = {
          status,
          slots: existing?.status === "temporary" ? existing.slots : baseSlots,
          ...(existing?.note ? { note: existing.note } : {})
        };
      }
      return next;
    });
    setCellEditor(null);
    setNotice(null);
  }, [draftWeekly, selectedDate, selectedWeekday]);

  const addDateSlot = useCallback((slot: string) => {
    setDraftOverrides((previous) => {
      const next = cloneOverrides(previous);
      const existing = next[selectedDate];
      const slots = existing?.status === "temporary" ? existing.slots : [];
      if (slots.includes(slot)) return previous;
      next[selectedDate] = {
        status: "temporary",
        slots: [...slots, slot].sort(),
        ...(existing?.note ? { note: existing.note } : {})
      };
      return next;
    });
    setNotice(null);
  }, [selectedDate]);

  const removeDateSlot = (slot: string) => {
    setDraftOverrides((previous) => {
      const next = cloneOverrides(previous);
      const existing = next[selectedDate];
      if (existing?.status !== "temporary") return previous;
      next[selectedDate] = { ...existing, slots: existing.slots.filter((item) => item !== slot) };
      return next;
    });
  };

  const applyDragCell = useCallback((drag: DragSelection, weekday: Weekday | null, slot: string) => {
    const key = drag.scope === "weekly" ? `${weekday}:${slot}` : `${selectedDate}:${slot}`;
    if (drag.visited.has(key)) return;
    drag.visited.add(key);
    if (drag.scope === "weekly" && weekday) applyWeeklyPaint(weekday, slot, drag.weeklyPaintMode ?? "available");
    if (drag.scope === "date") addDateSlot(slot);
  }, [addDateSlot, applyWeeklyPaint, selectedDate]);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, scope: DragScope, weekday: Weekday | null, slot: string) => {
    if (loading || saving || event.button !== 0) return;
    event.preventDefault();
    const drag: DragSelection = {
      pointerId: event.pointerId,
      scope,
      visited: new Set(),
      ...(scope === "weekly" ? { weeklyPaintMode } : {})
    };
    dragRef.current = drag;
    if (scope === "weekly" && weekday) {
      const current = draftWeekly[weekday]?.[slot];
      const willClear = weeklyPaintMode === "clear" || current?.status === weeklyPaintMode;
      setCellEditor(willClear ? null : { weekday, slot });
    }
    applyDragCell(drag, weekday, slot);
  }, [applyDragCell, draftWeekly, loading, saving, weeklyPaintMode]);

  const continueDrag = useCallback((event: ReactPointerEvent<HTMLElement>, scope: DragScope) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.scope !== scope) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-student-availability-cell]");
    if (!target || target.dataset.scope !== scope || !target.dataset.slot) return;
    const weekday = Number(target.dataset.weekday);
    applyDragCell(drag, weekday >= 1 && weekday <= 7 ? (weekday as Weekday) : null, target.dataset.slot);
  }, [applyDragCell]);

  const stopDrag = useCallback((pointerId?: number) => {
    if (!dragRef.current || (pointerId != null && dragRef.current.pointerId !== pointerId)) return;
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const stop = () => stopDrag();
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [stopDrag]);

  const validateDraft = (): boolean => {
    if (!draftTitle.trim()) {
      setError("가능 일정 제목을 입력해 주세요.");
      return false;
    }
    if (invalidTemporary) {
      setError("한시 적용한 날짜에는 가능 시간을 한 개 이상 선택해 주세요.");
      return false;
    }
    if (weeklyCount(draftWeekly) === 0 && Object.keys(draftOverrides).length === 0) {
      setError("기본 시간이나 날짜별 변동 일정을 한 개 이상 입력해 주세요.");
      return false;
    }
    return true;
  };

  const createGroup = async () => {
    if (!validateDraft()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/students/${studentId}/availability-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthStart,
          title: draftTitle.trim(),
          memo: draftMemo.trim(),
          weeklyAvailability: draftWeekly,
          dateOverrides: draftOverrides,
          isActive: true
        })
      });
      if (!response.ok) throw new Error(await apiError(response, "학생 가능 일정을 저장하지 못했습니다."));
      setNotice("새 학생 가능 일정을 활성 상태로 저장했습니다.");
      await loadGroups();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "학생 가능 일정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const saveGroup = async () => {
    if (!selectedGroup || !validateDraft()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/students/${studentId}/availability-groups`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          id: selectedGroup.id,
          title: draftTitle.trim(),
          memo: draftMemo.trim(),
          weeklyAvailability: draftWeekly,
          dateOverrides: draftOverrides
        })
      });
      if (!response.ok) throw new Error(await apiError(response, "학생 가능 일정 변경을 저장하지 못했습니다."));
      setNotice("선택한 가능 일정의 변경사항을 저장했습니다.");
      await loadGroups();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "학생 가능 일정 변경을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const activateGroup = async (group: AvailabilityGroup) => {
    if (group.isActive || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/students/${studentId}/availability-groups`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", id: group.id })
      });
      if (!response.ok) throw new Error(await apiError(response, "학생 가능 일정을 활성화하지 못했습니다."));
      setNotice(`'${group.title}' 일정을 활성화했습니다.`);
      await loadGroups();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "학생 가능 일정을 활성화하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-student-availability-workspace="true" className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="sync-surface min-w-0 rounded-xl bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <p className="sync-heading text-base font-black text-slate-950">{studentName} 학생 수업 가능 일정</p>
            <p className="sync-copy mt-1 text-xs font-semibold text-slate-500">
              드래그로 시간을 선택한 뒤 셀을 눌러 가능·불가와 사유를 기록합니다.
            </p>
            {studentSecondary ? <p className="mt-1 text-[11px] font-bold text-slate-400">{studentSecondary}</p> : null}
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button type="button" onClick={() => setMonthStart((value) => shiftMonth(value, -1))} className="sync-pressable sync-focus min-h-10 rounded-md px-3 text-xs font-bold text-slate-600 hover:bg-white">이전</button>
            <span className="sync-tabular min-w-[92px] text-center text-xs font-black text-slate-800">{monthLabel(monthStart)}</span>
            <button type="button" onClick={() => setMonthStart((value) => shiftMonth(value, 1))} className="sync-pressable sync-focus min-h-10 rounded-md px-3 text-xs font-bold text-slate-600 hover:bg-white">다음</button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2"><p className="text-[10px] font-bold text-blue-600">기본 가능</p><p className="sync-tabular mt-1 text-xl font-black text-slate-900">{weeklyCount(draftWeekly, "available")}</p></div>
          <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2"><p className="text-[10px] font-bold text-rose-600">기본 불가</p><p className="sync-tabular mt-1 text-xl font-black text-slate-900">{weeklyCount(draftWeekly, "unavailable")}</p></div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2"><p className="text-[10px] font-bold text-emerald-600">날짜별 변동</p><p className="sync-tabular mt-1 text-xl font-black text-slate-900">{Object.keys(draftOverrides).length}</p></div>
        </div>

        {error ? <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p> : null}
        {notice ? <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{notice}</p> : null}

        {compareMode ? (
          <div className="mt-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-black text-slate-900">선택한 날짜 모아보기</p>
                <p className="sync-copy text-[11px] font-semibold text-slate-500">날짜별 일정은 한 화면에서 비교하고, 수정은 각 날짜의 ‘편집’으로 들어가 진행합니다.</p>
              </div>
              <span className="sync-tabular rounded-md bg-violet-100 px-2.5 py-1.5 text-[11px] font-black text-violet-700">선택 {comparisonDates.length}일</span>
            </div>
            {comparisonDates.length === 0 ? (
              <div className="flex min-h-72 items-center justify-center rounded-lg border border-dashed border-violet-200 bg-violet-50 p-6 text-center">
                <div>
                  <p className="text-sm font-black text-violet-900">오른쪽 달력에서 비교할 날짜를 선택해 주세요.</p>
                  <p className="sync-copy mt-1 text-xs font-semibold text-violet-700">한시 적용일 전체를 한 번에 선택할 수도 있습니다.</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="sync-tabular min-w-max border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 w-24 min-w-24 border-b border-r border-slate-200 bg-slate-50 px-2 py-3">시간</th>
                      {comparisonDates.map((date) => {
                        const override = draftOverrides[date];
                        return (
                          <th key={`student-compare-head-${date}`} className="w-44 min-w-44 border-b border-r border-slate-200 bg-white px-2 py-2 last:border-r-0">
                            <span className="block font-black text-slate-900">{dateLabel(date)}</span>
                            <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[9px] font-black ${override?.status === "temporary" ? "bg-emerald-100 text-emerald-700" : override?.status === "unavailable" ? "bg-rose-100 text-rose-700" : "bg-blue-100 text-blue-700"}`}>
                              {override?.status === "temporary" ? "한시 적용" : override?.status === "unavailable" ? "수업 불가" : "기본 일정"}
                            </span>
                            <button type="button" onClick={() => { setSelectedDate(date); setCompareMode(false); setCellEditor(null); }} className="sync-pressable sync-focus ml-1 min-h-8 rounded-md border border-slate-200 bg-white px-2 text-[9px] font-black text-slate-600 hover:bg-slate-50">편집</button>
                            {override?.note ? <span title={override.note} className="mt-1 block truncate text-[9px] font-semibold text-slate-500">{override.note}</span> : null}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {TIME_SLOTS.map((slot) => (
                      <tr key={`student-compare-row-${slot}`}>
                        <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-[11px] font-black text-slate-600">{timeRange(slot)}</th>
                        {comparisonDates.map((date) => {
                          const cell = studentAvailabilityComparisonCell(draftWeekly, draftOverrides, date, slot);
                          const label = cell.source === "temporary" && cell.status === "available"
                            ? "한시 가능"
                            : cell.status === "available"
                              ? "기본 가능"
                              : cell.status === "unavailable"
                                ? cell.source === "date-unavailable" ? "수업 불가" : "기본 불가"
                                : "—";
                          return (
                            <td key={`student-compare-cell-${date}-${slot}`} className="border-b border-r border-slate-100 p-1 last:border-r-0">
                              <div title={cell.note} className={`flex min-h-10 items-center justify-center rounded-md border px-2 text-center text-[10px] font-black ${cell.source === "temporary" && cell.status === "available" ? "border-emerald-300 bg-emerald-100 text-emerald-800" : cell.status === "available" ? "border-blue-200 bg-blue-50 text-blue-700" : cell.status === "unavailable" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-transparent bg-slate-50 text-slate-300"}`}>
                                {label}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : selectedOverride?.status === "temporary" ? (
          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div><p className="text-sm font-black text-slate-900">{dateLabel(selectedDate)} 한시 적용</p><p className="sync-copy text-[11px] font-semibold text-slate-500">이 날짜에만 가능한 시간을 드래그해 선택합니다.</p></div>
              <button type="button" onClick={() => setDateOverride("default")} className="sync-pressable sync-focus min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50">기본 일정으로 복귀</button>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200 select-none" onPointerMove={(event) => continueDrag(event, "date")} onPointerUp={(event) => stopDrag(event.pointerId)}>
              <table className="sync-tabular w-full table-fixed border-collapse text-xs">
                <thead><tr><th className="w-24 border-b border-r border-slate-200 bg-slate-50 px-2 py-3">시간</th><th className="border-b border-slate-200 bg-white px-2 py-3">{dateLabel(selectedDate)}</th></tr></thead>
                <tbody>
                  {TIME_SLOTS.map((slot) => {
                    const selected = selectedOverride.slots.includes(slot);
                    return <tr key={`student-date-slot-${slot}`}><th className="border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-[11px] font-black text-slate-600">{timeRange(slot)}</th><td className="border-b border-slate-100 p-1"><div className="grid grid-cols-[minmax(0,1fr)_48px] gap-1"><button type="button" aria-pressed={selected} data-student-availability-cell="true" data-scope="date" data-slot={slot} onPointerDown={(event) => startDrag(event, "date", null, slot)} onClick={() => addDateSlot(slot)} className={`sync-pressable sync-focus min-h-10 touch-none rounded-md border text-[11px] font-black ${selected ? "border-emerald-500 bg-emerald-500 text-white shadow-sm" : "border-transparent bg-slate-50 text-slate-500 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"}`}>{selected ? "한시 가능" : slot}</button><button type="button" disabled={!selected} onClick={() => removeDateSlot(slot)} aria-label={`${slot} 한시 가능 선택 해제`} className="sync-pressable sync-focus min-h-10 rounded-md border border-slate-200 bg-white text-xs font-black text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-30">해제</button></div></td></tr>;
                  })}
                </tbody>
              </table>
            </div>
            {selectedOverride.slots.length === 0 ? <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">한시 적용에는 가능 시간이 한 개 이상 필요합니다.</p> : null}
          </div>
        ) : selectedOverride?.status === "unavailable" ? (
          <div className="mt-3 flex min-h-72 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
            <div><p className="text-lg font-black text-rose-800">{dateLabel(selectedDate)} 수업 불가</p><p className="sync-copy mt-2 text-sm font-semibold text-rose-700">{selectedOverride.note || "오른쪽에서 등원 불가 사유를 입력해 주세요."}</p></div>
          </div>
        ) : (
          <div className="mt-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
              <div>
                <p className="text-xs font-black text-blue-800">기본 적용 · 매주 반복</p>
                <p className="sync-copy mt-0.5 text-[10px] font-semibold text-blue-700">월요일부터 일요일까지 선택한 주간 패턴이 매주 동일하게 적용됩니다.</p>
              </div>
              <span className="sync-tabular rounded-md bg-white px-2 py-1 text-[10px] font-black text-blue-700">선택 {weeklyCount(draftWeekly)}칸</span>
            </div>
            <div className="mb-3 rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black text-slate-900">드래그 도구</p>
                  <p className="sync-copy mt-0.5 text-[10px] font-semibold text-slate-500">도구를 고른 뒤 셀을 누르거나 드래그하세요. 같은 상태를 다시 누르면 해제됩니다.</p>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">
                  {weeklyPaintMode === "available" ? "수업 가능 적용 중" : weeklyPaintMode === "unavailable" ? "수업 불가 적용 중" : "선택 해제 적용 중"}
                </span>
              </div>
              <div role="toolbar" aria-label="기본 가능 일정 드래그 도구" className="mt-2 grid grid-cols-3 gap-2">
                <button type="button" aria-pressed={weeklyPaintMode === "available"} onClick={() => setWeeklyPaintMode("available")} className={`sync-pressable sync-focus min-h-10 rounded-lg border px-2 text-xs font-black transition-[background-color,border-color,box-shadow,color] duration-150 ease-out ${weeklyPaintMode === "available" ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"}`}>수업 가능</button>
                <button type="button" aria-pressed={weeklyPaintMode === "unavailable"} onClick={() => setWeeklyPaintMode("unavailable")} className={`sync-pressable sync-focus min-h-10 rounded-lg border px-2 text-xs font-black transition-[background-color,border-color,box-shadow,color] duration-150 ease-out ${weeklyPaintMode === "unavailable" ? "border-rose-600 bg-rose-600 text-white shadow-sm" : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"}`}>수업 불가</button>
                <button type="button" aria-pressed={weeklyPaintMode === "clear"} onClick={() => { setWeeklyPaintMode("clear"); setCellEditor(null); }} className={`sync-pressable sync-focus min-h-10 rounded-lg border px-2 text-xs font-black transition-[background-color,border-color,box-shadow,color] duration-150 ease-out ${weeklyPaintMode === "clear" ? "border-slate-700 bg-slate-700 text-white shadow-sm" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"}`}>선택 해제</button>
              </div>
            </div>
            <div className="mb-3 min-h-[132px] rounded-lg border border-slate-200 bg-slate-50 p-3">
              {cellEditor && selectedWeeklyCell ? (
                <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="text-sm font-black text-slate-900">{DAYS.find((day) => day.key === cellEditor.weekday)?.label}요일 {timeRange(cellEditor.slot)}</p><p className="text-[11px] font-semibold text-slate-500">{selectedWeeklyCell.status === "unavailable" ? "수업 불가 사유나 참고 내용을 입력하세요." : "수업 가능 조건이나 참고 내용을 입력하세요."}</p></div>
                  <button type="button" onClick={() => setCellEditor(null)} className="sync-pressable sync-focus min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-100">편집 닫기</button>
                </div>
                <label className="mt-2 block text-[11px] font-black text-slate-600">{selectedWeeklyCell.status === "unavailable" ? "수업 불가 사유·메모" : "수업 가능 메모"}<input value={selectedWeeklyCell.note ?? selectedWeeklyCell.reason ?? ""} maxLength={160} onChange={(event) => setWeeklyCell(cellEditor.weekday, cellEditor.slot, { status: selectedWeeklyCell.status, ...(event.target.value ? { note: event.target.value } : {}) })} placeholder={selectedWeeklyCell.status === "unavailable" ? "예: 타 수학학원, 가족여행" : "예: 타 수학학원 수업 전후 가능"} className={`sync-input mt-1 min-h-10 w-full rounded-lg border bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:ring-2 ${selectedWeeklyCell.status === "unavailable" ? "border-rose-200 focus:border-rose-300 focus:ring-rose-100" : "border-blue-200 focus:border-blue-300 focus:ring-blue-100"}`} /></label>
                </>
              ) : (
                <div className="flex min-h-[106px] items-center justify-center text-center">
                  <div><p className="text-xs font-black text-slate-700">메모를 입력할 셀을 선택하세요.</p><p className="sync-copy mt-1 text-[11px] font-semibold text-slate-500">수업 가능과 수업 불가 모두 셀별 내용을 남길 수 있습니다.</p></div>
                </div>
              )}
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200 select-none" onPointerMove={(event) => continueDrag(event, "weekly")} onPointerUp={(event) => stopDrag(event.pointerId)}>
              <table className="sync-tabular min-w-[760px] table-fixed border-collapse text-xs">
                <thead><tr><th className="w-20 border-b border-r border-slate-200 bg-slate-50 px-2 py-3 text-center font-black text-slate-600">시간</th>{DAYS.map((day) => <th key={`student-availability-head-${day.key}`} className="border-b border-r border-slate-200 bg-white px-2 py-3 text-center font-black text-slate-700 last:border-r-0">{day.label}</th>)}</tr></thead>
                <tbody>
                  {TIME_SLOTS.map((slot) => <tr key={`student-availability-row-${slot}`}><th className="border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-center text-[11px] font-black text-slate-600">{timeRange(slot)}</th>{DAYS.map((day) => {
                    const item = draftWeekly[day.key]?.[slot];
                    const editing = cellEditor?.weekday === day.key && cellEditor.slot === slot;
                    const note = item?.note ?? item?.reason ?? "";
                    return <td key={`student-availability-cell-${day.key}-${slot}`} className="border-b border-r border-slate-100 p-1 last:border-r-0"><button type="button" aria-pressed={Boolean(item)} aria-label={`${day.label}요일 ${timeRange(slot)} ${item?.status === "unavailable" ? `수업 불가 ${note}` : item ? `수업 가능 ${note}` : "선택 안 됨"}. 현재 도구: ${weeklyPaintMode === "available" ? "수업 가능" : weeklyPaintMode === "unavailable" ? "수업 불가" : "선택 해제"}`} data-student-availability-cell="true" data-scope="weekly" data-weekday={day.key} data-slot={slot} onPointerDown={(event) => startDrag(event, "weekly", day.key, slot)} onClick={(event) => { if (event.detail !== 0) return; const willClear = weeklyPaintMode === "clear" || item?.status === weeklyPaintMode; applyWeeklyPaint(day.key, slot, weeklyPaintMode); setCellEditor(willClear ? null : { weekday: day.key, slot }); }} className={`sync-pressable sync-focus min-h-10 w-full touch-none rounded-md border px-1 text-[10px] font-black transition-[background-color,border-color,box-shadow,color] duration-150 ease-out ${item?.status === "unavailable" ? "border-rose-300 bg-rose-100 text-rose-800" : item ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-transparent bg-slate-50 text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"} ${editing ? "ring-2 ring-slate-800 ring-offset-1" : ""}`}>{item?.status === "unavailable" ? "불가" : item ? "가능" : slot}</button></td>;
                  })}</tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-3">
        <div className="sync-surface rounded-xl bg-white p-3">
          <div className="flex items-center justify-between gap-2"><div><p className="text-sm font-black text-slate-900">날짜별 변동</p><p className="sync-copy mt-0.5 text-[10px] font-semibold text-slate-500">{compareMode ? "비교할 날짜를 여러 개 선택합니다." : "특정 날짜만 기본 일정과 다르게 지정합니다."}</p></div><span className="sync-tabular rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">{Object.keys(draftOverrides).length}일</span></div>
          <button type="button" aria-pressed={compareMode} onClick={toggleCompareMode} className={`sync-pressable sync-focus mt-3 min-h-10 w-full rounded-lg border px-3 text-xs font-black ${compareMode ? "border-violet-600 bg-violet-600 text-white shadow-sm" : "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"}`}>{compareMode ? "여러 날짜 모아보기 종료" : "여러 날짜 모아보기"}</button>
          {compareMode ? <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={selectAllOverrideDates} className="sync-pressable sync-focus min-h-10 rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-[10px] font-black text-emerald-700 hover:bg-emerald-100">변동일 전체 선택</button><button type="button" onClick={() => setComparisonDates([])} className="sync-pressable sync-focus min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-black text-slate-600 hover:bg-slate-50">선택 해제</button></div> : null}
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-black text-slate-500">{DAYS.map((day) => <span key={`student-calendar-head-${day.key}`}>{day.label}</span>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1">{calendarValues.map((date, index) => {
            if (!date) return <span key={`student-calendar-empty-${index}`} className="min-h-10" aria-hidden="true" />;
            const item = draftOverrides[date];
            const selected = compareMode ? comparisonDates.includes(date) : date === selectedDate;
            return <button key={date} type="button" onClick={() => { if (compareMode) toggleComparisonDate(date); else { setSelectedDate(date); setCellEditor(null); } }} aria-pressed={selected} aria-label={`${date} ${item?.status === "temporary" ? "한시 적용" : item?.status === "unavailable" ? "수업 불가" : "기본 적용"}${compareMode ? selected ? ", 비교 선택됨" : ", 비교 선택 안 됨" : ""}`} className={`sync-pressable sync-focus sync-tabular min-h-10 rounded-md border text-[11px] font-black ${item?.status === "temporary" ? "border-emerald-300 bg-emerald-100 text-emerald-800" : item?.status === "unavailable" ? "border-rose-600 bg-rose-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50"} ${selected ? compareMode ? "ring-2 ring-violet-600 ring-offset-1" : "ring-2 ring-slate-800 ring-offset-1" : ""}`}>{Number(date.slice(-2))}</button>;
          })}</div>
          {!compareMode ? <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <p className="sync-tabular text-xs font-black text-slate-900">{dateLabel(selectedDate)}</p>
            <div className="mt-2 grid grid-cols-3 gap-1"><button type="button" onClick={() => setDateOverride("default")} className={`sync-pressable sync-focus min-h-10 rounded-md border px-1 text-[10px] font-black ${!selectedOverride ? "border-slate-700 bg-slate-700 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"}`}>기본 적용</button><button type="button" onClick={() => setDateOverride("temporary")} className={`sync-pressable sync-focus min-h-10 rounded-md border px-1 text-[10px] font-black ${selectedOverride?.status === "temporary" ? "border-emerald-500 bg-emerald-500 text-white" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>한시 적용</button><button type="button" onClick={() => setDateOverride("unavailable")} className={`sync-pressable sync-focus min-h-10 rounded-md border px-1 text-[10px] font-black ${selectedOverride?.status === "unavailable" ? "border-rose-600 bg-rose-600 text-white" : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"}`}>수업 불가</button></div>
            {selectedOverride ? <label className="mt-2 block text-[10px] font-black text-slate-600">{selectedOverride.status === "unavailable" ? "수업 불가 사유" : "일자 메모"}<textarea value={selectedOverride.note ?? ""} maxLength={160} onChange={(event) => setDraftOverrides((previous) => ({ ...previous, [selectedDate]: { ...previous[selectedDate]!, note: event.target.value } }))} placeholder={selectedOverride.status === "unavailable" ? "예: 타 학원, 가족여행" : "한시 일정에 대한 메모"} className="sync-input mt-1 min-h-20 w-full resize-y rounded-lg border border-slate-300 bg-white p-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" /></label> : null}
          </div> : <p className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-[10px] font-bold leading-relaxed text-violet-700">모아보기에서는 일정이 변경되지 않습니다. 표의 ‘편집’을 누르면 해당 날짜만 수정할 수 있습니다.</p>}
        </div>

        <div className="sync-surface rounded-xl bg-white p-3">
          <div className="flex items-center justify-between gap-2"><div><p className="text-sm font-black text-slate-900">저장된 그룹</p><p className="sync-copy mt-0.5 text-[10px] font-semibold text-slate-500">제목과 메모까지 월별 DB에 저장합니다.</p></div><button type="button" onClick={resetDraft} className="sync-pressable sync-focus min-h-10 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-black text-blue-700 hover:bg-blue-100">새 그룹</button></div>
          <label className="mt-3 block text-[10px] font-black text-slate-600">가능 일정 제목<input value={draftTitle} maxLength={100} onChange={(event) => setDraftTitle(event.target.value)} placeholder="예: 7월 여름방학 기본 가능 일정" className="sync-input mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" /></label>
          <label className="mt-2 block text-[10px] font-black text-slate-600">가능 일정 메모<textarea value={draftMemo} maxLength={500} onChange={(event) => setDraftMemo(event.target.value)} placeholder="상담 시 확인할 내용이나 적용 기준" className="sync-input mt-1 min-h-20 w-full resize-y rounded-lg border border-slate-300 bg-white p-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" /></label>
          <button type="button" disabled={saving || loading || invalidTemporary} onClick={() => void (selectedGroup ? saveGroup() : createGroup())} className="sync-pressable sync-focus mt-2 min-h-10 w-full rounded-lg bg-blue-600 px-3 text-xs font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "저장 중" : selectedGroup ? "변경사항 DB 저장" : "새 그룹 DB 저장"}</button>
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">{loading ? <p className="rounded-lg bg-slate-50 px-3 py-5 text-center text-xs font-bold text-slate-500">불러오는 중...</p> : groups.length === 0 ? <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs font-bold text-slate-500">이 달에 저장된 가능 일정이 없습니다.</p> : groups.map((group) => <div key={group.id} className={`rounded-lg border p-2.5 ${group.id === selectedGroupId ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}><button type="button" onClick={() => applyGroup(group)} className="sync-pressable sync-focus min-h-10 w-full rounded-md px-1 text-left"><span className="flex items-center justify-between gap-2"><span className="truncate text-xs font-black text-slate-900">{group.title}</span>{group.isActive ? <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-black text-white">활성</span> : null}</span><span className="sync-tabular mt-1 block text-[10px] font-semibold text-slate-500">기본 {weeklyCount(group.weeklyAvailability)}칸 · 변동 {Object.keys(group.dateOverrides).length}일</span></button>{!group.isActive ? <button type="button" disabled={saving} onClick={() => void activateGroup(group)} className="sync-pressable sync-focus mt-1 min-h-10 w-full rounded-md border border-emerald-200 bg-emerald-50 text-[10px] font-black text-emerald-700 hover:bg-emerald-100">이 그룹 활성화</button> : null}</div>)}</div>
        </div>
      </aside>
    </section>
  );
}
