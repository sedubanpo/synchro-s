"use client";

import { RoleTabs } from "@/components/schedule/RoleTabs";
import { ScheduleModal } from "@/components/schedule/ScheduleModal";
import { TimetableGrid } from "@/components/schedule/TimetableGrid";
import { DAYS, TIME_SLOTS } from "@/lib/constants";
import { setSubjectColor } from "@/lib/subjectColors";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { timeToMinutes } from "@/lib/time";
import type {
  ClassTypeOption,
  ConflictResult,
  RoleView,
  ScheduleEvent,
  ScheduleFormInput,
  SelectOption,
  SubjectOption,
  Weekday
} from "@/types/schedule";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SubjectOptionWithColor = SubjectOption & { tailwindClass?: string };

type OptionsResponse = {
  instructors: SelectOption[];
  students: SelectOption[];
  subjects: SubjectOptionWithColor[];
  classTypes: ClassTypeOption[];
};

type WeekResponse = {
  weekStart: string;
  weekEnd: string;
  events: ScheduleEvent[];
};

type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
};

type ParsedNotionItem = {
  weekday: Weekday;
  startTime: string;
  endTime: string;
  subjectLabel: string;
  classTypeLabel: string;
  instructorName: string;
  note?: string;
  rawText: string;
};

type TimetableGroup = {
  id: string;
  name: string;
  roleView: RoleView;
  targetId: string;
  weekStart: string;
  classIds: string[];
  snapshotEvents?: ScheduleEvent[];
  isActive: boolean;
  createdAt: string;
};

type ImportProgress = {
  active: boolean;
  total: number;
  done: number;
  label: string;
};

type ConflictDialogState = {
  open: boolean;
  title: string;
  message: string;
};

type SubjectSettingItem = {
  code: string;
  displayName: string;
  tailwindBgClass: string;
};

function formatDateISOInKST(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}

function mondayOfCurrentWeek(): string {
  const today = formatDateISOInKST(new Date());
  const date = new Date(`${today}T00:00:00+09:00`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (day - 1));
  return date.toISOString().slice(0, 10);
}

function shiftDate(dateISO: string, days: number): string {
  const date = new Date(`${dateISO}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getConflictMessage(conflict: ConflictResult): string {
  if (!conflict.hasConflict) return "";
  return conflict.conflicts.map((item) => `- ${item.reason} (class: ${item.classId})`).join("\n");
}

function getConflictMessageForDisplay(
  conflict: ConflictResult,
  activeStudentGroups: TimetableGroup[],
  students: SelectOption[]
): string {
  if (!conflict.hasConflict) return "";

  const ownerByClassId = new Map<string, string>();
  for (const group of activeStudentGroups) {
    const ownerName = students.find((item) => item.id === group.targetId)?.name;
    if (!ownerName) continue;
    for (const event of group.snapshotEvents ?? []) {
      ownerByClassId.set(event.id, ownerName);
    }
  }

  return conflict.conflicts
    .map((item) => {
      const owner = ownerByClassId.get(item.classId);
      const prefix = owner ? `${owner} 활성 시간표와 충돌: ` : "";
      return `- ${prefix}${item.reason}`;
    })
    .join("\n");
}

function dayOf(dateISO: string): Weekday {
  const d = new Date(`${dateISO}T00:00:00+09:00`);
  const jsDay = d.getUTCDay();
  return (jsDay === 0 ? 7 : jsDay) as Weekday;
}

function toKoreanHourRange(startTime: string): string {
  const [hour, minute] = startTime.split(":").map(Number);
  const endHour = hour + 1;
  if (minute === 0) {
    return `${hour}-${endHour}시`;
  }
  const mm = String(minute).padStart(2, "0");
  return `${hour}:${mm}-${endHour}:${mm}`;
}

function parseTimeLabel(raw: string): { startTime: string; endTime: string } | null {
  const normalized = raw.replace(/\s/g, "").replace("시", "");
  const range = normalized.split("-");
  if (range.length !== 2) {
    return null;
  }

  const parsePart = (part: string) => {
    const [hourRaw, minuteRaw] = part.split(":");
    const hour = Number(hourRaw);
    const minute = minuteRaw ? Number(minuteRaw) : 0;
    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      return null;
    }
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }
    return { hour, minute };
  };

  const start = parsePart(range[0]);
  const end = parsePart(range[1]);
  if (!start || !end) {
    return null;
  }

  const startTime = `${String(start.hour).padStart(2, "0")}:${String(start.minute).padStart(2, "0")}`;
  const endTime = `${String(end.hour).padStart(2, "0")}:${String(end.minute).padStart(2, "0")}`;

  if (endTime <= startTime) {
    return null;
  }
  return { startTime, endTime };
}

function parseCellClassText(cell: string): {
  subjectLabel: string;
  classTypeLabel: string;
  instructorName: string;
  rawText: string;
} {
  const trimmed = cell.trim();
  const matched = trimmed.match(/^(.+?)-(.+?)\((.+?)\)$/);
  if (!matched) {
    return { subjectLabel: trimmed, classTypeLabel: "개별정규", instructorName: "", rawText: trimmed };
  }
  const instructorName = matched[3].trim().replace(/T$/i, "");

  return {
    subjectLabel: matched[1].trim(),
    classTypeLabel: matched[2].trim(),
    instructorName,
    rawText: trimmed
  };
}

function normalizePersonName(value: string): string {
  return value
    .replace(/T$/i, "")
    .replace(/^\/+/, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();
}

function normalizeLookupToken(value: string): string {
  return value.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase().trim();
}

function normalizeInstructorAlias(value: string): string {
  const token = normalizeLookupToken(value);
  if (token === "원장님" || token === "원장" || token === "원장님t" || token === "원장t") {
    return "안준성";
  }
  return value;
}

function resolveSubjectOption(rawLabel: string, subjects: SubjectOptionWithColor[]): SubjectOptionWithColor | undefined {
  const target = normalizeLookupToken(rawLabel);
  if (!target) return undefined;

  const direct =
    subjects.find((entry) => normalizeLookupToken(entry.label) === target) ??
    subjects.find((entry) => normalizeLookupToken(entry.code) === target);
  if (direct) return direct;

  const contains =
    subjects.find((entry) => normalizeLookupToken(entry.label).includes(target) || target.includes(normalizeLookupToken(entry.label))) ??
    subjects.find((entry) => normalizeLookupToken(entry.code).includes(target) || target.includes(normalizeLookupToken(entry.code)));
  if (contains) return contains;

  const aliasByCode: Record<string, string[]> = {
    MATH: ["수학", "math"],
    ENGLISH: ["영어", "english", "eng"],
    KOREAN: ["국어", "korean"],
    SCIENCE: ["과학", "science"],
    SOCIAL: ["사회", "사탐", "social"]
  };

  for (const [code, aliases] of Object.entries(aliasByCode)) {
    if (!aliases.some((alias) => target.includes(normalizeLookupToken(alias)))) continue;
    const mapped =
      subjects.find((entry) => normalizeLookupToken(entry.code) === normalizeLookupToken(code)) ??
      subjects.find((entry) => aliases.some((alias) => normalizeLookupToken(entry.label).includes(normalizeLookupToken(alias))));
    if (mapped) return mapped;
  }

  return undefined;
}

function resolveClassTypeOption(rawLabel: string, classTypes: ClassTypeOption[]): ClassTypeOption | undefined {
  const target = normalizeLookupToken(rawLabel);
  if (!target) return undefined;

  const direct =
    classTypes.find((entry) => normalizeLookupToken(entry.label) === target) ??
    classTypes.find((entry) => normalizeLookupToken(entry.code) === target);
  if (direct) return direct;

  const contains =
    classTypes.find((entry) => normalizeLookupToken(entry.label).includes(target) || target.includes(normalizeLookupToken(entry.label))) ??
    classTypes.find((entry) => normalizeLookupToken(entry.code).includes(target) || target.includes(normalizeLookupToken(entry.code)));
  if (contains) return contains;

  const pick = (keys: string[]) =>
    classTypes.find((entry) =>
      keys.some((key) => normalizeLookupToken(entry.code).includes(key) || normalizeLookupToken(entry.label).includes(key))
    );

  if (["11", "1대1", "일대일", "one", "onetoone"].some((key) => target.includes(normalizeLookupToken(key)))) {
    return pick(["onetoone", "one", "11", "개별", "개인"]);
  }
  if (["21", "2대1", "이대일"].some((key) => target.includes(normalizeLookupToken(key)))) {
    return pick(["twotoone", "two", "21", "2대1"]);
  }
  if (["개별정규", "개별", "정규", "regular", "multi"].some((key) => target.includes(normalizeLookupToken(key)))) {
    return pick(["regular", "multi", "정규"]);
  }
  if (["특강", "special"].some((key) => target.includes(normalizeLookupToken(key)))) {
    return pick(["special", "특강"]);
  }

  return undefined;
}

function parseNotionTextToItems(text: string): ParsedNotionItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const tokenize = (line: string) => {
    if (line.includes("\t")) {
      return line.split("\t").map((cell) => cell.trim());
    }
    return line.split(/\s{2,}/).map((cell) => cell.trim());
  };

  const headerIdx = lines.findIndex((line) => /시간/.test(line) && /(월|월요일)/.test(line));
  const headerCells = headerIdx >= 0 ? tokenize(lines[headerIdx]) : [];
  const dayMap: Record<string, Weekday> = {
    월: 1,
    월요일: 1,
    화: 2,
    화요일: 2,
    수: 3,
    수요일: 3,
    목: 4,
    목요일: 4,
    금: 5,
    금요일: 5,
    토: 6,
    토요일: 6,
    일: 7,
    일요일: 7
  };

  const dayIndexes: { index: number; weekday: Weekday }[] = [];
  const memoIndex = headerCells.findIndex((cell) => /메모/.test(cell));
  if (headerCells.length > 0) {
    headerCells.forEach((cell, index) => {
      const weekday = dayMap[cell];
      if (weekday) {
        dayIndexes.push({ index, weekday });
      }
    });
  }

  const items: ParsedNotionItem[] = [];
  const dataStart = headerIdx >= 0 ? headerIdx + 1 : 0;
  for (let i = dataStart; i < lines.length; i += 1) {
    const cols = tokenize(lines[i]);
    const timeIndex = cols.findIndex((token) => Boolean(parseTimeLabel(token)));
    if (timeIndex < 0) continue;
    const time = parseTimeLabel(cols[timeIndex] ?? "");
    if (!time) continue;

    const resolvedIndexes =
      dayIndexes.length > 0
        ? dayIndexes
        : ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((weekday, idx) => ({ index: timeIndex + idx + 1, weekday }));
    const rowMemo = memoIndex >= 0 ? (cols[memoIndex] ?? "").trim() : "";

    resolvedIndexes.forEach(({ index, weekday }) => {
      const rawCell = (cols[index] ?? "").trim();
      if (!rawCell) return;

      const parts = rawCell
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);

      parts.forEach((part) => {
        const parsed = parseCellClassText(part);
        items.push({
          weekday,
          startTime: time.startTime,
          endTime: time.endTime,
          subjectLabel: parsed.subjectLabel,
          classTypeLabel: parsed.classTypeLabel,
          instructorName: parsed.instructorName,
          note: rowMemo || undefined,
          rawText: parsed.rawText
        });
      });
    });
  }

  return items;
}

function subjectTint(subjectCode: string, strong: boolean): string {
  const alpha = strong ? 0.34 : 0.18;
  const palette: Record<string, string> = {
    MATH: `rgba(59,130,246,${alpha})`,
    ENGLISH: `rgba(139,92,246,${alpha})`,
    KOREAN: `rgba(249,115,22,${alpha})`,
    SCIENCE: `rgba(16,185,129,${alpha})`,
    SOCIAL: `rgba(14,165,233,${alpha})`
  };
  return palette[subjectCode] ?? `rgba(56,189,248,${alpha})`;
}

function monthStart(dateISO: string): string {
  const [year, month] = dateISO.split("-").map(Number);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

function shiftMonth(monthISO: string, diff: number): string {
  const [year, month] = monthISO.split("-").map(Number);
  const absolute = year * 12 + (month - 1) + diff;
  const nextYear = Math.floor(absolute / 12);
  const nextMonth = (absolute % 12 + 12) % 12;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth + 1).padStart(2, "0")}-01`;
}

function lastDateOfMonth(monthISO: string): number {
  const [year, month] = monthISO.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function buildMonthCells(monthISO: string): CalendarCell[] {
  const [year, month] = monthISO.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = first.getUTCDay() === 0 ? 7 : first.getUTCDay();
  const total = lastDateOfMonth(monthISO);
  const cells: CalendarCell[] = [];

  for (let i = 1; i < firstWeekday; i += 1) {
    cells.push({ date: "", day: 0, inMonth: false });
  }

  for (let day = 1; day <= total; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    cells.push({ date: date.toISOString().slice(0, 10), day, inMonth: true });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ date: "", day: 0, inMonth: false });
  }

  return cells;
}

