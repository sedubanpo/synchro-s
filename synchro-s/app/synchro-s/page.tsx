"use client";

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
  TimetableViewMode,
  Weekday
} from "@/types/schedule";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type MainTab = "overview" | RoleView;

type ConflictDialogState = {
  open: boolean;
  title: string;
  message: string;
};

type DeleteGroupDialogState = {
  open: boolean;
  groupId: string | null;
  groupName: string;
  submitting: boolean;
};

type SubjectSettingItem = {
  code: string;
  displayName: string;
  tailwindBgClass: string;
};

type UndoState = {
  label: string;
  events: ScheduleEvent[];
  notionInput: string;
  notionPreview: string;
  parsedNotionItems: ParsedNotionItem[];
  timetableGroups: TimetableGroup[];
  selectedGroupId: string | null;
  restoreMove?: {
    classId: string;
    weekday: Weekday;
    startTime: string;
    weekStart: string;
    studentId?: string;
  };
};

const MIXED_CLASS_TYPE_CONFLICT_MESSAGE = "1:1 수업과 개별정규 수업은 같은 시간에 혼합하여 배정할 수 없습니다.";

function cloneEvents(items: ScheduleEvent[]): ScheduleEvent[] {
  return items.map((item) => ({
    ...item,
    studentIds: [...item.studentIds],
    studentNames: [...item.studentNames]
  }));
}

function cloneParsedNotionItems(items: ParsedNotionItem[]): ParsedNotionItem[] {
  return items.map((item) => ({ ...item }));
}

function cloneTimetableGroups(items: TimetableGroup[]): TimetableGroup[] {
  return items.map((group) => ({
    ...group,
    classIds: [...group.classIds],
    snapshotEvents: group.snapshotEvents ? cloneEvents(group.snapshotEvents) : undefined
  }));
}

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