function moveEventInList(
  source: ScheduleEvent[],
  move: { classId: string; weekday: Weekday; startTime: string; endTime: string; classDate: string }
): ScheduleEvent[] {
  return source.map((event) =>
    event.id === move.classId
      ? {
          ...event,
          weekday: move.weekday,
          startTime: move.startTime,
          endTime: move.endTime,
          classDate: move.classDate
        }
      : event
  );
}

function hasTimeOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(aEnd) > timeToMinutes(bStart);
}

function isStrictConflictClassType(code: string, label?: string): boolean {
  const normalizedCode = normalizeLookupToken(code);
  const normalizedLabel = normalizeLookupToken(label ?? "");
  if (normalizedCode.includes("onetone") || normalizedCode.includes("onetoone") || normalizedCode.includes("11")) return true;
  if (normalizedCode.includes("twotone") || normalizedCode.includes("twotoone") || normalizedCode.includes("21")) return true;
  return (
    normalizedLabel.includes(normalizeLookupToken("1:1")) ||
    normalizedLabel.includes(normalizeLookupToken("1대1")) ||
    normalizedLabel.includes(normalizeLookupToken("2:1")) ||
    normalizedLabel.includes(normalizeLookupToken("2대1"))
  );
}

export default function SynchroSPage() {
  const router = useRouter();
  const [roleView, setRoleView] = useState<RoleView>("student");
  const [weekStart, setWeekStart] = useState<string>(mondayOfCurrentWeek);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);

  const [instructors, setInstructors] = useState<SelectOption[]>([]);
  const [students, setStudents] = useState<SelectOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOptionWithColor[]>([]);
  const [classTypes, setClassTypes] = useState<ClassTypeOption[]>([]);

  const [selectedInstructorId, setSelectedInstructorId] = useState<string>("");
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");

  const [modalOpen, setModalOpen] = useState(false);
  const [initialCell, setInitialCell] = useState<{ weekday: Weekday; startTime: string } | undefined>();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<string>(monthStart(mondayOfCurrentWeek()));
  const [searchKeyword, setSearchKeyword] = useState("");
  const [showStudentPicker, setShowStudentPicker] = useState(false);
  const [showInstructorPicker, setShowInstructorPicker] = useState(false);
  const [subjectSettingsOpen, setSubjectSettingsOpen] = useState(false);
  const [subjectSettingsLoading, setSubjectSettingsLoading] = useState(false);
  const [subjectSettingsSaving, setSubjectSettingsSaving] = useState(false);
  const [subjectSettings, setSubjectSettings] = useState<SubjectSettingItem[]>([]);
  const [subjectForm, setSubjectForm] = useState<SubjectSettingItem>({
    code: "",
    displayName: "",
    tailwindBgClass: "bg-blue-500"
  });
  const [notionPreview, setNotionPreview] = useState<string>("");
  const [notionInput, setNotionInput] = useState<string>("");
  const [parsedNotionItems, setParsedNotionItems] = useState<ParsedNotionItem[]>([]);
  const [importingNotion, setImportingNotion] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress>({
    active: false,
    total: 0,
    done: 0,
    label: ""
  });
  const [memoByEventId, setMemoByEventId] = useState<Record<string, string>>({});
  const [timetableGroups, setTimetableGroups] = useState<TimetableGroup[]>([]);
  const [groupPage, setGroupPage] = useState(1);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [groupsHydrated, setGroupsHydrated] = useState(false);
  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState>({
    open: false,
    title: "",
    message: ""
  });
  const movingLockRef = useRef(false);
  const importingNotionRef = useRef(false);
  const pendingRealtimeReloadRef = useRef(false);
  const notionTextValue = notionInput !== "" ? notionInput : notionPreview;

  const weekEnd = useMemo(() => shiftDate(weekStart, 6), [weekStart]);
  const monthLabel = useMemo(() => {
    const [year, month] = calendarMonth.split("-").map(Number);
    return `${year}년 ${month}월`;
  }, [calendarMonth]);
  const monthCells = useMemo(() => buildMonthCells(calendarMonth), [calendarMonth]);
  const keyword = searchKeyword.trim().toLowerCase();
  const eventsWithMemo = useMemo(
    () =>
      events.map((event) => ({
        ...event,
        note: memoByEventId[event.id] ?? event.note
      })),
    [events, memoByEventId]
  );
  const filteredEvents = useMemo(
    () =>
      keyword.length === 0
        ? eventsWithMemo
        : eventsWithMemo.filter((event) => {
            const searchable = `${event.instructorName} ${event.studentNames.join(" ")} ${event.subjectName}`.toLowerCase();
            return searchable.includes(keyword);
          }),
    [eventsWithMemo, keyword]
  );
  const selectedStudentLabel = useMemo(
    () => students.find((item) => item.id === selectedStudentId)?.name ?? "학생 선택",
    [selectedStudentId, students]
  );
  const selectedStudentSecondary = useMemo(
    () => students.find((item) => item.id === selectedStudentId)?.secondary ?? "",
    [selectedStudentId, students]
  );
  const selectedInstructorLabel = useMemo(
    () => instructors.find((item) => item.id === selectedInstructorId)?.name ?? "강사 선택",
    [selectedInstructorId, instructors]
  );
  const selectedInstructorSecondary = useMemo(
    () => instructors.find((item) => item.id === selectedInstructorId)?.secondary ?? "",
    [selectedInstructorId, instructors]
  );
  const currentTargetId = roleView === "student" ? selectedStudentId : selectedInstructorId;
  const currentTargetLabel = roleView === "student" ? selectedStudentLabel : selectedInstructorLabel;
  const activeGroup = useMemo(
    () =>
      timetableGroups.find(
        (group) => group.roleView === roleView && group.targetId === currentTargetId && group.isActive
      ) ?? null,
    [currentTargetId, roleView, timetableGroups]
  );
  const selectedGroup = useMemo(
    () =>
      (selectedGroupId
        ? timetableGroups.find(
            (group) => group.id === selectedGroupId && group.roleView === roleView && group.targetId === currentTargetId
          )
        : null) ?? null,
    [currentTargetId, roleView, selectedGroupId, timetableGroups]
  );
  const activeStudentEventsForInstructor = useMemo(() => {
    if (roleView !== "instructor" || !selectedInstructorId) return [];
    const selectedInstructorKey = normalizePersonName(selectedInstructorLabel);
    const activeStudentGroups = timetableGroups.filter(
      (group) => group.roleView === "student" && group.isActive && (group.snapshotEvents?.length ?? 0) > 0
    );
    if (activeStudentGroups.length === 0) return [];

    const merged = activeStudentGroups
      .flatMap((group) => group.snapshotEvents ?? [])
      .filter((event) => {
        if (event.instructorId === selectedInstructorId) return true;
        if (!selectedInstructorKey) return false;
        return normalizePersonName(event.instructorName) === selectedInstructorKey;
      });

    const dedup = new Map<string, ScheduleEvent>();
    for (const event of merged) {
      dedup.set(`${event.id}-${event.weekday}-${event.startTime}-${event.endTime}`, event);
    }
    return [...dedup.values()];
  }, [roleView, selectedInstructorId, selectedInstructorLabel, timetableGroups]);
  const draftEvents = useMemo<ScheduleEvent[]>(() => {
    if (parsedNotionItems.length === 0) return [];
    return parsedNotionItems.map((item, index) => {
      const subjectMatch = resolveSubjectOption(item.subjectLabel, subjects);
      const classTypeMatch = resolveClassTypeOption(item.classTypeLabel, classTypes);
      const resolvedInstructorName = item.instructorName ? normalizeInstructorAlias(item.instructorName) : "";
      const instructorName =
        resolvedInstructorName || (selectedInstructorLabel === "강사 선택" ? "미지정 강사" : selectedInstructorLabel);
      const studentNames =
        selectedStudentLabel !== "학생 선택"
          ? [selectedStudentLabel]
          : roleView === "student"
            ? ["학생 미지정"]
            : ["학생 정보 없음"];

      return {
        id: `draft-${index}`,
        scheduleMode: "recurring",
        instructorId: selectedInstructorId || `draft-instructor-${index}`,
        instructorName,
        studentIds: selectedStudentId ? [selectedStudentId] : [],
        studentNames,
        subjectCode: subjectMatch?.code ?? `UNMAPPED:${normalizeLookupToken(item.subjectLabel) || "unknown"}`,
        subjectName: subjectMatch?.label ?? item.subjectLabel,
        classTypeCode: classTypeMatch?.code ?? `UNMAPPED:${normalizeLookupToken(item.classTypeLabel) || "unknown"}`,
        classTypeLabel: classTypeMatch?.label ?? item.classTypeLabel,
        badgeText: classTypeMatch?.badgeText ?? `[${item.classTypeLabel}]`,
        weekday: item.weekday,
        classDate: shiftDate(weekStart, item.weekday - 1),
        startTime: item.startTime,
        endTime: item.endTime,
        note: item.note?.trim() || item.rawText,
        progressStatus: "planned",
        createdAt: new Date().toISOString()
      };
    });
  }, [
    classTypes,
    parsedNotionItems,
    roleView,
    selectedInstructorId,
    selectedInstructorLabel,
    selectedStudentId,
    selectedStudentLabel,
    subjects,
    weekStart
  ]);
  const displayEvents = useMemo(() => {
    const preferredGroup = selectedGroup ?? activeGroup;
    if (preferredGroup) {
      const snapshot = preferredGroup.snapshotEvents ?? [];
      const hasDraftSnapshot = snapshot.some((event) => event.id.startsWith("draft-"));
      if (snapshot.length > 0 && !hasDraftSnapshot) {
        return snapshot;
      }
      const idSet = new Set(preferredGroup.classIds);
      return filteredEvents.filter((event) => idSet.has(event.id));
    }
    if (draftEvents.length > 0) return draftEvents;
    if (roleView === "instructor" && activeStudentEventsForInstructor.length > 0) {
      return activeStudentEventsForInstructor;
    }
    return filteredEvents;
  }, [activeGroup, activeStudentEventsForInstructor, draftEvents, filteredEvents, roleView, selectedGroup]);
  const activeHighlightCellTints = useMemo(() => {
    if (displayEvents.length === 0) return {};
    const chainEvents = [...displayEvents]
      .sort((a, b) => {
        if (a.weekday !== b.weekday) return a.weekday - b.weekday;
        return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
      });

    const map: Record<string, string> = {};
    for (let i = 0; i < chainEvents.length; i += 1) {
      const event = chainEvents[i];
      const prev = chainEvents[i - 1];
      const next = chainEvents[i + 1];
      const start = timeToMinutes(event.startTime);
      const end = timeToMinutes(event.endTime);
      const isChainWithPrev =
        Boolean(prev) &&
        prev.weekday === event.weekday &&
        prev.subjectCode === event.subjectCode &&
        timeToMinutes(prev.endTime) === start;
      const isChainWithNext =
        Boolean(next) &&
        next.weekday === event.weekday &&
        next.subjectCode === event.subjectCode &&
        timeToMinutes(next.startTime) === end;

      map[`${event.weekday}-${event.startTime}`] = subjectTint(event.subjectCode, isChainWithPrev || isChainWithNext);
    }
    return map;
  }, [displayEvents]);
  const eventDateSet = useMemo(() => new Set(displayEvents.map((event) => event.classDate)), [displayEvents]);
  const filteredInstructors = useMemo(
    () => (keyword.length === 0 ? instructors : instructors.filter((item) => item.name.toLowerCase().includes(keyword))),
    [instructors, keyword]
  );
  const filteredStudents = useMemo(
    () => (keyword.length === 0 ? students : students.filter((item) => item.name.toLowerCase().includes(keyword))),
    [students, keyword]
  );
  const filteredGroups = useMemo(
    () =>
      timetableGroups
        .filter((group) => group.roleView === roleView && group.targetId === currentTargetId)
        .filter((group) => (showActiveOnly ? group.isActive : true))
        .sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          return b.createdAt.localeCompare(a.createdAt);
        }),
    [currentTargetId, roleView, showActiveOnly, timetableGroups]
  );
  const visibleGroups = useMemo(() => {
    const pageSize = 4;
    const start = (groupPage - 1) * pageSize;
    return filteredGroups.slice(start, start + pageSize);
  }, [filteredGroups, groupPage]);
  const groupPageCount = useMemo(() => Math.max(1, Math.ceil(filteredGroups.length / 4)), [filteredGroups.length]);
  const groupNumberById = useMemo(() => {
    const byDate = new Map<string, TimetableGroup[]>();
    for (const group of filteredGroups) {
      const bucket = byDate.get(group.weekStart) ?? [];
      bucket.push(group);
      byDate.set(group.weekStart, bucket);
    }
    const numberMap: Record<string, number> = {};
    for (const [, bucket] of byDate) {
      const ordered = [...bucket].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      ordered.forEach((group, idx) => {
        numberMap[group.id] = idx + 1;
      });
    }
    return numberMap;
  }, [filteredGroups]);
  const headerGlowClass =
    roleView === "instructor"
      ? "before:absolute before:-inset-2 before:-z-10 before:rounded-[28px] before:bg-[radial-gradient(circle_at_85%_20%,rgba(59,130,246,0.32),transparent_60%)]"
      : "before:absolute before:-inset-2 before:-z-10 before:rounded-[28px] before:bg-[radial-gradient(circle_at_85%_20%,rgba(16,185,129,0.32),transparent_60%)]";

  const moveToLogin = useCallback(() => {
    router.replace(`/login?next=${encodeURIComponent("/synchro-s")}`);
  }, [router]);

  const loadOptions = useCallback(async () => {
    const res = await fetch("/api/schedules/options", { method: "GET", cache: "no-store" });

    if (res.status === 401) {
      moveToLogin();
      return;
    }

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? "Failed to load options");
    }

    const data = (await res.json()) as OptionsResponse;

    setInstructors(data.instructors);
    setStudents(data.students);
    setSubjects(data.subjects);
    setClassTypes(data.classTypes);

    setSelectedInstructorId((prev) => prev || data.instructors[0]?.id || "");
    setSelectedStudentId((prev) => prev || data.students[0]?.id || "");

    if (data.instructors.length > 0 && data.students.length === 0) {
      setRoleView("instructor");
    }
    if (data.students.length > 0 && data.instructors.length === 0) {
      setRoleView("student");
    }

    data.subjects.forEach((subject) => {
      if (subject.tailwindClass) {
        setSubjectColor(subject.code, subject.tailwindClass);
      }
    });
  }, [moveToLogin]);

  const loadSubjectSettings = useCallback(async () => {
    setSubjectSettingsLoading(true);
    try {
      const res = await fetch("/api/settings/subjects", { method: "GET", cache: "no-store" });
      if (res.status === 401) {
        moveToLogin();
        return;
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "과목 설정 목록을 불러오지 못했습니다.");
      }
      const data = (await res.json().catch(() => ({}))) as { subjects?: SubjectSettingItem[] };
      setSubjectSettings(data.subjects ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "과목 설정 목록을 불러오지 못했습니다.");
    } finally {
      setSubjectSettingsLoading(false);
    }
  }, [moveToLogin]);

  const openSubjectSettingsModal = useCallback(() => {
    setSubjectSettingsOpen(true);
    void loadSubjectSettings();
  }, [loadSubjectSettings]);

  const handleCreateSubject = useCallback(async () => {
    const payload: SubjectSettingItem = {
      code: subjectForm.code.trim(),
      displayName: subjectForm.displayName.trim(),
      tailwindBgClass: subjectForm.tailwindBgClass.trim()
    };
    if (!payload.code || !payload.displayName || !payload.tailwindBgClass) {
      setError("과목코드/과목명/Tailwind 클래스는 모두 입력해야 합니다.");
      return;
    }

    setSubjectSettingsSaving(true);
    try {
      const res = await fetch("/api/settings/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.status === 401) {
        moveToLogin();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "과목 추가에 실패했습니다.");
      }
      setNotice(`과목 코드 '${payload.code.toUpperCase()}'를 저장했습니다.`);
      setSubjectForm({ code: "", displayName: "", tailwindBgClass: "bg-blue-500" });
      await Promise.all([loadSubjectSettings(), loadOptions()]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "과목 추가에 실패했습니다.");
    } finally {
      setSubjectSettingsSaving(false);
    }
  }, [loadOptions, loadSubjectSettings, moveToLogin, subjectForm]);

  const handleUpdateSubject = useCallback(
    async (subject: SubjectSettingItem) => {
      setSubjectSettingsSaving(true);
      try {
        const res = await fetch("/api/settings/subjects", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subject)
        });
        if (res.status === 401) {
          moveToLogin();
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "과목 수정에 실패했습니다.");
        }
        setNotice(`과목 코드 '${subject.code}'를 수정했습니다.`);
        await Promise.all([loadSubjectSettings(), loadOptions()]);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "과목 수정에 실패했습니다.");
      } finally {
        setSubjectSettingsSaving(false);
      }
    },
    [loadOptions, loadSubjectSettings, moveToLogin]
  );

  const handleDeleteSubject = useCallback(
    async (code: string) => {
      const confirmed = window.confirm(`'${code}' 과목 코드를 삭제할까요?`);
      if (!confirmed) return;
      setSubjectSettingsSaving(true);
      try {
        const res = await fetch("/api/settings/subjects", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code })
        });
        if (res.status === 401) {
          moveToLogin();
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "과목 삭제에 실패했습니다.");
        }
        setNotice(`과목 코드 '${code}'를 삭제했습니다.`);
        await Promise.all([loadSubjectSettings(), loadOptions()]);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "과목 삭제에 실패했습니다.");
      } finally {
        setSubjectSettingsSaving(false);
      }
    },
    [loadOptions, loadSubjectSettings, moveToLogin]
  );

  const loadWeek = useCallback(async (opts?: { silent?: boolean }) => {
    if (roleView === "instructor" && !selectedInstructorId) {
      setEvents([]);
      return;
    }

    if (roleView === "student" && !selectedStudentId) {
      setEvents([]);
      return;
    }

    if (!opts?.silent) {
      setLoading(true);
    }
    setError(null);

    try {
      const query = new URLSearchParams({ weekStart, view: roleView });

      if (roleView === "instructor" && selectedInstructorId) {
        query.set("instructorId", selectedInstructorId);
      }

      if (roleView === "student" && selectedStudentId) {
        query.set("studentId", selectedStudentId);
      }

      const res = await fetch(`/api/schedules/week?${query.toString()}`, { method: "GET", cache: "no-store" });

      if (res.status === 401) {
        moveToLogin();
        return;
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to load week schedule");
      }

      const data = (await res.json()) as WeekResponse;
      setEvents(data.events);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load week schedule");
      setEvents([]);
    } finally {
      if (!opts?.silent) {
        setLoading(false);
      }
    }
  }, [moveToLogin, roleView, selectedInstructorId, selectedStudentId, weekStart]);

  const handleCreate = useCallback(
    async (input: ScheduleFormInput) => {
      const normalizedInput: ScheduleFormInput = {
        ...input,
        note: input.note.trim(),
        activeFrom: input.scheduleMode === "recurring" ? weekStart : undefined,
        classDate: input.scheduleMode === "one_off" ? input.classDate : undefined,
        weekday: input.scheduleMode === "recurring" ? input.weekday ?? initialCell?.weekday ?? dayOf(weekStart) : undefined
      };

      const conflictRes = await fetch("/api/schedules/check-conflict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedInput)
      });

      if (conflictRes.status === 401) {
        moveToLogin();
        return;
      }

      if (!conflictRes.ok) {
        const payload = (await conflictRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to check conflicts");
      }

      const conflict = (await conflictRes.json()) as ConflictResult;

      if (conflict.hasConflict) {
        throw new Error(`시간표 충돌이 발견되었습니다.\n${getConflictMessage(conflict)}`);
      }

      const createRes = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedInput)
      });

      if (createRes.status === 401) {
        moveToLogin();
        return;
      }

      if (createRes.status === 409) {
        const payload = (await createRes.json()) as { conflict: ConflictResult };
        throw new Error(`시간표 충돌로 저장이 차단되었습니다.\n${getConflictMessage(payload.conflict)}`);
      }

      if (!createRes.ok) {
        const payload = (await createRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to create schedule");
      }

      const created = (await createRes.json().catch(() => ({}))) as { classId?: string };
      if (created.classId && normalizedInput.note) {
        setMemoByEventId((prev) => ({ ...prev, [created.classId as string]: normalizedInput.note }));
      }

      await loadWeek();
    },
    [initialCell?.weekday, loadWeek, moveToLogin, weekStart]
  );

  const handleMoveSchedule = useCallback(
    async (ctx: { classId: string; weekday: Weekday; startTime: string; endTime: string }) => {
      if (movingLockRef.current) return;
      movingLockRef.current = true;
      try {
        const selectedEditingGroup = selectedGroup ?? activeGroup;
        const isActiveEditing = selectedEditingGroup?.isActive ?? true;
        const classIdBackedSnapshot = selectedEditingGroup
          ? filteredEvents.filter((event) => selectedEditingGroup.classIds.includes(event.id))
          : [];
        const selectedSnapshot = selectedEditingGroup?.snapshotEvents ?? [];
        const snapshotHasDraftIds = selectedSnapshot.some((event) => event.id.startsWith("draft-"));
        const baseSnapshot =
          selectedEditingGroup && selectedSnapshot.length > 0 && !snapshotHasDraftIds
            ? selectedSnapshot
            : classIdBackedSnapshot;

        let targetClassId = ctx.classId;
        let draftIndex = -1;
        if (ctx.classId.startsWith("draft-")) {
          draftIndex = Number(ctx.classId.replace("draft-", ""));
          if (!Number.isNaN(draftIndex) && draftEvents[draftIndex]) {
            const draft = draftEvents[draftIndex];
            const matched = classIdBackedSnapshot.find((event) => {
              if (event.weekday !== draft.weekday) return false;
              if (event.startTime !== draft.startTime || event.endTime !== draft.endTime) return false;
              const sameSubject = normalizePersonName(event.subjectName) === normalizePersonName(draft.subjectName);
              const sameInstructor =
                normalizePersonName(event.instructorName) === normalizePersonName(draft.instructorName || selectedInstructorLabel);
              return sameSubject && sameInstructor;
            });
            if (matched) {
              targetClassId = matched.id;
            }
          }
        }

        if (targetClassId.startsWith("draft-")) {
          if (ctx.classId.startsWith("draft-") && draftIndex >= 0) {
            setParsedNotionItems((prev) =>
              prev.map((item, index) =>
                index === draftIndex
                  ? {
                      ...item,
                      weekday: ctx.weekday,
                      startTime: ctx.startTime,
                      endTime: ctx.endTime
                    }
                  : item
              )
            );
            setNotice("미리보기 수업 위치를 이동했습니다. DB 저장 시 반영됩니다.");
          }
          return;
        }

        const moveClassDate = shiftDate(weekStart, ctx.weekday - 1);
        const targetEvent =
          baseSnapshot.find((event) => event.id === targetClassId) ?? events.find((event) => event.id === targetClassId) ?? null;

        if (!targetEvent) {
          setError("이동 대상 수업을 찾지 못했습니다.");
          return;
        }

        const targetInstructorKey =
          targetEvent.instructorId || normalizePersonName(targetEvent.instructorName || selectedInstructorLabel);
        const conflictMessages: string[] = [];
        const candidateGroups = timetableGroups.filter((group) => group.roleView === "student" && group.isActive);

        for (const group of candidateGroups) {
          const groupEvents = group.snapshotEvents ?? [];
          const ownerName = students.find((item) => item.id === group.targetId)?.name ?? "다른 학생";
          for (const other of groupEvents) {
            if (other.id === ctx.classId) continue;
            if (other.weekday !== ctx.weekday) continue;

            const otherInstructorKey = other.instructorId || normalizePersonName(other.instructorName);
            if (!otherInstructorKey || otherInstructorKey !== targetInstructorKey) continue;
            if (!hasTimeOverlap(ctx.startTime, ctx.endTime, other.startTime, other.endTime)) continue;
            const movingIsStrict = isStrictConflictClassType(targetEvent.classTypeCode, targetEvent.classTypeLabel);
            const existingIsStrict = isStrictConflictClassType(other.classTypeCode, other.classTypeLabel);
            if (!(movingIsStrict && existingIsStrict)) continue;

            const dayLabel = DAYS.find((day) => day.key === ctx.weekday)?.label ?? `${ctx.weekday}`;
            conflictMessages.push(
              `${ownerName} 활성 시간표와 충돌: ${dayLabel} ${ctx.startTime}-${ctx.endTime} (기존 ${other.startTime}-${other.endTime})`
            );
          }
        }

        if (conflictMessages.length > 0) {
          const msg = `드래그 이동 충돌:\n- ${conflictMessages.join("\n- ")}`;
          setError(msg);
          setConflictDialog({ open: true, title: "시간표 충돌 경고", message: msg });
          return;
        }

        const prevEvents = events;
        const prevSnapshot = baseSnapshot.map((event) => ({ ...event }));
        const rollbackMove = () => {
          setEvents(prevEvents);
          if (selectedEditingGroup) {
            setTimetableGroups((prev) =>
              prev.map((group) =>
                group.id === selectedEditingGroup.id
                  ? {
                      ...group,
                      snapshotEvents: prevSnapshot.map((event) => ({ ...event }))
                    }
                  : group
              )
            );
          }
        };

        if (selectedEditingGroup) {
          setTimetableGroups((prev) =>
            prev.map((group) =>
              group.id === selectedEditingGroup.id
                ? {
                    ...group,
                    snapshotEvents: moveEventInList(baseSnapshot, {
                      classId: targetClassId,
                      weekday: ctx.weekday,
                      startTime: ctx.startTime,
                      endTime: ctx.endTime,
                      classDate: moveClassDate
                    })
                  }
                : group
            )
          );
        }

        if (!isActiveEditing) {
          setNotice("비활성 그룹 버전을 이동했습니다. '활성'을 눌러 실제 시간표 반영이 가능합니다.");
          return;
        }

        setEvents((current) =>
          moveEventInList(current, {
            classId: targetClassId,
            weekday: ctx.weekday,
            startTime: ctx.startTime,
            endTime: ctx.endTime,
            classDate: moveClassDate
          })
        );

        setError(null);
        setNotice(null);
        const res = await fetch(`/api/schedules/${targetClassId}/move`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekday: ctx.weekday, startTime: ctx.startTime, weekStart })
        });

        if (res.status === 401) {
          rollbackMove();
          moveToLogin();
          return;
        }

        if (res.status === 409) {
          const payload = (await res.json()) as { conflict: ConflictResult };
          rollbackMove();
          const activeStudentGroups = timetableGroups.filter((group) => group.roleView === "student" && group.isActive);
          const readable = getConflictMessageForDisplay(payload.conflict, activeStudentGroups, students);
          const msg = `드래그 이동 충돌:\n${readable || getConflictMessage(payload.conflict)}`;
          setError(msg);
          setConflictDialog({ open: true, title: "시간표 충돌 경고", message: msg });
          return;
        }

        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          rollbackMove();
          setError(payload.error ?? "수업 이동에 실패했습니다.");
          return;
        }

        setNotice(`수업을 ${ctx.startTime} / ${DAYS.find((day) => day.key === ctx.weekday)?.label ?? ""}로 이동했습니다.`);
        void loadWeek({ silent: true });
      } finally {
        movingLockRef.current = false;
      }
    },
    [
      activeGroup,
      draftEvents,
      events,
      filteredEvents,
      loadWeek,
      moveToLogin,
      selectedGroup,
      selectedInstructorLabel,
      students,
      timetableGroups,
      weekStart
    ]
  );

  const handleLogout = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } finally {
      moveToLogin();
    }
  }, [moveToLogin]);

  const handleCopyForNotion = useCallback(async () => {
    const buildNotionPayload = (sourceEvents: ScheduleEvent[]) => {
      const eventByCell = new Map<string, ScheduleEvent[]>();
      for (const event of sourceEvents) {
        const key = `${event.weekday}-${event.startTime}`;
        const bucket = eventByCell.get(key) ?? [];
        bucket.push(event);
        eventByCell.set(key, bucket);
      }

      const headers = ["시간", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일", "메모", "유형", "기준일"];
      const rows = TIME_SLOTS.map((slot) => {
        const weekCells = DAYS.map((day) => {
          const key = `${day.key}-${slot}`;
          const bucket = eventByCell.get(key) ?? [];
          if (bucket.length === 0) return "";
          return bucket
            .map((event) => `${event.subjectName}-${event.classTypeLabel}(${event.studentNames.join(",")})`)
            .join(" | ");
        });
        return [toKoreanHourRange(slot), ...weekCells, "", "", weekStart].join("\t");
      });

      return [headers.join("\t"), ...rows].join("\n");
    };

    const payload = buildNotionPayload(filteredEvents);
    setNotionPreview(payload);

    try {
      await navigator.clipboard.writeText(payload);
      setNotice(
        filteredEvents.length === 0
          ? "수업이 없어도 기본 템플릿 형태로 복사되었습니다."
          : "노션 붙여넣기용 데이터가 복사되었습니다."
      );
    } catch {
      setNotice("자동 복사가 제한되었습니다. 아래 텍스트를 전체 선택 후 수동 복사해 주세요.");
    }
  }, [filteredEvents, weekStart]);

  const handleCopyGroup = useCallback(
    async (groupId: string) => {
      const group = timetableGroups.find((item) => item.id === groupId);
      if (!group) return;
      const idSet = new Set(group.classIds);
      const sourceEvents =
        group.snapshotEvents && group.snapshotEvents.length > 0
          ? group.snapshotEvents
          : events.filter((event) => idSet.has(event.id));
      const eventByCell = new Map<string, ScheduleEvent[]>();
      for (const event of sourceEvents) {
        const key = `${event.weekday}-${event.startTime}`;
        const bucket = eventByCell.get(key) ?? [];
        bucket.push(event);
        eventByCell.set(key, bucket);
      }

      const headers = ["시간", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일", "메모", "유형", "기준일"];
      const rows = TIME_SLOTS.map((slot) => {
        const weekCells = DAYS.map((day) => {
          const key = `${day.key}-${slot}`;
          const bucket = eventByCell.get(key) ?? [];
          if (bucket.length === 0) return "";
          return bucket
            .map((event) => `${event.subjectName}-${event.classTypeLabel}(${event.studentNames.join(",")})`)
            .join(" | ");
        });
        return [toKoreanHourRange(slot), ...weekCells, "", "", group.weekStart].join("\t");
      });

      const payload = [headers.join("\t"), ...rows].join("\n");
      setNotionPreview(payload);
      try {
        await navigator.clipboard.writeText(payload);
        setNotice(`'${group.name}' 그룹을 노션 붙여넣기 형식으로 복사했습니다.`);
      } catch {
        setNotice(`'${group.name}' 복사에 실패했습니다. 텍스트 영역에서 수동 복사해 주세요.`);
      }
    },
    [events, timetableGroups]
  );

  const handleLoadClipboardToNotionInput = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setNotionInput(text);
      const parsed = parseNotionTextToItems(text);
      setParsedNotionItems(parsed);
      setNotice(parsed.length > 0 ? `노션 데이터 ${parsed.length}건을 시간표로 변환했습니다.` : "클립보드에서 수업 데이터를 찾지 못했습니다.");
    } catch {
      setError("클립보드 읽기에 실패했습니다. 브라우저 권한을 확인해 주세요.");
    }
  }, []);

  const handleApplyNotionInput = useCallback(() => {
    const parsed = parseNotionTextToItems(notionTextValue);
    setParsedNotionItems(parsed);
    if (parsed.length > 0 && !selectedInstructorId) {
      const normalize = (value: string) => value.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
      const firstInstructor = parsed.find((item) => item.instructorName)?.instructorName;
      if (firstInstructor) {
        const target = normalize(normalizeInstructorAlias(firstInstructor));
        const matched =
          instructors.find((entry) => normalize(entry.name) === target) ??
          instructors.find((entry) => normalize(entry.name).includes(target) || target.includes(normalize(entry.name)));
        if (matched) {
          setSelectedInstructorId(matched.id);
        }
      }
    }
    setNotice(parsed.length > 0 ? `노션 데이터 ${parsed.length}건을 시간표 미리보기에 반영했습니다.` : "붙여넣은 텍스트에서 수업 데이터가 인식되지 않았습니다.");
  }, [instructors, notionTextValue, selectedInstructorId]);

  const handleImportNotionToServer = useCallback(async () => {
    if (parsedNotionItems.length === 0) {
      const existingClassIds = Array.from(new Set(displayEvents.map((event) => event.id).filter((id) => !id.startsWith("draft-"))));
      if (existingClassIds.length === 0) {
        setError("저장할 시간표가 없습니다. 노션 반영 또는 수업 추가 후 다시 시도해 주세요.");
        return;
      }
      if (!currentTargetId) {
        setError("강사/학생 선택 후 다시 시도해 주세요.");
        return;
      }
      const newGroup: TimetableGroup = {
        id: crypto.randomUUID(),
        name: `${weekStart} ${currentTargetLabel} 시간표`,
        roleView,
        targetId: currentTargetId,
        weekStart,
        classIds: existingClassIds,
        snapshotEvents: displayEvents.filter((event) => existingClassIds.includes(event.id)).map((event) => ({ ...event })),
        isActive: true,
        createdAt: new Date().toISOString()
      };
      setTimetableGroups((prev) => {
        const next = prev.map((group) =>
          group.roleView === roleView && group.targetId === currentTargetId ? { ...group, isActive: false } : group
        );
        return [newGroup, ...next];
      });
      setSelectedGroupId(newGroup.id);
      setError(null);
      setNotice(`현재 시간표를 그룹으로 저장했습니다. (${existingClassIds.length}개 수업)`);
      return;
    }

    setImportingNotion(true);
    importingNotionRef.current = true;
    setImportProgress({
      active: true,
      total: parsedNotionItems.length,
      done: 0,
      label: "노션 시간표를 서버에 저장 중입니다..."
    });
    setError(null);

    const normalize = (value: string) => value.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
    const findInstructorId = (name: string): string => {
      const aliased = normalizeInstructorAlias(name);
      const target = normalize(aliased);
      if (!target) return "";
      const exact = instructors.find((entry) => normalize(entry.name) === target);
      if (exact) return exact.id;
      const partial = instructors.find((entry) => normalize(entry.name).includes(target) || target.includes(normalize(entry.name)));
      return partial?.id ?? "";
    };
    let created = 0;
    let existing = 0;
    let skipped = 0;
    const importedClassIds: string[] = [];
    const conflictDetails: string[] = [];
    const noSubjectDetails: string[] = [];
    const skipReasons: Record<string, number> = {
      noInstructor: 0,
      noStudent: 0,
      noSubject: 0,
      noClassType: 0,
      conflict: 0,
      requestFailed: 0
    };

    try {
      for (let idx = 0; idx < parsedNotionItems.length; idx += 1) {
        const item = parsedNotionItems[idx] as ParsedNotionItem;
      const subject = resolveSubjectOption(item.subjectLabel, subjects);
      const classType = resolveClassTypeOption(item.classTypeLabel, classTypes);

      let instructorId = "";
      if (item.instructorName) {
        instructorId = findInstructorId(item.instructorName);
      } else {
        instructorId = selectedInstructorId;
      }

      const studentIds: string[] = selectedStudentId ? [selectedStudentId] : [];

      if (!instructorId) {
        skipped += 1;
        skipReasons.noInstructor += 1;
        continue;
      }
      if (studentIds.length === 0) {
        skipped += 1;
        skipReasons.noStudent += 1;
        continue;
      }
      if (!subject) {
        skipped += 1;
        skipReasons.noSubject += 1;
        const weekdayLabel = DAYS.find((day) => day.key === item.weekday)?.label ?? String(item.weekday);
        noSubjectDetails.push(`${weekdayLabel} ${toKoreanHourRange(item.startTime)} (${item.rawText})`);
        setImportProgress((prev) => ({ ...prev, done: idx + 1 }));
        continue;
      }
      if (!classType) {
        skipped += 1;
        skipReasons.noClassType += 1;
        setImportProgress((prev) => ({ ...prev, done: idx + 1 }));
        continue;
      }

      const payload: ScheduleFormInput = {
        instructorId,
        studentIds,
        subjectCode: subject.code,
        classTypeCode: classType.code,
        note: item.note?.trim() || item.rawText,
        scheduleMode: "recurring",
        weekday: item.weekday,
        activeFrom: weekStart,
        startTime: item.startTime,
        endTime: item.endTime
      };

      const createRes = await fetch("/api/schedules/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (createRes.ok) {
        const result = (await createRes.json().catch(() => ({}))) as { status?: string; classId?: string };
        if (result.classId) {
          importedClassIds.push(result.classId);
          setMemoByEventId((prev) => ({ ...prev, [result.classId as string]: payload.note }));
        }
        if (result.status === "existing") {
          existing += 1;
        } else {
          created += 1;
        }
      } else if (createRes.status === 409) {
        skipped += 1;
        skipReasons.conflict += 1;
        const conflictResult = (await createRes.json().catch(() => ({}))) as {
          conflict?: { conflicts?: { reason?: string; classId?: string }[] };
        };
        const weekdayLabel = DAYS.find((day) => day.key === item.weekday)?.label ?? String(item.weekday);
        const slotLabel = `${weekdayLabel} ${toKoreanHourRange(item.startTime)}`;
        const conflictReason =
          conflictResult.conflict?.conflicts?.map((conflict) => conflict.reason).filter(Boolean).join(", ") ??
          "시간표 충돌";
        conflictDetails.push(`- ${slotLabel} (${item.rawText}): ${conflictReason}`);
      } else {
        skipped += 1;
        skipReasons.requestFailed += 1;
      }

        setImportProgress((prev) => ({ ...prev, done: idx + 1 }));
    }
      const reasonLine = Object.entries(skipReasons)
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${key}:${count}`)
        .join(", ");
      setNotice(`노션 가져오기 완료: 생성 ${created}건 / 기존유지 ${existing}건 / 건너뜀 ${skipped}건${reasonLine ? ` (${reasonLine})` : ""}`);

      const dedupedClassIds = Array.from(new Set(importedClassIds));
      if (dedupedClassIds.length > 0 && currentTargetId) {
        const newGroup: TimetableGroup = {
          id: crypto.randomUUID(),
          name: `${weekStart} ${currentTargetLabel} 시간표`,
          roleView,
          targetId: currentTargetId,
          weekStart,
          classIds: dedupedClassIds,
          snapshotEvents: [],
          isActive: true,
          createdAt: new Date().toISOString()
        };
        setTimetableGroups((prev) => {
          const next = prev.map((group) =>
            group.roleView === roleView && group.targetId === currentTargetId ? { ...group, isActive: false } : group
          );
          return [newGroup, ...next];
        });
        setSelectedGroupId(newGroup.id);
      }

      if (created > 0 || existing > 0) {
        setParsedNotionItems([]);
        setNotionInput("");
      }

      if (conflictDetails.length > 0 || noSubjectDetails.length > 0) {
        const lines: string[] = [];
        let title = "시간표 저장 경고";
        if (conflictDetails.length > 0) {
          title = "시간표 충돌 경고";
          lines.push("노션 시간표 저장 중 충돌이 발생했습니다.");
          lines.push(...conflictDetails);
        }
        if (noSubjectDetails.length > 0) {
          if (conflictDetails.length === 0) {
            title = "과목 매핑 경고";
          }
          lines.push("");
          lines.push(`과목 매핑 실패(noSubject) ${noSubjectDetails.length}건`);
          lines.push(...noSubjectDetails.slice(0, 12).map((item) => `- ${item}`));
          if (noSubjectDetails.length > 12) {
            lines.push(`- 외 ${noSubjectDetails.length - 12}건`);
          }
          lines.push("");
          lines.push("사탐/사회 과목은 subjects 테이블에 코드가 있어야 저장됩니다.");
        }
        setConflictDialog({
          open: true,
          title,
          message: lines.join("\n")
        });
      }
    } finally {
      setImportingNotion(false);
      importingNotionRef.current = false;
      setImportProgress((prev) => ({ ...prev, active: false, label: "" }));
    }

    if (pendingRealtimeReloadRef.current) {
      pendingRealtimeReloadRef.current = false;
    }
    await loadWeek({ silent: true });
  }, [
    classTypes,
    instructors,
    loadWeek,
    parsedNotionItems,
    selectedInstructorId,
    selectedStudentId,
    subjects,
    currentTargetId,
    currentTargetLabel,
    draftEvents,
    displayEvents,
    roleView,
    weekStart
  ]);

  const handleSyncSheets = useCallback(async () => {
    setSyncingSheets(true);
    setNotice(null);
    setError(null);

    try {
      const res = await fetch("/api/sheets/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      if (res.status === 401) {
        moveToLogin();
        return;
      }

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        teachersInserted?: number;
        studentsInserted?: number;
      };

      if (!res.ok) {
        throw new Error(payload.error ?? "시트 동기화에 실패했습니다.");
      }

      setNotice(`시트 동기화 완료: 강사 ${payload.teachersInserted ?? 0}명 추가 / 학생 ${payload.studentsInserted ?? 0}명 추가`);
      await loadOptions();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "시트 동기화에 실패했습니다.");
    } finally {
      setSyncingSheets(false);
    }
  }, [loadOptions, moveToLogin]);

  const handleActivateGroup = useCallback((groupId: string) => {
    setParsedNotionItems([]);
    let activatedSnapshot: ScheduleEvent[] = [];
    setTimetableGroups((prev) =>
      prev.map((group) => {
        if (group.roleView === roleView && group.targetId === currentTargetId) {
          const nextGroup = { ...group, isActive: group.id === groupId };
          if (group.id === groupId) {
            activatedSnapshot = nextGroup.snapshotEvents ?? [];
          }
          return nextGroup;
        }
        return group;
      })
    );
    if (activatedSnapshot.length > 0) {
      setEvents(activatedSnapshot.map((event) => ({ ...event })));
    }
    setSelectedGroupId(groupId);
    setNotice("활성 시간표를 변경했습니다.");
  }, [currentTargetId, roleView]);

  const handleSelectGroup = useCallback((groupId: string) => {
    setParsedNotionItems([]);
    setTimetableGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        const snapshot = group.snapshotEvents ?? [];
        const hasDraftSnapshot = snapshot.some((event) => event.id.startsWith("draft-"));
        if (snapshot.length > 0 && !hasDraftSnapshot) return group;
        const seeded = filteredEvents
          .filter((event) => group.classIds.includes(event.id))
          .map((event) => ({ ...event }));
        return { ...group, snapshotEvents: seeded };
      })
    );
    setSelectedGroupId(groupId);
    setNotice("선택한 그룹 시간표를 표시했습니다.");
  }, [filteredEvents]);

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      const targetGroup = timetableGroups.find((group) => group.id === groupId);
      if (!targetGroup) return;
      const confirmed = window.confirm(`'${targetGroup.name}' 그룹을 삭제할까요?`);
      if (!confirmed) return;

      try {
        const res = await fetch("/api/schedules/group", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classIds: targetGroup.classIds,
            roleView: targetGroup.roleView,
            targetId: targetGroup.targetId
          })
        });

        if (res.status === 401) {
          moveToLogin();
          return;
        }

        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "시간표 삭제에 실패했습니다.");
        }
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : "시간표 삭제에 실패했습니다.");
        return;
      }

      setTimetableGroups((prev) => {
        const next = prev.filter((group) => group.id !== groupId);
        const sameScope = next
          .filter((group) => group.roleView === targetGroup.roleView && group.targetId === targetGroup.targetId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (!sameScope.some((group) => group.isActive) && sameScope.length > 0) {
          const activeId = sameScope[0]?.id;
          return next.map((group) => (group.id === activeId ? { ...group, isActive: true } : group));
        }
        return next;
      });
      setSelectedGroupId((prev) => (prev === groupId ? null : prev));
      setNotice("시간표 그룹과 해당 수업을 삭제했습니다.");
      await loadWeek({ silent: true });
    },
    [loadWeek, moveToLogin, timetableGroups]
  );

  const handleRenameGroup = useCallback((groupId: string, name: string) => {
    setTimetableGroups((prev) => prev.map((group) => (group.id === groupId ? { ...group, name } : group)));
  }, []);

  useEffect(() => {
    void loadOptions().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Failed to load options");
    });
  }, [loadOptions]);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek]);

  useEffect(() => {
    const saved = window.localStorage.getItem("synchro-s-timetable-groups-v1");
    if (!saved) {
      setGroupsHydrated(true);
      return;
    }
    try {
      const parsed = JSON.parse(saved) as TimetableGroup[];
      setTimetableGroups(parsed);
    } catch {
      setTimetableGroups([]);
    } finally {
      setGroupsHydrated(true);
    }
  }, []);

  useEffect(() => {
    const savedMemo = window.localStorage.getItem("synchro-s-event-memo-v1");
    if (!savedMemo) return;
    try {
      setMemoByEventId(JSON.parse(savedMemo) as Record<string, string>);
    } catch {
      setMemoByEventId({});
    }
  }, []);

  useEffect(() => {
    if (!groupsHydrated) return;
    window.localStorage.setItem("synchro-s-timetable-groups-v1", JSON.stringify(timetableGroups));
  }, [groupsHydrated, timetableGroups]);

  useEffect(() => {
    window.localStorage.setItem("synchro-s-event-memo-v1", JSON.stringify(memoByEventId));
  }, [memoByEventId]);

  useEffect(() => {
    setGroupPage(1);
    setSelectedGroupId(null);
  }, [currentTargetId, roleView]);

  useEffect(() => {
    if (groupPage > groupPageCount) {
      setGroupPage(groupPageCount);
    }
  }, [groupPage, groupPageCount]);

  useEffect(() => {
    if (!selectedGroupId) return;
    const exists = timetableGroups.some(
      (group) => group.id === selectedGroupId && group.roleView === roleView && group.targetId === currentTargetId
    );
    if (!exists) {
      setSelectedGroupId(null);
    }
  }, [currentTargetId, roleView, selectedGroupId, timetableGroups]);

  useEffect(() => {
    if (!showActiveOnly || !selectedGroupId) return;
    const selected = timetableGroups.find((group) => group.id === selectedGroupId);
    if (selected && !selected.isActive) {
      setSelectedGroupId(activeGroup?.id ?? null);
    }
  }, [activeGroup?.id, selectedGroupId, showActiveOnly, timetableGroups]);

  useEffect(() => {
    if (!keyword) return;

    if (roleView === "student") {
      const exact = students.find((item) => item.name.toLowerCase() === keyword);
      const first = exact ?? filteredStudents[0];
      if (first && first.id !== selectedStudentId) {
        setSelectedStudentId(first.id);
      }
      setShowStudentPicker(false);
      return;
    }

    const exact = instructors.find((item) => item.name.toLowerCase() === keyword);
    const first = exact ?? filteredInstructors[0];
    if (first && first.id !== selectedInstructorId) {
      setSelectedInstructorId(first.id);
    }
    setShowInstructorPicker(false);
  }, [
    filteredInstructors,
    filteredStudents,
    instructors,
    keyword,
    roleView,
    selectedInstructorId,
    selectedStudentId,
    students
  ]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("synchro-s-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "classes" }, () => {
        if (importingNotionRef.current) {
          pendingRealtimeReloadRef.current = true;
          return;
        }
        void loadWeek({ silent: true });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "class_enrollments" }, () => {
        if (importingNotionRef.current) {
          pendingRealtimeReloadRef.current = true;
          return;
        }
        void loadWeek({ silent: true });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "class_overrides" }, () => {
        if (importingNotionRef.current) {
          pendingRealtimeReloadRef.current = true;
          return;
        }
        void loadWeek({ silent: true });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadWeek]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1520px] flex-col gap-4 bg-[radial-gradient(circle_at_5%_10%,#dbeafe,transparent_35%),radial-gradient(circle_at_95%_0%,#bfdbfe,transparent_30%),#eef2f7] px-4 py-6 lg:px-8">
      <section
        className={`relative z-[80] overflow-visible rounded-3xl border border-white/70 bg-gradient-to-r from-white/80 via-sky-50/70 to-teal-100/60 p-4 pl-20 shadow-[0_20px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl ${headerGlowClass}`}
      >
        <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center">
          <img
            src="https://raw.githubusercontent.com/whdtjd5294/whdtjd5294.github.io/main/sedu_logo.png"
            alt="SEDU 로고"
            className="h-14 w-14 object-contain"
          />
          <div className="h-14 w-40 bg-gradient-to-r from-white/60 via-white/25 to-transparent" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Synchro-S</h1>
            <p className="text-sm font-medium text-slate-500">
              {weekStart} ~ {weekEnd} | 입력 일시/진행현황 자동 기록
            </p>
          </div>

          <div className="flex items-center gap-2">
            <RoleTabs value={roleView} onChange={setRoleView} />
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              로그아웃
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => setWeekStart((prev) => shiftDate(prev, -7))}
          >
            이전 주
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => setWeekStart(mondayOfCurrentWeek())}
          >
            이번 주
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => setWeekStart((prev) => shiftDate(prev, 7))}
          >
            다음 주
          </button>
          <button
            type="button"
            className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            onClick={() => void handleCopyForNotion()}
          >
            노션 붙여넣기 복사
          </button>
          <button
            type="button"
            disabled={syncingSheets}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
            onClick={() => void handleSyncSheets()}
          >
            {syncingSheets ? "시트 동기화 중..." : "명단 동기화"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100"
            onClick={openSubjectSettingsModal}
          >
            과목 코드 설정
          </button>

          <div className="flex min-w-[260px] items-center gap-2 rounded-full border border-white/70 bg-white/60 px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_22px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <span className="text-sm text-slate-500">⌕</span>
            <input
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="강사/학생 검색"
              className="w-full bg-transparent text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>

          <div className="min-w-[220px] rounded-2xl border border-white/70 bg-white/60 px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_22px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            {roleView === "student" ? (
              <>
                <p className="text-[11px] font-bold text-emerald-700">학생 프로필</p>
                <p className="text-base font-extrabold text-slate-900">{selectedStudentLabel}</p>
                <p className="text-xs font-semibold text-slate-500">{selectedStudentSecondary || "학교 정보 없음"}</p>
              </>
            ) : (
              <>
                <p className="text-[11px] font-bold text-sky-700">강사 프로필</p>
                <p className="text-base font-extrabold text-slate-900">{selectedInstructorLabel}</p>
                <p className="text-xs font-semibold text-slate-500">{selectedInstructorSecondary || "과목 정보 없음"}</p>
              </>
            )}
          </div>

          {roleView === "instructor" ? (
            <div className="relative z-[120] ml-auto">
              <button
                type="button"
                onClick={() => {
                  setShowInstructorPicker((prev) => !prev);
                  setShowStudentPicker(false);
                }}
                className="rounded-2xl border border-white/70 bg-white/65 px-4 py-2 text-sm font-semibold text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_22px_rgba(15,23,42,0.12)] backdrop-blur-xl"
              >
                강사: {selectedInstructorLabel}
              </button>
              {showInstructorPicker ? (
                <div className="absolute right-0 z-[220] mt-2 w-64 overflow-hidden rounded-2xl border border-white/70 bg-white/80 p-2 shadow-[0_16px_36px_rgba(15,23,42,0.2)] backdrop-blur-2xl">
                  <div className="max-h-72 overflow-auto">
                    {(filteredInstructors.length > 0 ? filteredInstructors : instructors).map((instructor) => (
                      <button
                        key={instructor.id}
                        type="button"
                        onClick={() => {
                          setSelectedInstructorId(instructor.id);
                          setShowInstructorPicker(false);
                        }}
                        className={`block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold ${
                          instructor.id === selectedInstructorId
                            ? "bg-indigo-100 text-indigo-800"
                            : "text-slate-800 hover:bg-slate-100/70"
                        }`}
                      >
                        강사: {instructor.name}
                        {instructor.secondary ? (
                          <span className="ml-2 text-xs font-medium text-slate-500">({instructor.secondary})</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="relative z-[120] ml-auto">
              <button
                type="button"
                onClick={() => {
                  setShowStudentPicker((prev) => !prev);
                  setShowInstructorPicker(false);
                }}
                className="rounded-2xl border border-white/70 bg-white/65 px-4 py-2 text-sm font-semibold text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_22px_rgba(15,23,42,0.12)] backdrop-blur-xl"
              >
                학생: {selectedStudentLabel}
              </button>
              {showStudentPicker ? (
                <div className="absolute right-0 z-[220] mt-2 w-72 overflow-hidden rounded-2xl border border-white/70 bg-white/80 p-2 shadow-[0_16px_36px_rgba(15,23,42,0.2)] backdrop-blur-2xl">
                  <div className="max-h-80 overflow-auto">
                    {(filteredStudents.length > 0 ? filteredStudents : students).map((student) => (
                      <button
                        key={student.id}
                        type="button"
                        onClick={() => {
                          setSelectedStudentId(student.id);
                          setShowStudentPicker(false);
                        }}
                        className={`block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold ${
                          student.id === selectedStudentId
                            ? "bg-teal-100 text-teal-800"
                            : "text-slate-800 hover:bg-slate-100/70"
                        }`}
                      >
                        학생: {student.name}
                        {student.secondary ? (
                          <span className="ml-2 text-xs font-medium text-slate-500">({student.secondary})</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {error ? (
        <div className="whitespace-pre-line rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {notice}
        </div>
      ) : null}
      <div className="rounded-xl border border-blue-100 bg-white/60 px-4 py-2 text-xs font-semibold text-slate-600 backdrop-blur-sm">
        노션 시간표는 아래 입력칸에 직접 붙여넣거나 클립보드에서 불러온 뒤, 시간표 미리보기/DB 저장까지 진행할 수 있습니다.
      </div>
      <div className="rounded-xl border border-slate-200 bg-white/70 p-3 backdrop-blur-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-slate-600">노션 시간표 원본 텍스트</p>
          <button
            type="button"
            onClick={() => void handleLoadClipboardToNotionInput()}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            클립보드 불러오기
          </button>
          <button
            type="button"
            onClick={handleApplyNotionInput}
            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
          >
            시간표에 반영
          </button>
          <button
            type="button"
            disabled={importingNotion}
            onClick={() => void handleImportNotionToServer()}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
          >
            {importingNotion ? "저장 중..." : "DB로 저장"}
          </button>
          {notionPreview ? (
            <button
              type="button"
              onClick={() => void handleCopyForNotion()}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              현재 주차 내보내기 복사
            </button>
          ) : null}
        </div>
        <textarea
          value={notionTextValue}
          onChange={(event) => {
            setNotionInput(event.target.value);
            setParsedNotionItems([]);
          }}
          placeholder="노션 표를 그대로 붙여넣으세요. 예: 시간, 월요일, 화요일..."
          className="h-28 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700"
        />
      </div>

      <section className="grid flex-1 gap-4 xl:grid-cols-[1fr_330px]">
        <div>
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500">로딩 중...</div>
          ) : (
            <TimetableGrid
              roleView={roleView}
              days={DAYS}
              timeSlots={TIME_SLOTS}
              events={displayEvents}
              highlightCellTints={activeHighlightCellTints}
              onEventMove={handleMoveSchedule}
              onCellClick={(ctx) => {
                setInitialCell(ctx);
                setModalOpen(true);
              }}
            />
          )}
        </div>

        <aside className="rounded-3xl border border-white/40 bg-gradient-to-b from-blue-600/95 to-indigo-600/95 p-4 text-white shadow-[0_20px_45px_rgba(30,64,175,0.45)] backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">{monthLabel}</h2>
            <div className="flex gap-1">
              <button
                type="button"
                className="rounded-md bg-white/20 px-2 py-1 text-sm font-bold hover:bg-white/30"
                onClick={() => setCalendarMonth((prev) => shiftMonth(prev, -1))}
              >
                ‹
              </button>
              <button
                type="button"
                className="rounded-md bg-white/20 px-2 py-1 text-sm font-bold hover:bg-white/30"
                onClick={() => setCalendarMonth((prev) => shiftMonth(prev, 1))}
              >
                ›
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-white/80">
            {["월", "화", "수", "목", "금", "토", "일"].map((label) => (
              <div key={label} className="py-1">
                {label}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {monthCells.map((cell, idx) => {
              if (!cell.inMonth) {
                return <div key={`empty-${idx}`} className="h-9 rounded-md bg-transparent" />;
              }

              const hasClass = eventDateSet.has(cell.date);
              return (
                <div key={cell.date} className="relative flex h-9 items-center justify-center rounded-full text-sm font-semibold">
                  <span className={hasClass ? "rounded-full bg-white px-2 py-1 text-blue-700 shadow-md" : "text-white/90"}>{cell.day}</span>
                  {hasClass ? <span className="absolute bottom-0.5 h-1.5 w-1.5 rounded-full bg-amber-300" /> : null}
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-2xl bg-white/10 p-3">
            <p className="text-xs font-semibold text-white/80">월간 수업 현황</p>
            <p className="mt-1 text-2xl font-extrabold">{displayEvents.length}개</p>
            <p className="mt-1 text-xs text-white/80">현재 주간/검색 필터 기준 수업 수</p>
          </div>

          <div className="mt-4 rounded-2xl bg-white/12 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-white/90">저장된 시간표 그룹</p>
              <span className="rounded-full border border-white/35 bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/90">
                {roleView === "instructor" ? "강사" : "학생"} / {currentTargetLabel}
              </span>
            </div>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowActiveOnly((prev) => !prev)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                  showActiveOnly
                    ? "border-emerald-200/75 bg-[linear-gradient(120deg,rgba(255,255,255,0.4),rgba(16,185,129,0.5))] text-white shadow-[0_8px_20px_rgba(16,185,129,0.35)]"
                    : "border-white/35 bg-white/12 text-white/90 hover:bg-white/20"
                }`}
              >
                활성만 보기 {showActiveOnly ? "ON" : "OFF"}
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {visibleGroups.length === 0 ? (
                <p className="text-xs text-white/75">DB 저장 시 월~일 10-22시 한 세트가 그룹으로 저장됩니다.</p>
              ) : (
                visibleGroups.map((group) => (
                  <div
                    key={group.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectGroup(group.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelectGroup(group.id);
                      }
                    }}
                    className={`w-full rounded-xl border p-2 text-left ${
                      (selectedGroup?.id ?? activeGroup?.id) === group.id
                        ? "border-white/70 bg-white/22 shadow-[0_10px_30px_rgba(15,23,42,0.22)]"
                        : "border-white/25 bg-white/12"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={group.name}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => handleRenameGroup(group.id, event.target.value)}
                        className="flex-1 rounded-lg border border-white/30 bg-white/15 px-2 py-1 text-xs font-semibold text-white outline-none placeholder:text-white/70"
                      />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleActivateGroup(group.id);
                        }}
                        className={`rounded-lg border px-2 py-1 text-[11px] font-semibold backdrop-blur-xl ${
                          group.isActive
                            ? "border-emerald-200/70 bg-[linear-gradient(140deg,rgba(255,255,255,0.4),rgba(16,185,129,0.45))] text-white shadow-[0_8px_24px_rgba(16,185,129,0.35)]"
                            : "border-white/35 bg-white/15 text-white/90 hover:bg-white/20"
                        }`}
                      >
                        {group.isActive ? "활성" : "활성화"}
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-white/80">
                      <span className="mr-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white/25 px-1 text-[10px] font-bold">
                        {groupNumberById[group.id] ?? 1}
                      </span>
                      {group.weekStart} | 수업 {group.classIds.length}개
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleCopyGroup(group.id);
                        }}
                        className="rounded-md border border-white/35 bg-white/15 px-2 py-1 text-[11px] font-semibold text-white/95 hover:bg-white/25"
                      >
                        복사
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteGroup(group.id);
                        }}
                        className="rounded-md border border-rose-200/50 bg-rose-400/20 px-2 py-1 text-[11px] font-semibold text-rose-100 hover:bg-rose-400/35"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-white/90">
              <button
                type="button"
                className="rounded-md bg-white/20 px-2 py-1 disabled:opacity-40"
                disabled={groupPage <= 1}
                onClick={() => setGroupPage((prev) => Math.max(1, prev - 1))}
              >
                ‹
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: groupPageCount }).map((_, idx) => {
                  const page = idx + 1;
                  return (
                    <button
                      key={`group-page-${page}`}
                      type="button"
                      onClick={() => setGroupPage(page)}
                      className={`rounded-md px-2 py-1 ${groupPage === page ? "bg-white/35 font-bold" : "bg-white/15"}`}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="rounded-md bg-white/20 px-2 py-1 disabled:opacity-40"
                disabled={groupPage >= groupPageCount}
                onClick={() => setGroupPage((prev) => Math.min(groupPageCount, prev + 1))}
              >
                ›
              </button>
            </div>
          </div>
        </aside>
      </section>

      {importProgress.active ? (
        <div className="fixed inset-0 z-[340] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.72),rgba(219,234,254,0.65),rgba(167,243,208,0.45))] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.28)] backdrop-blur-2xl">
            <p className="text-base font-extrabold text-slate-800">노션 시간표 저장 중...</p>
            <p className="mt-1 text-xs font-semibold text-slate-600">{importProgress.label || "데이터를 처리하고 있습니다."}</p>
            <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white/60">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#34d399,#60a5fa,#a78bfa)] transition-all duration-300"
                style={{
                  width: `${Math.max(
                    6,
                    importProgress.total > 0 ? Math.round((importProgress.done / importProgress.total) * 100) : 0
                  )}%`
                }}
              />
            </div>
            <p className="mt-2 text-right text-sm font-bold text-slate-700">
              {importProgress.total > 0 ? Math.round((importProgress.done / importProgress.total) * 100) : 0}% (
              {importProgress.done}/{importProgress.total})
            </p>
          </div>
        </div>
      ) : null}

      {subjectSettingsOpen ? (
        <div className="fixed inset-0 z-[335] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-3xl border border-white/60 bg-[linear-gradient(160deg,rgba(255,255,255,0.78),rgba(237,233,254,0.68),rgba(219,234,254,0.65))] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.30)] backdrop-blur-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-lg font-extrabold text-slate-800">과목 코드 설정</p>
                <p className="text-xs font-semibold text-slate-500">subjects 테이블을 UI에서 관리합니다.</p>
              </div>
              <button
                type="button"
                className="rounded-xl border border-white/70 bg-white/60 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-white/80"
                onClick={() => setSubjectSettingsOpen(false)}
              >
                닫기
              </button>
            </div>

            <div className="grid gap-2 rounded-2xl border border-white/70 bg-white/45 p-3 md:grid-cols-[1fr_1.2fr_1.2fr_auto]">
              <input
                value={subjectForm.code}
                onChange={(event) => setSubjectForm((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))}
                placeholder="코드 (예: SOCIAL)"
                className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 outline-none"
              />
              <input
                value={subjectForm.displayName}
                onChange={(event) => setSubjectForm((prev) => ({ ...prev, displayName: event.target.value }))}
                placeholder="과목명 (예: 사회/사탐)"
                className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 outline-none"
              />
              <input
                value={subjectForm.tailwindBgClass}
                onChange={(event) => setSubjectForm((prev) => ({ ...prev, tailwindBgClass: event.target.value }))}
                placeholder="Tailwind 클래스 (예: bg-amber-500)"
                className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 outline-none"
              />
              <button
                type="button"
                disabled={subjectSettingsSaving}
                onClick={() => void handleCreateSubject()}
                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
              >
                추가
              </button>
            </div>

            <div className="mt-3 max-h-[52vh] overflow-auto rounded-2xl border border-white/70 bg-white/40 p-2">
              {subjectSettingsLoading ? (
                <p className="px-2 py-4 text-sm font-semibold text-slate-500">불러오는 중...</p>
              ) : subjectSettings.length === 0 ? (
                <p className="px-2 py-4 text-sm font-semibold text-slate-500">등록된 과목 코드가 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {subjectSettings.map((subject) => (
                    <div key={subject.code} className="grid gap-2 rounded-xl border border-white/70 bg-white/55 p-2 md:grid-cols-[1fr_1.2fr_1.2fr_auto_auto]">
                      <input
                        value={subject.code}
                        readOnly
                        className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 outline-none"
                      />
                      <input
                        value={subject.displayName}
                        onChange={(event) =>
                          setSubjectSettings((prev) =>
                            prev.map((item) => (item.code === subject.code ? { ...item, displayName: event.target.value } : item))
                          )
                        }
                        className="rounded-lg border border-slate-200 bg-white/85 px-3 py-2 text-sm font-semibold text-slate-700 outline-none"
                      />
                      <input
                        value={subject.tailwindBgClass}
                        onChange={(event) =>
                          setSubjectSettings((prev) =>
                            prev.map((item) =>
                              item.code === subject.code ? { ...item, tailwindBgClass: event.target.value } : item
                            )
                          )
                        }
                        className="rounded-lg border border-slate-200 bg-white/85 px-3 py-2 text-sm font-semibold text-slate-700 outline-none"
                      />
                      <button
                        type="button"
                        disabled={subjectSettingsSaving}
                        onClick={() => void handleUpdateSubject(subject)}
                        className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-60"
                      >
                        저장
                      </button>
                      <button
                        type="button"
                        disabled={subjectSettingsSaving}
                        onClick={() => void handleDeleteSubject(subject.code)}
                        className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {conflictDialog.open ? (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-white/60 bg-[linear-gradient(160deg,rgba(255,255,255,0.66),rgba(254,226,226,0.58),rgba(219,234,254,0.55))] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.32)] backdrop-blur-2xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-lg font-extrabold text-rose-700">{conflictDialog.title || "시간표 경고"}</p>
              <button
                type="button"
                className="rounded-xl border border-white/70 bg-white/60 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-white/80"
                onClick={() => setConflictDialog({ open: false, title: "", message: "" })}
              >
                닫기
              </button>
            </div>
            <pre className="whitespace-pre-wrap rounded-2xl border border-white/60 bg-white/45 p-3 text-sm font-semibold leading-6 text-slate-800">
              {conflictDialog.message}
            </pre>
            <div className="mt-4 text-right">
              <button
                type="button"
                className="rounded-2xl border border-rose-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.55),rgba(244,114,182,0.48))] px-4 py-2 text-sm font-bold text-rose-900 shadow-[0_10px_28px_rgba(244,63,94,0.28)]"
                onClick={() => setConflictDialog({ open: false, title: "", message: "" })}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ScheduleModal
        open={modalOpen}
        initialCell={initialCell}
        instructors={instructors}
        students={students}
        preferredInstructorId={selectedInstructorId}
        preferredStudentId={selectedStudentId}
        subjects={subjects.map((subject) => ({ code: subject.code, label: subject.label }))}
        classTypes={classTypes.map((type) => ({
          code: type.code,
          label: type.label,
          badgeText: type.badgeText,
          maxStudents: type.maxStudents
        }))}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCreate}
      />
    </main>
  );
}