function normalizeDaysOff(daysOff?: Weekday[]): Weekday[] {
  if (!Array.isArray(daysOff)) {
    return [];
  }
  return Array.from(new Set(daysOff.filter((value): value is Weekday => value >= 1 && value <= 7))).sort((a, b) => a - b) as Weekday[];
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

function hasMixedClassTypeConflict(
  current: { classTypeCode: string; classTypeLabel?: string },
  other: { classTypeCode: string; classTypeLabel?: string }
): boolean {
  return isStrictConflictClassType(current.classTypeCode, current.classTypeLabel) !== isStrictConflictClassType(other.classTypeCode, other.classTypeLabel);
}

function conflictIncludesMixedTypeRule(conflict: ConflictResult): boolean {
  return conflict.conflicts.some((item) => item.reason.includes(MIXED_CLASS_TYPE_CONFLICT_MESSAGE));
}

export default function SynchroSPage() {
  const router = useRouter();
  const [roleView, setRoleView] = useState<RoleView>("student");
  const [mainTab, setMainTab] = useState<MainTab>("student");
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
  const [showIntroPage, setShowIntroPage] = useState(true);
  const [timetableViewMode, setTimetableViewMode] = useState<TimetableViewMode>("detailed");
  const [refreshingData, setRefreshingData] = useState(false);
  const [showStudentPicker, setShowStudentPicker] = useState(false);
  const [showInstructorPicker, setShowInstructorPicker] = useState(false);
  const [savingInstructorDaysOff, setSavingInstructorDaysOff] = useState(false);
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
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [groupsHydrated, setGroupsHydrated] = useState(false);
  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState>({
    open: false,
    title: "",
    message: ""
  });
  const [deleteGroupDialog, setDeleteGroupDialog] = useState<DeleteGroupDialogState>({
    open: false,
    groupId: null,
    groupName: "",
    submitting: false
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
  const selectedInstructorOption = useMemo(
    () => instructors.find((item) => item.id === selectedInstructorId) ?? null,
    [instructors, selectedInstructorId]
  );
  const selectedInstructorDaysOff = useMemo(
    () => normalizeDaysOff(selectedInstructorOption?.daysOff),
    [selectedInstructorOption]
  );
  const overviewInstructorGroups = useMemo(() => {
    const subjectOrder = ["국어", "수학", "영어", "사탐", "과학", "논술", "입시", "기타"];
    const normalizeSubjectLabel = (value?: string) => {
      const raw = (value ?? "").trim();
      if (!raw) return "기타";
      if (raw.includes("사회") || raw.includes("사탐")) return "사탐";
      if (raw.includes("국어")) return "국어";
      if (raw.includes("수학")) return "수학";
      if (raw.includes("영어")) return "영어";
      if (raw.includes("과학")) return "과학";
      if (raw.includes("논술")) return "논술";
      if (raw.includes("입시")) return "입시";
      return raw;
    };

    const grouped = new Map<string, SelectOption[]>();
    for (const instructor of instructors) {
      const key = normalizeSubjectLabel(instructor.secondary);
      const bucket = grouped.get(key) ?? [];
      bucket.push(instructor);
      grouped.set(key, bucket);
    }

    return [...grouped.entries()]
      .sort((a, b) => {
        const aIndex = subjectOrder.indexOf(a[0]);
        const bIndex = subjectOrder.indexOf(b[0]);
        if (aIndex >= 0 && bIndex >= 0 && aIndex !== bIndex) return aIndex - bIndex;
        if (aIndex >= 0) return -1;
        if (bIndex >= 0) return 1;
        return a[0].localeCompare(b[0], "ko");
      })
      .map(([subject, items]) => ({
        subject,
        items: [...items].sort((a, b) => a.name.localeCompare(b.name, "ko"))
      }));
  }, [instructors]);
  const currentTargetId = roleView === "student" ? selectedStudentId : selectedInstructorId;
  const currentTargetLabel = roleView === "student" ? selectedStudentLabel : selectedInstructorLabel;
  const profileTitle = roleView === "student" ? "학생 프로필" : "강사 프로필";
  const profileName = roleView === "student" ? selectedStudentLabel : selectedInstructorLabel;
  const profileSecondary = roleView === "student" ? selectedStudentSecondary : selectedInstructorSecondary;
  const profileAccentClass =
    roleView === "student"
      ? "from-emerald-400/18 via-white/30 to-teal-300/12 text-emerald-700"
      : "from-sky-400/18 via-white/30 to-indigo-300/12 text-sky-700";
  const profileInitial = (profileName === "학생 선택" || profileName === "강사 선택" ? roleView === "student" ? "학" : "강" : profileName)
    .trim()
    .charAt(0);
  const getInstructorDaysOff = useCallback(
    (instructorId: string): Weekday[] => normalizeDaysOff(instructors.find((item) => item.id === instructorId)?.daysOff),
    [instructors]
  );
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
    const activeStudentGroups = timetableGroups.filter((group) => group.roleView === "student" && group.isActive);
    const isForSelectedInstructor = (event: ScheduleEvent) => {
      if (event.instructorId === selectedInstructorId) return true;
      if (!selectedInstructorKey) return false;
      return normalizePersonName(event.instructorName) === selectedInstructorKey;
    };

    const liveInstructorEvents = filteredEvents.filter(isForSelectedInstructor);
    if (activeStudentGroups.length === 0) return liveInstructorEvents;

    const merged = activeStudentGroups
      .flatMap((group) => {
        const snapshot = (group.snapshotEvents ?? []).filter(isForSelectedInstructor);
        const snapshotKeys = new Set(snapshot.map((event) => `${event.id}:${event.classDate}`));
        const liveLinked = liveInstructorEvents.filter(
          (event) => group.classIds.includes(event.id) && !snapshotKeys.has(`${event.id}:${event.classDate}`)
        );
        return [...snapshot, ...liveLinked];
      })
      .concat(liveInstructorEvents);

    const dedup = new Map<string, ScheduleEvent>();
    for (const event of merged) {
      const key = [
        event.classDate,
        event.weekday,
        event.startTime,
        event.endTime,
        normalizeLookupToken(event.subjectCode),
        normalizeLookupToken(event.classTypeCode),
        normalizePersonName(event.instructorName)
      ].join("::");
      const existing = dedup.get(key);
      if (!existing) {
        dedup.set(key, event);
        continue;
      }

      const mergedStudentIds = Array.from(new Set([...(existing.studentIds ?? []), ...(event.studentIds ?? [])]));
      const mergedStudentNames = Array.from(new Set([...(existing.studentNames ?? []), ...(event.studentNames ?? [])]));
      dedup.set(key, {
        ...existing,
        studentIds: mergedStudentIds,
        studentNames: mergedStudentNames
      });
    }
    return [...dedup.values()];
  }, [filteredEvents, roleView, selectedInstructorId, selectedInstructorLabel, timetableGroups]);
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
    if (roleView === "instructor" && activeStudentEventsForInstructor.length > 0) {
      // 강사 탭은 라이브 DB 결과를 기준으로, 활성 학생 그룹 스냅샷을 보정해서 합본을 표시한다.
      return activeStudentEventsForInstructor;
    }

    const preferredGroup = selectedGroup ?? activeGroup;
    if (preferredGroup) {
      if (preferredGroup.isActive) {
        return filteredEvents;
      }
      const snapshot = preferredGroup.snapshotEvents ?? [];
      const hasDraftSnapshot = snapshot.some((event) => event.id.startsWith("draft-"));
      if (snapshot.length > 0 && !hasDraftSnapshot) {
        return snapshot;
      }
      const idSet = new Set(preferredGroup.classIds);
      return filteredEvents.filter((event) => idSet.has(event.id));
    }
    if (draftEvents.length > 0) return draftEvents;
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

  const handleMainTabChange = useCallback(
    (next: MainTab) => {
      setMainTab(next);
      setSearchKeyword("");
      setShowStudentPicker(false);
      setShowInstructorPicker(false);

      if (next === "overview") {
        setRoleView("instructor");
        if (!selectedInstructorId && instructors.length > 0) {
          setSelectedInstructorId(instructors[0]!.id);
        }
        return;
      }

      setRoleView(next);
    },
    [instructors, selectedInstructorId]
  );

  const handleToggleInstructorDayOff = useCallback(
    async (weekday: Weekday) => {
      if (!selectedInstructorId) {
        setConflictDialog({ open: true, title: "강사 선택 필요", message: "먼저 휴무일을 설정할 강사를 선택해 주세요." });
        return;
      }

      const currentDaysOff = getInstructorDaysOff(selectedInstructorId);
      const nextDaysOff = currentDaysOff.includes(weekday)
        ? currentDaysOff.filter((value) => value !== weekday)
        : [...currentDaysOff, weekday].sort((a, b) => a - b);

      setSavingInstructorDaysOff(true);
      setError(null);

      try {
        const res = await fetch(`/api/instructors/${selectedInstructorId}/days-off`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ daysOff: nextDaysOff })
        });

        if (res.status === 401) {
          moveToLogin();
          return;
        }

        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "강사 휴무일 저장에 실패했습니다.");
        }

        const payload = (await res.json().catch(() => ({}))) as { daysOff?: Weekday[] };
        const resolvedDaysOff = normalizeDaysOff(payload.daysOff ?? nextDaysOff);
        setInstructors((prev) =>
          prev.map((item) =>
            item.id === selectedInstructorId
              ? {
                  ...item,
                  daysOff: resolvedDaysOff
                }
              : item
          )
        );

        const weekdayLabel = DAYS.find((day) => day.key === weekday)?.label ?? `${weekday}`;
        setNotice(
          resolvedDaysOff.includes(weekday)
            ? `${selectedInstructorLabel} 강사의 ${weekdayLabel} 휴무를 저장했습니다.`
            : `${selectedInstructorLabel} 강사의 ${weekdayLabel} 휴무를 해제했습니다.`
        );
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "강사 휴무일 저장에 실패했습니다.");
      } finally {
        setSavingInstructorDaysOff(false);
      }
    },
    [getInstructorDaysOff, moveToLogin, selectedInstructorId, selectedInstructorLabel]
  );

  const buildUndoState = useCallback(
    (label: string, restoreMove?: UndoState["restoreMove"]): UndoState => ({
      label,
      events: cloneEvents(events),
      notionInput,
      notionPreview,
      parsedNotionItems: cloneParsedNotionItems(parsedNotionItems),
      timetableGroups: cloneTimetableGroups(timetableGroups),
      selectedGroupId,
      restoreMove
    }),
    [events, notionInput, notionPreview, parsedNotionItems, selectedGroupId, timetableGroups]
  );

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

    setSelectedInstructorId((prev) => (data.instructors.some((item) => item.id === prev) ? prev : ""));
    setSelectedStudentId((prev) => (data.students.some((item) => item.id === prev) ? prev : ""));

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

  const handleHardRefreshData = useCallback(async () => {
    if (refreshingData) return;

    setRefreshingData(true);
    setError(null);
    setNotice(null);

    try {
      router.refresh();
      await Promise.all([loadOptions(), loadWeek({ silent: true })]);
      setNotice("최신 DB 기준으로 데이터를 새로고침했습니다.");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "데이터 새로고침에 실패했습니다.");
    } finally {
      setRefreshingData(false);
    }
  }, [loadOptions, loadWeek, refreshingData, router]);

  const handleUndoLastChange = useCallback(async () => {
    if (!undoState) return;

    const snapshot = undoState;
    setUndoState(null);
    setEvents(cloneEvents(snapshot.events));
    setNotionInput(snapshot.notionInput);
    setNotionPreview(snapshot.notionPreview);
    setParsedNotionItems(cloneParsedNotionItems(snapshot.parsedNotionItems));
    setTimetableGroups(cloneTimetableGroups(snapshot.timetableGroups));
    setSelectedGroupId(snapshot.selectedGroupId);
    setError(null);
    setNotice(`${snapshot.label} 변경을 되돌렸습니다.`);

    if (!snapshot.restoreMove) {
      return;
    }

    const res = await fetch(`/api/schedules/${snapshot.restoreMove.classId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weekday: snapshot.restoreMove.weekday,
        startTime: snapshot.restoreMove.startTime,
        weekStart: snapshot.restoreMove.weekStart,
        studentId: snapshot.restoreMove.studentId
      })
    });

    if (res.status === 401) {
      moveToLogin();
      return;
    }

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "되돌리기 저장에 실패했습니다.");
      await loadWeek({ silent: true });
      return;
    }

    await loadWeek({ silent: true });
  }, [loadWeek, moveToLogin, undoState]);

  const handleCreate = useCallback(
    async (input: ScheduleFormInput) => {
      const normalizedInput: ScheduleFormInput = {
        ...input,
        note: input.note.trim(),
        activeFrom: input.scheduleMode === "recurring" ? weekStart : undefined,
        classDate: input.scheduleMode === "one_off" ? input.classDate : undefined,
        weekday: input.scheduleMode === "recurring" ? input.weekday ?? initialCell?.weekday ?? dayOf(weekStart) : undefined
      };
      const targetWeekday =
        normalizedInput.scheduleMode === "recurring"
          ? (normalizedInput.weekday as Weekday)
          : dayOf(normalizedInput.classDate as string);
      const immediateOverlap = events.find(
        (event) =>
          event.instructorId === normalizedInput.instructorId &&
          event.weekday === targetWeekday &&
          hasTimeOverlap(normalizedInput.startTime, normalizedInput.endTime, event.startTime, event.endTime) &&
          hasMixedClassTypeConflict(
            {
              classTypeCode: normalizedInput.classTypeCode
            },
            event
          )
      );

      if (getInstructorDaysOff(normalizedInput.instructorId).includes(targetWeekday)) {
        setConflictDialog({
          open: true,
          title: "휴무일 안내",
          message: "해당 강사의 휴무일입니다"
        });
        return;
      }

      if (immediateOverlap) {
        setConflictDialog({
          open: true,
          title: "혼합 배정 불가",
          message: MIXED_CLASS_TYPE_CONFLICT_MESSAGE
        });
        return;
      }

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
        if (payload.error?.includes("해당 강사의 휴무일입니다")) {
          setConflictDialog({
            open: true,
            title: "휴무일 안내",
            message: "해당 강사의 휴무일입니다"
          });
          return;
        }
        throw new Error(payload.error ?? "Failed to check conflicts");
      }

      const conflict = (await conflictRes.json()) as ConflictResult;

      if (conflict.hasConflict) {
        if (conflictIncludesMixedTypeRule(conflict)) {
          setConflictDialog({
            open: true,
            title: "혼합 배정 불가",
            message: MIXED_CLASS_TYPE_CONFLICT_MESSAGE
          });
          return;
        }
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
        if (conflictIncludesMixedTypeRule(payload.conflict)) {
          setConflictDialog({
            open: true,
            title: "혼합 배정 불가",
            message: MIXED_CLASS_TYPE_CONFLICT_MESSAGE
          });
          return;
        }
        throw new Error(`시간표 충돌로 저장이 차단되었습니다.\n${getConflictMessage(payload.conflict)}`);
      }

      if (!createRes.ok) {
        const payload = (await createRes.json().catch(() => ({}))) as { error?: string };
        if (payload.error?.includes("해당 강사의 휴무일입니다")) {
          setConflictDialog({
            open: true,
            title: "휴무일 안내",
            message: "해당 강사의 휴무일입니다"
          });
          return;
        }
        throw new Error(payload.error ?? "Failed to create schedule");
      }

      const created = (await createRes.json().catch(() => ({}))) as { classId?: string };
      if (created.classId && normalizedInput.note) {
        setMemoByEventId((prev) => ({ ...prev, [created.classId as string]: normalizedInput.note }));
      }

      await loadWeek();
    },
    [events, getInstructorDaysOff, initialCell?.weekday, loadWeek, moveToLogin, weekStart]
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
            setUndoState(buildUndoState("드래그 이동"));
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

        if (getInstructorDaysOff(targetEvent.instructorId).includes(ctx.weekday)) {
          setConflictDialog({
            open: true,
            title: "휴무일 안내",
            message: "해당 강사의 휴무일입니다"
          });
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
            if (movingIsStrict !== existingIsStrict) {
              setConflictDialog({
                open: true,
                title: "혼합 배정 불가",
                message: MIXED_CLASS_TYPE_CONFLICT_MESSAGE
              });
              return;
            }
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
        const undoSnapshot = buildUndoState(
          "드래그 이동",
          isActiveEditing
            ? {
                classId: targetClassId,
                weekday: targetEvent.weekday,
                startTime: targetEvent.startTime,
                weekStart,
                studentId: roleView === "student" ? selectedStudentId || undefined : undefined
              }
            : undefined
        );
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
          setUndoState(undoSnapshot);
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
        } else {
          setUndoState(undoSnapshot);
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
          body: JSON.stringify({
            weekday: ctx.weekday,
            startTime: ctx.startTime,
            weekStart,
            studentId: roleView === "student" ? selectedStudentId || undefined : undefined
          })
        });

        if (res.status === 401) {
          rollbackMove();
          moveToLogin();
          return;
        }

        if (res.status === 409) {
          const payload = (await res.json()) as { conflict: ConflictResult };
          rollbackMove();
          if (conflictIncludesMixedTypeRule(payload.conflict)) {
            setConflictDialog({
              open: true,
              title: "혼합 배정 불가",
              message: MIXED_CLASS_TYPE_CONFLICT_MESSAGE
            });
            return;
          }
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
          if (payload.error?.includes("해당 강사의 휴무일입니다")) {
            setConflictDialog({
              open: true,
              title: "휴무일 안내",
              message: "해당 강사의 휴무일입니다"
            });
            return;
          }
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
      buildUndoState,
      getInstructorDaysOff,
      loadWeek,
      moveToLogin,
      selectedGroup,
      selectedInstructorLabel,
      selectedStudentId,
      students,
      timetableGroups,
      roleView,
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
    setUndoState(buildUndoState("노션 반영"));
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
  }, [buildUndoState, instructors, notionTextValue, selectedInstructorId]);

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
    const instructorIndex = instructors.map((entry) => ({
      id: entry.id,
      token: normalize(entry.name)
    }));
    const instructorExactMap = new Map(instructorIndex.map((entry) => [entry.token, entry.id]));
    const subjectResolutionCache = new Map<string, SubjectOptionWithColor | null>();
    const classTypeResolutionCache = new Map<string, ClassTypeOption | null>();
    const findInstructorId = (name: string): string => {
      const aliased = normalizeInstructorAlias(name);
      const target = normalize(aliased);
      if (!target) return "";
      const exact = instructorExactMap.get(target);
      if (exact) return exact;
      const partial = instructorIndex.find((entry) => entry.token.includes(target) || target.includes(entry.token));
      return partial?.id ?? "";
    };
    const resolveSubjectCached = (rawLabel: string) => {
      const key = normalize(rawLabel);
      if (subjectResolutionCache.has(key)) {
        return subjectResolutionCache.get(key) ?? undefined;
      }
      const resolved = resolveSubjectOption(rawLabel, subjects) ?? null;
      subjectResolutionCache.set(key, resolved);
      return resolved ?? undefined;
    };
    const resolveClassTypeCached = (rawLabel: string) => {
      const key = normalize(rawLabel);
      if (classTypeResolutionCache.has(key)) {
        return classTypeResolutionCache.get(key) ?? undefined;
      }
      const resolved = resolveClassTypeOption(rawLabel, classTypes) ?? null;
      classTypeResolutionCache.set(key, resolved);
      return resolved ?? undefined;
    };
    let created = 0;
    let existing = 0;
    let skipped = 0;
    const importedClassIds: string[] = [];
    const memoUpdates: Record<string, string> = {};
    const conflictDetails: string[] = [];
    const dayOffDetails: string[] = [];
    const noSubjectDetails: string[] = [];
    const skipReasons: Record<string, number> = {
      noInstructor: 0,
      noStudent: 0,
      noSubject: 0,
      noClassType: 0,
      daysOff: 0,
      conflict: 0,
      requestFailed: 0
    };

    try {
      const preparedItems: { item: ParsedNotionItem; payload: ScheduleFormInput }[] = [];

      for (let idx = 0; idx < parsedNotionItems.length; idx += 1) {
        const item = parsedNotionItems[idx] as ParsedNotionItem;
        const subject = resolveSubjectCached(item.subjectLabel);
        const classType = resolveClassTypeCached(item.classTypeLabel);

        const instructorId = item.instructorName ? findInstructorId(item.instructorName) : selectedInstructorId;
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
          continue;
        }
        if (!classType) {
          skipped += 1;
          skipReasons.noClassType += 1;
          continue;
        }
        if (getInstructorDaysOff(instructorId).includes(item.weekday)) {
          skipped += 1;
          skipReasons.daysOff += 1;
          const weekdayLabel = DAYS.find((day) => day.key === item.weekday)?.label ?? String(item.weekday);
          const instructorLabel = instructors.find((entry) => entry.id === instructorId)?.name ?? item.instructorName ?? "선택 강사";
          dayOffDetails.push(
            `[${instructorLabel}] 강사님의 휴무일(${weekdayLabel})에는 수업을 배정할 수 없습니다. 해당 항목은 저장되지 않았습니다. - ${toKoreanHourRange(item.startTime)} (${item.rawText})`
          );
          continue;
        }

        preparedItems.push({
          item,
          payload: {
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
          }
        });
      }

      let processedCount = skipped;
      setImportProgress((prev) => ({ ...prev, done: processedCount }));

      const batchSize = 12;
      for (let idx = 0; idx < preparedItems.length; idx += batchSize) {
        const batch = preparedItems.slice(idx, idx + batchSize);
        const createRes = await fetch("/api/schedules/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: batch.map((entry) => entry.payload)
          })
        });

        if (createRes.status === 401) {
          moveToLogin();
          return;
        }

        const payload = (await createRes.json().catch(() => ({}))) as {
          error?: string;
          results?: {
            status?: string;
            classId?: string;
            conflict?: { conflicts?: { reason?: string; classId?: string }[] };
          }[];
        };

        if (!createRes.ok) {
          if ((payload.error ?? "").includes("해당 강사의 휴무일입니다")) {
            batch.forEach((entry) => {
              skipped += 1;
              skipReasons.daysOff += 1;
              const weekdayLabel = DAYS.find((day) => day.key === entry.item.weekday)?.label ?? String(entry.item.weekday);
              const instructorLabel =
                instructors.find((item) => item.id === entry.payload.instructorId)?.name ?? entry.item.instructorName ?? "선택 강사";
              dayOffDetails.push(
                `[${instructorLabel}] 강사님의 휴무일(${weekdayLabel})에는 수업을 배정할 수 없습니다. 해당 항목은 저장되지 않았습니다. - ${toKoreanHourRange(entry.item.startTime)} (${entry.item.rawText})`
              );
            });
            processedCount += batch.length;
            setImportProgress((prev) => ({ ...prev, done: processedCount }));
            continue;
          }
          throw new Error(payload.error ?? "시간표 저장 요청에 실패했습니다.");
        }

        const results = Array.isArray(payload.results) ? payload.results : [];

        batch.forEach((entry, batchIndex) => {
          const result = results[batchIndex];
          if (!result) {
            skipped += 1;
            skipReasons.requestFailed += 1;
            return;
          }

          if (result.classId) {
            importedClassIds.push(result.classId);
            memoUpdates[result.classId] = entry.payload.note;
          }

          if (result.status === "existing") {
            existing += 1;
            return;
          }

          if (result.status === "conflict") {
            skipped += 1;
            skipReasons.conflict += 1;
            const weekdayLabel = DAYS.find((day) => day.key === entry.item.weekday)?.label ?? String(entry.item.weekday);
            const slotLabel = `${weekdayLabel} ${toKoreanHourRange(entry.item.startTime)}`;
            const conflictReason =
              result.conflict?.conflicts?.map((conflict) => conflict.reason).filter(Boolean).join(", ") ?? "시간표 충돌";
            conflictDetails.push(`- ${slotLabel} (${entry.item.rawText}): ${conflictReason}`);
            return;
          }

          if (result.status === "created" || result.status === "enrolled") {
            created += 1;
            return;
          }

          skipped += 1;
          skipReasons.requestFailed += 1;
        });

        processedCount += batch.length;
        setImportProgress((prev) => ({ ...prev, done: processedCount }));
      }

      if (Object.keys(memoUpdates).length > 0) {
        setMemoByEventId((prev) => ({ ...prev, ...memoUpdates }));
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

      if (conflictDetails.length > 0 || dayOffDetails.length > 0 || noSubjectDetails.length > 0) {
        const lines: string[] = [];
        let title = "시간표 저장 경고";
        if (conflictDetails.length > 0) {
          title = "시간표 충돌 경고";
          lines.push("노션 시간표 저장 중 충돌이 발생했습니다.");
          lines.push(...conflictDetails);
        }
        if (dayOffDetails.length > 0) {
          if (conflictDetails.length === 0) {
            title = "휴무일 배정 경고";
          }
          if (lines.length > 0) {
            lines.push("");
          }
          lines.push(`휴무일 충돌 ${dayOffDetails.length}건`);
          lines.push(...dayOffDetails.slice(0, 12).map((item) => `- ${item}`));
          if (dayOffDetails.length > 12) {
            lines.push(`- 외 ${dayOffDetails.length - 12}건`);
          }
        }
        if (noSubjectDetails.length > 0) {
          if (conflictDetails.length === 0) {
            title = dayOffDetails.length > 0 ? title : "과목 매핑 경고";
          }
          if (lines.length > 0) {
            lines.push("");
          }
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
    moveToLogin,
    parsedNotionItems,
    selectedInstructorId,
    selectedStudentId,
    subjects,
    currentTargetId,
    currentTargetLabel,
    displayEvents,
    getInstructorDaysOff,
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

  const handleOpenDeleteGroupDialog = useCallback(
    (groupId: string) => {
      const targetGroup = timetableGroups.find((group) => group.id === groupId);
      if (!targetGroup) return;
      setDeleteGroupDialog({
        open: true,
        groupId,
        groupName: targetGroup.name,
        submitting: false
      });
    },
    [timetableGroups]
  );

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      const targetGroup = timetableGroups.find((group) => group.id === groupId);
      if (!targetGroup) return;

      setDeleteGroupDialog((prev) => ({ ...prev, submitting: true }));

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
          setDeleteGroupDialog({ open: false, groupId: null, groupName: "", submitting: false });
          moveToLogin();
          return;
        }

        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "시간표 삭제에 실패했습니다.");
        }
      } catch (deleteError) {
        setDeleteGroupDialog((prev) => ({ ...prev, submitting: false }));
        setError(deleteError instanceof Error ? deleteError.message : "시간표 삭제에 실패했습니다.");
        return;
      }

      setDeleteGroupDialog({ open: false, groupId: null, groupName: "", submitting: false });
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
    if (mainTab === "overview" && !selectedInstructorId && instructors.length > 0) {
      setSelectedInstructorId(instructors[0]!.id);
    }
  }, [instructors, mainTab, selectedInstructorId]);

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
        className={`relative z-[80] overflow-visible rounded-[32px] border border-white/40 bg-white/30 p-4 shadow-xl shadow-cyan-500/10 backdrop-blur-md ${headerGlowClass}`}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(110,231,183,0.22),transparent_28%),radial-gradient(circle_at_18%_18%,rgba(147,197,253,0.18),transparent_24%)]" />
        <div className="relative space-y-4">
          <div className="grid gap-3 xl:grid-cols-[1.2fr_minmax(320px,0.9fr)_auto]">
            <div className="rounded-[28px] border border-white/45 bg-white/35 p-4 shadow-lg shadow-slate-900/5 backdrop-blur-md">
              <div className="flex items-center gap-4">
                <img
                  src="https://raw.githubusercontent.com/whdtjd5294/whdtjd5294.github.io/main/sedu_logo.png"
                  alt="SEDU 로고"
                  className="h-14 w-14 shrink-0 object-contain"
                />
                <div>
                  <div className="flex flex-wrap items-end gap-3">
                    <h1 className="text-[2.35rem] font-black tracking-tight text-slate-900">Synchro-S</h1>
                    <span className="mb-1 rounded-full border border-white/50 bg-white/35 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">
                      Timetable DB
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-500">{weekStart} ~ {weekEnd} | 입력 일시/진행현황 자동 기록</p>
                </div>
              </div>
            </div>

            <label className="flex min-h-[88px] items-center gap-3 rounded-[28px] border border-white/45 bg-white/35 px-5 shadow-lg shadow-slate-900/5 backdrop-blur-md">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/45 bg-white/55 text-slate-500 shadow-inner shadow-white/40">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="11" cy="11" r="6" />
                  <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Global Search</p>
                <input
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  placeholder={showIntroPage ? "강사/학생을 미리 검색해 둘 수 있습니다." : "강사/학생 검색"}
                  className="mt-1 w-full bg-transparent text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400"
                />
              </div>
            </label>

            <div className="flex flex-wrap items-center justify-end gap-2 rounded-[28px] border border-white/45 bg-white/30 p-3 shadow-lg shadow-slate-900/5 backdrop-blur-md">
              <button
                type="button"
                onClick={() => setShowIntroPage(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/45 bg-white/45 px-4 py-2 text-xs font-bold text-slate-700 shadow-sm shadow-white/20 hover:bg-white/60"
              >
                <span className="h-2 w-2 rounded-full bg-sky-400" />
                앱 소개
              </button>
              <div className="inline-flex rounded-2xl border border-white/55 bg-white/35 p-1 shadow-[0_12px_34px_rgba(31,38,135,0.16)] backdrop-blur-xl">
                {([
                  { key: "overview", label: "전체 요약" },
                  { key: "instructor", label: "강사" },
                  { key: "student", label: "학생" }
                ] as const).map((tab) => {
                  const active = mainTab === tab.key;
                  const accentClass =
                    tab.key === "overview"
                      ? "shadow-[inset_0_-2px_0_rgba(99,102,241,0.42),0_7px_16px_rgba(99,102,241,0.22)]"
                      : tab.key === "instructor"
                        ? "shadow-[inset_0_-2px_0_rgba(59,130,246,0.45),0_7px_16px_rgba(59,130,246,0.24)]"
                        : "shadow-[inset_0_-2px_0_rgba(16,185,129,0.45),0_7px_16px_rgba(16,185,129,0.24)]";
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => handleMainTabChange(tab.key)}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        active ? `bg-white/90 text-slate-900 ${accentClass}` : "text-slate-700 hover:bg-white/70"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="inline-flex items-center gap-2 rounded-full border border-white/45 bg-white/35 px-4 py-2 text-xs font-bold text-slate-700 shadow-sm shadow-white/20 hover:bg-white/55"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" strokeLinecap="round" />
                  <path d="M10 16l4-4-4-4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 12H4" strokeLinecap="round" />
                </svg>
                로그아웃
              </button>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[auto_auto_1fr_auto]">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-[24px] border border-white/45 bg-white/30 p-1.5 shadow-lg shadow-slate-900/5 backdrop-blur-md">
              <button
                type="button"
                className="rounded-2xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-white/45"
                onClick={() => setWeekStart((prev) => shiftDate(prev, -7))}
              >
                이전 주
              </button>
              <button
                type="button"
                className="rounded-2xl bg-white/65 px-4 py-2 text-xs font-black text-slate-800 shadow-sm"
                onClick={() => setWeekStart(mondayOfCurrentWeek())}
              >
                이번 주
              </button>
              <button
                type="button"
                className="rounded-2xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-white/45"
                onClick={() => setWeekStart((prev) => shiftDate(prev, 7))}
              >
                다음 주
              </button>
            </div>

            <button
              type="button"
              disabled={refreshingData}
              onClick={() => void handleHardRefreshData()}
              className="inline-flex items-center justify-center gap-2 rounded-[24px] border border-white/45 bg-white/36 px-4 py-2 text-xs font-bold text-slate-700 shadow-lg shadow-slate-900/5 backdrop-blur-md transition hover:bg-white/56 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 ${refreshingData ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
              >
                <path d="M20 12a8 8 0 1 1-2.34-5.66" strokeLinecap="round" />
                <path d="M20 4v6h-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {refreshingData ? "새로고침 중..." : "데이터 새로고침"}
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/45 bg-white/35 px-3 py-2 text-xs font-bold text-blue-700 shadow-sm shadow-blue-500/10 backdrop-blur-md hover:bg-white/55"
                onClick={() => void handleCopyForNotion()}
              >
                <span className="h-2 w-2 rounded-full bg-blue-400" />
                노션 붙여넣기 복사
              </button>
              <button
                type="button"
                disabled={syncingSheets}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/45 bg-white/35 px-3 py-2 text-xs font-bold text-emerald-700 shadow-sm shadow-emerald-500/10 backdrop-blur-md hover:bg-white/55 disabled:opacity-60"
                onClick={() => void handleSyncSheets()}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                {syncingSheets ? "시트 동기화 중..." : "명단 동기화"}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/45 bg-white/35 px-3 py-2 text-xs font-bold text-violet-700 shadow-sm shadow-violet-500/10 backdrop-blur-md hover:bg-white/55"
                onClick={openSubjectSettingsModal}
              >
                <span className="h-2 w-2 rounded-full bg-violet-400" />
                과목 코드 설정
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className={`min-w-[240px] rounded-[26px] border border-white/45 bg-gradient-to-br ${showIntroPage ? "from-slate-100/65 via-white/40 to-sky-100/45 text-slate-500" : profileAccentClass} p-3 shadow-lg shadow-slate-900/5 backdrop-blur-md`}>
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/55 bg-white/55 text-base font-black text-slate-800 shadow-inner shadow-white/40">
                    {showIntroPage ? "홈" : profileInitial}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em]">
                      {showIntroPage ? "Home Guide" : mainTab === "overview" ? "Overview Dashboard" : profileTitle}
                    </p>
                    <p className="truncate text-lg font-black text-slate-900">
                      {showIntroPage ? "운영 가이드 홈화면" : mainTab === "overview" ? "강사 스케줄 모아보기" : profileName}
                    </p>
                    <p className="truncate text-xs font-semibold text-slate-500">
                      {showIntroPage
                        ? "먼저 안내를 확인한 뒤 시간표 작업을 시작하세요."
                        : mainTab === "overview"
                          ? "등록된 강사를 빠르게 넘겨 보며 심플 시간표를 조회합니다."
                          : profileSecondary || "상세 정보 없음"}
                    </p>
                  </div>
                </div>
                {!showIntroPage && mainTab !== "overview" && roleView === "instructor" && selectedInstructorId ? (
                  <div className="mt-3 rounded-2xl border border-white/45 bg-white/35 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Days Off</p>
                      <span className="text-[10px] font-semibold text-slate-500">
                        {savingInstructorDaysOff ? "저장 중..." : selectedInstructorDaysOff.length > 0 ? "회색 열로 표시" : "설정 없음"}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-7 gap-1">
                      {DAYS.map((day) => {
                        const active = selectedInstructorDaysOff.includes(day.key);
                        return (
                          <button
                            key={`day-off-${day.key}`}
                            type="button"
                            disabled={savingInstructorDaysOff}
                            onClick={() => void handleToggleInstructorDayOff(day.key)}
                            className={`rounded-2xl border px-0 py-1.5 text-[11px] font-bold transition ${
                              active
                                ? "border-slate-300 bg-slate-700/80 text-white shadow-[0_8px_20px_rgba(71,85,105,0.22)]"
                                : "border-white/50 bg-white/55 text-slate-600 hover:bg-white/70"
                            } disabled:opacity-60`}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              {!showIntroPage && mainTab !== "overview" ? (
                roleView === "instructor" ? (
                  <div className="relative z-[120]">
                    <button
                      type="button"
                      onClick={() => {
                        setShowInstructorPicker((prev) => !prev);
                        setShowStudentPicker(false);
                      }}
                      className="rounded-full border border-white/45 bg-white/40 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-md hover:bg-white/55"
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
                  <div className="relative z-[120]">
                    <button
                      type="button"
                      onClick={() => {
                        setShowStudentPicker((prev) => !prev);
                        setShowInstructorPicker(false);
                      }}
                      className="rounded-full border border-white/45 bg-white/40 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-md hover:bg-white/55"
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
                )
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {!showIntroPage && mainTab !== "overview" ? (
        <>
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
          <button
            type="button"
            disabled={!undoState || importingNotion}
            onClick={() => void handleUndoLastChange()}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            되돌리기
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
          <div className="mb-3 flex items-center justify-between rounded-2xl border border-white/55 bg-white/55 px-3 py-2 shadow-sm backdrop-blur-md">
            <div>
              <p className="text-sm font-black text-slate-800">시간표 보기 모드</p>
              <p className="text-[11px] font-semibold text-slate-500">상세 블록과 강사별 심플 점 표시를 전환할 수 있습니다.</p>
            </div>
            <div className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 p-1">
              <button
                type="button"
                onClick={() => setTimetableViewMode("detailed")}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                  timetableViewMode === "detailed" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                상세
              </button>
              <button
                type="button"
                onClick={() => setTimetableViewMode("summary")}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                  timetableViewMode === "summary" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                심플 뷰
              </button>
            </div>
          </div>
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500">로딩 중...</div>
          ) : (
            <TimetableGrid
              roleView={roleView}
              days={DAYS}
              timeSlots={TIME_SLOTS}
              events={displayEvents}
              daysOff={roleView === "instructor" ? selectedInstructorDaysOff : []}
              viewMode={timetableViewMode}
              highlightCellTints={activeHighlightCellTints}
              onEventMove={roleView === "student" ? handleMoveSchedule : undefined}
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
                          handleOpenDeleteGroupDialog(group.id);
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
        </>
      ) : null}

      {!showIntroPage && mainTab === "overview" ? (
        <>
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
          <section className="rounded-[30px] border border-white/50 bg-white/40 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-md">
            <div className="rounded-[26px] border border-white/55 bg-white/45 p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Instructor Overview</p>
                  <p className="mt-1 text-xl font-black text-slate-900">강사 스케줄 모아보기</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">원장/실무자가 강사별 심플 시간표를 빠르게 넘겨보는 조회 전용 화면입니다.</p>
                </div>
                <div className="rounded-2xl border border-white/60 bg-white/70 px-4 py-2 text-right">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Selected</p>
                  <p className="text-sm font-black text-slate-800">{selectedInstructorLabel}</p>
                </div>
              </div>
              <div className="mt-4 rounded-3xl border border-white/55 bg-white/40 p-3">
                <div className="grid gap-3 xl:grid-cols-2">
                  {overviewInstructorGroups.map((group) => (
                    <div
                      key={`overview-subject-${group.subject}`}
                      className="rounded-2xl border border-white/60 bg-white/55 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-100/85 px-2.5 py-1 text-[11px] font-black tracking-[0.16em] text-slate-600">
                          {group.subject}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-400">{group.items.length}명</span>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {group.items.map((instructor) => {
                          const active = instructor.id === selectedInstructorId;
                          return (
                            <button
                              key={`overview-chip-${instructor.id}`}
                              type="button"
                              onClick={() => setSelectedInstructorId(instructor.id)}
                              className={`rounded-2xl border px-3 py-1.5 text-sm font-black leading-none transition ${
                                active
                                  ? "border-sky-300 bg-[linear-gradient(135deg,rgba(37,99,235,0.92),rgba(96,165,250,0.84))] text-white shadow-[0_10px_24px_rgba(59,130,246,0.24)]"
                                  : "border-slate-200/80 bg-white/88 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] hover:border-sky-200 hover:bg-sky-50/70 hover:text-sky-700"
                              }`}
                            >
                              {instructor.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_330px]">
              <div>
                {loading ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500">로딩 중...</div>
                ) : (
                  <TimetableGrid
                    roleView="instructor"
                    days={DAYS}
                    timeSlots={TIME_SLOTS}
                    events={displayEvents}
                    daysOff={selectedInstructorDaysOff}
                    viewMode="summary"
                    highlightCellTints={{}}
                    onEventMove={undefined}
                    onCellClick={() => {}}
                  />
                )}
              </div>

              <aside className="rounded-3xl border border-white/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.46),rgba(219,234,254,0.42),rgba(224,231,255,0.4))] p-4 shadow-lg shadow-slate-900/5 backdrop-blur-md">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Quick Read</p>
                <p className="mt-2 text-xl font-black text-slate-900">{selectedInstructorLabel}</p>
                <p className="mt-1 text-sm font-semibold text-slate-500">{selectedInstructorSecondary || "담당 과목 정보 없음"}</p>
                <div className="mt-4 rounded-2xl border border-white/60 bg-white/60 p-4">
                  <p className="text-xs font-bold text-slate-500">이번 주 배치 수업</p>
                  <p className="mt-2 text-3xl font-black text-slate-900">{displayEvents.length}개</p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">심플 뷰 기준으로 동일 시간대는 유형 배지를 중앙에 압축 표시합니다.</p>
                </div>
                <div className="mt-4 rounded-2xl border border-white/60 bg-white/55 p-4">
                  <p className="text-xs font-bold text-slate-500">범례</p>
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <span className="inline-flex min-h-[26px] items-center justify-center rounded-full border border-green-200/70 bg-green-500/80 px-2.5 py-1 text-[11px] font-black text-white">
                        1:1
                      </span>
                      1:1 / 2:1 수업
                    </div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <span className="inline-flex min-h-[26px] items-center justify-center rounded-full border border-blue-200/70 bg-blue-500/80 px-2.5 py-1 text-[11px] font-black text-white">
                        개별정규
                      </span>
                      개별정규 및 다대일 수업
                    </div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <span className="inline-flex rounded-full border border-slate-300 bg-slate-200/80 px-2 py-0.5 text-[11px] font-bold text-slate-700">휴무</span>
                      휴무일 컬럼
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </section>
        </>
      ) : null}

      {showIntroPage ? (
        <section className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
          <div className="rounded-[32px] border border-white/45 bg-white/38 p-6 shadow-xl shadow-slate-900/5 backdrop-blur-md">
            <div className="inline-flex rounded-full border border-sky-200/80 bg-white/55 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] text-sky-700">
              Synchro-S Guide
            </div>
            <h2 className="mt-5 text-4xl font-black tracking-tight text-slate-900">시간표 입력, 그룹 관리, 저장 흐름을 한 화면에서 정리합니다.</h2>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-8 text-slate-500">
              Synchro-S는 강사/학생 시간표 조회, 노션 붙여넣기 반영, DB 저장, 그룹 버전 관리까지 연결하는 운영용 시간표 DB입니다.
              로그인 직후에는 바로 편집보다 홈화면에서 전체 흐름을 확인하고, 필요한 작업으로 진입하는 구성이 더 안전합니다.
            </p>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {[
                ["1", "탭 선택", "강사/학생 기준으로 대상 시야를 먼저 고릅니다."],
                ["2", "노션 반영", "붙여넣은 텍스트를 미리보기로 검수하고 수정합니다."],
                ["3", "DB 저장", "검토한 시간표를 그룹과 함께 서버에 저장합니다."]
              ].map(([step, title, body]) => (
                <div key={step} className="rounded-3xl border border-white/55 bg-white/42 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500 text-sm font-black text-white">{step}</div>
                  <p className="mt-4 text-lg font-black text-slate-800">{title}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{body}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-[28px] border border-white/55 bg-white/35 p-5">
              <p className="text-lg font-black text-slate-800">실무 체크 포인트</p>
              <div className="mt-4 space-y-3">
                {[
                  "강사 탭은 조회 중심이며, 실제 드래그 이동은 학생 탭에서만 수행합니다.",
                  "노션 붙여넣기 후 '시간표에 반영'으로 미리보고, 필요하면 '되돌리기'로 직전 상태를 복구할 수 있습니다.",
                  "저장된 시간표 그룹은 주간 버전 관리용이며, 삭제 전에는 전용 확인 UI가 표시됩니다."
                ].map((item, index) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl bg-white/45 px-4 py-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-black text-white">
                      {index + 1}
                    </span>
                    <p className="text-sm font-semibold leading-6 text-slate-600">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[32px] border border-white/45 bg-[linear-gradient(160deg,rgba(37,99,235,0.88),rgba(59,130,246,0.78),rgba(103,232,249,0.45))] p-6 text-white shadow-xl shadow-blue-500/20 backdrop-blur-md">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-white/70">Quick Infographic</p>
            <div className="mt-5 rounded-[28px] border border-white/20 bg-white/10 p-5">
              <div className="grid grid-cols-[80px_1fr] gap-3 text-[11px] font-bold text-white/85">
                <div className="rounded-2xl bg-white/10 px-3 py-3 text-center">시간</div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-white/10 px-3 py-3 text-center">강사</div>
                  <div className="rounded-2xl bg-white/10 px-3 py-3 text-center">학생</div>
                  <div className="rounded-2xl bg-white/10 px-3 py-3 text-center">저장</div>
                </div>
                {[
                  ["10-11", "조회", "편집", "저장"],
                  ["11-12", "검색", "드래그", "그룹"],
                  ["12-13", "검토", "반영", "복원"]
                ].map((row) => (
                  <Fragment key={row.join("-")}>
                    <div className="rounded-2xl bg-white/10 px-3 py-3 text-center">{row[0]}</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-2xl bg-white/10 px-3 py-3 text-center">{row[1]}</div>
                      <div className="rounded-2xl bg-white/10 px-3 py-3 text-center">{row[2]}</div>
                      <div className="rounded-2xl bg-white/10 px-3 py-3 text-center">{row[3]}</div>
                    </div>
                  </Fragment>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-[26px] border border-white/20 bg-white/10 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/65">주요 버튼</p>
                <div className="mt-4 space-y-3 text-sm font-semibold text-white/90">
                  <p>노션 붙여넣기 복사</p>
                  <p>시간표에 반영</p>
                  <p>DB 저장</p>
                  <p>되돌리기</p>
                </div>
              </div>
              <div className="rounded-[26px] border border-white/20 bg-white/10 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/65">권장 순서</p>
                <p className="mt-4 text-sm font-semibold leading-7 text-white/90">
                  검색으로 대상 확인 → 노션 반영 → 미리보기 검토 → 저장 또는 그룹 관리
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-[26px] border border-white/20 bg-white/10 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/65">바로 시작</p>
              <p className="mt-3 text-sm font-semibold leading-7 text-white/90">
                홈화면에서 전체 흐름을 확인한 뒤, 아래 버튼으로 실제 시간표 작업 화면으로 이동하세요.
              </p>
              <button
                type="button"
                onClick={() => setShowIntroPage(false)}
                className="mt-5 w-full rounded-3xl border border-white/35 bg-white/80 px-4 py-3 text-sm font-black text-slate-900 shadow-lg shadow-slate-900/10"
              >
                시간표 작업 시작
              </button>
            </div>
          </div>
        </section>
      ) : null}

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

      {deleteGroupDialog.open ? (
        <div className="fixed inset-0 z-[330] flex items-center justify-center bg-slate-900/28 p-4 backdrop-blur-md">
          <div className="w-full max-w-xl rounded-[30px] border border-white/55 bg-[linear-gradient(160deg,rgba(255,255,255,0.34),rgba(255,241,242,0.26),rgba(219,234,254,0.24))] p-5 shadow-[0_28px_80px_rgba(15,23,42,0.34)] backdrop-blur-2xl">
            <div className="rounded-[26px] border border-white/45 bg-[linear-gradient(145deg,rgba(15,23,42,0.80),rgba(30,41,59,0.72),rgba(88,28,135,0.32))] p-6 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/55">Delete Schedule Group</p>
              <p className="mt-4 text-3xl font-black tracking-tight">이 시간표 그룹을 삭제할까요?</p>
              <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold leading-6 text-white/80">
                <span>&apos;{deleteGroupDialog.groupName}&apos; 그룹과 연결된 수업이 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</span>
              </p>
              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={deleteGroupDialog.submitting}
                  onClick={() => setDeleteGroupDialog({ open: false, groupId: null, groupName: "", submitting: false })}
                  className="rounded-3xl border border-white/18 bg-white/10 px-6 py-3 text-sm font-bold text-white/85 hover:bg-white/16 disabled:opacity-60"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={deleteGroupDialog.submitting || !deleteGroupDialog.groupId}
                  onClick={() => void handleDeleteGroup(deleteGroupDialog.groupId as string)}
                  className="rounded-3xl border border-rose-200/30 bg-[linear-gradient(135deg,rgba(251,113,133,0.86),rgba(253,186,116,0.82))] px-6 py-3 text-sm font-black text-slate-950 shadow-[0_16px_36px_rgba(251,113,133,0.28)] disabled:opacity-60"
                >
                  {deleteGroupDialog.submitting ? "삭제 중..." : "삭제 확인"}
                </button>
              </div>
            </div>
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
