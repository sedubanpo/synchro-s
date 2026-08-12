"use client";

import { InstructorAvailabilityWorkspace } from "@/components/schedule/InstructorAvailabilityWorkspace";
import { HomeInstructorFolderDashboard } from "@/components/schedule/HomeInstructorFolderDashboard";
import { SchoolEmblem } from "@/components/schedule/SchoolEmblem";
import { ScheduleCreationWorkspace } from "@/components/schedule/ScheduleCreationWorkspace";
import { mergeHomeInstructorEvents } from "@/lib/homeDashboardGrouping";
import { StudentAvailabilityWorkspace } from "@/components/schedule/StudentAvailabilityWorkspace";
import { ScheduleModal } from "@/components/schedule/ScheduleModal";
import { ScheduleTagManager, SCHEDULE_TAG_TONES, type ScheduleTag } from "@/components/schedule/ScheduleTagManager";
import { SyncScheduleDraftModal, type SyncScheduleDraftInput } from "@/components/schedule/SyncScheduleDraftModal";
import { TimeSlotVisibilityControl } from "@/components/schedule/TimeSlotVisibilityControl";
import { TimetableGrid } from "@/components/schedule/TimetableGrid";
import { DAYS, TIME_SLOTS } from "@/lib/constants";
import { getSynchroFirebaseAuth } from "@/lib/firebase/client";
import { loadSchoolIconRegistry } from "@/lib/firebase/sharedIcons";
import { getSchoolName, resolveSchoolIconUrl } from "@/lib/sharedIcons";
import { getSubjectColorClass, setSubjectColor } from "@/lib/subjectColors";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { addDays, dateToWeekday, timeToMinutes } from "@/lib/time";
import { getOverlappingHourSlots } from "@/lib/timetableSlots";
import {
  compareEffectiveTimetableGroups,
  getEffectiveStudentTimetableGroupMap,
  isTimetableGroupExpired,
  selectEffectiveStudentTimetableGroup
} from "@/lib/timetableGroupSelection";
import { normalizeInstructorAlias, parseNotionClassCell } from "@/lib/notionScheduleParser";
import { mergeScheduleEventsByIdentity } from "@/lib/scheduleEventMerge";
import {
  createScheduleReviewSnapshot,
  getScheduleReviewFingerprint,
  mergeScheduleReviewEvents
} from "@/lib/scheduleReviewSnapshot";
import type {
  AvailableTimeSlotsByDay,
  ClassTypeOption,
  ConflictLogCreateInput,
  ConflictLogEntry,
  ConflictResult,
  RoleView,
  ScheduleEvent,
  ScheduleFormInput,
  SelectOption,
  SubjectOption,
  TimetableViewMode,
  Weekday
} from "@/types/schedule";
import { getIdToken } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SubjectOptionWithColor = SubjectOption & { tailwindClass?: string };

type OptionsResponse = {
  viewerRole?: "admin" | "coordinator" | "instructor" | "student";
  viewerName?: string;
  instructors: SelectOption[];
  suspendedInstructors?: SelectOption[];
  students: SelectOption[];
  suspendedStudents?: SelectOption[];
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

type StudentScheduleInputTab = "sync" | "notion" | "availability";
type InstructorWorkspaceTab = "schedule" | "availability";

type SyncScheduleDraftItem = {
  id: string;
  weekday: Weekday;
  startTime: string;
  endTime: string;
  subjectLabel: string;
  instructorId: string;
  instructorName: string;
  classTypeCode: string;
  classTypeLabel: string;
  badgeText: string;
  note: string;
  isSelfStudy: boolean;
  rawText: string;
  scheduleMode: "recurring" | "one_off";
  classDate?: string;
};

type TimetableGroup = {
  id: string;
  name: string;
  roleView: RoleView;
  targetId: string;
  weekStart: string;
  expiresOn?: string | null;
  tagId?: string | null;
  classIds: string[];
  snapshotEvents?: ScheduleEvent[];
  isActive: boolean;
  createdAt: string;
  creator: StaffActor;
  activity: TimetableGroupActivity[];
};

type StaffActor = {
  uid?: string | null;
  name?: string | null;
  position?: string | null;
  iconUrl?: string | null;
};

type TimetableGroupActivity = {
  id: string;
  createdAt: string;
  action: "created" | "activated" | "deactivated";
  actor: StaffActor;
};

type TimetableGroupMonthSection = {
  sectionKey: string;
  monthKey: string;
  label: string;
  tagId: string | null;
  tagName: string;
  tagColorKey: ScheduleTag["colorKey"];
  isCurrentMonth: boolean;
  groups: TimetableGroup[];
};

type ImportProgress = {
  active: boolean;
  total: number;
  done: number;
  label: string;
};

type MainTab = "overview" | "review" | "new" | "issues" | RoleView;

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

type SelfStudyDraft = {
  weekday: Weekday;
  startTime: string;
  endTime: string;
  classDate?: string;
};

const TIME_EDIT_OPTIONS = Array.from({ length: 33 }, (_, index) => {
  const totalMinutes = 8 * 60 + index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});

const SELF_STUDY_EVENT_ID_PREFIX = "self-study:";
const SYNC_DRAFT_EVENT_ID_PREFIX = "sync-draft:";

function isSelfStudyEventId(id: string): boolean {
  return id.startsWith(SELF_STUDY_EVENT_ID_PREFIX);
}

function isSyncDraftEventId(id: string): boolean {
  return id.startsWith(SYNC_DRAFT_EVENT_ID_PREFIX);
}

async function getFirebaseIdTokenForApi(forceRefresh = false): Promise<string | null> {
  const auth = getSynchroFirebaseAuth();
  await auth.authStateReady();
  return auth.currentUser ? getIdToken(auth.currentUser, forceRefresh) : null;
}

async function getFirebaseAuthHeaders(extra?: HeadersInit, forceRefresh = false): Promise<HeadersInit> {
  const token = await getFirebaseIdTokenForApi(forceRefresh);
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

function minutesToTime(totalMinutes: number): string {
  const safeMinutes = Math.max(0, totalMinutes);
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutesToTime(time: string, minutes: number): string {
  return minutesToTime(timeToMinutes(time) + minutes);
}

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

type SaveHistoryEntry = {
  id: string;
  timestampLabel: string;
  targetType: "학생" | "강사";
  targetName: string;
  targetId?: string | null;
  targetLabel: string;
  tagId?: string | null;
  tagLabel: string;
  source: "student_timetable" | "schedule_creation";
  actor: StaffActor;
};

type SaveHistoryResponse = {
  items?: {
    id: string;
    created_at: string;
    target_type: "학생" | "강사";
    target_name: string;
    target_id?: string | null;
    tag_id?: string | null;
    tag_name?: string | null;
    source?: "student_timetable" | "schedule_creation";
    created_by_uid?: string | null;
    created_by_name?: string | null;
    created_by_position?: string | null;
    created_by_icon_url?: string | null;
  }[];
};

type TimetableGroupApiItem = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  roleView: RoleView;
  targetId: string;
  weekStart: string;
  expiresOn?: string | null;
  tagId?: string | null;
  name: string;
  classIds: string[];
  snapshotEvents?: ScheduleEvent[];
  isActive: boolean;
  creator?: StaffActor;
  activity?: TimetableGroupActivity[];
};

type TimetableGroupsResponse = {
  items?: TimetableGroupApiItem[];
  supportsExpiration?: boolean;
};

type SpecialNoteItem = {
  id: string;
  createdAt: string;
  content: string;
  groupId: string | null;
};

type SpecialNotesResponse = {
  items?: {
    id: string;
    created_at: string;
    target_type: "학생" | "강사";
    target_id: string;
    content: string;
    group_id?: string | null;
  }[];
};

type ConflictLogsResponse = {
  items?: ConflictLogEntry[];
};

type ReviewStatus = "normal" | "needs_check" | "issue";

type ScheduleReviewItem = {
  id: string;
  studentId: string;
  studentName?: string;
  weekStart: string;
  sourceWeekStart?: string;
  tagId?: string | null;
  isLegacyFallback?: boolean;
  isCarryForward?: boolean;
  status: ReviewStatus;
  memo: string;
  reviewedByName?: string;
  reviewedAt?: string;
  snapshotEvents?: ScheduleEvent[];
  snapshotFingerprint?: string | null;
  snapshotEventCount?: number | null;
  snapshotTagId?: string | null;
  snapshotTagName?: string | null;
  snapshotGroupId?: string | null;
  snapshotGroupName?: string | null;
  snapshotGroupWeekStart?: string | null;
};

type ScheduleReviewsResponse = {
  items?: ScheduleReviewItem[];
  historyItems?: ScheduleReviewItem[];
};

type OverviewEntity = RoleView;
type InstructorOverviewMode = "subject" | "weekday" | "dayOff";
type StudentOverviewMode = "weekday" | "school" | "classType";
type RecommendationMode = "new" | "join";

type NewPlacementDraft = {
  subjectCode: string;
  classTypeCode: string;
  preferredWeekdays: Weekday[];
  preferredTimes: string[];
  note: string;
};

type RecommendationItem = {
  key: string;
  instructorId: string;
  instructorName: string;
  instructorSecondary?: string;
  weekday: Weekday;
  startTime: string;
  endTime: string;
  mode: RecommendationMode;
  classTypeLabel: string;
  reason: string;
  existingStudentNames: string[];
};

type HomePersonSummary = {
  id: string;
  name: string;
  secondary?: string;
  school?: string;
  schoolIconUrl?: string;
  events: ScheduleEvent[];
};

const MIXED_CLASS_TYPE_CONFLICT_MESSAGE = "1:1/2:1/3:1 수업과 개별정규 수업은 같은 시간에 혼합하여 배정할 수 없습니다.";
const EXCLUDED_OVERVIEW_INSTRUCTORS = new Set(["홍성우", "안종성", "김용찬", "에스에듀"]);
const REVIEW_STATUS_META: Record<ReviewStatus, { label: string; shortLabel: string; tone: string; button: string }> = {
  normal: {
    label: "정상",
    shortLabel: "정상",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    button: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
  },
  needs_check: {
    label: "확인필요",
    shortLabel: "확인",
    tone: "border-amber-200 bg-amber-50 text-amber-700",
    button: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
  },
  issue: {
    label: "문제발생",
    shortLabel: "문제",
    tone: "border-rose-200 bg-rose-50 text-rose-700",
    button: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
  }
};

type ReviewSubjectTone = "blue" | "violet" | "amber" | "emerald" | "rose" | "slate";

const REVIEW_SUBJECT_TONE_CLASSES: Record<
  ReviewSubjectTone,
  { card: string; selected: string; badge: string; label: string; time: string; segmentOn: string; segmentOff: string }
> = {
  blue: {
    card: "border-blue-200 bg-blue-50 text-blue-950 hover:border-blue-300 hover:bg-blue-100/70",
    selected: "border-blue-500 bg-blue-100 text-blue-950 ring-2 ring-blue-300",
    badge: "border-blue-200 bg-blue-100 text-blue-700",
    label: "text-blue-700",
    time: "bg-white/75 text-blue-900 ring-1 ring-blue-100",
    segmentOn: "bg-blue-500",
    segmentOff: "bg-blue-200"
  },
  violet: {
    card: "border-violet-200 bg-violet-50 text-violet-950 hover:border-violet-300 hover:bg-violet-100/70",
    selected: "border-violet-500 bg-violet-100 text-violet-950 ring-2 ring-violet-300",
    badge: "border-violet-200 bg-violet-100 text-violet-700",
    label: "text-violet-700",
    time: "bg-white/75 text-violet-900 ring-1 ring-violet-100",
    segmentOn: "bg-violet-500",
    segmentOff: "bg-violet-200"
  },
  amber: {
    card: "border-amber-200 bg-amber-50 text-amber-950 hover:border-amber-300 hover:bg-amber-100/70",
    selected: "border-amber-500 bg-amber-100 text-amber-950 ring-2 ring-amber-300",
    badge: "border-amber-200 bg-amber-100 text-amber-700",
    label: "text-amber-700",
    time: "bg-white/75 text-amber-900 ring-1 ring-amber-100",
    segmentOn: "bg-amber-500",
    segmentOff: "bg-amber-200"
  },
  emerald: {
    card: "border-emerald-200 bg-emerald-50 text-emerald-950 hover:border-emerald-300 hover:bg-emerald-100/70",
    selected: "border-emerald-500 bg-emerald-100 text-emerald-950 ring-2 ring-emerald-300",
    badge: "border-emerald-200 bg-emerald-100 text-emerald-700",
    label: "text-emerald-700",
    time: "bg-white/75 text-emerald-900 ring-1 ring-emerald-100",
    segmentOn: "bg-emerald-500",
    segmentOff: "bg-emerald-200"
  },
  rose: {
    card: "border-rose-200 bg-rose-50 text-rose-950 hover:border-rose-300 hover:bg-rose-100/70",
    selected: "border-rose-500 bg-rose-100 text-rose-950 ring-2 ring-rose-300",
    badge: "border-rose-200 bg-rose-100 text-rose-700",
    label: "text-rose-700",
    time: "bg-white/75 text-rose-900 ring-1 ring-rose-100",
    segmentOn: "bg-rose-500",
    segmentOff: "bg-rose-200"
  },
  slate: {
    card: "border-slate-200 bg-slate-50 text-slate-950 hover:border-slate-300 hover:bg-slate-100/70",
    selected: "border-slate-500 bg-slate-100 text-slate-950 ring-2 ring-slate-300",
    badge: "border-slate-200 bg-slate-100 text-slate-700",
    label: "text-slate-600",
    time: "bg-white/75 text-slate-800 ring-1 ring-slate-100",
    segmentOn: "bg-slate-500",
    segmentOff: "bg-slate-200"
  }
};

function getReviewSubjectTone(event: ScheduleEvent): ReviewSubjectTone {
  const subjectColorClass = getSubjectColorClass(event.subjectCode, event.subjectName).toLowerCase();
  const subjectCode = event.subjectCode.toLowerCase();
  const subjectName = event.subjectName.replace(/\s+/g, "").toLowerCase();

  if (subjectCode.includes("math") || subjectName.includes("수학")) {
    return "blue";
  }
  if (
    subjectCode.includes("english") ||
    subjectName.includes("영어")
  ) {
    return "violet";
  }
  if (
    subjectCode.includes("social") ||
    subjectName.includes("사회") ||
    subjectName.includes("사탐")
  ) {
    return "amber";
  }
  if (
    subjectCode.includes("science") ||
    subjectName.includes("과학") ||
    subjectName.includes("생명") ||
    subjectName.includes("물리") ||
    subjectName.includes("화학") ||
    subjectName.includes("지구")
  ) {
    return "emerald";
  }
  if (
    subjectCode.includes("korean") ||
    subjectName.includes("국어")
  ) {
    return "rose";
  }
  if (subjectColorClass.includes("blue") || subjectColorClass.includes("sky") || subjectColorClass.includes("cyan")) {
    return "blue";
  }
  if (
    subjectColorClass.includes("purple") ||
    subjectColorClass.includes("violet") ||
    subjectColorClass.includes("fuchsia") ||
    subjectColorClass.includes("indigo")
  ) {
    return "violet";
  }
  if (subjectColorClass.includes("amber") || subjectColorClass.includes("yellow") || subjectColorClass.includes("orange")) {
    return "amber";
  }
  if (
    subjectColorClass.includes("green") ||
    subjectColorClass.includes("emerald") ||
    subjectColorClass.includes("teal") ||
    subjectColorClass.includes("lime")
  ) {
    return "emerald";
  }
  if (subjectColorClass.includes("red") || subjectColorClass.includes("rose") || subjectColorClass.includes("pink")) {
    return "rose";
  }
  return "slate";
}

function getReviewSubjectKey(event: ScheduleEvent): string {
  return normalizeLookupToken(event.subjectName) || normalizeLookupToken(event.subjectCode);
}

function getReviewClassKey(event: ScheduleEvent): string {
  return event.id || [
    normalizePersonName(event.instructorName),
    normalizeLookupToken(event.subjectCode),
    normalizeLookupToken(event.classTypeCode),
    ...event.studentNames.map(normalizePersonName).sort()
  ].join("::");
}

function getReviewClassBadge(event: ScheduleEvent): string | null {
  const badgeText = event.badgeText.replace(/^\[|\]$/g, "").trim();
  const normalized = normalizeLookupToken([event.classTypeCode, event.classTypeLabel, badgeText].join(" "));
  if (normalized.includes("11") || normalized.includes("1:1") || normalized.includes("1대1") || normalized.includes("onetoone")) {
    return badgeText || "1:1";
  }
  if (normalized.includes("21") || normalized.includes("2:1") || normalized.includes("2대1") || normalized.includes("twotoone")) {
    return badgeText || "2:1";
  }
  return null;
}

function getReviewEventKey(event: ScheduleEvent): string {
  return `${event.id}-${event.classDate}-${event.startTime}`;
}

function getReviewStudentKey(student: SelectOption): string {
  const name = normalizePersonName(student.name);
  const secondary = normalizeLookupToken(student.secondary ?? "");
  return name ? `${name}|${secondary}` : student.id;
}

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
    snapshotEvents: group.snapshotEvents ? cloneEvents(group.snapshotEvents) : undefined,
    creator: { ...group.creator },
    activity: group.activity.map((item) => ({ ...item, actor: { ...item.actor } }))
  }));
}

function mapApiGroupToState(item: TimetableGroupApiItem): TimetableGroup {
  return {
    id: item.id,
    name: item.name,
    roleView: item.roleView,
    targetId: item.targetId,
    weekStart: item.weekStart,
    expiresOn: item.expiresOn ?? null,
    tagId: item.tagId ?? null,
    classIds: Array.isArray(item.classIds) ? item.classIds : [],
    snapshotEvents: Array.isArray(item.snapshotEvents) ? cloneEvents(item.snapshotEvents) : [],
    isActive: item.isActive === true,
    createdAt: item.createdAt,
    creator: item.creator ?? {},
    activity: Array.isArray(item.activity) ? item.activity : []
  };
}

function formatDateISOInKST(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}

function mondayOfCurrentWeek(): string {
  const today = formatDateISOInKST(new Date());
  return mondayOfDate(today);
}

function mondayOfDate(dateISO: string): string {
  return addDays(dateISO, -(dateToWeekday(dateISO) - 1));
}

function shiftDate(dateISO: string, days: number): string {
  return addDays(dateISO, days);
}

function isGroupEffectiveForWeek(group: TimetableGroup, targetWeekStart: string, todayISO?: string): boolean {
  return group.weekStart <= targetWeekStart && !isTimetableGroupExpired(group, targetWeekStart, todayISO);
}

function compareEffectiveTimetableGroup(a: TimetableGroup, b: TimetableGroup): number {
  return compareEffectiveTimetableGroups(a, b);
}

function getEffectiveStudentGroupMap(
  groups: TimetableGroup[],
  targetWeekStart: string,
  tagId: string | null,
  todayISO?: string
): Map<string, TimetableGroup> {
  return getEffectiveStudentTimetableGroupMap(groups, targetWeekStart, tagId, todayISO);
}

function getStudentGroupTargetSetForWeek(groups: TimetableGroup[], targetWeekStart: string, tagId: string | null): Set<string> {
  const targets = new Set<string>();
  for (const group of groups) {
    if (group.roleView !== "student" || group.weekStart > targetWeekStart || (group.tagId ?? null) !== tagId) continue;
    targets.add(group.targetId);
  }
  return targets;
}

function getLatestActiveStudentGroup(
  groups: TimetableGroup[],
  targetId: string,
  tagId: string | null,
  latestWeekStart: string,
  todayISO?: string
): TimetableGroup | null {
  return selectEffectiveStudentTimetableGroup(
    groups.filter((group) => group.targetId === targetId),
    latestWeekStart,
    tagId,
    todayISO
  );
}

function getLatestActiveStudentGroupForInstructor(
  groups: TimetableGroup[],
  instructorId: string,
  instructorName: string,
  tagId: string | null
): TimetableGroup | null {
  const normalizedInstructorName = normalizePersonName(instructorName);
  return (
    groups
      .filter(
        (group) =>
          group.roleView === "student" &&
          (group.tagId ?? null) === tagId &&
          group.isActive &&
          (group.snapshotEvents ?? []).some(
            (event) =>
              event.instructorId === instructorId ||
              (normalizedInstructorName && normalizePersonName(event.instructorName) === normalizedInstructorName)
          )
      )
      .sort(compareEffectiveTimetableGroup)[0] ?? null
  );
}

function getGroupExpirationLabel(group: TimetableGroup): string {
  return group.expiresOn ? `${group.expiresOn}까지 적용` : "만료일 없음";
}

function getTimetableGroupMonthKey(group: TimetableGroup): string {
  return (group.weekStart || group.createdAt || "").slice(0, 7);
}

function formatTimetableGroupMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return "날짜 미지정";
  return `${year}년 ${month}월`;
}

function normalizeConflictReasonText(reason: string): string {
  return Array.from(
    new Set(
      reason
        .split(/\s*,\s*|\s*\|\s*/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).join(" · ");
}

function getConflictMessage(conflict: ConflictResult): string {
  if (!conflict.hasConflict) return "";
  const lines = conflict.conflicts.map((item) => {
    const existing = item.existingSchedule;
    const owner = existing?.studentNames?.filter(Boolean).join(", ") || (existing?.source === "prospect_timetable" ? "임시 시간표" : "기존 학생 수업");
    const slot =
      existing?.weekday && existing.startTime && existing.endTime
        ? `${weekdayLabel(existing.weekday)}요일 ${existing.startTime}-${existing.endTime}`
        : "같은 시간대";
    const type = existing?.classTypeLabel || existing?.classTypeCode || "기존 수업";
    return `충돌 이유: ${normalizeConflictReasonText(item.reason)}\n겹치는 기존 수업: ${owner} · ${type} · ${slot}`;
  });
  return Array.from(new Set(lines)).join("\n\n");
}

function getConflictMessageForDisplay(
  conflict: ConflictResult,
  activeStudentGroups: TimetableGroup[],
  students: SelectOption[]
): string {
  if (!conflict.hasConflict) return "";

  const ownerByClassId = new Map<string, string>();
  const eventByClassId = new Map<string, ScheduleEvent>();
  for (const group of activeStudentGroups) {
    const ownerName = students.find((item) => item.id === group.targetId)?.name;
    if (!ownerName) continue;
    for (const event of group.snapshotEvents ?? []) {
      ownerByClassId.set(event.id, ownerName);
      eventByClassId.set(event.id, event);
    }
  }

  const lines = conflict.conflicts
    .map((item) => {
      const event = eventByClassId.get(item.classId);
      const existing = item.existingSchedule;
      const owner =
        ownerByClassId.get(item.classId) ||
        existing?.studentNames?.filter(Boolean).join(", ") ||
        (existing?.source === "prospect_timetable" ? "임시 시간표" : "기존 학생 수업");
      const classType = event?.classTypeLabel || existing?.classTypeLabel || existing?.classTypeCode || "기존 수업";
      const weekday = event?.weekday || existing?.weekday;
      const startTime = event?.startTime || existing?.startTime;
      const endTime = event?.endTime || existing?.endTime;
      const slot = weekday && startTime && endTime ? `${weekdayLabel(weekday)}요일 ${startTime}-${endTime}` : "같은 시간대";
      return `충돌 이유: ${normalizeConflictReasonText(item.reason)}\n겹치는 기존 수업: ${owner} · ${classType} · ${slot}`;
    });
  return Array.from(new Set(lines)).join("\n\n");
}

function formatStoredConflictDetails(details?: string | null): string {
  if (!details) return "";
  const lines = details
    .split("\n")
    .map((line) => line.replace(/\s*\(class:\s*[^)]+\)\s*$/i, "").replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
  return Array.from(new Set(lines)).join("\n");
}

function buildConflictAttemptDetails(input: {
  studentName: string;
  instructorName: string;
  classTypeLabel: string;
  weekday: Weekday;
  startTime: string;
  endTime: string;
  scheduleTagLabel: string;
  conflictMessage: string;
}): string {
  return [
    `입력 시도: ${input.studentName} · ${input.instructorName} · ${input.classTypeLabel} · ${weekdayLabel(input.weekday)}요일 ${input.startTime}-${input.endTime}`,
    `적용 분류: #${input.scheduleTagLabel}`,
    input.conflictMessage,
    "확인 방법: 같은 분류의 활성 시간표에서 위 학생과 시간대를 확인해 주세요. 미분류 및 다른 분류의 수업은 충돌 검사에서 제외됩니다."
  ]
    .filter(Boolean)
    .join("\n");
}

function dayOf(dateISO: string): Weekday {
  return dateToWeekday(dateISO);
}

function normalizeDaysOff(daysOff?: Weekday[]): Weekday[] {
  if (!Array.isArray(daysOff)) {
    return [];
  }
  return Array.from(new Set(daysOff.filter((value): value is Weekday => value >= 1 && value <= 7))).sort((a, b) => a - b) as Weekday[];
}

function normalizeAvailableTimeSlots(slots?: string[]): string[] {
  if (!Array.isArray(slots)) {
    return [];
  }
  return Array.from(new Set(slots.filter((value): value is string => /^\d{2}:\d{2}$/.test(value)))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function normalizeAvailableTimeSlotsByDay(slotsByDay?: AvailableTimeSlotsByDay): AvailableTimeSlotsByDay {
  if (!slotsByDay || typeof slotsByDay !== "object" || Array.isArray(slotsByDay)) {
    return {};
  }

  const normalized: AvailableTimeSlotsByDay = {};
  for (const [rawWeekday, rawSlots] of Object.entries(slotsByDay)) {
    const weekday = Number(rawWeekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      continue;
    }

    const slots = normalizeAvailableTimeSlots(rawSlots);
    if (slots.length > 0) {
      normalized[weekday as Weekday] = slots;
    }
  }

  return normalized;
}

function flattenAvailableTimeSlotsByDay(slotsByDay?: AvailableTimeSlotsByDay, fallback?: string[]): string[] {
  const merged = new Set<string>();

  for (const slots of Object.values(normalizeAvailableTimeSlotsByDay(slotsByDay))) {
    for (const slot of slots ?? []) {
      merged.add(slot);
    }
  }

  if (merged.size === 0) {
    for (const slot of normalizeAvailableTimeSlots(fallback)) {
      merged.add(slot);
    }
  }

  return [...merged].sort((a, b) => a.localeCompare(b));
}

function getInstructorAvailableTimeSlotsForWeekday(instructor: SelectOption | null | undefined, weekday: Weekday): string[] {
  const slotsByDay = normalizeAvailableTimeSlotsByDay(instructor?.availableTimeSlotsByDay);
  const daySpecificSlots = normalizeAvailableTimeSlots(slotsByDay[weekday]);
  if (daySpecificSlots.length > 0) {
    return daySpecificSlots;
  }

  return normalizeAvailableTimeSlots(instructor?.availableTimeSlots);
}

function eventMatchesInstructorOption(event: ScheduleEvent, instructor: SelectOption): boolean {
  if (event.instructorId === instructor.id) {
    return true;
  }

  const eventName = normalizePersonName(event.instructorName);
  const instructorName = normalizePersonName(instructor.name);
  return Boolean(eventName && instructorName && eventName === instructorName);
}

function eventHasInstructorInSet(event: ScheduleEvent, activeInstructorIds: Set<string>, activeInstructorNames: Set<string>): boolean {
  if (isSelfStudyEventId(event.id)) return true;
  return activeInstructorIds.has(event.instructorId) || activeInstructorNames.has(normalizePersonName(event.instructorName));
}

function eventHasStudentInSet(event: ScheduleEvent, activeStudentIds: Set<string>, activeStudentNames: Set<string>): boolean {
  return (
    event.studentIds.some((studentId) => activeStudentIds.has(studentId)) ||
    event.studentNames.some((studentName) => activeStudentNames.has(normalizePersonName(studentName)))
  );
}

function eventHasProspectStudent(event: ScheduleEvent): boolean {
  return event.studentIds.some((studentId) => studentId.startsWith("prospect:"));
}

function getScheduleEventMergeKey(event: ScheduleEvent): string {
  const subjectKey = normalizeLookupToken(event.subjectName) || normalizeLookupToken(event.subjectCode);
  const classTypeKey = normalizeLookupToken(event.classTypeLabel) || normalizeLookupToken(event.classTypeCode);
  return [
    event.classDate,
    event.weekday,
    event.startTime,
    event.endTime,
    subjectKey,
    classTypeKey,
    event.instructorId || normalizePersonName(event.instructorName)
  ].join("::");
}

function getInstructorScheduleMergeKey(event: ScheduleEvent): string {
  const subjectKey = normalizeLookupToken(event.subjectName) || normalizeLookupToken(event.subjectCode);
  const classTypeKey = normalizeLookupToken(event.classTypeLabel) || normalizeLookupToken(event.classTypeCode);
  return [
    event.weekday,
    event.startTime,
    event.endTime,
    subjectKey,
    classTypeKey
  ].join("::");
}

function scopeScheduleEventToStudent(event: ScheduleEvent, studentId: string): ScheduleEvent | null {
  const studentIndex = event.studentIds.findIndex((value) => value === studentId);
  if (studentIndex < 0) return null;
  return {
    ...event,
    studentIds: [studentId],
    studentNames: [event.studentNames[studentIndex] ?? studentId]
  };
}

function mergeStudentRosters(a: ScheduleEvent, b: ScheduleEvent): Pick<ScheduleEvent, "studentIds" | "studentNames"> {
  const studentIds: string[] = [];
  const studentNames: string[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  const append = (ids: string[], names: string[]) => {
    const maxLength = Math.max(ids.length, names.length);
    for (let index = 0; index < maxLength; index += 1) {
      const id = (ids[index] ?? "").trim();
      const name = (names[index] ?? "").trim();
      const nameKey = normalizePersonName(name);
      if (id && seenIds.has(id)) continue;
      if (nameKey && seenNames.has(nameKey)) continue;
      if (!id && !nameKey) continue;

      studentIds.push(id);
      studentNames.push(name || id);
      if (id) seenIds.add(id);
      if (nameKey) seenNames.add(nameKey);
    }
  };

  append(a.studentIds ?? [], a.studentNames ?? []);
  append(b.studentIds ?? [], b.studentNames ?? []);

  return { studentIds, studentNames };
}

function mergeScheduleEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  const dedup = new Map<string, ScheduleEvent>();

  for (const event of events) {
    const key = getScheduleEventMergeKey(event);

    const existing = dedup.get(key);
    if (!existing) {
      const mergedRoster = mergeStudentRosters(event, event);
      dedup.set(key, { ...event, ...mergedRoster });
      continue;
    }

    const mergedRoster = mergeStudentRosters(existing, event);
    dedup.set(key, {
      ...existing,
      ...mergedRoster
    });
  }

  return [...dedup.values()].sort((a, b) => {
    if (a.classDate !== b.classDate) return a.classDate.localeCompare(b.classDate);
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.instructorName.localeCompare(b.instructorName, "ko");
  });
}

function dedupeInstructorStudentTimeSlots(events: ScheduleEvent[]): ScheduleEvent[] {
  const seenBySlot = new Map<string, Set<string>>();
  const cleaned: ScheduleEvent[] = [];

  for (const event of events) {
    const slotKey = [
      event.weekday,
      event.startTime,
      event.endTime
    ].join("::");
    const seenStudents = seenBySlot.get(slotKey) ?? new Set<string>();
    const studentIds: string[] = [];
    const studentNames: string[] = [];
    const maxLength = Math.max(event.studentIds.length, event.studentNames.length);

    for (let index = 0; index < maxLength; index += 1) {
      const id = (event.studentIds[index] ?? "").trim();
      const name = (event.studentNames[index] ?? "").trim();
      const studentKey = normalizePersonName(name) || id;
      if (!studentKey || seenStudents.has(studentKey)) continue;

      seenStudents.add(studentKey);
      studentIds.push(id);
      studentNames.push(name || id);
    }

    seenBySlot.set(slotKey, seenStudents);
    if (studentNames.length > 0) {
      cleaned.push({ ...event, studentIds, studentNames });
    }
  }

  return cleaned;
}

function isTransientGatewayErrorMessage(message: string): boolean {
  return /502|bad gateway|cloudflare|supabase/i.test(message);
}

async function getApiErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (payload.error?.trim()) {
    return payload.error;
  }
  return `${fallback} (HTTP ${response.status})`;
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

function formatSaveHistoryTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("month")}/${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

function formatSpecialNoteTimestamp(dateISO: string): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(dateISO));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}.${pick("month")}.${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

function StaffAvatar({ actor, size = "sm" }: { actor: StaffActor; size?: "xs" | "sm" }) {
  const name = actor.name?.trim() || "담당자 미상";
  const initial = name.charAt(0) || "?";
  const dimension = size === "xs" ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]";
  return (
    <span
      role="img"
      aria-label={`${name}${actor.position ? ` ${actor.position}` : ""}`}
      title={`${name}${actor.position ? ` · ${actor.position}` : ""}`}
      className={`inline-flex shrink-0 items-center justify-center rounded-md border border-white/50 bg-slate-700 bg-cover bg-center font-black text-white shadow-sm ${dimension}`}
      style={actor.iconUrl ? { backgroundImage: `url("${actor.iconUrl.replace(/["\\]/g, "")}")` } : undefined}
    >
      {actor.iconUrl ? <span className="sr-only">{name}</span> : initial}
    </span>
  );
}

function formatConflictLogTimestamp(dateISO: string): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(dateISO));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("month")}/${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

function weekdayLabel(weekday: Weekday): string {
  return DAYS.find((day) => day.key === weekday)?.label ?? `${weekday}`;
}

function summarizeConflictReason(conflict: ConflictResult): string {
  if (!conflict.hasConflict || conflict.conflicts.length === 0) {
    return "시간표 충돌";
  }

  return normalizeConflictReasonText(conflict.conflicts.map((item) => item.reason.trim()).filter(Boolean).join(" | ")) || "시간표 충돌";
}

function findOptionByName(items: SelectOption[], targetName: string): SelectOption | null {
  const target = normalizePersonName(targetName);
  if (!target) {
    return null;
  }

  return (
    items.find((item) => normalizePersonName(item.name) === target) ??
    items.find((item) => {
      const token = normalizePersonName(item.name);
      return token.includes(target) || target.includes(token);
    }) ??
    null
  );
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

function addMinutesToClock(time: string, minutes: number): string {
  const next = timeToMinutes(time) + minutes;
  const safe = Math.max(0, Math.min(next, 24 * 60));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function subjectAliases(label: string): string[] {
  const normalized = normalizeLookupToken(label);
  if (normalized.includes("수학")) return ["수학", "math"];
  if (normalized.includes("영어")) return ["영어", "english", "eng"];
  if (normalized.includes("국어")) return ["국어", "korean"];
  if (normalized.includes("과학")) return ["과학", "science"];
  if (normalized.includes("사회") || normalized.includes("사탐")) return ["사회", "사탐", "social"];
  return [label];
}

function instructorMatchesSubject(instructor: SelectOption, subjectLabel: string): boolean {
  const secondary = normalizeLookupToken(instructor.secondary ?? "");
  if (!secondary) return true;
  return subjectAliases(subjectLabel).some((alias) => {
    const token = normalizeLookupToken(alias);
    return secondary.includes(token) || token.includes(secondary);
  });
}

function parseCellClassText(cell: string): {
  subjectLabel: string;
  classTypeLabel: string;
  instructorName: string;
  rawText: string;
} {
  return parseNotionClassCell(cell);
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

  const specificAliasByCode: Record<string, string[]> = {
    SOCIAL2: ["사문", "사회문화"],
    SOCIAL: ["세지", "세계지리"],
    SOCIAL3: ["생윤", "생활과윤리"],
    SOCIAL4: ["윤리", "윤리와사상"],
    SOCIAL5: ["한국사"],
    SOCIAL6: ["경제"],
    SOCIAL7: ["지리"],
    SOCIAL8: ["통사", "통합사회"],
    SCIENCE2: ["물리"],
    SCIENCE3: ["생물"],
    SCIENCE5: ["화학"],
    SCIENCE6: ["생명", "생명과학"],
    SCIENCE7: ["통과", "통합과학"]
  };

  for (const [code, aliases] of Object.entries(specificAliasByCode)) {
    if (!aliases.some((alias) => target === normalizeLookupToken(alias))) continue;
    const mapped = subjects.find((entry) => normalizeLookupToken(entry.code) === normalizeLookupToken(code));
    if (mapped) return mapped;
  }

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
  move: {
    classId: string;
    weekday: Weekday;
    startTime: string;
    endTime: string;
    classDate: string;
    subjectCode?: string;
    subjectName?: string;
  }
): ScheduleEvent[] {
  return source.map((event) =>
    event.id === move.classId
      ? {
          ...event,
          weekday: move.weekday,
          startTime: move.startTime,
          endTime: move.endTime,
          classDate: move.classDate,
          subjectCode: move.subjectCode ?? event.subjectCode,
          subjectName: move.subjectName ?? event.subjectName
        }
      : event
  );
}

function extractSnapshotClassIds(source: ScheduleEvent[]): string[] {
  return Array.from(
    new Set(
      source
        .map((event) => event.id)
        .filter((id) => id && !id.startsWith("draft-") && !isSelfStudyEventId(id))
    )
  );
}

function replaceClassId(source: string[], previousId: string, nextId: string): string[] {
  return Array.from(new Set(source.map((id) => (id === previousId ? nextId : id)).filter(Boolean)));
}

function replaceEventIdInList(source: ScheduleEvent[], previousId: string, nextId: string): ScheduleEvent[] {
  return source.map((event) => (event.id === previousId ? { ...event, id: nextId } : event));
}

function hasTimeOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(aEnd) > timeToMinutes(bStart);
}

function isStrictConflictClassType(code: string, label?: string): boolean {
  const normalizedCode = normalizeLookupToken(code);
  const normalizedLabel = normalizeLookupToken(label ?? "");
  if (normalizedCode.includes("onetone") || normalizedCode.includes("onetoone") || normalizedCode.includes("11")) return true;
  if (normalizedCode.includes("twotone") || normalizedCode.includes("twotoone") || normalizedCode.includes("21")) return true;
  if (normalizedCode.includes("threetone") || normalizedCode.includes("threetoone") || normalizedCode.includes("31")) return true;
  return (
    normalizedLabel.includes(normalizeLookupToken("1:1")) ||
    normalizedLabel.includes(normalizeLookupToken("1대1")) ||
    normalizedLabel.includes(normalizeLookupToken("2:1")) ||
    normalizedLabel.includes(normalizeLookupToken("2대1")) ||
    normalizedLabel.includes(normalizeLookupToken("3:1")) ||
    normalizedLabel.includes(normalizeLookupToken("3대1"))
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
  const [overviewEntity, setOverviewEntity] = useState<OverviewEntity>("instructor");
  const [instructorOverviewMode, setInstructorOverviewMode] = useState<InstructorOverviewMode>("subject");
  const [studentOverviewMode, setStudentOverviewMode] = useState<StudentOverviewMode>("weekday");
  const [weekStart, setWeekStart] = useState<string>(mondayOfCurrentWeek);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [viewerRole, setViewerRole] = useState<"admin" | "coordinator" | "instructor" | "student">("admin");
  const [viewerRoleResolved, setViewerRoleResolved] = useState(false);
  const [overviewEvents, setOverviewEvents] = useState<ScheduleEvent[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [reviewEvents, setReviewEvents] = useState<ScheduleEvent[]>([]);
  const [targetedReviewEventsByStudentId, setTargetedReviewEventsByStudentId] = useState<Record<string, ScheduleEvent[]>>({});
  const [scheduleReviews, setScheduleReviews] = useState<ScheduleReviewItem[]>([]);
  const [scheduleReviewHistory, setScheduleReviewHistory] = useState<ScheduleReviewItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSavingId, setReviewSavingId] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewStatus | "all" | "unreviewed" | "memo">("all");
  const [reviewSearchKeyword, setReviewSearchKeyword] = useState("");
  const [reviewSortMode, setReviewSortMode] = useState<"needs_first" | "class_desc" | "class_asc" | "name">("needs_first");
  const [selectedReviewStudentId, setSelectedReviewStudentId] = useState("");
  const [selectedReviewClassKey, setSelectedReviewClassKey] = useState<string | null>(null);
  const [reviewMemoDraft, setReviewMemoDraft] = useState("");
  const [homeDashboardDayOffset, setHomeDashboardDayOffset] = useState<-1 | 0 | 1>(0);

  const [instructors, setInstructors] = useState<SelectOption[]>([]);
  const [suspendedInstructors, setSuspendedInstructors] = useState<SelectOption[]>([]);
  const [students, setStudents] = useState<SelectOption[]>([]);
  const [suspendedStudents, setSuspendedStudents] = useState<SelectOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOptionWithColor[]>([]);
  const [classTypes, setClassTypes] = useState<ClassTypeOption[]>([]);

  const [selectedInstructorId, setSelectedInstructorId] = useState<string>("");
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");

  const [modalOpen, setModalOpen] = useState(false);
  const [initialCell, setInitialCell] = useState<{
    weekday: Weekday;
    startTime: string;
    classDate?: string;
    scheduleMode?: "recurring" | "one_off";
  }>();
  const [studentScheduleInputTab, setStudentScheduleInputTab] = useState<StudentScheduleInputTab>("sync");
  const [instructorWorkspaceTab, setInstructorWorkspaceTab] = useState<InstructorWorkspaceTab>("schedule");
  const [syncDraftModalOpen, setSyncDraftModalOpen] = useState(false);
  const [syncDraftInitialCell, setSyncDraftInitialCell] = useState<{
    weekday: Weekday;
    startTime: string;
    classDate?: string;
    scheduleMode?: "recurring" | "one_off";
  }>();
  const [studentDayDateOverrides, setStudentDayDateOverrides] = useState<Partial<Record<Weekday, string>>>({});
  const [syncDraftItems, setSyncDraftItems] = useState<SyncScheduleDraftItem[]>([]);
  const [savingSyncDrafts, setSavingSyncDrafts] = useState(false);
  const [timeEditEvent, setTimeEditEvent] = useState<ScheduleEvent | null>(null);
  const [timeEditForm, setTimeEditForm] = useState({ startTime: "10:00", endTime: "11:00", subjectCode: "" });
  const [timeEditSaving, setTimeEditSaving] = useState(false);
  const [selfStudyDraft, setSelfStudyDraft] = useState<SelfStudyDraft | null>(null);
  const [selfStudySaving, setSelfStudySaving] = useState(false);

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
  const [instructorStudentSearchKeyword, setInstructorStudentSearchKeyword] = useState("");
  const [savingInstructorDaysOff, setSavingInstructorDaysOff] = useState(false);
  const [hideEmptyDays, setHideEmptyDays] = useState(false);
  const [hideEmptyTimes, setHideEmptyTimes] = useState(false);
  const [hiddenTimeSlots, setHiddenTimeSlots] = useState<string[]>([]);
  const [hiddenTimeSlotsReady, setHiddenTimeSlotsReady] = useState(false);
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
  const [saveHistory, setSaveHistory] = useState<SaveHistoryEntry[]>([]);
  const [conflictLogs, setConflictLogs] = useState<ConflictLogEntry[]>([]);
  const [conflictLogsLoading, setConflictLogsLoading] = useState(false);
  const [specialNotes, setSpecialNotes] = useState<SpecialNoteItem[]>([]);
  const [specialNoteInput, setSpecialNoteInput] = useState("");
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [newPlacementDraft, setNewPlacementDraft] = useState<NewPlacementDraft>({
    subjectCode: "",
    classTypeCode: "",
    preferredWeekdays: [],
    preferredTimes: [],
    note: ""
  });
  const [memoByEventId, setMemoByEventId] = useState<Record<string, string>>({});
  const [timetableGroups, setTimetableGroups] = useState<TimetableGroup[]>([]);
  const [scheduleTags, setScheduleTags] = useState<ScheduleTag[]>([]);
  const [selectedScheduleTagId, setSelectedScheduleTagId] = useState<string | null>(null);
  const [scheduleTagManagerOpen, setScheduleTagManagerOpen] = useState(false);
  const [scheduleTagsBusy, setScheduleTagsBusy] = useState(false);
  const [scheduleTagSelectionReady, setScheduleTagSelectionReady] = useState(false);
  const [timetableGroupsLoading, setTimetableGroupsLoading] = useState(true);
  const [timetableGroupExpirationSupported, setTimetableGroupExpirationSupported] = useState(true);
  const [expandedGroupMonths, setExpandedGroupMonths] = useState<Record<string, boolean>>({});
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isCreatingNewSyncTimetable, setIsCreatingNewSyncTimetable] = useState(false);
  const [capturingTimetable, setCapturingTimetable] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [groupActivationPendingId, setGroupActivationPendingId] = useState<string | null>(null);
  const [groupActivationPulseId, setGroupActivationPulseId] = useState<string | null>(null);
  const [showSuspendedRoster, setShowSuspendedRoster] = useState(false);
  const [showRosterActions, setShowRosterActions] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
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
  const weekLoadRequestRef = useRef(0);
  const timetableGroupsLoadRequestRef = useRef(0);
  const scheduleTagSelectionInitializedRef = useRef(false);
  const autoSelectedGroupScopeRef = useRef<string | null>(null);
  const timetableCaptureRef = useRef<HTMLDivElement | null>(null);
  const notionTextValue = notionInput !== "" ? notionInput : notionPreview;

  const weekEnd = useMemo(() => shiftDate(weekStart, 6), [weekStart]);
  const [todayISO, setTodayISO] = useState(() => formatDateISOInKST(new Date()));
  const todayWeekday = useMemo(() => dayOf(todayISO), [todayISO]);
  const todayLabel = useMemo(() => DAYS.find((day) => day.key === todayWeekday)?.label ?? "오늘", [todayWeekday]);
  const homeDashboardDateISO = useMemo(() => shiftDate(todayISO, homeDashboardDayOffset), [homeDashboardDayOffset, todayISO]);
  const homeDashboardWeekday = useMemo(() => dayOf(homeDashboardDateISO), [homeDashboardDateISO]);
  const homeDashboardWeekdayLabel = useMemo(
    () => DAYS.find((day) => day.key === homeDashboardWeekday)?.label ?? "선택 날짜",
    [homeDashboardWeekday]
  );
  const homeDashboardRelativeLabel = homeDashboardDayOffset === -1 ? "어제" : homeDashboardDayOffset === 1 ? "내일" : "오늘";
  const monthLabel = useMemo(() => {
    const [year, month] = calendarMonth.split("-").map(Number);
    return `${year}년 ${month}월`;
  }, [calendarMonth]);
  const monthCells = useMemo(() => buildMonthCells(calendarMonth), [calendarMonth]);
  const keyword = searchKeyword.trim().toLowerCase();
  const instructorStudentKeyword = instructorStudentSearchKeyword.trim().toLowerCase();
  const instructorStudentKeywordToken = normalizeLookupToken(instructorStudentSearchKeyword);
  const isWorkspaceTab = mainTab === "student" || mainTab === "instructor";
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
  const selectedStudentOption = useMemo<SelectOption | null>(() => {
    const activeOption = students.find((item) => item.id === selectedStudentId);
    if (activeOption) return activeOption;

    const historyOption = saveHistory.find((item) => item.targetType === "학생" && item.targetId === selectedStudentId);
    return historyOption?.targetId ? { id: historyOption.targetId, name: historyOption.targetName } : null;
  }, [saveHistory, selectedStudentId, students]);
  const selectedStudentLabel = selectedStudentOption?.name ?? "학생 선택";
  const selectedStudentSecondary = selectedStudentOption?.secondary ?? "";
  const selectedInstructorOption = useMemo<SelectOption | null>(() => {
    const activeOption = instructors.find((item) => item.id === selectedInstructorId);
    if (activeOption) return activeOption;

    const historyOption = saveHistory.find((item) => item.targetType === "강사" && item.targetId === selectedInstructorId);
    return historyOption?.targetId ? { id: historyOption.targetId, name: historyOption.targetName } : null;
  }, [instructors, saveHistory, selectedInstructorId]);
  const selectedInstructorLabel = selectedInstructorOption?.name ?? "강사 선택";
  const selectedInstructorSecondary = selectedInstructorOption?.secondary ?? "";
  const selectedScheduleTag = useMemo(
    () => scheduleTags.find((tag) => tag.id === selectedScheduleTagId) ?? null,
    [scheduleTags, selectedScheduleTagId]
  );
  const selectedScheduleTagLabel = selectedScheduleTag?.name ?? "미분류";
  const selectedInstructorDaysOff = useMemo(
    () => normalizeDaysOff(selectedInstructorOption?.daysOff),
    [selectedInstructorOption]
  );
  const selectedInstructorAvailabilityByDay = useMemo(
    () => normalizeAvailableTimeSlotsByDay(selectedInstructorOption?.availableTimeSlotsByDay),
    [selectedInstructorOption]
  );
  const activeStudentIdSet = useMemo(() => new Set(students.map((item) => item.id)), [students]);
  const activeStudentNameSet = useMemo(
    () => new Set(students.map((item) => normalizePersonName(item.name)).filter(Boolean)),
    [students]
  );
  const activeInstructorIdSet = useMemo(() => new Set(instructors.map((item) => item.id)), [instructors]);
  const activeInstructorNameSet = useMemo(
    () => new Set(instructors.map((item) => normalizePersonName(item.name)).filter(Boolean)),
    [instructors]
  );
  const studentSecondaryLookup = useMemo(() => {
    const lookup: Record<string, string> = {};
    for (const student of [...students, ...suspendedStudents]) {
      const secondary = student.secondary?.trim();
      if (!secondary) continue;
      lookup[`id:${student.id}`] = secondary;
      lookup[`name:${normalizePersonName(student.name)}`] = secondary;
    }
    return lookup;
  }, [students, suspendedStudents]);
  const overviewStudents = useMemo(() => {
    const byId = new Map(students.map((student) => [student.id, student]));
    for (const event of overviewEvents) {
      event.studentIds.forEach((studentId, index) => {
        if (!studentId.startsWith("prospect:") || byId.has(studentId)) return;
        byId.set(studentId, {
          id: studentId,
          name: event.studentNames[index] ?? event.studentNames[0] ?? "[가안] 신규문의",
          secondary: "신규문의 가안",
          isActive: true
        });
      });
    }
    return [...byId.values()];
  }, [overviewEvents, students]);
  const effectiveStudentGroupByTargetId = useMemo(
    () => getEffectiveStudentGroupMap(timetableGroups, weekStart, selectedScheduleTagId, todayISO),
    [selectedScheduleTagId, timetableGroups, todayISO, weekStart]
  );
  const studentGroupTargetIdsForWeek = useMemo(
    () => getStudentGroupTargetSetForWeek(timetableGroups, weekStart, selectedScheduleTagId),
    [selectedScheduleTagId, timetableGroups, weekStart]
  );
  const overviewUniverseEvents = useMemo(() => {
    const collected: ScheduleEvent[] = [];
    const relevantGroups = [...effectiveStudentGroupByTargetId.values()]
      .sort((a, b) => {
        if (a.isActive !== b.isActive) {
          return a.isActive ? -1 : 1;
        }
        return b.createdAt.localeCompare(a.createdAt);
      });

    for (const group of relevantGroups) {
      const snapshot = group.snapshotEvents ?? [];
      if (snapshot.length > 0) {
        collected.push(...snapshot);
      }

      if (group.classIds.length > 0) {
        const snapshotKeys = new Set(snapshot.map((event) => `${event.id}:${event.classDate}`));
        const linkedLiveEvents = overviewEvents.filter(
          (event) => group.classIds.includes(event.id) && !snapshotKeys.has(`${event.id}:${event.classDate}`)
        );
        collected.push(...linkedLiveEvents);
      }
    }

    return mergeScheduleEvents(collected).filter(
      (event) =>
        eventHasInstructorInSet(event, activeInstructorIdSet, activeInstructorNameSet) &&
        (eventHasStudentInSet(event, activeStudentIdSet, activeStudentNameSet) || eventHasProspectStudent(event))
    );
  }, [
    activeInstructorIdSet,
    activeInstructorNameSet,
    activeStudentIdSet,
    activeStudentNameSet,
    effectiveStudentGroupByTargetId,
    overviewEvents
  ]);
  const overviewVisibleInstructors = useMemo(
    () => instructors.filter((item) => item.isActive !== false && !EXCLUDED_OVERVIEW_INSTRUCTORS.has(item.name)),
    [instructors]
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
    const labelForDay = (weekday: Weekday) => DAYS.find((day) => day.key === weekday)?.label ?? `${weekday}`;
    for (const instructor of overviewVisibleInstructors) {
      let key = "기타";
      if (instructorOverviewMode === "subject") {
        key = normalizeSubjectLabel(instructor.secondary);
      } else if (instructorOverviewMode === "weekday") {
        const activeDays = Array.from(new Set(overviewUniverseEvents.filter((event) => eventMatchesInstructorOption(event, instructor)).map((event) => event.weekday))).sort((a, b) => a - b);
        key = activeDays.length > 0 ? activeDays.map((day) => labelForDay(day)).join(" · ") : "이번 주 수업 없음";
      } else {
        const daysOff = normalizeDaysOff(instructor.daysOff);
        key = daysOff.length > 0 ? daysOff.map((day) => labelForDay(day)).join(" · ") : "휴무 없음";
      }
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
  }, [instructorOverviewMode, overviewUniverseEvents, overviewVisibleInstructors]);
  const overviewStudentGroups = useMemo(() => {
    const grouped = new Map<string, SelectOption[]>();
    const labelForDay = (weekday: Weekday) => DAYS.find((day) => day.key === weekday)?.label ?? `${weekday}`;
    const schoolLabel = (secondary?: string) => secondary?.split("·")[0]?.trim() || "학교 정보 없음";
    const weekdayOrder = ["월", "화", "수", "목", "금", "토", "일", "수업 없음"];
    const eventsByStudent = new Map<string, ScheduleEvent[]>();

    for (const event of overviewEvents) {
      for (const studentId of event.studentIds) {
        const bucket = eventsByStudent.get(studentId) ?? [];
        bucket.push(event);
        eventsByStudent.set(studentId, bucket);
      }
    }

    for (const student of overviewStudents) {
      const studentWeekEvents = eventsByStudent.get(student.id) ?? [];
      const preferredGroup = effectiveStudentGroupByTargetId.get(student.id) ?? null;
      const preferredSnapshot = preferredGroup?.snapshotEvents ?? [];
      const groupedClassIds = Array.from(new Set((preferredGroup?.classIds ?? []).filter(Boolean)));
      const groupLinkedEvents = groupedClassIds.length > 0 ? studentWeekEvents.filter((event) => groupedClassIds.includes(event.id)) : [];
      const linkedEvents =
        preferredSnapshot.length > 0
          ? preferredSnapshot
          : preferredGroup
            ? groupLinkedEvents
            : studentGroupTargetIdsForWeek.has(student.id)
              ? []
              : studentWeekEvents;
      let keys: string[] = [];

      if (studentOverviewMode === "weekday") {
        keys = Array.from(new Set(linkedEvents.map((event) => labelForDay(event.weekday))));
      } else if (studentOverviewMode === "school") {
        keys = [schoolLabel(student.secondary)];
      } else {
        keys = Array.from(new Set(linkedEvents.map((event) => event.classTypeLabel || event.badgeText || "유형 없음")));
      }

      if (keys.length === 0) {
        keys = [studentOverviewMode === "weekday" ? "수업 없음" : studentOverviewMode === "classType" ? "유형 없음" : "학교 정보 없음"];
      }

      for (const key of keys) {
        const bucket = grouped.get(key) ?? [];
        bucket.push(student);
        grouped.set(key, bucket);
      }
    }

    return [...grouped.entries()]
      .sort((a, b) => {
        if (studentOverviewMode === "weekday") {
          const aIndex = weekdayOrder.indexOf(a[0]);
          const bIndex = weekdayOrder.indexOf(b[0]);
          const normalizedA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
          const normalizedB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
          if (normalizedA !== normalizedB) {
            return normalizedA - normalizedB;
          }
        }
        return a[0].localeCompare(b[0], "ko");
      })
      .map(([label, items], index) => ({
        label,
        items: [...items].sort((a, b) => a.name.localeCompare(b.name, "ko")),
        toneClass:
          studentOverviewMode === "weekday"
            ? [
                "border-sky-100/80 bg-[linear-gradient(135deg,rgba(239,246,255,0.88),rgba(219,234,254,0.78))]",
                "border-cyan-100/80 bg-[linear-gradient(135deg,rgba(236,254,255,0.88),rgba(207,250,254,0.72))]",
                "border-indigo-100/80 bg-[linear-gradient(135deg,rgba(238,242,255,0.88),rgba(224,231,255,0.78))]",
                "border-violet-100/80 bg-[linear-gradient(135deg,rgba(245,243,255,0.88),rgba(237,233,254,0.78))]",
                "border-emerald-100/80 bg-[linear-gradient(135deg,rgba(236,253,245,0.88),rgba(209,250,229,0.76))]",
                "border-amber-100/80 bg-[linear-gradient(135deg,rgba(255,251,235,0.9),rgba(254,243,199,0.76))]",
                "border-rose-100/80 bg-[linear-gradient(135deg,rgba(255,241,242,0.9),rgba(255,228,230,0.78))]",
                "border-slate-200/80 bg-[linear-gradient(135deg,rgba(248,250,252,0.92),rgba(226,232,240,0.78))]"
              ][Math.min(index, 7)]
            : [
                "border-white/60 bg-white/55",
                "border-sky-100/80 bg-[linear-gradient(135deg,rgba(239,246,255,0.82),rgba(219,234,254,0.68))]",
                "border-emerald-100/80 bg-[linear-gradient(135deg,rgba(236,253,245,0.82),rgba(209,250,229,0.68))]",
                "border-violet-100/80 bg-[linear-gradient(135deg,rgba(245,243,255,0.82),rgba(237,233,254,0.68))]"
              ][index % 4]
      }));
  }, [effectiveStudentGroupByTargetId, overviewEvents, overviewStudents, studentGroupTargetIdsForWeek, studentOverviewMode]);
  const overviewDisplayGroups = useMemo(
    () =>
      overviewEntity === "instructor"
        ? overviewInstructorGroups.map((group, index) => ({
            label: group.subject,
            items: group.items,
            toneClass: [
              "border-white/60 bg-white/55",
              "border-sky-100/80 bg-[linear-gradient(135deg,rgba(239,246,255,0.82),rgba(219,234,254,0.68))]",
              "border-indigo-100/80 bg-[linear-gradient(135deg,rgba(238,242,255,0.82),rgba(224,231,255,0.68))]",
              "border-cyan-100/80 bg-[linear-gradient(135deg,rgba(236,254,255,0.82),rgba(207,250,254,0.68))]"
            ][index % 4]
          }))
        : overviewStudentGroups.map((group) => ({ label: group.label, items: group.items, toneClass: group.toneClass })),
    [overviewEntity, overviewInstructorGroups, overviewStudentGroups]
  );
  const homeTodayEvents = useMemo(
    () =>
      overviewUniverseEvents
        .filter((event) => event.weekday === homeDashboardWeekday)
        .sort((a, b) => {
          if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
          return a.instructorName.localeCompare(b.instructorName, "ko");
        }),
    [homeDashboardWeekday, overviewUniverseEvents]
  );
  const homeTodayInstructorSummaries = useMemo<HomePersonSummary[]>(() => {
    const byInstructor = new Map<string, HomePersonSummary>();
    for (const event of homeTodayEvents) {
      const option = instructors.find((item) => eventMatchesInstructorOption(event, item));
      const id = option?.id ?? event.instructorId ?? event.instructorName;
      const existing = byInstructor.get(id);
      if (existing) {
        existing.events.push(event);
        continue;
      }
      byInstructor.set(id, {
        id,
        name: option?.name ?? event.instructorName,
        secondary: option?.secondary,
        events: [event]
      });
    }
    return [...byInstructor.values()]
      .map((item) => ({ ...item, events: mergeHomeInstructorEvents(item.events) }))
      .sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name, "ko"));
  }, [homeTodayEvents, instructors]);
  const homeTodayStudentSummaries = useMemo<HomePersonSummary[]>(() => {
    const byStudent = new Map<string, HomePersonSummary>();
    for (const event of homeTodayEvents) {
      event.studentNames.forEach((name, index) => {
        const id = event.studentIds[index] ?? name;
        const option = students.find((item) => item.id === id || normalizePersonName(item.name) === normalizePersonName(name));
        const key = option?.id ?? id;
        const existing = byStudent.get(key);
        if (existing) {
          existing.events.push(event);
          return;
        }
        byStudent.set(key, {
          id: key,
          name: option?.name ?? name,
          secondary: option?.secondary,
          school: option?.school,
          schoolIconUrl: option?.schoolIconUrl,
          events: [event]
        });
      });
    }
    return [...byStudent.values()].sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name, "ko"));
  }, [homeTodayEvents, students]);
  const currentTargetId = roleView === "student" ? selectedStudentId : selectedInstructorId;
  const currentTargetLabel = roleView === "student" ? selectedStudentLabel : selectedInstructorLabel;
  const isInstructorReadOnly = viewerRole === "instructor";
  const isHomeDashboardLoading =
    showIntroPage &&
    !isInstructorReadOnly &&
    (!viewerRoleResolved || !scheduleTagSelectionReady || overviewLoading || timetableGroupsLoading);
  const selectedSubjectForPlacement = useMemo(
    () => subjects.find((subject) => subject.code === newPlacementDraft.subjectCode) ?? null,
    [newPlacementDraft.subjectCode, subjects]
  );
  const selectedClassTypeForPlacement = useMemo(
    () => classTypes.find((type) => type.code === newPlacementDraft.classTypeCode) ?? null,
    [classTypes, newPlacementDraft.classTypeCode]
  );
  const groupedUniverseEvents = useMemo(() => {
    const eventMap = new Map<string, ScheduleEvent>();
    for (const group of effectiveStudentGroupByTargetId.values()) {
      for (const event of group.snapshotEvents ?? []) {
        eventMap.set(event.id, event);
      }
    }
    for (const event of events) {
      eventMap.set(event.id, event);
    }
    return [...eventMap.values()];
  }, [effectiveStudentGroupByTargetId, events]);
  const placementRecommendations = useMemo(() => {
    if (!selectedSubjectForPlacement || !selectedClassTypeForPlacement) return [] as RecommendationItem[];
    if (newPlacementDraft.preferredWeekdays.length === 0 || newPlacementDraft.preferredTimes.length === 0) return [] as RecommendationItem[];

    const strictRequest = isStrictConflictClassType(selectedClassTypeForPlacement.code, selectedClassTypeForPlacement.label);
    const recommendations: RecommendationItem[] = [];
    const seen = new Set<string>();

    for (const weekday of [...newPlacementDraft.preferredWeekdays].sort((a, b) => a - b)) {
      for (const startTime of [...newPlacementDraft.preferredTimes].sort()) {
        const endTime = addMinutesToClock(startTime, 60);
        for (const instructor of overviewVisibleInstructors) {
          if (!instructorMatchesSubject(instructor, selectedSubjectForPlacement.label)) continue;
          if (normalizeDaysOff(instructor.daysOff).includes(weekday)) continue;
          const availableTimeSlots = getInstructorAvailableTimeSlotsForWeekday(instructor, weekday);
          if (availableTimeSlots.length > 0 && !availableTimeSlots.includes(startTime)) continue;

          const overlaps = groupedUniverseEvents.filter(
            (event) =>
              event.instructorId === instructor.id &&
              event.weekday === weekday &&
              hasTimeOverlap(startTime, endTime, event.startTime, event.endTime)
          );

          let next: RecommendationItem | null = null;

          if (strictRequest) {
            if (overlaps.length === 0) {
              next = {
                key: `${instructor.id}-${weekday}-${startTime}-new`,
                instructorId: instructor.id,
                instructorName: instructor.name,
                instructorSecondary: instructor.secondary,
                weekday,
                startTime,
                endTime,
                mode: "new",
                classTypeLabel: selectedClassTypeForPlacement.label,
                reason: "1:1/2:1 신규 배정 가능",
                existingStudentNames: []
              };
            }
          } else {
            const hasStrictOverlap = overlaps.some((event) => isStrictConflictClassType(event.classTypeCode, event.classTypeLabel));
            const sameSubjectRegular = overlaps.filter(
              (event) =>
                !isStrictConflictClassType(event.classTypeCode, event.classTypeLabel) &&
                normalizeLookupToken(event.subjectCode) === normalizeLookupToken(selectedSubjectForPlacement.code)
            );

            if (!hasStrictOverlap && sameSubjectRegular.length > 0) {
              next = {
                key: `${instructor.id}-${weekday}-${startTime}-join-${sameSubjectRegular[0]!.id}`,
                instructorId: instructor.id,
                instructorName: instructor.name,
                instructorSecondary: instructor.secondary,
                weekday,
                startTime,
                endTime,
                mode: "join",
                classTypeLabel: sameSubjectRegular[0]!.classTypeLabel,
                reason: "기존 개별정규 수업에 합류 가능",
                existingStudentNames: Array.from(new Set(sameSubjectRegular.flatMap((event) => event.studentNames))).slice(0, 4)
              };
            } else if (!hasStrictOverlap && overlaps.length === 0) {
              next = {
                key: `${instructor.id}-${weekday}-${startTime}-new`,
                instructorId: instructor.id,
                instructorName: instructor.name,
                instructorSecondary: instructor.secondary,
                weekday,
                startTime,
                endTime,
                mode: "new",
                classTypeLabel: selectedClassTypeForPlacement.label,
                reason: "개별정규 신규 편성 가능",
                existingStudentNames: []
              };
            }
          }

          if (next && !seen.has(next.key)) {
            seen.add(next.key);
            recommendations.push(next);
          }
        }
      }
    }

    return recommendations.sort((a, b) => {
      if (a.weekday !== b.weekday) return a.weekday - b.weekday;
      if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
      if (a.mode !== b.mode) return a.mode === "join" ? -1 : 1;
      return a.instructorName.localeCompare(b.instructorName, "ko");
    });
  }, [groupedUniverseEvents, newPlacementDraft.preferredTimes, newPlacementDraft.preferredWeekdays, overviewVisibleInstructors, selectedClassTypeForPlacement, selectedSubjectForPlacement]);
  const overviewDisplayEvents = useMemo(() => {
    if (overviewEntity === "instructor") {
      if (!selectedInstructorOption) {
        return [];
      }
      return overviewUniverseEvents.filter((event) => eventMatchesInstructorOption(event, selectedInstructorOption));
    }

    if (!selectedStudentId) {
      return [];
    }

    const studentWeekEvents = overviewEvents.filter((event) => event.studentIds.includes(selectedStudentId));
    const preferredGroup = effectiveStudentGroupByTargetId.get(selectedStudentId) ?? null;
    const preferredSnapshot = preferredGroup?.snapshotEvents ?? [];
    const groupedClassIds = Array.from(new Set((preferredGroup?.classIds ?? []).filter(Boolean)));
    const groupLinkedEvents =
      groupedClassIds.length > 0 ? studentWeekEvents.filter((event) => groupedClassIds.includes(event.id)) : [];

    return preferredSnapshot.length > 0
      ? preferredSnapshot
      : preferredGroup
        ? groupLinkedEvents
        : studentGroupTargetIdsForWeek.has(selectedStudentId)
          ? []
          : studentWeekEvents;
  }, [
    effectiveStudentGroupByTargetId,
    overviewEntity,
    overviewEvents,
    overviewUniverseEvents,
    selectedInstructorOption,
    selectedStudentId,
    studentGroupTargetIdsForWeek
  ]);
  const profileTitle =
    mainTab === "new"
      ? "시간표 생성"
      : mainTab === "review"
        ? "시간표 검토"
      : mainTab === "issues"
        ? "오류 기록"
        : roleView === "student"
          ? "학생 프로필"
          : "강사 프로필";
  const profileName =
    mainTab === "new"
      ? "학생 시간표 생성"
      : mainTab === "review"
        ? "주차별 학생 시간표 검토"
      : mainTab === "issues"
        ? "시간표 오류/충돌 기록"
        : roleView === "student"
          ? selectedStudentLabel
          : selectedInstructorLabel;
  const profileSecondary =
    mainTab === "new"
      ? "재원생과 신규문의 가안을 구성하고 저장한 뒤 활성 시간표를 운영 화면에 반영합니다."
      : mainTab === "review"
        ? "학생별 주간 시간표를 정상, 확인필요, 문제발생으로 빠르게 처리합니다."
      : mainTab === "issues"
        ? "저장된 충돌과 입력 오류를 학생명, 요일, 시간, 사유 기준으로 다시 확인합니다."
      : roleView === "student"
        ? selectedStudentSecondary
        : selectedInstructorSecondary;
  const profileInitial = (mainTab === "new"
    ? "신"
    : mainTab === "review"
      ? "검"
    : mainTab === "issues"
      ? "오"
    : profileName === "학생 선택" || profileName === "강사 선택"
      ? roleView === "student"
        ? "학"
        : "강"
      : profileName
  )
    .trim()
    .charAt(0);
  const getInstructorDaysOff = useCallback(
    (instructorId: string): Weekday[] => normalizeDaysOff(instructors.find((item) => item.id === instructorId)?.daysOff),
    [instructors]
  );
  const activeGroup = useMemo(
    () => {
      if (roleView === "student" && currentTargetId) {
        return effectiveStudentGroupByTargetId.get(currentTargetId) ?? null;
      }

      return (
        [...timetableGroups]
          .filter(
            (group) =>
              group.roleView === roleView &&
              group.targetId === currentTargetId &&
              (group.tagId ?? null) === selectedScheduleTagId &&
              group.isActive &&
              isGroupEffectiveForWeek(group, weekStart, todayISO)
          )
          .sort((a, b) => {
            if (a.weekStart !== b.weekStart) return b.weekStart.localeCompare(a.weekStart);
            return b.createdAt.localeCompare(a.createdAt);
          })[0] ?? null
      );
    },
    [currentTargetId, effectiveStudentGroupByTargetId, roleView, selectedScheduleTagId, timetableGroups, todayISO, weekStart]
  );
  const selectedGroup = useMemo(
    () =>
      (selectedGroupId
        ? timetableGroups.find(
            (group) =>
              group.id === selectedGroupId &&
              group.roleView === roleView &&
              group.targetId === currentTargetId &&
              (group.tagId ?? null) === selectedScheduleTagId
          )
        : null) ?? null,
    [currentTargetId, roleView, selectedGroupId, selectedScheduleTagId, timetableGroups]
  );
  const displayedGroup = selectedGroup ?? activeGroup;
  const isDisplayedGroupInactive = Boolean(
    displayedGroup &&
      !displayedGroup.isActive &&
      displayedGroup.id !== activeGroup?.id
  );
  const activeStudentEventsForInstructor = useMemo(() => {
    if (roleView !== "instructor" || !selectedInstructorId) return [];
    const selectedInstructorKey = normalizePersonName(selectedInstructorLabel);
    const activeStudentGroups = [...effectiveStudentGroupByTargetId.values()];
    const isForSelectedInstructor = (event: ScheduleEvent) => {
      if (event.instructorId === selectedInstructorId) return true;
      if (!selectedInstructorKey) return false;
      return normalizePersonName(event.instructorName) === selectedInstructorKey;
    };
    const isForActiveStudent = (event: ScheduleEvent) =>
      event.studentIds.some((studentId) => activeStudentIdSet.has(studentId)) ||
      event.studentNames.some((studentName) => activeStudentNameSet.has(normalizePersonName(studentName)));

    const liveInstructorEvents = filteredEvents.filter(
      (event) => isForSelectedInstructor(event) && isForActiveStudent(event)
    );
    if (activeStudentGroups.length === 0) return selectedScheduleTagId ? [] : liveInstructorEvents;

    const merged = activeStudentGroups.flatMap((group) => {
      const snapshot = (group.snapshotEvents ?? []).flatMap((event) => {
        if (!isForSelectedInstructor(event)) return [];
        const scopedEvent = scopeScheduleEventToStudent(event, group.targetId);
        return scopedEvent && isForActiveStudent(scopedEvent) ? [scopedEvent] : [];
      });
      const snapshotKeys = new Set(snapshot.map((event) => `${event.id}:${event.classDate}`));
      const liveLinked = liveInstructorEvents.flatMap((event) => {
        if (!group.classIds.includes(event.id) || snapshotKeys.has(`${event.id}:${event.classDate}`)) return [];
        const scopedEvent = scopeScheduleEventToStudent(event, group.targetId);
        return scopedEvent ? [scopedEvent] : [];
      });
      return [...snapshot, ...liveLinked];
    });
    const mergedWithLiveFallback = selectedScheduleTagId ? merged : [...merged, ...liveInstructorEvents];

    const dedup = new Map<string, ScheduleEvent>();
    for (const event of mergedWithLiveFallback) {
      const key = getInstructorScheduleMergeKey(event);
      const existing = dedup.get(key);
      if (!existing) {
        const mergedRoster = mergeStudentRosters(event, event);
        dedup.set(key, { ...event, ...mergedRoster });
        continue;
      }

      const mergedRoster = mergeStudentRosters(existing, event);
      dedup.set(key, {
        ...existing,
        ...mergedRoster
      });
    }
    return dedupeInstructorStudentTimeSlots(
      [...dedup.values()].sort((a, b) => {
        if (a.weekday !== b.weekday) return a.weekday - b.weekday;
        if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
        return a.subjectName.localeCompare(b.subjectName, "ko");
      })
    );
  }, [
    activeStudentIdSet,
    activeStudentNameSet,
    filteredEvents,
    roleView,
    selectedInstructorId,
    selectedInstructorLabel,
    selectedScheduleTagId,
    effectiveStudentGroupByTargetId
  ]);
  const notionDraftEvents = useMemo<ScheduleEvent[]>(() => {
    if (parsedNotionItems.length === 0) return [];
    return parsedNotionItems.map((item, index) => {
      const subjectMatch = resolveSubjectOption(item.subjectLabel, subjects);
      const classTypeMatch = resolveClassTypeOption(item.classTypeLabel, classTypes);
      const resolvedInstructorName = item.instructorName ? normalizeInstructorAlias(item.instructorName) : "";
      const instructorName =
        resolvedInstructorName ||
        (roleView === "student"
          ? "강사 확인 필요"
          : selectedInstructorLabel === "강사 선택"
            ? "미지정 강사"
            : selectedInstructorLabel);
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
  const syncDraftEvents = useMemo<ScheduleEvent[]>(
    () =>
      syncDraftItems.map((item) => ({
        id: item.id,
        scheduleMode: item.scheduleMode,
        instructorId: item.instructorId,
        instructorName: item.instructorName,
        studentIds: selectedStudentId ? [selectedStudentId] : [],
        studentNames: selectedStudentLabel !== "학생 선택" ? [selectedStudentLabel] : ["학생 미지정"],
        subjectCode: item.isSelfStudy ? "SELF_STUDY" : `SYNC_DRAFT:${normalizeLookupToken(item.subjectLabel) || "unknown"}`,
        subjectName: item.subjectLabel,
        classTypeCode: item.classTypeCode,
        classTypeLabel: item.classTypeLabel,
        badgeText: item.badgeText,
        weekday: item.weekday,
        classDate: item.classDate ?? shiftDate(weekStart, item.weekday - 1),
        startTime: item.startTime,
        endTime: item.endTime,
        note: item.note || item.rawText,
        progressStatus: "planned",
        createdAt: new Date().toISOString()
      })),
    [selectedStudentId, selectedStudentLabel, syncDraftItems, weekStart]
  );
  const draftEvents = studentScheduleInputTab === "sync" ? syncDraftEvents : notionDraftEvents;
  const displayEvents = useMemo(() => {
    const onlyActiveRosterEvents = (items: ScheduleEvent[]) =>
      items.filter(
        (event) =>
          eventHasInstructorInSet(event, activeInstructorIdSet, activeInstructorNameSet) &&
          (eventHasStudentInSet(event, activeStudentIdSet, activeStudentNameSet) || eventHasProspectStudent(event))
      );
    const filterInstructorStudent = (items: ScheduleEvent[]) => {
      if (!instructorStudentKeyword && !instructorStudentKeywordToken) return items;
      return items.filter((event) =>
        event.studentNames.some((studentName) => {
          const lowerName = studentName.toLowerCase();
          return (
            (instructorStudentKeyword && lowerName.includes(instructorStudentKeyword)) ||
            (instructorStudentKeywordToken && normalizeLookupToken(studentName).includes(instructorStudentKeywordToken))
          );
        })
      );
    };

    if (mainTab === "overview") {
      return onlyActiveRosterEvents(overviewDisplayEvents);
    }
    if (roleView === "instructor") {
      // 강사 탭은 활성 학생 기준 실시간 수업 + 활성 학생 그룹 스냅샷을 함께 반영한다.
      return filterInstructorStudent(onlyActiveRosterEvents(activeStudentEventsForInstructor));
    }

    if (isCreatingNewSyncTimetable && studentScheduleInputTab === "sync") {
      return draftEvents;
    }

    const preferredGroup = selectedGroup ?? activeGroup;
    if (preferredGroup) {
      const snapshot = preferredGroup.snapshotEvents ?? [];
      const hasDraftSnapshot = snapshot.some((event) => event.id.startsWith("draft-"));
      if (snapshot.length > 0 && !hasDraftSnapshot) {
        return onlyActiveRosterEvents(snapshot);
      }
      const idSet = new Set(preferredGroup.classIds);
      return onlyActiveRosterEvents(filteredEvents.filter((event) => idSet.has(event.id)));
    }
    if (draftEvents.length > 0) return draftEvents;
    if (selectedScheduleTagId) return [];
    if (selectedStudentId && studentGroupTargetIdsForWeek.has(selectedStudentId)) return [];
    return onlyActiveRosterEvents(filteredEvents);
  }, [
    activeGroup,
    activeInstructorIdSet,
    activeInstructorNameSet,
    activeStudentEventsForInstructor,
    activeStudentIdSet,
    activeStudentNameSet,
    draftEvents,
    filteredEvents,
    instructorStudentKeyword,
    instructorStudentKeywordToken,
    isCreatingNewSyncTimetable,
    mainTab,
    overviewDisplayEvents,
    roleView,
    selectedScheduleTagId,
    selectedGroup,
    selectedStudentId,
    studentScheduleInputTab,
    studentGroupTargetIdsForWeek
  ]);
  const timetableEmptyMessage = useMemo(() => {
    if (roleView !== "student" || displayEvents.length > 0) return undefined;
    if (!selectedScheduleTagId) {
      return "분류(태그)를 선택하면 해당 범위의 시간표만 표시됩니다.";
    }
    if (!displayedGroup) {
      return `#${selectedScheduleTagLabel}로 저장된 시간표가 없습니다. 미분류 시간표는 이 범위에 표시되지 않습니다.`;
    }
    return `#${selectedScheduleTagLabel} 시간표에 등록된 수업이 없습니다.`;
  }, [displayEvents.length, displayedGroup, roleView, selectedScheduleTagId, selectedScheduleTagLabel]);
  const specialNotesByGroupId = useMemo(() => {
    const notesByGroup = new Map<string, SpecialNoteItem[]>();
    for (const note of specialNotes) {
      if (!note.groupId || !note.content.trim()) continue;
      const groupNotes = notesByGroup.get(note.groupId) ?? [];
      groupNotes.push(note);
      notesByGroup.set(note.groupId, groupNotes);
    }
    return notesByGroup;
  }, [specialNotes]);
  const displayedGroupNotes = useMemo(
    () => (displayedGroup ? specialNotesByGroupId.get(displayedGroup.id) ?? [] : []),
    [displayedGroup, specialNotesByGroupId]
  );
  const eventDateSet = useMemo(() => new Set(displayEvents.map((event) => event.classDate)), [displayEvents]);
  const filteredInstructors = useMemo(
    () => (keyword.length === 0 ? instructors : instructors.filter((item) => item.name.toLowerCase().includes(keyword))),
    [instructors, keyword]
  );
  const filteredStudents = useMemo(
    () => (keyword.length === 0 ? students : students.filter((item) => item.name.toLowerCase().includes(keyword))),
    [students, keyword]
  );
  const effectiveGroupIdSet = useMemo(
    () => new Set([...effectiveStudentGroupByTargetId.values()].map((group) => group.id)),
    [effectiveStudentGroupByTargetId]
  );
  const filteredGroups = useMemo(
    () =>
      timetableGroups
        .filter((group) => group.roleView === roleView && group.targetId === currentTargetId)
        .filter((group) => (showActiveOnly ? group.isActive || effectiveGroupIdSet.has(group.id) : true))
        .sort((a, b) => {
          const aEffective = effectiveGroupIdSet.has(a.id);
          const bEffective = effectiveGroupIdSet.has(b.id);
          if (aEffective !== bEffective) return aEffective ? -1 : 1;
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          return b.createdAt.localeCompare(a.createdAt);
        }),
    [currentTargetId, effectiveGroupIdSet, roleView, showActiveOnly, timetableGroups]
  );
  const currentGroupMonthKey = useMemo(() => calendarMonth.slice(0, 7), [calendarMonth]);
  const groupMonthSections = useMemo<TimetableGroupMonthSection[]>(() => {
    const groupsBySection = new Map<string, TimetableGroup[]>();
    for (const group of filteredGroups) {
      const monthKey = getTimetableGroupMonthKey(group);
      const sectionKey = `${group.tagId ?? "untagged"}::${monthKey}`;
      const bucket = groupsBySection.get(sectionKey) ?? [];
      bucket.push(group);
      groupsBySection.set(sectionKey, bucket);
    }

    return [...groupsBySection.entries()]
      .sort(([a], [b]) => {
        const [aTag, aMonth] = a.split("::");
        const [bTag, bMonth] = b.split("::");
        const selectedTagKey = selectedScheduleTagId ?? "untagged";
        if (aTag === selectedTagKey && bTag !== selectedTagKey) return -1;
        if (bTag === selectedTagKey && aTag !== selectedTagKey) return 1;
        if (aMonth === currentGroupMonthKey && bMonth !== currentGroupMonthKey) return -1;
        if (bMonth === currentGroupMonthKey && aMonth !== currentGroupMonthKey) return 1;
        return b.localeCompare(a);
      })
      .map(([sectionKey, groups]) => {
        const monthKey = sectionKey.split("::")[1] ?? "";
        const tagId = groups[0]?.tagId ?? null;
        const tag = scheduleTags.find((item) => item.id === tagId);
        return {
          sectionKey,
          monthKey,
          label: formatTimetableGroupMonthLabel(monthKey),
          tagId,
          tagName: tag?.name ?? "미분류",
          tagColorKey: tag?.colorKey ?? "slate",
          isCurrentMonth: monthKey === currentGroupMonthKey,
          groups
        };
      });
  }, [currentGroupMonthKey, filteredGroups, scheduleTags, selectedScheduleTagId]);
  const reviewStudents = useMemo(() => {
    const byKey = new Map<string, SelectOption>();

    for (const student of students) {
      const key = getReviewStudentKey(student);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, student);
        continue;
      }

      const existingHasDetail = Boolean(existing.secondary);
      const nextHasDetail = Boolean(student.secondary);
      if (!existingHasDetail && nextHasDetail) {
        byKey.set(key, student);
      }
    }


    for (const event of reviewEvents) {
      event.studentIds.forEach((studentId, index) => {
        if (!studentId.startsWith("prospect:")) return;
        const name = event.studentNames[index] ?? event.studentNames[0] ?? "[가안] 신규문의";
        if (!byKey.has(studentId)) {
          byKey.set(studentId, { id: studentId, name, secondary: "신규문의 가안" });
        }
      });
    }

    return [...byKey.values()];
  }, [reviewEvents, students]);
  const reviewStudentAlias = useMemo(() => {
    const idToCanonical = new Map<string, SelectOption>();
    const nameToCanonical = new Map<string, SelectOption>();
    const canonicalByKey = new Map(reviewStudents.map((student) => [getReviewStudentKey(student), student]));

    for (const student of reviewStudents) {
      idToCanonical.set(student.id, student);
      const normalizedName = normalizePersonName(student.name);
      if (normalizedName && !nameToCanonical.has(normalizedName)) {
        nameToCanonical.set(normalizedName, student);
      }
    }

    for (const student of students) {
      const key = getReviewStudentKey(student);
      const canonical = canonicalByKey.get(key) ?? student;
      idToCanonical.set(student.id, canonical);
      const normalizedName = normalizePersonName(student.name);
      if (normalizedName && !nameToCanonical.has(normalizedName)) {
        nameToCanonical.set(normalizedName, canonical);
      }
    }

    return { idToCanonical, nameToCanonical };
  }, [reviewStudents, students]);
  const reviewByStudentId = useMemo(() => {
    const map = new Map<string, ScheduleReviewItem>();
    for (const item of scheduleReviews) {
      const canonicalStudent =
        reviewStudentAlias.idToCanonical.get(item.studentId) ??
        (item.studentName ? reviewStudentAlias.nameToCanonical.get(normalizePersonName(item.studentName)) : undefined);
      if (!canonicalStudent) {
        continue;
      }
      const canonicalId = canonicalStudent.id;
      const existing = map.get(canonicalId);
      if (!existing || (item.reviewedAt ?? "") > (existing.reviewedAt ?? "")) {
        map.set(canonicalId, { ...item, studentId: canonicalId });
      }
    }
    return map;
  }, [reviewStudentAlias, scheduleReviews]);
  const reviewActiveGroupByStudentId = useMemo(() => {
    const byStudentId = new Map<string, TimetableGroup>();

    for (const group of timetableGroups) {
      if (
        group.roleView !== "student" ||
        !group.isActive ||
        (group.tagId ?? null) !== selectedScheduleTagId ||
        !isGroupEffectiveForWeek(group, weekStart, todayISO)
      ) {
        continue;
      }
      const normalizedGroupName = normalizeLookupToken(group.name);
      const canonicalStudent =
        reviewStudentAlias.idToCanonical.get(group.targetId) ??
        [...reviewStudents]
          .filter((student) => {
            const normalizedStudentName = normalizeLookupToken(student.name);
            return Boolean(normalizedStudentName && normalizedGroupName.includes(normalizedStudentName));
          })
          .sort((a, b) => normalizeLookupToken(b.name).length - normalizeLookupToken(a.name).length)[0];
      if (!canonicalStudent) {
        continue;
      }

      const existingGroup = byStudentId.get(canonicalStudent.id);
      const targetsCanonicalStudent = group.targetId === canonicalStudent.id;
      const existingTargetsCanonicalStudent = existingGroup?.targetId === canonicalStudent.id;
      const groupEventCount = (group.snapshotEvents?.length ?? 0) > 0
        ? group.snapshotEvents!.length
        : group.classIds.length;
      const existingGroupEventCount = existingGroup
        ? (existingGroup.snapshotEvents?.length ?? 0) > 0
          ? existingGroup.snapshotEvents!.length
          : existingGroup.classIds.length
        : -1;
      if (
        !existingGroup ||
        groupEventCount > existingGroupEventCount ||
        (groupEventCount === existingGroupEventCount && targetsCanonicalStudent && !existingTargetsCanonicalStudent) ||
        (groupEventCount === existingGroupEventCount &&
          targetsCanonicalStudent === existingTargetsCanonicalStudent &&
          compareEffectiveTimetableGroup(group, existingGroup) < 0)
      ) {
        byStudentId.set(canonicalStudent.id, group);
      }
    }

    return byStudentId;
  }, [reviewStudentAlias, reviewStudents, selectedScheduleTagId, timetableGroups, todayISO, weekStart]);
  const reviewEligibleStudents = useMemo(
    () => reviewStudents.filter((student) => reviewActiveGroupByStudentId.has(student.id)),
    [reviewActiveGroupByStudentId, reviewStudents]
  );
  const reviewEventsByStudentId = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>();

    for (const student of reviewStudents) {
      const targetedEvents = targetedReviewEventsByStudentId[student.id];
      if (targetedEvents) {
        map.set(
          student.id,
          targetedEvents
            .filter(
              (event) =>
                eventHasInstructorInSet(event, activeInstructorIdSet, activeInstructorNameSet) &&
                eventHasStudentInSet(event, activeStudentIdSet, activeStudentNameSet)
            )
            .sort((a, b) => {
              if (a.weekday !== b.weekday) return a.weekday - b.weekday;
              return a.startTime.localeCompare(b.startTime);
            })
        );
        continue;
      }

      const activeGroup = reviewActiveGroupByStudentId.get(student.id);
      const liveLinkedEvents = activeGroup?.classIds.length
        ? reviewEvents.filter((event) => activeGroup.classIds.includes(event.id))
        : [];
      const sourceEvents =
        activeGroup && (activeGroup.snapshotEvents?.length ?? 0) > 0
          ? mergeScheduleReviewEvents(activeGroup.snapshotEvents ?? [], liveLinkedEvents)
          : activeGroup?.classIds.length
            ? liveLinkedEvents
            : [];

      const studentEvents: ScheduleEvent[] = [];

      for (const event of sourceEvents) {
        const isProspect = student.id.startsWith("prospect:");
        if (
          !eventHasInstructorInSet(event, activeInstructorIdSet, activeInstructorNameSet) ||
          (!isProspect && !eventHasStudentInSet(event, activeStudentIdSet, activeStudentNameSet))
        ) {
          continue;
        }

        const hasCanonicalStudent =
          event.studentIds.some((studentId) => reviewStudentAlias.idToCanonical.get(studentId)?.id === student.id) ||
          event.studentNames.some((studentName) => reviewStudentAlias.nameToCanonical.get(normalizePersonName(studentName))?.id === student.id);
        // A saved student group already scopes its snapshot to the target student.
        // Older snapshots can omit that student from an individual class record,
        // so requiring the embedded link here would hide classes that the student
        // timetable correctly renders from the same group.
        if (!activeGroup && !hasCanonicalStudent) {
          continue;
        }

        studentEvents.push(event);
      }

      studentEvents.sort((a, b) => {
        if (a.weekday !== b.weekday) return a.weekday - b.weekday;
        return a.startTime.localeCompare(b.startTime);
      });

      map.set(student.id, studentEvents);
    }

    return map;
  }, [
    activeInstructorIdSet,
    activeInstructorNameSet,
    activeStudentIdSet,
    activeStudentNameSet,
    reviewActiveGroupByStudentId,
    reviewEvents,
    reviewStudentAlias,
    reviewStudents,
    targetedReviewEventsByStudentId
  ]);
  const reviewFingerprintByStudentId = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of reviewStudents) {
      map.set(student.id, getScheduleReviewFingerprint(reviewEventsByStudentId.get(student.id) ?? []));
    }
    return map;
  }, [reviewEventsByStudentId, reviewStudents]);
  const staleReviewStudentIds = useMemo(() => {
    const stale = new Set<string>();
    for (const [studentId, review] of reviewByStudentId) {
      if (!review.snapshotFingerprint) continue;
      if (review.snapshotFingerprint !== reviewFingerprintByStudentId.get(studentId)) stale.add(studentId);
    }
    return stale;
  }, [reviewByStudentId, reviewFingerprintByStudentId]);
  const getReviewHints = useCallback((eventsForStudent: ScheduleEvent[]) => {
    const hints: string[] = [];
    if (eventsForStudent.length === 0) {
      hints.push("이번 주 수업 없음");
    }

    for (let i = 0; i < eventsForStudent.length; i += 1) {
      for (let j = i + 1; j < eventsForStudent.length; j += 1) {
        const a = eventsForStudent[i]!;
        const b = eventsForStudent[j]!;
        if (a.weekday !== b.weekday) continue;
        if (timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(a.endTime) > timeToMinutes(b.startTime)) {
          hints.push(`${weekdayLabel(a.weekday)} ${a.startTime} 시간 중복`);
        }
      }
    }

    if (eventsForStudent.some((event) => timeToMinutes(event.endTime) > 22 * 60)) {
      hints.push("22시 이후 종료");
    }

    return Array.from(new Set(hints)).slice(0, 3);
  }, []);
  const reviewRows = useMemo(() => {
    return reviewEligibleStudents
      .map((student) => {
        const eventsForStudent = reviewEventsByStudentId.get(student.id) ?? [];
        const review = reviewByStudentId.get(student.id) ?? null;
        const isStale = staleReviewStudentIds.has(student.id);
        const hints = getReviewHints(eventsForStudent);
        return {
          student,
          events: eventsForStudent,
          review,
          effectiveReview: isStale ? null : review,
          isStale,
          hints
        };
      })
      .filter((row) => {
        if (reviewFilter === "all") return true;
        if (reviewFilter === "unreviewed") return !row.effectiveReview;
        if (reviewFilter === "memo") return Boolean(row.review?.memo?.trim());
        return row.effectiveReview?.status === reviewFilter;
      })
      .filter((row) => {
        const keyword = reviewSearchKeyword.trim().toLowerCase();
        if (!keyword) return true;
        return [row.student.name, row.student.secondary ?? ""].join(" ").toLowerCase().includes(keyword);
      })
      .sort((a, b) => {
        if (reviewSortMode === "class_desc") {
          return b.events.length - a.events.length || a.student.name.localeCompare(b.student.name, "ko");
        }
        if (reviewSortMode === "class_asc") {
          return a.events.length - b.events.length || a.student.name.localeCompare(b.student.name, "ko");
        }
        if (reviewSortMode === "name") {
          return a.student.name.localeCompare(b.student.name, "ko");
        }
        const aStatus = a.effectiveReview?.status ?? "unreviewed";
        const bStatus = b.effectiveReview?.status ?? "unreviewed";
        if (aStatus !== bStatus) {
          const order = ["unreviewed", "issue", "needs_check", "normal"];
          return order.indexOf(aStatus) - order.indexOf(bStatus);
        }
        return b.events.length - a.events.length || a.student.name.localeCompare(b.student.name, "ko");
      });
  }, [getReviewHints, reviewByStudentId, reviewEligibleStudents, reviewEventsByStudentId, reviewFilter, reviewSearchKeyword, reviewSortMode, staleReviewStudentIds]);
  const reviewStats = useMemo(() => {
    const eligibleStudentIds = new Set(reviewEligibleStudents.map((student) => student.id));
    const effectiveReviews = [...reviewByStudentId.entries()].filter(
      ([studentId]) => eligibleStudentIds.has(studentId) && !staleReviewStudentIds.has(studentId)
    );
    const reviewedIds = new Set(effectiveReviews.map(([studentId]) => studentId));
    return {
      total: reviewEligibleStudents.length,
      normal: effectiveReviews.filter(([, item]) => item.status === "normal").length,
      needsCheck: effectiveReviews.filter(([, item]) => item.status === "needs_check").length,
      issue: effectiveReviews.filter(([, item]) => item.status === "issue").length,
      unreviewed: reviewEligibleStudents.filter((student) => !reviewedIds.has(student.id)).length,
      memo: [...reviewByStudentId.entries()].filter(
        ([studentId, item]) => eligibleStudentIds.has(studentId) && item.memo.trim().length > 0
      ).length
    };
  }, [reviewByStudentId, reviewEligibleStudents, staleReviewStudentIds]);
  const selectedReviewStudent = useMemo(
    () => reviewRows.find((row) => row.student.id === selectedReviewStudentId)?.student ?? reviewRows[0]?.student ?? null,
    [reviewRows, selectedReviewStudentId]
  );
  const selectedReview = selectedReviewStudent ? reviewByStudentId.get(selectedReviewStudent.id) ?? null : null;
  const selectedReviewIsStale = Boolean(selectedReviewStudent && staleReviewStudentIds.has(selectedReviewStudent.id));
  const selectedReviewEvents = useMemo(
    () => (selectedReviewStudent ? reviewEventsByStudentId.get(selectedReviewStudent.id) ?? [] : []),
    [reviewEventsByStudentId, selectedReviewStudent]
  );
  const selectedReviewHistory = useMemo(() => {
    if (!selectedReviewStudent) return [];
    return scheduleReviewHistory
      .filter((item) => {
        const canonicalStudent =
          reviewStudentAlias.idToCanonical.get(item.studentId) ??
          (item.studentName ? reviewStudentAlias.nameToCanonical.get(normalizePersonName(item.studentName)) : undefined);
        return canonicalStudent?.id === selectedReviewStudent.id;
      })
      .sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? ""))
      .slice(0, 8);
  }, [reviewStudentAlias, scheduleReviewHistory, selectedReviewStudent]);
  const selectedReviewProgressByEventKey = useMemo(() => {
    const progress = new Map<string, { index: number; total: number }>();
    const eventGroups = new Map<string, ScheduleEvent[]>();

    for (const event of selectedReviewEvents) {
      const key = [
        event.weekday,
        getReviewSubjectKey(event)
      ].join("::");
      const bucket = eventGroups.get(key) ?? [];
      bucket.push(event);
      eventGroups.set(key, bucket);
    }

    for (const group of eventGroups.values()) {
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
          progress.set(getReviewEventKey(event), {
            index: idx - chainStart + 1,
            total
          });
        }
        chainStart = chainEnd + 1;
      }
    }

    return progress;
  }, [selectedReviewEvents]);
  const selectedReviewHints = useMemo(() => getReviewHints(selectedReviewEvents), [getReviewHints, selectedReviewEvents]);
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
  const filteredConflictLogs = useMemo(
    () =>
      keyword.length === 0
        ? conflictLogs
        : conflictLogs.filter((item) => {
            const searchable = [
              item.studentName,
              item.instructorName ?? "",
              weekdayLabel(item.weekday),
              item.startTime,
              item.endTime,
              item.reason,
              item.details ?? "",
              item.source,
              item.targetName ?? ""
            ]
              .join(" ")
              .toLowerCase();
            return searchable.includes(keyword);
          }),
    [conflictLogs, keyword]
  );

  const moveToLogin = useCallback(() => {
    router.replace(`/login?next=${encodeURIComponent("/synchro-s")}`);
  }, [router]);

  const handleMainTabChange = useCallback(
    (next: MainTab) => {
      setError(null);
      setShowIntroPage(false);
      setMainTab(next);
      setSearchKeyword("");
      setShowStudentPicker(false);
      setShowInstructorPicker(false);

      if (next === "overview") {
        setRoleView(overviewEntity);
        if (
          overviewEntity === "instructor" &&
          overviewVisibleInstructors.length > 0 &&
          !overviewVisibleInstructors.some((item) => item.id === selectedInstructorId)
        ) {
          setSelectedInstructorId(overviewVisibleInstructors[0]!.id);
        }
        if (overviewEntity === "student" && students.length > 0 && !students.some((item) => item.id === selectedStudentId)) {
          setSelectedStudentId(students[0]!.id);
        }
        return;
      }

      if (next === "review") {
        setRoleView("student");
        if (!selectedReviewStudentId && reviewEligibleStudents.length > 0) {
          setSelectedReviewStudentId(reviewEligibleStudents[0]!.id);
        }
        return;
      }

      if (next === "new") {
        setRoleView("student");
        return;
      }

      if (next === "issues") {
        return;
      }

      setRoleView(next);
    },
    [overviewEntity, overviewVisibleInstructors, reviewEligibleStudents, selectedInstructorId, selectedReviewStudentId, selectedStudentId, students]
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

  const loadOptions = useCallback(async (opts?: { refreshSheets?: boolean }) => {
    const query = new URLSearchParams();
    if (opts?.refreshSheets) {
      query.set("refreshSheets", "1");
    }
    const queryString = query.toString();
    const url = queryString ? `/api/schedules/options?${queryString}` : "/api/schedules/options";
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: await getFirebaseAuthHeaders(undefined, Boolean(opts?.refreshSheets))
    });

    if (res.status === 401) {
      moveToLogin();
      return;
    }

    if (!res.ok) {
      throw new Error(await getApiErrorMessage(res, "/api/schedules/options 호출에 실패했습니다."));
    }

    const data = (await res.json()) as OptionsResponse;

    let decoratedStudents = data.students;
    let decoratedSuspendedStudents = data.suspendedStudents ?? [];
    try {
      const schoolIcons = await loadSchoolIconRegistry(Boolean(opts?.refreshSheets));
      const decorate = (student: SelectOption): SelectOption => ({
        ...student,
        school: getSchoolName(student) || undefined,
        schoolIconUrl: resolveSchoolIconUrl(schoolIcons, student)
      });
      decoratedStudents = data.students.map(decorate);
      decoratedSuspendedStudents = (data.suspendedStudents ?? []).map(decorate);
    } catch (iconError) {
      console.warn("학교 엠블럼을 불러오지 못해 이니셜로 표시합니다.", iconError);
    }

    setInstructors(data.instructors);
    setSuspendedInstructors(data.suspendedInstructors ?? []);
    setStudents(decoratedStudents);
    setSuspendedStudents(decoratedSuspendedStudents);
    setSubjects(data.subjects);
    setClassTypes(data.classTypes);
    if (data.viewerRole) {
      setViewerRole(data.viewerRole);
    }
    setViewerRoleResolved(true);

    setSelectedInstructorId((prev) => {
      if (data.instructors.some((item) => item.id === prev)) return prev;
      if (data.viewerRole === "instructor" && data.instructors.length > 0) return data.instructors[0]!.id;
      return "";
    });
    setSelectedStudentId((prev) => (data.students.some((item) => item.id === prev) ? prev : ""));

    if (data.viewerRole === "instructor") {
      setMainTab("instructor");
      setRoleView("instructor");
      setShowIntroPage(false);
    } else if (data.instructors.length > 0 && data.students.length === 0) {
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

    setError(null);
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
    const requestId = ++weekLoadRequestRef.current;
    if (roleView === "instructor" && !selectedInstructorId) {
      if (requestId === weekLoadRequestRef.current) {
        setEvents([]);
        setLoading(false);
      }
      return;
    }

    if (roleView === "student" && !selectedStudentId) {
      if (requestId === weekLoadRequestRef.current) {
        setEvents([]);
        setLoading(false);
      }
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
        throw new Error(await getApiErrorMessage(res, "/api/schedules/week 호출에 실패했습니다."));
      }

      const data = (await res.json()) as WeekResponse;
      if (requestId !== weekLoadRequestRef.current) return;
      setEvents(data.events);
      setError(null);
    } catch (loadError) {
      if (requestId !== weekLoadRequestRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load week schedule");
      setEvents([]);
    } finally {
      if (!opts?.silent && requestId === weekLoadRequestRef.current) {
        setLoading(false);
      }
    }
  }, [moveToLogin, roleView, selectedInstructorId, selectedStudentId, weekStart]);

  const loadSaveHistory = useCallback(async () => {
    const res = await fetch("/api/save-history", { method: "GET", cache: "no-store" });

    if (res.status === 401) {
      moveToLogin();
      return;
    }

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? "저장 기록을 불러오지 못했습니다.");
    }

    const data = (await res.json().catch(() => ({}))) as SaveHistoryResponse;
    setSaveHistory(
      (data.items ?? []).map((item) => ({
        id: item.id,
        timestampLabel: formatSaveHistoryTimestamp(new Date(item.created_at)),
        targetType: item.target_type,
        targetName: item.target_name,
        targetId: item.target_id ?? null,
        targetLabel: `${item.target_type}: ${item.target_name}`,
        tagId: item.tag_id ?? null,
        tagLabel: item.tag_name?.trim() || "기록 없음",
        source: item.source ?? "student_timetable",
        actor: {
          uid: item.created_by_uid ?? null,
          name: item.created_by_name ?? null,
          position: item.created_by_position ?? null,
          iconUrl: item.created_by_icon_url ?? null
        }
      }))
    );
    setError(null);
  }, [moveToLogin]);

  const loadConflictLogs = useCallback(async () => {
    setConflictLogsLoading(true);

    try {
      const res = await fetch("/api/conflict-logs", { method: "GET", cache: "no-store" });

      if (res.status === 401) {
        moveToLogin();
        return;
      }

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "오류 기록을 불러오지 못했습니다."));
      }

      const data = (await res.json().catch(() => ({}))) as ConflictLogsResponse;
      setConflictLogs(data.items ?? []);
      setError(null);
    } catch (loadError) {
      setConflictLogs([]);
      setError(loadError instanceof Error ? loadError.message : "오류 기록을 불러오지 못했습니다.");
    } finally {
      setConflictLogsLoading(false);
    }
  }, [moveToLogin]);

  const loadScheduleReviews = useCallback(async () => {
    if (mainTab !== "review") {
      return;
    }

    const requestedTagId = selectedScheduleTagId;
    setReviewLoading(true);

    try {
      const reviewQuery = new URLSearchParams({ weekStart, tagId: requestedTagId ?? "" });
      const weekQuery = new URLSearchParams({ weekStart, view: "student" });
      const [weekRes, reviewRes] = await Promise.all([
        fetch(`/api/schedules/week?${weekQuery.toString()}`, { method: "GET", cache: "no-store" }),
        fetch(`/api/timetable-notes?${reviewQuery.toString()}`, { method: "GET", cache: "no-store" })
      ]);

      if (weekRes.status === 401 || reviewRes.status === 401) {
        moveToLogin();
        return;
      }

      if (!reviewRes.ok) {
        throw new Error(await getApiErrorMessage(reviewRes, "시간표 검토 상태를 불러오지 못했습니다."));
      }

      // 검토 상태는 주간 시간표 응답과 독립적으로 먼저 복원합니다. 한쪽 요청이
      // 지연되거나 실패해도 이미 서버에 저장된 판정이 미검토로 되돌아가지 않습니다.
      const reviewData = (await reviewRes.json()) as ScheduleReviewsResponse;
      setScheduleReviews(reviewData.items ?? []);
      setScheduleReviewHistory(reviewData.historyItems ?? []);

      if (!weekRes.ok) {
        throw new Error(await getApiErrorMessage(weekRes, "검토용 시간표를 불러오지 못했습니다."));
      }
      const weekData = (await weekRes.json()) as { events?: ScheduleEvent[] };
      setReviewEvents(weekData.events ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "시간표 검토 데이터를 불러오지 못했습니다.");
    } finally {
      setReviewLoading(false);
    }
  }, [mainTab, moveToLogin, selectedScheduleTagId, weekStart]);

  useEffect(() => {
    setTargetedReviewEventsByStudentId({});
  }, [selectedScheduleTagId, weekStart]);

  useEffect(() => {
    if (mainTab !== "review" || !selectedReviewStudentId || targetedReviewEventsByStudentId[selectedReviewStudentId]) {
      return;
    }

    const selectedReviewGroup = reviewActiveGroupByStudentId.get(selectedReviewStudentId);
    if (!selectedReviewGroup) {
      setTargetedReviewEventsByStudentId((current) => ({ ...current, [selectedReviewStudentId]: [] }));
      return;
    }

    const controller = new AbortController();
    const selectedStudent = reviewStudents.find((student) => student.id === selectedReviewStudentId);
    const selectedName = normalizePersonName(selectedStudent?.name ?? "");
    const savedGroupTargetId = selectedReviewGroup.targetId;
    const candidateStudentIds = Array.from(
      new Set([
        selectedReviewStudentId,
        ...(savedGroupTargetId ? [savedGroupTargetId] : []),
        ...students
          .filter((student) => normalizePersonName(student.name) === selectedName)
          .map((student) => student.id)
      ])
    );

    void Promise.all(
      candidateStudentIds.map(async (studentId) => {
        const weekQuery = new URLSearchParams({ weekStart, view: "student", studentId });
        const groupQuery = new URLSearchParams({
          roleView: "student",
          targetId: studentId,
          tagId: selectedScheduleTagId ?? "",
          includeSnapshots: "1"
        });
        const [weekResponse, groupResponse] = await Promise.all([
          fetch(`/api/schedules/week?${weekQuery.toString()}`, {
            method: "GET",
            cache: "no-store",
            signal: controller.signal
          }),
          fetch(`/api/schedules/groups?${groupQuery.toString()}`, {
            method: "GET",
            cache: "no-store",
            signal: controller.signal
          })
        ]);
        if (weekResponse.status === 401 || groupResponse.status === 401) {
          moveToLogin();
          return null;
        }
        if (!weekResponse.ok) {
          throw new Error(await getApiErrorMessage(weekResponse, "학생별 검토 시간표를 불러오지 못했습니다."));
        }
        if (!groupResponse.ok) {
          throw new Error(await getApiErrorMessage(groupResponse, "학생별 저장 시간표를 불러오지 못했습니다."));
        }
        const weekData = (await weekResponse.json()) as WeekResponse;
        const groupData = (await groupResponse.json()) as TimetableGroupsResponse;
        const selectedGroup = selectEffectiveStudentTimetableGroup(
          (groupData.items ?? []).map(mapApiGroupToState),
          weekStart,
          selectedScheduleTagId,
          todayISO
        );
        const snapshotEvents = selectedGroup?.snapshotEvents ?? [];
        const selectedEvents = snapshotEvents.length > 0
          ? snapshotEvents
          : selectedGroup
            ? weekData.events.filter((event) => selectedGroup.classIds.includes(event.id))
            : [];
        return { ...weekData, events: selectedEvents };
      })
    )
      .then((results) => {
        if (controller.signal.aborted) return;
        const data = results
          .filter((item): item is WeekResponse => Boolean(item))
          .sort((a, b) => b.events.length - a.events.length)[0];
        if (!data) return;
        setTargetedReviewEventsByStudentId((current) => ({
          ...current,
          [selectedReviewStudentId]: data.events
        }));
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "학생별 검토 시간표를 불러오지 못했습니다.");
      });

    return () => controller.abort();
  }, [
    mainTab,
    moveToLogin,
    reviewActiveGroupByStudentId,
    reviewStudents,
    selectedReviewStudentId,
    selectedScheduleTagId,
    students,
    targetedReviewEventsByStudentId,
    todayISO,
    weekStart
  ]);

  const saveScheduleReview = useCallback(
    async (studentId: string, status: ReviewStatus, memo: string, action: "status" | "memo" = "status") => {
      if (!studentId || reviewSavingId) return;

      const previousReviews = scheduleReviews;
      const previousHistory = scheduleReviewHistory;
      const studentName = reviewStudents.find((student) => student.id === studentId)?.name ?? "";
      const existingReview = reviewByStudentId.get(studentId) ?? null;
      const reviewGroup = reviewActiveGroupByStudentId.get(studentId) ?? null;
      if (!reviewGroup) {
        setError(`#${selectedScheduleTagLabel}에 저장된 시간표가 없어 판정을 저장할 수 없습니다.`);
        return;
      }
      const shouldPreserveReviewSnapshot = action === "memo" && Boolean(existingReview?.snapshotFingerprint);
      const snapshot = createScheduleReviewSnapshot(
        shouldPreserveReviewSnapshot
          ? existingReview?.snapshotEvents ?? []
          : reviewEventsByStudentId.get(studentId) ?? []
      );
      const optimisticItem: ScheduleReviewItem = {
        id: `optimistic:${studentId}:${Date.now()}`,
        studentId,
        studentName,
        weekStart,
        tagId: selectedScheduleTagId,
        isLegacyFallback: false,
        status,
        memo: memo.trim(),
        reviewedAt: new Date().toISOString(),
        snapshotTagId: shouldPreserveReviewSnapshot ? existingReview?.snapshotTagId ?? selectedScheduleTagId : selectedScheduleTagId,
        snapshotTagName: shouldPreserveReviewSnapshot ? existingReview?.snapshotTagName ?? selectedScheduleTagLabel : selectedScheduleTagLabel,
        snapshotGroupId: shouldPreserveReviewSnapshot ? existingReview?.snapshotGroupId ?? reviewGroup.id : reviewGroup.id,
        snapshotGroupName: shouldPreserveReviewSnapshot ? existingReview?.snapshotGroupName ?? reviewGroup.name : reviewGroup.name,
        snapshotGroupWeekStart: shouldPreserveReviewSnapshot ? existingReview?.snapshotGroupWeekStart ?? reviewGroup.weekStart : reviewGroup.weekStart,
        ...(action === "status" || shouldPreserveReviewSnapshot
          ? snapshot
          : {
              snapshotEvents: existingReview?.snapshotEvents,
              snapshotFingerprint: existingReview?.snapshotFingerprint ?? null,
              snapshotEventCount: existingReview?.snapshotEventCount ?? null
            })
      };
      setReviewSavingId(studentId);
      setError(null);
      setNotice(null);
      setScheduleReviews((prev) => [optimisticItem, ...prev.filter((item) => item.studentId !== studentId)]);
      if (action === "status") {
        setScheduleReviewHistory((prev) => [optimisticItem, ...prev]);
      }

      try {
        const res = await fetch("/api/timetable-notes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            weekStart,
            studentId,
            tagId: selectedScheduleTagId,
            status,
            memo,
            action,
            snapshotGroupId: shouldPreserveReviewSnapshot ? existingReview?.snapshotGroupId ?? reviewGroup.id : reviewGroup.id,
            snapshotTagName: shouldPreserveReviewSnapshot ? existingReview?.snapshotTagName ?? selectedScheduleTagLabel : selectedScheduleTagLabel,
            ...(action === "status" || shouldPreserveReviewSnapshot ? { snapshotEvents: snapshot.snapshotEvents } : {})
          })
        });

        if (res.status === 401) {
          moveToLogin();
          return;
        }

        if (!res.ok) {
          throw new Error(await getApiErrorMessage(res, "시간표 검토 저장에 실패했습니다."));
        }

        const data = (await res.json().catch(() => ({}))) as { item?: ScheduleReviewItem; historyItem?: ScheduleReviewItem | null };
        if (data.item) {
          setScheduleReviews((prev) => [data.item!, ...prev.filter((item) => item.studentId !== studentId)]);
          if (studentId === selectedReviewStudentId) {
            setReviewMemoDraft(data.item.memo ?? "");
          }
        }
        if (action === "status" && data.historyItem) {
          setScheduleReviewHistory((prev) => [data.historyItem!, ...prev.filter((item) => item.id !== optimisticItem.id)]);
        }
        setNotice(action === "memo" ? "검토 메모를 서버에 저장했습니다." : `${REVIEW_STATUS_META[status].label} 상태를 서버에 저장했습니다.`);
      } catch (saveError) {
        setScheduleReviews(previousReviews);
        setScheduleReviewHistory(previousHistory);
        setError(saveError instanceof Error ? saveError.message : "시간표 검토 저장에 실패했습니다.");
      } finally {
        setReviewSavingId(null);
      }
    },
    [
      moveToLogin,
      reviewEventsByStudentId,
      reviewByStudentId,
      reviewActiveGroupByStudentId,
      reviewSavingId,
      reviewStudents,
      scheduleReviewHistory,
      scheduleReviews,
      selectedReviewStudentId,
      selectedScheduleTagId,
      selectedScheduleTagLabel,
      weekStart
    ]
  );

  const resolveStudentNames = useCallback(
    (studentIds: string[]) =>
      studentIds
        .map((studentId) => students.find((item) => item.id === studentId)?.name ?? "")
        .filter(Boolean),
    [students]
  );

  const recordConflictLogs = useCallback(
    async (items: ConflictLogCreateInput[]) => {
      if (items.length === 0) {
        return;
      }

      try {
        const res = await fetch("/api/conflict-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items })
        });

        if (res.status === 401) {
          moveToLogin();
          return;
        }

        if (!res.ok) {
          throw new Error(await getApiErrorMessage(res, "오류 기록 저장에 실패했습니다."));
        }

        if (mainTab === "issues") {
          await loadConflictLogs();
        }
      } catch (recordError) {
        console.error("[conflict-logs] failed to persist conflict logs", recordError);
      }
    },
    [loadConflictLogs, mainTab, moveToLogin]
  );

  const loadTimetableGroups = useCallback(async (opts?: { silent?: boolean }) => {
    const requestId = ++timetableGroupsLoadRequestRef.current;
    if (!opts?.silent) setTimetableGroupsLoading(true);

    try {
      const fetchGroups = async (query: URLSearchParams) => {
        const url = `/api/schedules/groups?${query.toString()}`;
        const res = await fetch(url, { method: "GET", cache: "no-store" });

        if (res.status === 401) {
          moveToLogin();
          return [] as TimetableGroup[];
        }

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "저장된 시간표 그룹을 불러오지 못했습니다.");
        }

        const data = (await res.json().catch(() => ({}))) as TimetableGroupsResponse;
        if (typeof data.supportsExpiration === "boolean") {
          setTimetableGroupExpirationSupported((prev) => prev && data.supportsExpiration === true);
        }
        return (data.items ?? []).map(mapApiGroupToState);
      };

      const activeQuery = new URLSearchParams({
        roleView: "student",
        effectiveWeekStart: shiftDate(weekStart, 7),
        includeSnapshots:
          mainTab === "review" || roleView === "instructor" || isInstructorReadOnly || (showIntroPage && !isInstructorReadOnly)
            ? "1"
            : "0",
        activeOnly: "1",
        tagId: selectedScheduleTagId ?? ""
      });
      setTimetableGroupExpirationSupported(true);
      const requests = [fetchGroups(activeQuery)];

      if (currentTargetId) {
        requests.push(fetchGroups(new URLSearchParams({ roleView, targetId: currentTargetId })));
      }

      const responses = await Promise.all(requests);
      const mergedById = new Map<string, TimetableGroup>();
      for (const item of responses.flat()) {
        mergedById.set(item.id, item);
      }
      const mergedGroups = [...mergedById.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (requestId !== timetableGroupsLoadRequestRef.current) return;
      setTimetableGroups(mergedGroups);
      setError(null);
    } catch (loadError) {
      if (requestId !== timetableGroupsLoadRequestRef.current) return;
      throw loadError;
    } finally {
      if (requestId === timetableGroupsLoadRequestRef.current) setTimetableGroupsLoading(false);
    }
  }, [currentTargetId, isInstructorReadOnly, mainTab, moveToLogin, roleView, selectedScheduleTagId, showIntroPage, weekStart]);

  const createTimetableGroup = useCallback(
    async (input: {
      name: string;
      roleView: RoleView;
      targetId: string;
      weekStart: string;
      expiresOn?: string | null;
      tagId?: string | null;
      classIds: string[];
      snapshotEvents: ScheduleEvent[];
      isActive?: boolean;
    }) => {
      const resolvedTagId = input.tagId === undefined ? selectedScheduleTagId : input.tagId;
      if (input.roleView === "student" && !resolvedTagId) {
        throw new Error("학생 시간표를 저장하려면 분류(태그)를 먼저 선택해 주세요.");
      }
      const res = await fetch("/api/schedules/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, tagId: resolvedTagId })
      });

      if (res.status === 401) {
        moveToLogin();
        return null;
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "시간표 그룹 저장에 실패했습니다.");
      }

      const payload = (await res.json().catch(() => ({}))) as { item?: TimetableGroupApiItem };
      const created = payload.item ? mapApiGroupToState(payload.item) : null;
      if (created) {
        setTimetableGroups((prev) => {
          const next = prev
            .filter((group) => group.id !== created.id)
            .map((group) =>
              created.isActive &&
              group.roleView === created.roleView &&
              group.targetId === created.targetId &&
              group.weekStart === created.weekStart &&
              (group.tagId ?? null) === (created.tagId ?? null)
                ? { ...group, isActive: false }
                : group
            );
          return [created, ...next].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        });
      }
      return created;
    },
    [moveToLogin, selectedScheduleTagId]
  );

  const loadScheduleTags = useCallback(async () => {
    const res = await fetch("/api/settings/schedule-tags", { method: "GET", cache: "no-store" });
    if (res.status === 401) {
      moveToLogin();
      return;
    }
    if (!res.ok) throw new Error(await getApiErrorMessage(res, "시간표 태그를 불러오지 못했습니다."));
    const payload = (await res.json().catch(() => ({}))) as { items?: ScheduleTag[] };
    const items = payload.items ?? [];
    setScheduleTags(items);
    if (!scheduleTagSelectionInitializedRef.current) {
      scheduleTagSelectionInitializedRef.current = true;
      const currentTag = items.find((tag) => tag.isCurrent && tag.isActive);
      if (currentTag) {
        setSelectedScheduleTagId(currentTag.id);
        setSelectedGroupId(null);
      }
    }
  }, [moveToLogin]);

  const createScheduleTag = useCallback(async (input: { name: string; colorKey: ScheduleTag["colorKey"] }) => {
    setScheduleTagsBusy(true);
    try {
      const res = await fetch("/api/settings/schedule-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      if (!res.ok) throw new Error(await getApiErrorMessage(res, "태그 저장에 실패했습니다."));
      const payload = (await res.json()) as { item: ScheduleTag };
      setSelectedScheduleTagId(payload.item.id);
      await loadScheduleTags();
      setNotice(`'${payload.item.name}' 태그를 만들었습니다.`);
    } finally {
      setScheduleTagsBusy(false);
    }
  }, [loadScheduleTags]);

  const updateScheduleTag = useCallback(async (id: string, input: { name?: string; colorKey?: ScheduleTag["colorKey"]; isActive?: boolean; isCurrent?: boolean }) => {
    setScheduleTagsBusy(true);
    try {
      const res = await fetch("/api/settings/schedule-tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...input })
      });
      if (!res.ok) throw new Error(await getApiErrorMessage(res, "태그 수정에 실패했습니다."));
      if (input.isCurrent === true) {
        setSelectedScheduleTagId(id);
        setSelectedGroupId(null);
      }
      await loadScheduleTags();
    } finally {
      setScheduleTagsBusy(false);
    }
  }, [loadScheduleTags]);

  const updateTimetableGroupTag = useCallback(async (groupId: string, tagId: string | null) => {
    const res = await fetch("/api/schedules/groups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "tag", id: groupId, tagId })
    });
    if (!res.ok) throw new Error(await getApiErrorMessage(res, "시간표 태그 변경에 실패했습니다."));
    await loadTimetableGroups();
    setSelectedScheduleTagId(tagId);
  }, [loadTimetableGroups]);

  const activateTimetableGroup = useCallback(
    async (groupId: string) => {
      const target = timetableGroups.find((group) => group.id === groupId);
      if (!target) throw new Error("변경할 시간표 그룹을 찾지 못했습니다.");
      const desiredActiveState = !target.isActive;
      const res = await fetch("/api/schedules/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", id: groupId, isActive: desiredActiveState })
      });
      if (res.status === 401) {
        moveToLogin();
        return false;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "그룹 활성화에 실패했습니다.");
      }
      const payload = (await res.json().catch(() => ({}))) as { isActive?: boolean };
      const isActive = payload.isActive ?? desiredActiveState;
      setTimetableGroups((prev) => {
        const currentTarget = prev.find((group) => group.id === groupId);
        if (!currentTarget) return prev;
        return prev.map((group) => {
          if (group.id === groupId) return { ...group, isActive };
          if (
            isActive &&
            group.roleView === currentTarget.roleView &&
            group.targetId === currentTarget.targetId &&
            group.weekStart === currentTarget.weekStart &&
            (group.tagId ?? null) === (currentTarget.tagId ?? null)
          ) {
            return { ...group, isActive: false };
          }
          return group;
        });
      });
      await loadTimetableGroups();
      return isActive;
    },
    [loadTimetableGroups, moveToLogin, timetableGroups]
  );

  const renameTimetableGroup = useCallback(
    async (groupId: string, name: string) => {
      const nextName = name.trim();
      if (!nextName) return;
      const res = await fetch("/api/schedules/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", id: groupId, name: nextName })
      });
      if (res.status === 401) {
        moveToLogin();
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "그룹 이름 저장에 실패했습니다.");
      }
    },
    [moveToLogin]
  );

  const saveTimetableGroupSnapshot = useCallback(
    async (groupId: string, classIds: string[], snapshotEvents: ScheduleEvent[]) => {
      const res = await fetch("/api/schedules/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "snapshot",
          id: groupId,
          classIds,
          snapshotEvents
        })
      });
      if (res.status === 401) {
        moveToLogin();
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "그룹 스냅샷 저장에 실패했습니다.");
      }
    },
    [moveToLogin]
  );

  const updateTimetableGroupExpiration = useCallback(
    async (groupId: string, expiresOn: string | null) => {
      const res = await fetch("/api/schedules/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "expiration", id: groupId, expiresOn })
      });
      if (res.status === 401) {
        moveToLogin();
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "그룹 만료일 저장에 실패했습니다.");
      }
    },
    [moveToLogin]
  );

  const deleteTimetableGroupRecord = useCallback(
    async (groupId: string) => {
      const res = await fetch(`/api/schedules/groups?id=${encodeURIComponent(groupId)}`, {
        method: "DELETE"
      });
      if (res.status === 401) {
        moveToLogin();
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "그룹 삭제에 실패했습니다.");
      }
      await loadTimetableGroups();
    },
    [loadTimetableGroups, moveToLogin]
  );

  const loadOverviewEvents = useCallback(async () => {
    if (mainTab !== "overview" && !(showIntroPage && !isInstructorReadOnly)) {
      setOverviewEvents([]);
      setOverviewLoading(false);
      return;
    }

    setOverviewLoading(true);

    try {
      const targetView = overviewEntity;
      const query = new URLSearchParams({
        weekStart,
        view: targetView
      });

      const res = await fetch(`/api/schedules/week?${query.toString()}`, { method: "GET", cache: "no-store" });

      if (res.status === 401) {
        moveToLogin();
        return;
      }

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "/api/schedules/week overview 호출에 실패했습니다."));
      }

      const data = (await res.json()) as WeekResponse;
      setOverviewEvents(data.events);
      setError(null);
    } finally {
      setOverviewLoading(false);
    }
  }, [isInstructorReadOnly, mainTab, moveToLogin, overviewEntity, showIntroPage, weekStart]);

  const loadSpecialNotes = useCallback(async () => {
    if (!isWorkspaceTab || !currentTargetId || (showIntroPage && !isInstructorReadOnly)) {
      setSpecialNotes([]);
      return;
    }

    setNotesLoading(true);

    try {
      const query = new URLSearchParams({
        targetType: roleView === "student" ? "학생" : "강사",
        targetId: currentTargetId
      });
      const res = await fetch(`/api/special-notes?${query.toString()}`, { method: "GET", cache: "no-store" });

      if (res.status === 401) {
        moveToLogin();
        return;
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "시간표 메모를 불러오지 못했습니다.");
      }

      const data = (await res.json().catch(() => ({}))) as SpecialNotesResponse;
      setSpecialNotes(
        (data.items ?? []).map((item) => ({
          id: item.id,
          createdAt: item.created_at,
          content: item.content,
          groupId: item.group_id ?? null
        }))
      );
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "시간표 메모를 불러오지 못했습니다.");
      setSpecialNotes([]);
    } finally {
      setNotesLoading(false);
    }
  }, [currentTargetId, isInstructorReadOnly, isWorkspaceTab, moveToLogin, roleView, showIntroPage]);

  const removeClassFromGroups = useCallback((classId: string) => {
    setTimetableGroups((prev) =>
      prev
        .map((group) => ({
          ...group,
          classIds: group.classIds.filter((id) => id !== classId),
          snapshotEvents: group.snapshotEvents?.filter((event) => event.id !== classId)
        }))
        .filter((group) => group.classIds.length > 0 || (group.snapshotEvents?.length ?? 0) > 0)
    );
  }, []);

  const buildSinglePayloadFromDraft = useCallback(
    (draftEvent: ScheduleEvent): { payload: ScheduleFormInput; rawLabel: string } | null => {
      const draftIndex = Number(draftEvent.id.replace("draft-", ""));
      const source = Number.isNaN(draftIndex) ? null : parsedNotionItems[draftIndex];
      if (!source) {
        return null;
      }

      const normalize = (value: string) => value.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
      const instructorIndex = instructors.map((entry) => ({ id: entry.id, token: normalize(entry.name) }));
      const subjectMatch = resolveSubjectOption(source.subjectLabel, subjects);
      const classTypeMatch = resolveClassTypeOption(source.classTypeLabel, classTypes);
      const targetInstructorName = source.instructorName ? normalizeInstructorAlias(source.instructorName) : "";
      const exactInstructor =
        instructorIndex.find((entry) => entry.token === normalize(targetInstructorName));
      const instructorId = exactInstructor?.id ?? (!targetInstructorName && roleView === "instructor" ? selectedInstructorId : "");
      const studentIds = selectedStudentId ? [selectedStudentId] : [];

      if (!subjectMatch || !classTypeMatch || !instructorId || studentIds.length === 0) {
        return null;
      }

      return {
        rawLabel: source.rawText,
        payload: {
          instructorId,
          sourceInstructorName: targetInstructorName || undefined,
          sourceRawText: source.rawText,
          studentIds,
          subjectCode: subjectMatch.code,
          classTypeCode: classTypeMatch.code,
          note: source.note?.trim() || source.rawText,
          scheduleMode: "recurring",
          weekday: source.weekday,
          activeFrom: weekStart,
          startTime: source.startTime,
          endTime: source.endTime
        }
      };
    },
    [classTypes, instructors, parsedNotionItems, roleView, selectedInstructorId, selectedStudentId, subjects, weekStart]
  );

  const handleAddSyncDraft = useCallback(
    (input: SyncScheduleDraftInput) => {
      if (!selectedScheduleTagId) {
        setError("학생 시간표를 입력하려면 상단에서 분류(태그)를 먼저 선택해 주세요.");
        return;
      }
      if (!selectedStudentId) {
        setError("학생을 선택한 뒤 싱크로 시간표를 입력해 주세요.");
        return;
      }

      const instructor = input.instructorId ? instructors.find((item) => item.id === input.instructorId) : null;
      const classType = input.classTypeCode ? classTypes.find((item) => item.code === input.classTypeCode) : null;
      const subject = resolveSubjectOption(input.subjectLabel, subjects);

      if (input.kind === "class" && (!instructor || !classType)) {
        setError("강사와 수업 유형을 다시 확인해 주세요.");
        return;
      }

      const candidate = {
        classTypeCode: input.kind === "self-study" ? "SELF_STUDY" : input.classTypeCode,
        classTypeLabel: input.kind === "self-study" ? "자기주도학습" : classType?.label
      };
      const mixedConflict =
        input.kind === "class"
          ? displayEvents.find(
              (event) =>
                event.instructorId === input.instructorId &&
                event.weekday === input.weekday &&
                hasTimeOverlap(input.startTime, input.endTime, event.startTime, event.endTime) &&
                hasMixedClassTypeConflict(candidate, event)
            )
          : null;

      if (mixedConflict) {
        setConflictDialog({
          open: true,
          title: "혼합 배정 불가",
          message: `${mixedConflict.startTime}-${mixedConflict.endTime} ${mixedConflict.classTypeLabel} 수업과 겹칩니다.\n${MIXED_CLASS_TYPE_CONFLICT_MESSAGE}`
        });
        return;
      }

      const idSeed =
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const classTypeLabel = input.kind === "self-study" ? "자기주도학습" : classType?.label ?? input.classTypeCode;
      const badgeText = input.kind === "self-study" ? "[자습]" : classType?.badgeText ?? `[${classTypeLabel}]`;
      const instructorName = input.kind === "self-study" ? "" : instructor?.name ?? "";
      const subjectLabel = input.kind === "self-study" ? "자기주도학습" : subject?.label ?? input.subjectLabel;
      const rawText =
        input.kind === "self-study"
          ? `자기주도학습 ${input.startTime}-${input.endTime}`
          : `${subjectLabel} ${instructorName} ${classTypeLabel} ${input.startTime}-${input.endTime}`;

      setSyncDraftItems((prev) => [
        ...prev,
        {
          id: `${SYNC_DRAFT_EVENT_ID_PREFIX}${idSeed}`,
          weekday: input.weekday,
          startTime: input.startTime,
          endTime: input.endTime,
          subjectLabel,
          instructorId: input.instructorId,
          instructorName,
          classTypeCode: input.kind === "self-study" ? "SELF_STUDY" : input.classTypeCode,
          classTypeLabel,
          badgeText,
          note: input.note,
          isSelfStudy: input.kind === "self-study",
          rawText,
          scheduleMode: input.scheduleMode,
          classDate: input.classDate
        }
      ]);
      setError(null);
      setNotice(`${rawText} 초안을 시간표에 추가했습니다. DB 저장 전까지는 미리보기입니다.`);
    },
    [classTypes, displayEvents, instructors, selectedScheduleTagId, selectedStudentId, subjects]
  );

  const handleResetSyncDrafts = useCallback(() => {
    if (syncDraftItems.length === 0) {
      setNotice("초기화할 싱크로 시간표 초안이 없습니다.");
      return;
    }
    setSyncDraftItems([]);
    setError(null);
    setNotice("싱크로 시간표 초안을 초기화했습니다.");
  }, [syncDraftItems.length]);

  const handleStartNewSyncTimetable = useCallback(() => {
    if (syncDraftItems.length > 0 && !window.confirm("작성 중인 싱크로 시간표 초안을 지우고 새 시간표를 만들까요?")) {
      return;
    }
    setSyncDraftItems([]);
    setParsedNotionItems([]);
    setSelectedGroupId(null);
    setIsCreatingNewSyncTimetable(true);
    setError(null);
    setNotice("새 싱크로 시간표를 시작했습니다. 기존 저장본은 변경되지 않습니다.");
  }, [syncDraftItems.length]);

  const handleSaveSyncDraftsToServer = useCallback(async () => {
    if (savingSyncDrafts) return;
    if (!selectedScheduleTagId) {
      setError("학생 시간표를 저장하려면 상단에서 분류(태그)를 먼저 선택해 주세요.");
      return;
    }
    if (!selectedStudentId || !currentTargetId) {
      setError("학생을 선택한 뒤 싱크로 시간표를 저장해 주세요.");
      return;
    }
    if (syncDraftItems.length === 0) {
      setError("저장할 싱크로 시간표 초안이 없습니다. 빈 시간표 칸을 눌러 수업을 추가해 주세요.");
      return;
    }

    const classDrafts = syncDraftItems.filter((item) => !item.isSelfStudy);
    const selfStudyDrafts = syncDraftItems.filter((item) => item.isSelfStudy);
    const validationErrors: string[] = [];
    const prepared: {
      draft: SyncScheduleDraftItem;
      payload: ScheduleFormInput;
      subject: SubjectOptionWithColor;
      classType: ClassTypeOption;
    }[] = [];

    for (const draft of classDrafts) {
      const subject = resolveSubjectOption(draft.subjectLabel, subjects);
      const classType = classTypes.find((item) => item.code === draft.classTypeCode);
      const instructor = instructors.find((item) => item.id === draft.instructorId);
      const dayLabel = weekdayLabel(draft.weekday);

      if (!subject) {
        validationErrors.push(`${dayLabel} ${draft.startTime}-${draft.endTime} '${draft.subjectLabel}' 과목을 DB 과목 코드와 매칭하지 못했습니다.`);
        continue;
      }
      if (!classType) {
        validationErrors.push(`${dayLabel} ${draft.startTime}-${draft.endTime} '${draft.classTypeLabel}' 수업 유형을 찾지 못했습니다.`);
        continue;
      }
      if (!instructor) {
        validationErrors.push(`${dayLabel} ${draft.startTime}-${draft.endTime} '${draft.instructorName || "강사 미지정"}' 강사를 찾지 못했습니다.`);
        continue;
      }
      if (getInstructorDaysOff(draft.instructorId).includes(draft.weekday)) {
        validationErrors.push(`${dayLabel} ${draft.startTime}-${draft.endTime} ${instructor.name} 강사는 해당 요일 휴무입니다.`);
        continue;
      }

      const mixedConflict = displayEvents.find(
        (event) =>
          event.id !== draft.id &&
          !isSelfStudyEventId(event.id) &&
          event.instructorId === draft.instructorId &&
          event.weekday === draft.weekday &&
          hasTimeOverlap(draft.startTime, draft.endTime, event.startTime, event.endTime) &&
          hasMixedClassTypeConflict({ classTypeCode: draft.classTypeCode, classTypeLabel: draft.classTypeLabel }, event)
      );
      if (mixedConflict) {
        validationErrors.push(
          `${dayLabel} ${draft.startTime}-${draft.endTime} ${draft.subjectLabel} 수업이 ${mixedConflict.startTime}-${mixedConflict.endTime} ${mixedConflict.classTypeLabel} 수업과 겹칩니다.`
        );
        continue;
      }

      prepared.push({
        draft,
        subject,
        classType,
        payload: {
          instructorId: draft.instructorId,
          studentIds: [selectedStudentId],
          subjectCode: subject.code,
          classTypeCode: classType.code,
          note: draft.note || draft.rawText || "싱크로 시간표 직접 입력",
          scheduleMode: draft.scheduleMode,
          weekday: draft.scheduleMode === "recurring" ? draft.weekday : undefined,
          classDate: draft.scheduleMode === "one_off" ? draft.classDate : undefined,
          activeFrom: draft.scheduleMode === "recurring" ? weekStart : undefined,
          startTime: draft.startTime,
          endTime: draft.endTime,
          scheduleTagId: selectedScheduleTagId
        }
      });
    }

    if (validationErrors.length > 0) {
      const message = validationErrors.join("\n");
      setError(message);
      setConflictDialog({
        open: true,
        title: "싱크로 시간표 저장 전 확인",
        message
      });
      return;
    }

    setSavingSyncDrafts(true);
    setImportProgress({
      active: true,
      total: syncDraftItems.length,
      done: 0,
      label: "싱크로 시간표를 서버에 저장 중입니다..."
    });
    setError(null);

    const importedClassIds: string[] = [];
    const importedEvents: ScheduleEvent[] = [];
    const memoUpdates: Record<string, string> = {};
    const conflictDetails: string[] = [];
    const conflictLogEntries: ConflictLogCreateInput[] = [];

    try {
      let processedCount = selfStudyDrafts.length;
      setImportProgress((prev) => ({ ...prev, done: processedCount }));

      if (prepared.length > 0) {
        const batch = prepared;
        const createRes = await fetch("/api/schedules/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: batch.map((entry) => entry.payload),
            targetType: "학생",
            targetName: currentTargetLabel
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
            conflict?: ConflictResult;
          }[];
        };

        if (!createRes.ok) {
          throw new Error(payload.error ?? "싱크로 시간표 저장 요청에 실패했습니다.");
        }

        const results = Array.isArray(payload.results) ? payload.results : [];
        batch.forEach((entry, batchIndex) => {
          const result = results[batchIndex];
          if (!result) {
            conflictDetails.push(`${entry.draft.rawText}: 저장 결과를 확인하지 못했습니다.`);
            return;
          }

          if (result.status === "conflict") {
            const conflict: ConflictResult = result.conflict ?? { hasConflict: true, conflicts: [] };
            const reason = summarizeConflictReason(conflict);
            const detailedMessage = buildConflictAttemptDetails({
              studentName: selectedStudentLabel,
              instructorName: entry.draft.instructorName,
              classTypeLabel: entry.draft.classTypeLabel,
              weekday: entry.draft.weekday,
              startTime: entry.draft.startTime,
              endTime: entry.draft.endTime,
              scheduleTagLabel: selectedScheduleTagLabel,
              conflictMessage:
                getConflictMessageForDisplay(conflict, [...effectiveStudentGroupByTargetId.values()], students) || getConflictMessage(conflict)
            });
            conflictDetails.push(`${entry.draft.rawText}\n${detailedMessage}`);
            conflictLogEntries.push({
              weekStart,
              targetType: "학생",
              targetName: currentTargetLabel,
              studentName: selectedStudentLabel,
              instructorName: entry.draft.instructorName,
              weekday: entry.draft.weekday,
              startTime: entry.draft.startTime,
              endTime: entry.draft.endTime,
              reason,
              details: detailedMessage,
              source: "싱크로 직접 입력",
              rawText: entry.draft.rawText
            });
            return;
          }

          if (result.classId) {
            importedClassIds.push(result.classId);
            memoUpdates[result.classId] = entry.payload.note;
            importedEvents.push({
              id: result.classId,
              scheduleMode: entry.draft.scheduleMode,
              instructorId: entry.payload.instructorId,
              instructorName: entry.draft.instructorName,
              studentIds: [selectedStudentId],
              studentNames: [selectedStudentLabel],
              subjectCode: entry.subject.code,
              subjectName: entry.subject.label,
              classTypeCode: entry.classType.code,
              classTypeLabel: entry.classType.label,
              badgeText: entry.classType.badgeText,
              weekday: entry.draft.weekday,
              classDate: entry.draft.classDate ?? shiftDate(weekStart, entry.draft.weekday - 1),
              startTime: entry.draft.startTime,
              endTime: entry.draft.endTime,
              progressStatus: "planned",
              createdAt: new Date().toISOString(),
              note: entry.payload.note
            });
          }
        });

        processedCount += batch.length;
        setImportProgress((prev) => ({ ...prev, done: processedCount }));
      }

      void recordConflictLogs(conflictLogEntries);
      if (Object.keys(memoUpdates).length > 0) {
        setMemoByEventId((prev) => ({ ...prev, ...memoUpdates }));
      }

      const existingSnapshotEvents = displayEvents
        .filter((event) => !event.id.startsWith("draft-") && !isSyncDraftEventId(event.id))
        .map((event) => ({ ...event }));
      const existingClassIds = extractSnapshotClassIds(existingSnapshotEvents);
      const selfStudyEvents: ScheduleEvent[] = selfStudyDrafts.map((draft) => ({
        id: `${SELF_STUDY_EVENT_ID_PREFIX}${selectedStudentId}:${draft.classDate ?? shiftDate(weekStart, draft.weekday - 1)}:${draft.startTime}:${draft.id.replace(SYNC_DRAFT_EVENT_ID_PREFIX, "")}`,
        scheduleMode: "one_off",
        instructorId: "",
        instructorName: "",
        studentIds: [selectedStudentId],
        studentNames: [selectedStudentLabel],
        subjectCode: "SELF_STUDY",
        subjectName: "자기주도학습",
        classTypeCode: "SELF_STUDY",
        classTypeLabel: "자기주도학습",
        badgeText: "[자습]",
        weekday: draft.weekday,
        classDate: draft.classDate ?? shiftDate(weekStart, draft.weekday - 1),
        startTime: draft.startTime,
        endTime: draft.endTime,
        progressStatus: "planned",
        createdAt: new Date().toISOString(),
        note: draft.note || "자기주도학습"
      }));
      const nextSnapshot = [...existingSnapshotEvents, ...importedEvents, ...selfStudyEvents];
      const nextClassIds = Array.from(new Set([...existingClassIds, ...importedClassIds]));
      const savedCount = importedEvents.length + selfStudyEvents.length;

      if (savedCount > 0 && nextSnapshot.length > 0) {
        const created = await createTimetableGroup({
          name: `${weekStart} ${currentTargetLabel} 시간표`,
          roleView: "student",
          targetId: currentTargetId,
          weekStart,
          classIds: nextClassIds,
          snapshotEvents: nextSnapshot,
          isActive: true
        });
        if (created?.id) {
          setSelectedGroupId(created.id);
          setIsCreatingNewSyncTimetable(false);
        }
      }

      setSyncDraftItems(conflictDetails.length > 0 ? syncDraftItems.filter((item) => conflictDetails.some((detail) => detail.includes(item.rawText))) : []);
      await Promise.all([loadWeek({ silent: true }), loadSaveHistory(), loadOverviewEvents(), loadScheduleReviews()]);
      setNotice(`싱크로 시간표 저장 완료: 반영 ${savedCount}건${conflictDetails.length > 0 ? ` / 충돌 ${conflictDetails.length}건` : ""}`);

      if (conflictDetails.length > 0) {
        setConflictDialog({
          open: true,
          title: "시간표 충돌 경고",
          message: conflictDetails.join("\n")
        });
      }
    } catch (syncSaveError) {
      const message = syncSaveError instanceof Error ? syncSaveError.message : "싱크로 시간표 저장에 실패했습니다.";
      setError(message);
      setConflictDialog({
        open: true,
        title: "DB 저장 실패",
        message
      });
    } finally {
      setSavingSyncDrafts(false);
      setImportProgress((prev) => ({ ...prev, active: false, label: "" }));
    }
  }, [
    classTypes,
    createTimetableGroup,
    currentTargetId,
    currentTargetLabel,
    displayEvents,
    effectiveStudentGroupByTargetId,
    getInstructorDaysOff,
    instructors,
    loadOverviewEvents,
    loadSaveHistory,
    loadScheduleReviews,
    loadWeek,
    moveToLogin,
    recordConflictLogs,
    savingSyncDrafts,
    selectedStudentId,
    selectedStudentLabel,
    selectedScheduleTagId,
    selectedScheduleTagLabel,
    students,
    subjects,
    syncDraftItems,
    weekStart
  ]);

  const handleHardRefreshData = useCallback(async () => {
    if (refreshingData) return;

    setRefreshingData(true);
    setError(null);
    setNotice(null);

    try {
      await Promise.all([
        loadOptions({ refreshSheets: true }),
        loadSaveHistory(),
        !showIntroPage && mainTab === "issues" ? loadConflictLogs() : Promise.resolve(),
        loadTimetableGroups(),
        isWorkspaceTab && (!showIntroPage || isInstructorReadOnly) ? loadWeek({ silent: true }) : Promise.resolve(),
        !showIntroPage && mainTab === "review" ? loadScheduleReviews() : Promise.resolve(),
        (!showIntroPage && mainTab === "overview") || (showIntroPage && !isInstructorReadOnly)
          ? loadOverviewEvents()
          : Promise.resolve(),
        isWorkspaceTab && (!showIntroPage || isInstructorReadOnly) ? loadSpecialNotes() : Promise.resolve()
      ]);
      setNotice("최신 DB 기준으로 데이터를 새로고침했습니다.");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "데이터 새로고침에 실패했습니다.");
    } finally {
      setRefreshingData(false);
    }
  }, [
    loadOptions,
    loadConflictLogs,
    loadOverviewEvents,
    loadScheduleReviews,
    loadSaveHistory,
    loadSpecialNotes,
    loadTimetableGroups,
    loadWeek,
    isInstructorReadOnly,
    isWorkspaceTab,
    mainTab,
    refreshingData,
    showIntroPage
  ]);

  const handleToggleRosterStatus = useCallback(
    async (entityType: OverviewEntity, item: SelectOption, isActive: boolean) => {
      if (statusUpdatingId) return;

      const entityLabel = entityType === "instructor" ? "강사" : "학생";
      if (
        !isActive &&
        !window.confirm(
          `${entityLabel} '${item.name}'을(를) 중지 처리할까요?\n중지된 ${entityLabel}의 수업은 시간표와 충돌 검토에서 제외됩니다.`
        )
      ) {
        return;
      }

      setStatusUpdatingId(`${entityType}-${item.id}`);
      setError(null);
      setNotice(null);

      try {
        const res = await fetch("/api/schedules/entity-status", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType, id: item.id, isActive })
        });

        if (res.status === 401) {
          moveToLogin();
          return;
        }

        if (!res.ok) {
          throw new Error(await getApiErrorMessage(res, "명단 상태 변경에 실패했습니다."));
        }

        await Promise.all([loadOptions(), loadTimetableGroups(), loadWeek({ silent: true }), loadOverviewEvents()]);
        setSelectedGroupId(null);
        setNotice(`${item.name} ${entityLabel}를 ${isActive ? "활성 명단으로 복구" : "중지 명단으로 이동"}했습니다.`);
      } catch (statusError) {
        setError(statusError instanceof Error ? statusError.message : "명단 상태 변경에 실패했습니다.");
      } finally {
        setStatusUpdatingId(null);
      }
    },
    [loadOptions, loadOverviewEvents, loadTimetableGroups, loadWeek, moveToLogin, statusUpdatingId]
  );

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
      if (roleView === "student" && !selectedScheduleTagId) {
        setError("학생 시간표를 입력하려면 상단에서 분류(태그)를 먼저 선택해 주세요.");
        return;
      }
      const normalizedInput: ScheduleFormInput = {
        ...input,
        scheduleTagId: roleView === "student" ? selectedScheduleTagId ?? undefined : input.scheduleTagId,
        note: input.note.trim(),
        activeFrom: input.scheduleMode === "recurring" ? weekStart : undefined,
        classDate: input.scheduleMode === "one_off" ? input.classDate : undefined,
        weekday: input.scheduleMode === "recurring" ? input.weekday ?? initialCell?.weekday ?? dayOf(weekStart) : undefined
      };
      const targetWeekday =
        normalizedInput.scheduleMode === "recurring"
          ? (normalizedInput.weekday as Weekday)
          : dayOf(normalizedInput.classDate as string);
      const candidateStudentName = resolveStudentNames(normalizedInput.studentIds).join(", ") || "학생 미지정";
      const candidateInstructorName = instructors.find((item) => item.id === normalizedInput.instructorId)?.name ?? "강사 미지정";
      const candidateClassTypeLabel =
        classTypes.find((item) => item.code === normalizedInput.classTypeCode)?.label ?? normalizedInput.classTypeCode;
      const describeConflict = (conflict: ConflictResult) =>
        buildConflictAttemptDetails({
          studentName: candidateStudentName,
          instructorName: candidateInstructorName,
          classTypeLabel: candidateClassTypeLabel,
          weekday: targetWeekday,
          startTime: normalizedInput.startTime,
          endTime: normalizedInput.endTime,
          scheduleTagLabel: selectedScheduleTagLabel,
          conflictMessage:
            getConflictMessageForDisplay(conflict, [...effectiveStudentGroupByTargetId.values()], students) || getConflictMessage(conflict)
        });
      const immediateOverlap = displayEvents.find(
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
        const immediateConflict: ConflictResult = {
          hasConflict: true,
          conflicts: [
            {
              classId: immediateOverlap.id,
              reason: MIXED_CLASS_TYPE_CONFLICT_MESSAGE,
              existingSchedule: {
                studentNames: immediateOverlap.studentNames,
                classTypeCode: immediateOverlap.classTypeCode,
                classTypeLabel: immediateOverlap.classTypeLabel,
                weekday: immediateOverlap.weekday,
                startTime: immediateOverlap.startTime,
                endTime: immediateOverlap.endTime,
                source: "student_timetable"
              }
            }
          ]
        };
        const details = describeConflict(immediateConflict);
        void recordConflictLogs([
          {
            weekStart,
            targetType: roleView === "student" ? "학생" : "강사",
            targetName: roleView === "student" ? selectedStudentLabel : selectedInstructorLabel,
            studentName: candidateStudentName,
            instructorName: candidateInstructorName,
            weekday: targetWeekday,
            startTime: normalizedInput.startTime,
            endTime: normalizedInput.endTime,
            reason: MIXED_CLASS_TYPE_CONFLICT_MESSAGE,
            details,
            source: "수동 추가"
          }
        ]);
        setConflictDialog({
          open: true,
          title: "혼합 배정 불가",
          message: details
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
        const details = describeConflict(conflict);
        void recordConflictLogs([
          {
            weekStart,
            targetType: roleView === "student" ? "학생" : "강사",
            targetName: roleView === "student" ? selectedStudentLabel : selectedInstructorLabel,
            studentName: candidateStudentName,
            instructorName: candidateInstructorName,
            weekday: targetWeekday,
            startTime: normalizedInput.startTime,
            endTime: normalizedInput.endTime,
            reason: summarizeConflictReason(conflict),
            details,
            source: "수동 추가"
          }
        ]);
        if (conflictIncludesMixedTypeRule(conflict)) {
          setConflictDialog({
            open: true,
            title: "혼합 배정 불가",
            message: details
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
        const details = describeConflict(payload.conflict);
        void recordConflictLogs([
          {
            weekStart,
            targetType: roleView === "student" ? "학생" : "강사",
            targetName: roleView === "student" ? selectedStudentLabel : selectedInstructorLabel,
            studentName: candidateStudentName,
            instructorName: candidateInstructorName,
            weekday: targetWeekday,
            startTime: normalizedInput.startTime,
            endTime: normalizedInput.endTime,
            reason: summarizeConflictReason(payload.conflict),
            details,
            source: "수동 추가"
          }
        ]);
        if (conflictIncludesMixedTypeRule(payload.conflict)) {
          setConflictDialog({
            open: true,
            title: "혼합 배정 불가",
            message: details
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
    [
      classTypes,
      displayEvents,
      effectiveStudentGroupByTargetId,
      getInstructorDaysOff,
      initialCell?.weekday,
      instructors,
      loadWeek,
      moveToLogin,
      recordConflictLogs,
      resolveStudentNames,
      roleView,
      selectedScheduleTagId,
      selectedScheduleTagLabel,
      selectedInstructorLabel,
      selectedStudentLabel,
      students,
      weekStart
    ]
  );

  const handleMoveSchedule = useCallback(
    async (ctx: {
      classId: string;
      weekday: Weekday;
      startTime: string;
      endTime: string;
      subjectCode?: string;
      subjectName?: string;
    }) => {
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
            : selectedEditingGroup
              ? classIdBackedSnapshot
              : displayEvents;

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
                      endTime: ctx.endTime,
                      subjectLabel: ctx.subjectName ?? item.subjectLabel
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
        const detectedConflictLogs: ConflictLogCreateInput[] = [];
        const candidateGroups = [...effectiveStudentGroupByTargetId.values()];

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
              void recordConflictLogs([
                {
                  weekStart,
                  targetType: roleView === "student" ? "학생" : "강사",
                  targetName: roleView === "student" ? selectedStudentLabel : selectedInstructorLabel,
                  studentName: ownerName,
                  instructorName: targetEvent.instructorName,
                  weekday: ctx.weekday,
                  startTime: ctx.startTime,
                  endTime: ctx.endTime,
                  reason: MIXED_CLASS_TYPE_CONFLICT_MESSAGE,
                  details: other.studentNames.join(", "),
                  source: "드래그 이동"
                }
              ]);
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
            detectedConflictLogs.push({
              weekStart,
              targetType: roleView === "student" ? "학생" : "강사",
              targetName: roleView === "student" ? selectedStudentLabel : selectedInstructorLabel,
              studentName: ownerName,
              instructorName: targetEvent.instructorName,
              weekday: ctx.weekday,
              startTime: ctx.startTime,
              endTime: ctx.endTime,
              reason: `드래그 이동 충돌 (기존 ${other.startTime}-${other.endTime})`,
              details: other.studentNames.join(", "),
              source: "드래그 이동"
            });
          }
        }

        if (conflictMessages.length > 0) {
          void recordConflictLogs(detectedConflictLogs);
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
                      classDate: moveClassDate,
                      subjectCode: ctx.subjectCode,
                      subjectName: ctx.subjectName
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
            classDate: moveClassDate,
            subjectCode: ctx.subjectCode,
            subjectName: ctx.subjectName
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
            endTime: ctx.endTime,
            weekStart,
            studentId: roleView === "student" ? selectedStudentId || undefined : undefined,
            subjectCode: ctx.subjectCode
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
          void recordConflictLogs([
            {
              weekStart,
              targetType: roleView === "student" ? "학생" : "강사",
              targetName: roleView === "student" ? selectedStudentLabel : selectedInstructorLabel,
              studentName: targetEvent.studentNames.join(", ") || selectedStudentLabel,
              instructorName: targetEvent.instructorName,
              weekday: ctx.weekday,
              startTime: ctx.startTime,
              endTime: ctx.endTime,
              reason: summarizeConflictReason(payload.conflict),
              details: getConflictMessage(payload.conflict),
              source: "드래그 이동"
            }
          ]);
          if (conflictIncludesMixedTypeRule(payload.conflict)) {
            setConflictDialog({
              open: true,
              title: "혼합 배정 불가",
              message: MIXED_CLASS_TYPE_CONFLICT_MESSAGE
            });
            return;
          }
          const activeStudentGroups = [...effectiveStudentGroupByTargetId.values()];
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

        const movePayload = (await res.json().catch(() => ({}))) as { updated?: { id?: string | null } };
        const updatedClassId = movePayload.updated?.id ?? targetClassId;
        const movedSnapshot = moveEventInList(baseSnapshot, {
          classId: targetClassId,
          weekday: ctx.weekday,
          startTime: ctx.startTime,
          endTime: ctx.endTime,
          classDate: moveClassDate,
          subjectCode: ctx.subjectCode,
          subjectName: ctx.subjectName
        });
        const nextSnapshot =
          updatedClassId && updatedClassId !== targetClassId
            ? replaceEventIdInList(movedSnapshot, targetClassId, updatedClassId)
            : movedSnapshot;
        const nextClassIds = selectedEditingGroup
          ? updatedClassId && updatedClassId !== targetClassId
            ? replaceClassId(selectedEditingGroup.classIds, targetClassId, updatedClassId)
            : selectedEditingGroup.classIds
          : extractSnapshotClassIds(nextSnapshot);

        if (updatedClassId && updatedClassId !== targetClassId) {
          setEvents((current) => replaceEventIdInList(current, targetClassId, updatedClassId));
        }

        if (selectedEditingGroup) {
          setTimetableGroups((prev) =>
            prev.map((group) =>
              group.id === selectedEditingGroup.id
                ? {
                    ...group,
                    classIds: nextClassIds,
                    snapshotEvents: nextSnapshot
                  }
                : group
            )
          );
          await saveTimetableGroupSnapshot(selectedEditingGroup.id, nextClassIds, nextSnapshot);
        } else if (roleView === "student" && selectedStudentId) {
          const created = await createTimetableGroup({
            name: `${weekStart} ${selectedStudentLabel} 시간표`,
            roleView: "student",
            targetId: selectedStudentId,
            weekStart,
            classIds: nextClassIds,
            snapshotEvents: nextSnapshot,
            isActive: true
          });
          if (created?.id) {
            setSelectedGroupId(created.id);
          }
        }

        setNotice(
          ctx.subjectName
            ? `${ctx.subjectName} · ${ctx.startTime}-${ctx.endTime}로 수정했습니다.`
            : `수업을 ${ctx.startTime} / ${DAYS.find((day) => day.key === ctx.weekday)?.label ?? ""}로 이동했습니다.`
        );
        void loadWeek({ silent: true });
      } finally {
        movingLockRef.current = false;
      }
    },
    [
      activeGroup,
      createTimetableGroup,
      displayEvents,
      draftEvents,
      effectiveStudentGroupByTargetId,
      events,
      filteredEvents,
      buildUndoState,
      getInstructorDaysOff,
      loadWeek,
      moveToLogin,
      saveTimetableGroupSnapshot,
      selectedGroup,
      selectedInstructorLabel,
      selectedStudentId,
      selectedStudentLabel,
      students,
      recordConflictLogs,
      roleView,
      weekStart
    ]
  );

  const handleOpenTimeEdit = useCallback(
    (event: ScheduleEvent) => {
      if (isInstructorReadOnly || roleView !== "student" || timetableViewMode !== "detailed") return;
      if (event.id.startsWith("draft-")) return;
      setTimeEditEvent(event);
      const subject =
        subjects.find((item) => item.code === event.subjectCode) ??
        resolveSubjectOption(event.subjectName, subjects);
      setTimeEditForm({
        startTime: event.startTime,
        endTime: event.endTime,
        subjectCode: subject?.code ?? event.subjectCode
      });
      setError(null);
    },
    [isInstructorReadOnly, roleView, subjects, timetableViewMode]
  );

  const handleSaveSelfStudy = useCallback(async () => {
    if (!selfStudyDraft || selfStudySaving) return;
    if (!selectedStudentId) {
      setError("학생을 선택한 뒤 자기주도학습을 추가해 주세요.");
      return;
    }
    if (timeToMinutes(selfStudyDraft.endTime) <= timeToMinutes(selfStudyDraft.startTime)) {
      setError("종료 시간은 시작 시간보다 늦어야 합니다.");
      return;
    }

    setSelfStudySaving(true);
    setError(null);
    try {
      const targetGroup = selectedGroup ?? activeGroup;
      const classDate = selfStudyDraft.classDate ?? shiftDate(weekStart, selfStudyDraft.weekday - 1);
      const stableSuffix =
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const selfStudyEvent: ScheduleEvent = {
        id: `${SELF_STUDY_EVENT_ID_PREFIX}${selectedStudentId}:${classDate}:${selfStudyDraft.startTime}:${stableSuffix}`,
        scheduleMode: "one_off",
        instructorId: "",
        instructorName: "",
        studentIds: [selectedStudentId],
        studentNames: [selectedStudentLabel],
        subjectCode: "SELF_STUDY",
        subjectName: "자기주도학습",
        classTypeCode: "SELF_STUDY",
        classTypeLabel: "자기주도학습",
        badgeText: "[자습]",
        weekday: selfStudyDraft.weekday,
        classDate,
        startTime: selfStudyDraft.startTime,
        endTime: selfStudyDraft.endTime,
        progressStatus: "planned",
        createdAt: new Date().toISOString(),
        note: "자기주도학습"
      };
      const baseSnapshot = targetGroup?.snapshotEvents?.length ? targetGroup.snapshotEvents : displayEvents;
      const nextSnapshot = [...baseSnapshot.map((event) => ({ ...event })), selfStudyEvent];
      const classIds = targetGroup ? targetGroup.classIds : extractSnapshotClassIds(nextSnapshot);

      if (targetGroup) {
        setTimetableGroups((prev) =>
          prev.map((group) =>
            group.id === targetGroup.id
              ? {
                  ...group,
                  classIds,
                  snapshotEvents: nextSnapshot
                }
              : group
          )
        );
        await saveTimetableGroupSnapshot(targetGroup.id, classIds, nextSnapshot);
        setSelectedGroupId(targetGroup.id);
      } else {
        const created = await createTimetableGroup({
          name: `${weekStart} ${selectedStudentLabel} 시간표`,
          roleView: "student",
          targetId: selectedStudentId,
          weekStart,
          classIds,
          snapshotEvents: nextSnapshot,
          isActive: true
        });
        if (created?.id) {
          setSelectedGroupId(created.id);
        }
      }

      setSelfStudyDraft(null);
      setNotice("자기주도학습을 시간표에 추가했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "자기주도학습 추가에 실패했습니다.");
    } finally {
      setSelfStudySaving(false);
    }
  }, [
    activeGroup,
    createTimetableGroup,
    displayEvents,
    saveTimetableGroupSnapshot,
    selectedGroup,
    selectedStudentId,
    selectedStudentLabel,
    selfStudyDraft,
    selfStudySaving,
    weekStart
  ]);

  const handleSaveTimeEdit = useCallback(async () => {
    if (!timeEditEvent || timeEditSaving) return;
    if (timeToMinutes(timeEditForm.endTime) <= timeToMinutes(timeEditForm.startTime)) {
      setError("종료 시간은 시작 시간보다 늦어야 합니다.");
      return;
    }
    const selectedSubject = subjects.find((subject) => subject.code === timeEditForm.subjectCode);
    if (!isSelfStudyEventId(timeEditEvent.id) && !selectedSubject) {
      setError("과목을 다시 선택해 주세요.");
      return;
    }

    setTimeEditSaving(true);
    setError(null);
    try {
      if (isSelfStudyEventId(timeEditEvent.id)) {
        const targetGroup =
          selectedGroup ??
          activeGroup ??
          timetableGroups.find(
            (group) =>
              group.roleView === "student" &&
              group.targetId === selectedStudentId &&
              group.weekStart === weekStart &&
              (group.snapshotEvents ?? []).some((event) => event.id === timeEditEvent.id)
          );
        if (!targetGroup) {
          setError("자기주도학습이 저장된 시간표 그룹을 찾지 못했습니다.");
          return;
        }
        const classDate = shiftDate(weekStart, timeEditEvent.weekday - 1);
        const baseSnapshot = targetGroup.snapshotEvents?.length ? targetGroup.snapshotEvents : displayEvents;
        const nextSnapshot = baseSnapshot.map((event) =>
          event.id === timeEditEvent.id
            ? {
                ...event,
                startTime: timeEditForm.startTime,
                endTime: timeEditForm.endTime,
                classDate
              }
            : { ...event }
        );
        const classIds = targetGroup.classIds.length > 0 ? targetGroup.classIds : extractSnapshotClassIds(nextSnapshot);

        setTimetableGroups((prev) =>
          prev.map((group) =>
            group.id === targetGroup.id
              ? {
                  ...group,
                  classIds,
                  snapshotEvents: nextSnapshot
                }
              : group
          )
        );
        await saveTimetableGroupSnapshot(targetGroup.id, classIds, nextSnapshot);
        setNotice("자기주도학습 시간을 수정했습니다.");
        setTimeEditEvent(null);
        return;
      }
      await handleMoveSchedule({
        classId: timeEditEvent.id,
        weekday: timeEditEvent.weekday,
        startTime: timeEditForm.startTime,
        endTime: timeEditForm.endTime,
        subjectCode: selectedSubject?.code,
        subjectName: selectedSubject?.label
      });
      setTimeEditEvent(null);
    } finally {
      setTimeEditSaving(false);
    }
  }, [
    activeGroup,
    displayEvents,
    handleMoveSchedule,
    saveTimetableGroupSnapshot,
    selectedGroup,
    selectedStudentId,
    timetableGroups,
    timeEditEvent,
    timeEditForm.endTime,
    timeEditForm.startTime,
    timeEditForm.subjectCode,
    timeEditSaving,
    subjects,
    weekStart
  ]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
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

  const handleResetNotionInput = useCallback(() => {
    if (!notionTextValue && parsedNotionItems.length === 0) {
      setNotice("이미 노션 입력이 비어 있습니다.");
      return;
    }

    setUndoState(buildUndoState("노션 입력 초기화"));
    setNotionInput("");
    setNotionPreview("");
    setParsedNotionItems([]);
    setError(null);
    setNotice("노션 입력과 미리보기를 초기화했습니다.");
  }, [buildUndoState, notionTextValue, parsedNotionItems.length]);

  const handleImportNotionToServer = useCallback(async () => {
    if (roleView === "student" && !selectedScheduleTagId) {
      setError("학생 시간표를 저장하려면 상단에서 분류(태그)를 먼저 선택해 주세요.");
      return;
    }
    const normalizedNotionText = notionTextValue.trim();
    const parsedItemsForSave =
      parsedNotionItems.length > 0
        ? parsedNotionItems
        : normalizedNotionText.length > 0
          ? parseNotionTextToItems(normalizedNotionText)
          : [];

    if (parsedNotionItems.length === 0 && parsedItemsForSave.length > 0) {
      setParsedNotionItems(parsedItemsForSave);
    }

    if (parsedItemsForSave.length === 0) {
      if (normalizedNotionText.length > 0) {
        setError("붙여넣은 노션 텍스트를 수업 데이터로 해석하지 못했습니다. [시간표에 반영] 결과를 먼저 확인해 주세요.");
        return;
      }
      const existingClassIds = Array.from(new Set(displayEvents.map((event) => event.id).filter((id) => !id.startsWith("draft-"))));
      if (existingClassIds.length === 0) {
        setError("저장할 시간표가 없습니다. 노션 반영 또는 수업 추가 후 다시 시도해 주세요.");
        return;
      }
      if (!currentTargetId) {
        setError("강사/학생 선택 후 다시 시도해 주세요.");
        return;
      }
      const created = await createTimetableGroup({
        name: `${weekStart} ${currentTargetLabel} 시간표`,
        roleView,
        targetId: currentTargetId,
        weekStart,
        classIds: existingClassIds,
        snapshotEvents: displayEvents.filter((event) => existingClassIds.includes(event.id)).map((event) => ({ ...event })),
        isActive: true
      });
      if (created?.id) {
        setSelectedGroupId(created.id);
      }
      setError(null);
      setNotice(`현재 시간표를 그룹으로 저장했습니다. (${existingClassIds.length}개 수업)`);
      return;
    }

    setImportingNotion(true);
    importingNotionRef.current = true;
    setImportProgress({
      active: true,
      total: parsedItemsForSave.length,
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
      return instructorExactMap.get(target) ?? "";
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
    const conflictLogEntries: ConflictLogCreateInput[] = [];
    const dayOffDetails: string[] = [];
    const noSubjectDetails: string[] = [];
    const noInstructorDetails: string[] = [];
    const unresolvedInstructorNames = new Set<string>();
    const confirmedSavedEvents: ScheduleEvent[] = [];
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

      for (let idx = 0; idx < parsedItemsForSave.length; idx += 1) {
        const item = parsedItemsForSave[idx] as ParsedNotionItem;
        const subject = resolveSubjectCached(item.subjectLabel);
        const classType = resolveClassTypeCached(item.classTypeLabel);

        const instructorId = item.instructorName
          ? findInstructorId(item.instructorName)
          : roleView === "instructor"
            ? selectedInstructorId
            : "";
        const studentIds: string[] = selectedStudentId ? [selectedStudentId] : [];

        if (!instructorId) {
          skipped += 1;
          skipReasons.noInstructor += 1;
          const unresolvedName = normalizeInstructorAlias(item.instructorName || "강사명 없음");
          const reason = item.instructorName ? "강사 명단 매핑 실패" : "강사명 인식 실패";
          const detail = `${weekdayLabel(item.weekday)} ${toKoreanHourRange(item.startTime)} · ${reason} · 원문: ${item.rawText}`;
          unresolvedInstructorNames.add(unresolvedName);
          noInstructorDetails.push(detail);
          conflictLogEntries.push({
            weekStart,
            targetType: roleView === "student" ? "학생" : "강사",
            targetName: currentTargetLabel,
            studentName: selectedStudentLabel || "학생 미지정",
            instructorName: unresolvedName,
            weekday: item.weekday,
            startTime: item.startTime,
            endTime: item.endTime,
            reason,
            details: detail,
            source: "노션 일괄 저장",
            rawText: item.rawText
          });
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
          const dayLabel = weekdayLabel(item.weekday);
          noSubjectDetails.push(`${dayLabel} ${toKoreanHourRange(item.startTime)} (${item.rawText})`);
          conflictLogEntries.push({
            weekStart,
            targetType: roleView === "student" ? "학생" : "강사",
            targetName: currentTargetLabel,
            studentName: selectedStudentLabel || "학생 미지정",
            instructorName: item.instructorName || "강사 미지정",
            weekday: item.weekday,
            startTime: item.startTime,
            endTime: item.endTime,
            reason: "과목 매핑 실패",
            details: item.rawText,
            source: "노션 일괄 저장",
            rawText: item.rawText
          });
          continue;
        }
        if (!classType) {
          skipped += 1;
          skipReasons.noClassType += 1;
          conflictLogEntries.push({
            weekStart,
            targetType: roleView === "student" ? "학생" : "강사",
            targetName: currentTargetLabel,
            studentName: selectedStudentLabel || "학생 미지정",
            instructorName: item.instructorName || "강사 미지정",
            weekday: item.weekday,
            startTime: item.startTime,
            endTime: item.endTime,
            reason: "수업 유형 매핑 실패",
            details: item.rawText,
            source: "노션 일괄 저장",
            rawText: item.rawText
          });
          continue;
        }
        if (getInstructorDaysOff(instructorId).includes(item.weekday)) {
          skipped += 1;
          skipReasons.daysOff += 1;
          const dayLabel = weekdayLabel(item.weekday);
          const instructorLabel = instructors.find((entry) => entry.id === instructorId)?.name ?? item.instructorName ?? "선택 강사";
          dayOffDetails.push(
            `[${instructorLabel}] 강사님의 휴무일(${dayLabel})에는 수업을 배정할 수 없습니다. 해당 항목은 저장되지 않았습니다. - ${toKoreanHourRange(item.startTime)} (${item.rawText})`
          );
          conflictLogEntries.push({
            weekStart,
            targetType: roleView === "student" ? "학생" : "강사",
            targetName: currentTargetLabel,
            studentName: selectedStudentLabel || "학생 미지정",
            instructorName: instructorLabel,
            weekday: item.weekday,
            startTime: item.startTime,
            endTime: item.endTime,
            reason: "강사 휴무일 충돌",
            details: item.rawText,
            source: "노션 일괄 저장",
            rawText: item.rawText
          });
          continue;
        }

        preparedItems.push({
          item,
          payload: {
            instructorId,
            sourceInstructorName: normalizeInstructorAlias(item.instructorName),
            sourceRawText: item.rawText,
            studentIds,
            subjectCode: subject.code,
            classTypeCode: classType.code,
            note: item.note?.trim() || item.rawText,
            scheduleMode: "recurring",
            weekday: item.weekday,
            activeFrom: weekStart,
            startTime: item.startTime,
            endTime: item.endTime,
            scheduleTagId: roleView === "student" ? selectedScheduleTagId ?? undefined : undefined
          }
        });
      }

      let processedCount = skipped;
      setImportProgress((prev) => ({ ...prev, done: processedCount }));

      if (preparedItems.length > 0) {
        const batch = preparedItems;
        const createRes = await fetch("/api/schedules/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: batch.map((entry) => entry.payload),
            targetType: roleView === "student" ? "학생" : "강사",
            targetName: currentTargetLabel
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
            conflict?: ConflictResult;
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
            throw new Error(payload.error ?? "해당 강사의 휴무일입니다.");
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

          if (
            result.classId &&
            (result.status === "created" || result.status === "enrolled" || result.status === "existing")
          ) {
            const savedInstructor = instructors.find((item) => item.id === entry.payload.instructorId);
            const savedSubject = subjects.find((item) => item.code === entry.payload.subjectCode);
            const savedClassType = classTypes.find((item) => item.code === entry.payload.classTypeCode);
            const savedStudentNames = resolveStudentNames(entry.payload.studentIds);
            const savedWeekday = entry.payload.weekday ?? entry.item.weekday;
            confirmedSavedEvents.push({
              id: result.classId,
              scheduleMode: entry.payload.scheduleMode,
              instructorId: entry.payload.instructorId,
              instructorName: savedInstructor?.name ?? normalizeInstructorAlias(entry.item.instructorName),
              studentIds: entry.payload.studentIds,
              studentNames:
                savedStudentNames.length > 0
                  ? savedStudentNames
                  : selectedStudentLabel && selectedStudentLabel !== "학생 선택"
                    ? [selectedStudentLabel]
                    : [],
              subjectCode: entry.payload.subjectCode,
              subjectName: savedSubject?.label ?? entry.item.subjectLabel,
              classTypeCode: entry.payload.classTypeCode,
              classTypeLabel: savedClassType?.label ?? entry.item.classTypeLabel,
              badgeText: savedClassType?.badgeText ?? `[${entry.item.classTypeLabel}]`,
              weekday: savedWeekday,
              classDate:
                entry.payload.classDate ??
                shiftDate(entry.payload.activeFrom ?? weekStart, savedWeekday - 1),
              startTime: entry.payload.startTime,
              endTime: entry.payload.endTime,
              note: entry.payload.note,
              progressStatus: "planned",
              createdAt: new Date().toISOString()
            });
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
            const structuredConflict: ConflictResult = result.conflict ?? { hasConflict: true, conflicts: [] };
            const conflictReason = summarizeConflictReason(structuredConflict);
            const detailedMessage = buildConflictAttemptDetails({
              studentName: selectedStudentLabel,
              instructorName:
                instructors.find((item) => item.id === entry.payload.instructorId)?.name ?? entry.item.instructorName ?? "강사 미지정",
              classTypeLabel: entry.item.classTypeLabel,
              weekday: entry.item.weekday,
              startTime: entry.item.startTime,
              endTime: entry.item.endTime,
              scheduleTagLabel: selectedScheduleTagLabel,
              conflictMessage:
                getConflictMessageForDisplay(structuredConflict, [...effectiveStudentGroupByTargetId.values()], students) ||
                getConflictMessage(structuredConflict)
            });
            conflictDetails.push(`- ${slotLabel} (${entry.item.rawText})\n${detailedMessage}`);
            conflictLogEntries.push({
              weekStart,
              targetType: roleView === "student" ? "학생" : "강사",
              targetName: currentTargetLabel,
              studentName: selectedStudentLabel,
              instructorName:
                instructors.find((item) => item.id === entry.payload.instructorId)?.name ?? entry.item.instructorName ?? "강사 미지정",
              weekday: entry.item.weekday,
              startTime: entry.item.startTime,
              endTime: entry.item.endTime,
              reason: conflictReason,
              details: detailedMessage,
              source: "노션 일괄 저장",
              rawText: entry.item.rawText
            });
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

      void recordConflictLogs(conflictLogEntries);

      const reasonLine = Object.entries(skipReasons)
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${key}:${count}`)
        .join(", ");
      const dedupedClassIds = Array.from(new Set(importedClassIds));
      if (dedupedClassIds.length === 0) {
        const unresolvedNames = [...unresolvedInstructorNames].filter(Boolean).join(", ");
        const failureMessage =
          skipReasons.noInstructor > 0
            ? `강사 명단에서 ${unresolvedNames || "입력된 강사"} 강사를 찾지 못해 DB 수업과 시간표 그룹을 저장하지 않았습니다. 명단을 새로고침한 뒤 다시 저장해 주세요.`
            : `DB에 저장된 수업이 없어 시간표 그룹을 만들지 못했습니다.${reasonLine ? ` 건너뜀 사유: ${reasonLine}` : ""}`;
        setNotice(null);
        setError(failureMessage);
        setConflictDialog({
          open: true,
          title: "시간표 그룹 저장 안 됨",
          message: failureMessage
        });
      } else {
        setNotice(`노션 가져오기 완료: 생성 ${created}건 / 기존유지 ${existing}건 / 건너뜀 ${skipped}건${reasonLine ? ` (${reasonLine})` : ""}`);
      }

      const postSaveWarnings: string[] = [];
      const shouldRefreshHistory = created > 0 || existing > 0;
      if (shouldRefreshHistory) {
        setParsedNotionItems([]);
        setNotionInput("");
        setEvents((prev) => mergeScheduleEventsByIdentity(prev, confirmedSavedEvents));
      }

      const [groupSaveResult, historyRefreshResult] = await Promise.allSettled([
        dedupedClassIds.length > 0 && currentTargetId
          ? createTimetableGroup({
            name: `${weekStart} ${currentTargetLabel} 시간표`,
            roleView,
            targetId: currentTargetId,
            weekStart,
            classIds: dedupedClassIds,
            snapshotEvents: confirmedSavedEvents,
            isActive: true
          })
          : Promise.resolve(null),
        shouldRefreshHistory ? loadSaveHistory() : Promise.resolve()
      ]);

      if (groupSaveResult.status === "fulfilled") {
        if (groupSaveResult.value?.id) {
          setSelectedGroupId(groupSaveResult.value.id);
        }
      } else {
        console.error("[notion-import] group save failed after classes were saved", groupSaveResult.reason);
        postSaveWarnings.push("수업 DB 저장은 완료됐지만 저장된 시간표 그룹 갱신 중 일시 오류가 발생했습니다.");
      }

      if (historyRefreshResult.status === "rejected") {
        console.error("[notion-import] save history reload failed after classes were saved", historyRefreshResult.reason);
        postSaveWarnings.push("수업 DB 저장은 완료됐지만 최근 저장 기록 갱신 중 일시 오류가 발생했습니다.");
      }

      if (confirmedSavedEvents.length > 0) {
        pendingRealtimeReloadRef.current = false;
        await loadWeek({ silent: true });
        // A successful import is authoritative even if a read replica trails
        // briefly. Keep those rows visible while the normal reload reconciles.
        setEvents((prev) => mergeScheduleEventsByIdentity(prev, confirmedSavedEvents));
      }

      if (postSaveWarnings.length > 0) {
        const warningMessage = postSaveWarnings.join("\n");
        setError(warningMessage);
        setConflictDialog({
          open: true,
          title: "후속 동기화 경고",
          message: warningMessage
        });
      }

      if (conflictDetails.length > 0 || dayOffDetails.length > 0 || noSubjectDetails.length > 0 || noInstructorDetails.length > 0) {
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
        if (noInstructorDetails.length > 0) {
          if (lines.length > 0) {
            lines.push("");
          }
          if (conflictDetails.length === 0 && dayOffDetails.length === 0 && noSubjectDetails.length === 0) {
            title = "강사명 확인 필요";
          }
          lines.push(`강사명 확인 실패 ${noInstructorDetails.length}건`);
          lines.push(...noInstructorDetails.slice(0, 12).map((item) => `- ${item}`));
          if (noInstructorDetails.length > 12) {
            lines.push(`- 외 ${noInstructorDetails.length - 12}건`);
          }
          lines.push("");
          lines.push("강사명을 확인할 수 없는 수업은 다른 강사로 대체하지 않고 저장에서 제외했습니다.");
        }
        setConflictDialog({
          open: true,
          title,
          message: lines.join("\n")
        });
      }
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : "노션 시간표 저장에 실패했습니다.";
      console.error("[notion-import] save failed", importError);
      const fallbackMessage = isTransientGatewayErrorMessage(message)
        ? "Supabase에서 일시적인 502 오류가 발생했습니다. 저장이 이미 반영됐을 수 있으니 새로고침 후 확인해 주세요."
        : message;
      setError(fallbackMessage);
      setConflictDialog((prev) => ({
        ...prev,
        open: true,
        title: "DB 저장 실패",
        message: fallbackMessage
      }));
    } finally {
      setImportingNotion(false);
      importingNotionRef.current = false;
      setImportProgress((prev) => ({ ...prev, active: false, label: "" }));
    }

  }, [
    createTimetableGroup,
    classTypes,
    instructors,
    loadWeek,
    moveToLogin,
    notionTextValue,
    parsedNotionItems,
    recordConflictLogs,
    resolveStudentNames,
    selectedInstructorId,
    selectedStudentId,
    selectedStudentLabel,
    subjects,
    currentTargetId,
    currentTargetLabel,
    displayEvents,
    effectiveStudentGroupByTargetId,
    getInstructorDaysOff,
    loadSaveHistory,
    roleView,
    selectedScheduleTagId,
    selectedScheduleTagLabel,
    students,
    weekStart
  ]);

  const handleSaveSingleSchedule = useCallback(
    async (event: ScheduleEvent) => {
      if (roleView === "student" && !selectedScheduleTagId) {
        setError("학생 시간표를 저장하려면 상단에서 분류(태그)를 먼저 선택해 주세요.");
        return;
      }
      if (!event.id.startsWith("draft-")) {
        setNotice("이미 DB에 저장된 수업입니다.");
        return;
      }

      try {
        const prepared = buildSinglePayloadFromDraft(event);
        if (!prepared) {
          setError("이 수업은 강사/학생/과목/수업유형 매핑이 완료되어야 개별 저장할 수 있습니다.");
          return;
        }

        if (getInstructorDaysOff(prepared.payload.instructorId).includes(prepared.payload.weekday as Weekday)) {
          const weekdayLabel = DAYS.find((day) => day.key === prepared.payload.weekday)?.label ?? `${prepared.payload.weekday}`;
          const instructorLabel =
            instructors.find((item) => item.id === prepared.payload.instructorId)?.name ?? event.instructorName ?? "선택 강사";
          setConflictDialog({
            open: true,
            title: "휴무일 배정 경고",
            message: `[${instructorLabel}] 강사님의 휴무일(${weekdayLabel})에는 수업을 배정할 수 없습니다. 해당 항목은 저장되지 않았습니다.`
          });
          return;
        }

        const res = await fetch("/api/schedules/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              {
                ...prepared.payload,
                scheduleTagId: roleView === "student" ? selectedScheduleTagId ?? undefined : prepared.payload.scheduleTagId
              }
            ],
            targetType: roleView === "student" ? "학생" : "강사",
            targetName: currentTargetLabel
          })
        });

        if (res.status === 401) {
          moveToLogin();
          return;
        }

        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          results?: { status?: string; classId?: string; conflict?: ConflictResult }[];
        };
        const result = payload.results?.[0];

        if (res.status === 409 || result?.status === "conflict") {
          const conflict = result?.conflict ?? { hasConflict: false, conflicts: [] };
          const details = buildConflictAttemptDetails({
            studentName: event.studentNames.join(", ") || selectedStudentLabel,
            instructorName: event.instructorName,
            classTypeLabel: event.classTypeLabel,
            weekday: event.weekday,
            startTime: event.startTime,
            endTime: event.endTime,
            scheduleTagLabel: selectedScheduleTagLabel,
            conflictMessage:
              getConflictMessageForDisplay(conflict, [...effectiveStudentGroupByTargetId.values()], students) || getConflictMessage(conflict)
          });
          void recordConflictLogs([
            {
              weekStart,
              targetType: roleView === "student" ? "학생" : "강사",
              targetName: currentTargetLabel,
              studentName: event.studentNames.join(", ") || selectedStudentLabel,
              instructorName: event.instructorName,
              weekday: event.weekday,
              startTime: event.startTime,
              endTime: event.endTime,
              reason: summarizeConflictReason(conflict),
              details,
              source: "개별 저장",
              rawText: prepared.rawLabel
            }
          ]);
          if (conflictIncludesMixedTypeRule(conflict)) {
            setConflictDialog({
              open: true,
              title: "혼합 배정 불가",
              message: details
            });
            return;
          }
          setConflictDialog({
            open: true,
            title: "시간표 충돌 경고",
            message: details || "시간표 충돌로 개별 저장이 차단되었습니다."
          });
          return;
        }

        if (!res.ok) {
          if ((payload.error ?? "").includes("해당 강사의 휴무일입니다")) {
            setConflictDialog({
              open: true,
              title: "휴무일 안내",
              message: "해당 강사의 휴무일입니다"
            });
            return;
          }
          setError(payload.error ?? "개별 저장에 실패했습니다.");
          return;
        }

        if (result?.classId && prepared.payload.note) {
          setMemoByEventId((prev) => ({ ...prev, [result.classId as string]: prepared.payload.note }));
        }

        const draftIndex = Number(event.id.replace("draft-", ""));
        if (!Number.isNaN(draftIndex)) {
          setParsedNotionItems((prev) => prev.filter((_, index) => index !== draftIndex));
        }

        await Promise.all([loadWeek(), loadSaveHistory(), loadOverviewEvents()]);
        setNotice(`'${prepared.rawLabel}' 수업을 즉시 저장했습니다.`);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "개별 저장에 실패했습니다.");
      }
    },
    [
      buildSinglePayloadFromDraft,
      currentTargetLabel,
      effectiveStudentGroupByTargetId,
      getInstructorDaysOff,
      instructors,
      loadOverviewEvents,
      loadSaveHistory,
      loadWeek,
      moveToLogin,
      recordConflictLogs,
      roleView,
      selectedScheduleTagId,
      selectedScheduleTagLabel,
      selectedStudentLabel,
      students,
      weekStart
    ]
  );

  const handleDeleteSingleSchedule = useCallback(
    async (event: ScheduleEvent) => {
      if (isSyncDraftEventId(event.id)) {
        setSyncDraftItems((prev) => prev.filter((item) => item.id !== event.id));
        setNotice("싱크로 시간표 초안을 삭제했습니다.");
        return;
      }

      if (event.id.startsWith("draft-")) {
        const draftIndex = Number(event.id.replace("draft-", ""));
        if (!Number.isNaN(draftIndex)) {
          setParsedNotionItems((prev) => prev.filter((_, index) => index !== draftIndex));
          setNotice("미리보기 수업을 삭제했습니다.");
        }
        return;
      }

      if (!currentTargetId) {
        setError("삭제 대상의 강사/학생을 먼저 선택해 주세요.");
        return;
      }

      try {
        const res = await fetch("/api/schedules/group", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classIds: [event.id],
            roleView,
            targetId: currentTargetId
          })
        });

        if (res.status === 401) {
          moveToLogin();
          return;
        }

        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          setError(payload.error ?? "개별 삭제에 실패했습니다.");
          return;
        }

        removeClassFromGroups(event.id);
        setEvents((prev) => prev.filter((item) => item.id !== event.id));
        await Promise.all([loadWeek({ silent: true }), loadOverviewEvents()]);
        setNotice(`${event.subjectName} ${event.startTime}-${event.endTime} 수업을 삭제했습니다.`);
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : "개별 삭제에 실패했습니다.");
      }
    },
    [currentTargetId, loadOverviewEvents, loadWeek, moveToLogin, removeClassFromGroups, roleView]
  );

  const handleCreateSpecialNote = useCallback(async () => {
    if (!currentTargetId) {
      setError("시간표 메모를 등록할 학생을 먼저 선택해 주세요.");
      return;
    }
    if (roleView === "student" && !displayedGroup) {
      setError("시간표를 먼저 저장한 뒤 해당 저장 그룹에 메모를 등록해 주세요.");
      return;
    }

    const content = specialNoteInput.trim();
    if (!content) return;

    setNoteSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/special-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: roleView === "student" ? "학생" : "강사",
          targetId: currentTargetId,
          groupId: roleView === "student" ? displayedGroup?.id ?? null : null,
          content
        })
      });

      if (res.status === 401) {
        moveToLogin();
        return;
      }

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "시간표 메모 저장에 실패했습니다.");
      }

      setSpecialNoteInput("");
      await loadSpecialNotes();
      setNotice("선택한 시간표 그룹에 메모를 저장했습니다.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "시간표 메모 저장에 실패했습니다.");
    } finally {
      setNoteSubmitting(false);
    }
  }, [currentTargetId, displayedGroup, loadSpecialNotes, moveToLogin, roleView, specialNoteInput]);

  const handleDeleteSpecialNote = useCallback(
    async (noteId: string) => {
      setNoteSubmitting(true);
      setError(null);

      try {
        const res = await fetch(`/api/special-notes/${noteId}`, { method: "DELETE" });

        if (res.status === 401) {
          moveToLogin();
          return;
        }

        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "특이사항 삭제에 실패했습니다.");
        }

        setSpecialNotes((prev) => prev.filter((item) => item.id !== noteId));
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : "특이사항 삭제에 실패했습니다.");
      } finally {
        setNoteSubmitting(false);
      }
    },
    [moveToLogin]
  );

  const handleSyncSheets = useCallback(async () => {
    setSyncingSheets(true);
    setNotice(null);
    setError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 45_000);

    try {
      const res = await fetch("/api/sheets/sync", {
        method: "POST",
        headers: await getFirebaseAuthHeaders({ "Content-Type": "application/json" }, true),
        body: JSON.stringify({}),
        signal: controller.signal
      });

      if (res.status === 401) {
        moveToLogin();
        return;
      }

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        source?: "firebase" | "sheets";
        teachersInserted?: number;
        teachersUpdated?: number;
        studentsInserted?: number;
        studentsUpdated?: number;
        warning?: string;
      };

      if (!res.ok) {
        throw new Error(payload.error ?? "시트 동기화에 실패했습니다.");
      }

      const sourceLabel = payload.source === "firebase" ? "Firebase 명단" : "시트";
      const warningSuffix = payload.warning ? ` · ${payload.warning}` : "";
      setNotice(
        `${sourceLabel} 동기화 완료: 강사 ${payload.teachersInserted ?? 0}명 추가, ${payload.teachersUpdated ?? 0}명 갱신 / 학생 ${
          payload.studentsInserted ?? 0
        }명 추가, ${payload.studentsUpdated ?? 0}명 갱신${warningSuffix}`
      );
      await loadOptions({ refreshSheets: true });
    } catch (syncError) {
      const message =
        syncError instanceof DOMException && syncError.name === "AbortError"
          ? "명단 동기화 응답이 지연되어 중단했습니다. 계정 관리의 변경은 자동 반영되며, 잠시 후 새로고침해 확인해 주세요."
          : syncError instanceof Error
            ? syncError.message
            : "명단 동기화에 실패했습니다.";
      setError(message);
    } finally {
      window.clearTimeout(timeoutId);
      setSyncingSheets(false);
    }
  }, [loadOptions, moveToLogin]);

  const handleActivateGroup = useCallback(
    async (groupId: string) => {
      setParsedNotionItems([]);
      setGroupActivationPendingId(groupId);
      setGroupActivationPulseId(null);
      try {
        const isActive = await activateTimetableGroup(groupId);
        const activated = timetableGroups.find((group) => group.id === groupId);
        if (activated) setSelectedScheduleTagId(activated.tagId ?? null);
        const activatedSnapshot = activated?.snapshotEvents ?? [];
        if (isActive && activatedSnapshot.length > 0) {
          setEvents(activatedSnapshot.map((event) => ({ ...event })));
        }
        setSelectedGroupId(groupId);
        setGroupActivationPulseId(groupId);
        window.setTimeout(() => {
          setGroupActivationPulseId((current) => (current === groupId ? null : current));
        }, 300);
        setNotice(isActive ? "활성 시간표를 변경했습니다." : "시간표 그룹을 비활성화했습니다.");
      } catch (activationError) {
        setError(activationError instanceof Error ? activationError.message : "시간표 상태 변경에 실패했습니다.");
      } finally {
        setGroupActivationPendingId((current) => (current === groupId ? null : current));
      }
    },
    [activateTimetableGroup, timetableGroups]
  );

  const handleSelectGroup = useCallback(
    (groupId: string) => {
      setIsCreatingNewSyncTimetable(false);
      setParsedNotionItems([]);
      const selected = timetableGroups.find((group) => group.id === groupId);
      if (selected) setSelectedScheduleTagId(selected.tagId ?? null);
      let seededSnapshot: ScheduleEvent[] | null = null;
      let seededClassIds: string[] = [];
      setTimetableGroups((prev) =>
        prev.map((group) => {
          if (group.id !== groupId) return group;
          const snapshot = group.snapshotEvents ?? [];
          const hasDraftSnapshot = snapshot.some((event) => event.id.startsWith("draft-"));
          if (snapshot.length > 0 && !hasDraftSnapshot) return group;
          const seeded = filteredEvents
            .filter((event) => group.classIds.includes(event.id))
            .map((event) => ({ ...event }));
          seededSnapshot = seeded;
          seededClassIds = seeded.map((event) => event.id);
          return { ...group, classIds: seededClassIds, snapshotEvents: seeded };
        })
      );
      if (seededSnapshot) {
        void saveTimetableGroupSnapshot(groupId, seededClassIds, seededSnapshot).catch(() => {
          // Snapshot sync failure should not block selection UX.
        });
      }
      setSelectedGroupId(groupId);
      setNotice("선택한 그룹 시간표를 표시했습니다.");
    },
    [filteredEvents, saveTimetableGroupSnapshot, timetableGroups]
  );

  const handleCaptureTimetableImage = useCallback(async () => {
    const target = timetableCaptureRef.current;
    if (!target) return;

    const ClipboardItemCtor = window.ClipboardItem;
    if (!navigator.clipboard?.write || !ClipboardItemCtor) {
      setError("이 브라우저에서는 이미지 클립보드 복사를 지원하지 않습니다.");
      return;
    }

    setCapturingTimetable(true);
    setError(null);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const gridNode = target.querySelector("[data-timetable-grid='true']") as HTMLElement | null;
      const tableNode = target.querySelector("[data-timetable-table='true']") as HTMLElement | null;
      const captureWidth = Math.ceil(Math.max(tableNode?.scrollWidth ?? 0, gridNode?.scrollWidth ?? 0, 1));
      const captureHeight = Math.ceil(target.scrollHeight);
      const canvas = await html2canvas(target, {
        backgroundColor: "#ffffff",
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true,
        logging: false,
        width: captureWidth,
        height: captureHeight,
        windowWidth: captureWidth,
        windowHeight: captureHeight,
        onclone: (documentClone) => {
          const captureNode = documentClone.querySelector("[data-timetable-capture='true']") as HTMLElement | null;
          if (!captureNode) return;
          captureNode.style.display = "inline-block";
          captureNode.style.width = `${captureWidth}px`;
          captureNode.style.maxWidth = "none";
          captureNode.querySelectorAll<HTMLElement>(".grid-scrollbar").forEach((node) => {
            node.style.width = `${captureWidth}px`;
            node.style.overflow = "visible";
            node.style.maxWidth = "none";
          });
          captureNode.querySelectorAll<HTMLElement>("[data-timetable-table='true']").forEach((node) => {
            node.style.width = `${captureWidth}px`;
          });
          captureNode.querySelectorAll<HTMLElement>("[data-timetable-watermark='true']").forEach((node) => {
            node.style.display = "block";
            node.style.opacity = "0.07";
            node.style.zIndex = "20";
          });
          captureNode.querySelectorAll<HTMLElement>("[data-schedule-time-notch='true']").forEach((node) => {
            node.style.display = "none";
          });
          captureNode.querySelectorAll<HTMLElement>("[data-schedule-time-bubble='true']").forEach((node) => {
            node.style.height = "22px";
            node.style.minHeight = "22px";
            node.style.paddingTop = "0";
            node.style.paddingBottom = "0";
            node.style.lineHeight = "22px";
            node.style.alignItems = "center";
            node.style.justifyContent = "center";
          });
          captureNode.querySelectorAll<HTMLElement>("[data-schedule-time-bubble='true'] span").forEach((node) => {
            node.style.lineHeight = "22px";
          });
          captureNode.querySelectorAll<HTMLElement>("[data-schedule-type-badge='true']").forEach((node) => {
            node.style.height = "20px";
            node.style.minHeight = "20px";
            node.style.paddingTop = "0";
            node.style.paddingBottom = "0";
            node.style.lineHeight = "20px";
            node.style.alignItems = "center";
            node.style.justifyContent = "center";
          });
          captureNode.querySelectorAll<HTMLElement>("[data-timetable-time-button='true']").forEach((node) => {
            node.style.display = "flex";
            node.style.alignItems = "center";
            node.style.justifyContent = "center";
            node.style.height = "32px";
            node.style.paddingTop = "0";
            node.style.paddingBottom = "0";
            node.style.lineHeight = "32px";
          });
        }
      });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("이미지 생성에 실패했습니다.");
      await navigator.clipboard.write([new ClipboardItemCtor({ "image/png": blob })]);
      setNotice("시간표 이미지를 클립보드에 복사했습니다.");
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "시간표 이미지 복사에 실패했습니다.");
    } finally {
      setCapturingTimetable(false);
    }
  }, []);

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

      try {
        await deleteTimetableGroupRecord(groupId);
      } catch (groupDeleteError) {
        setDeleteGroupDialog((prev) => ({ ...prev, submitting: false }));
        setError(groupDeleteError instanceof Error ? groupDeleteError.message : "그룹 삭제에 실패했습니다.");
        return;
      }

      setDeleteGroupDialog({ open: false, groupId: null, groupName: "", submitting: false });
      setTimetableGroups((prev) => {
        const next = prev.filter((group) => group.id !== groupId);
        return next;
      });
      setSelectedGroupId((prev) => (prev === groupId ? null : prev));
      setNotice("시간표 그룹과 해당 수업을 삭제했습니다.");
      await loadWeek({ silent: true });
    },
    [deleteTimetableGroupRecord, loadWeek, moveToLogin, timetableGroups]
  );

  const handleRenameGroup = useCallback((groupId: string, name: string) => {
    setTimetableGroups((prev) => prev.map((group) => (group.id === groupId ? { ...group, name } : group)));
  }, []);

  const handleGroupExpirationChange = useCallback((groupId: string, expiresOn: string) => {
    setTimetableGroups((prev) => prev.map((group) => (group.id === groupId ? { ...group, expiresOn: expiresOn || null } : group)));
  }, []);

  const handleSelectSaveHistoryTarget = useCallback(
    (entry: SaveHistoryEntry) => {
      setShowIntroPage(false);
      setSearchKeyword("");
      setShowStudentPicker(false);
      setShowInstructorPicker(false);
      setSelectedGroupId(null);
      setError(null);
      setNotice(null);
      if (entry.tagId) setSelectedScheduleTagId(entry.tagId);

      if (entry.source === "schedule_creation") {
        setMainTab("new");
        setRoleView("student");
        setNotice(`'${entry.targetName}' 시간표를 저장한 시간표 생성 메뉴를 열었습니다.`);
        return;
      }

      if (entry.targetType === "학생") {
        const matchedStudent = findOptionByName(students, entry.targetName);
        const fallbackStudent = entry.targetId ? { id: entry.targetId, name: entry.targetName } : null;
        const targetStudent = matchedStudent ?? fallbackStudent;
        if (!targetStudent) {
          setError(`저장 기록 대상 학생을 찾지 못했습니다: ${entry.targetName}`);
          return;
        }
        setMainTab("student");
        setRoleView("student");
        setSelectedStudentId(targetStudent.id);
        if (!matchedStudent) {
          setNotice(`활성 학생 목록에는 없지만 저장 기록 기준으로 '${entry.targetName}' 시간표를 열었습니다.`);
        }
      } else {
        const matchedInstructor = findOptionByName(instructors, entry.targetName);
        const fallbackInstructor = entry.targetId ? { id: entry.targetId, name: entry.targetName } : null;
        const targetInstructor = matchedInstructor ?? fallbackInstructor;
        if (!targetInstructor) {
          setError(`저장 기록 대상 강사를 찾지 못했습니다: ${entry.targetName}`);
          return;
        }
        setMainTab("instructor");
        setRoleView("instructor");
        setSelectedInstructorId(targetInstructor.id);
        if (!matchedInstructor) {
          setNotice(`활성 강사 목록에는 없지만 저장 기록 기준으로 '${entry.targetName}' 시간표를 열었습니다.`);
        }
      }

      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [instructors, students]
  );

  const handlePersistGroupName = useCallback(
    async (groupId: string, name: string) => {
      try {
        await renameTimetableGroup(groupId, name);
      } catch (renameError) {
        setError(renameError instanceof Error ? renameError.message : "그룹 이름 저장에 실패했습니다.");
      }
    },
    [renameTimetableGroup]
  );

  const handlePersistGroupExpiration = useCallback(
    async (groupId: string, expiresOn: string) => {
      try {
        const normalized = expiresOn.trim() || null;
        await updateTimetableGroupExpiration(groupId, normalized);
        await loadTimetableGroups();
        setNotice(normalized ? `시간표 그룹 만료일을 ${normalized}로 저장했습니다.` : "시간표 그룹 만료일을 해제했습니다.");
      } catch (expirationError) {
        setError(expirationError instanceof Error ? expirationError.message : "그룹 만료일 저장에 실패했습니다.");
        await loadTimetableGroups().catch(() => undefined);
      }
    },
    [loadTimetableGroups, updateTimetableGroupExpiration]
  );

  useEffect(() => {
    void loadOptions()
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Failed to load options");
      })
      .finally(() => setViewerRoleResolved(true));
  }, [loadOptions]);

  useEffect(() => {
    void loadScheduleTags().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "시간표 태그를 불러오지 못했습니다.");
    }).finally(() => setScheduleTagSelectionReady(true));
  }, [loadScheduleTags]);

  useEffect(() => {
    const saved = window.localStorage.getItem("synchro-s-schedule-tag-v1");
    setSelectedScheduleTagId(saved || null);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("synchro-s-hidden-time-slots-v1") ?? "[]");
      setHiddenTimeSlots(Array.isArray(saved) ? TIME_SLOTS.filter((slot) => saved.includes(slot)) : []);
    } catch {
      setHiddenTimeSlots([]);
    } finally {
      setHiddenTimeSlotsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!hiddenTimeSlotsReady) return;
    window.localStorage.setItem("synchro-s-hidden-time-slots-v1", JSON.stringify(hiddenTimeSlots));
  }, [hiddenTimeSlots, hiddenTimeSlotsReady]);

  useEffect(() => {
    const refreshToday = () => setTodayISO(formatDateISOInKST(new Date()));
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshToday();
    };
    refreshToday();
    const timer = window.setInterval(refreshToday, 60_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (selectedScheduleTagId) window.localStorage.setItem("synchro-s-schedule-tag-v1", selectedScheduleTagId);
    else window.localStorage.removeItem("synchro-s-schedule-tag-v1");
  }, [selectedScheduleTagId]);

  useEffect(() => {
    setStudentDayDateOverrides({});
  }, [selectedStudentId, weekStart]);

  useEffect(() => {
    if (selectedScheduleTagId && scheduleTags.length > 0 && !scheduleTags.some((tag) => tag.id === selectedScheduleTagId)) {
      setSelectedScheduleTagId(null);
    }
  }, [scheduleTags, selectedScheduleTagId]);

  useEffect(() => {
    void loadSaveHistory().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "저장 기록을 불러오지 못했습니다.");
    });
  }, [loadSaveHistory]);

  useEffect(() => {
    if (!viewerRoleResolved || !scheduleTagSelectionReady) return;
    void loadTimetableGroups().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "저장된 시간표 그룹을 불러오지 못했습니다.");
    });
  }, [loadTimetableGroups, scheduleTagSelectionReady, viewerRoleResolved]);

  useEffect(() => {
    if (!viewerRoleResolved || !scheduleTagSelectionReady) return;
    const refreshSharedState = () => {
      if (document.visibilityState !== "visible") return;
      void Promise.all([loadTimetableGroups({ silent: true }), loadSaveHistory()]).catch((refreshError) => {
        console.error("[shared-timetable-state] refresh failed", refreshError);
      });
    };
    const intervalId = window.setInterval(refreshSharedState, 15_000);
    window.addEventListener("focus", refreshSharedState);
    document.addEventListener("visibilitychange", refreshSharedState);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshSharedState);
      document.removeEventListener("visibilitychange", refreshSharedState);
    };
  }, [loadSaveHistory, loadTimetableGroups, scheduleTagSelectionReady, viewerRoleResolved]);

  useEffect(() => {
    if (mainTab !== "overview" && !(showIntroPage && !isInstructorReadOnly)) {
      return;
    }
    void loadOverviewEvents().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "전체 요약 데이터를 불러오지 못했습니다.");
    });
  }, [isInstructorReadOnly, loadOverviewEvents, mainTab, showIntroPage]);

  useEffect(() => {
    if (showIntroPage || mainTab !== "issues") {
      return;
    }
    void loadConflictLogs();
  }, [loadConflictLogs, mainTab, showIntroPage]);

  useEffect(() => {
    if (showIntroPage || mainTab !== "review") {
      return;
    }
    void loadScheduleReviews();
  }, [loadScheduleReviews, mainTab, showIntroPage]);

  useEffect(() => {
    if (!isWorkspaceTab || (showIntroPage && !isInstructorReadOnly)) {
      setLoading(false);
      setEvents([]);
      return;
    }
    void loadWeek();
  }, [isInstructorReadOnly, isWorkspaceTab, loadWeek, showIntroPage]);

  useEffect(() => {
    if (!isWorkspaceTab || (showIntroPage && !isInstructorReadOnly)) {
      setSpecialNotes([]);
      setNotesLoading(false);
      return;
    }
    void loadSpecialNotes();
  }, [isInstructorReadOnly, isWorkspaceTab, loadSpecialNotes, showIntroPage]);

  useEffect(() => {
    if (error === "Bad Request") {
      setError(null);
    }
  }, [error, mainTab, roleView, selectedInstructorId, selectedStudentId, showIntroPage]);

  useEffect(() => {
    if (mainTab !== "overview") {
      return;
    }
    setRoleView(overviewEntity);
    if (
      overviewEntity === "instructor" &&
      overviewVisibleInstructors.length > 0 &&
      !overviewVisibleInstructors.some((item) => item.id === selectedInstructorId)
    ) {
      setSelectedInstructorId(overviewVisibleInstructors[0]!.id);
    }
    if (overviewEntity === "student" && students.length > 0 && !students.some((item) => item.id === selectedStudentId)) {
      setSelectedStudentId(students[0]!.id);
    }
  }, [mainTab, overviewEntity, overviewVisibleInstructors, selectedInstructorId, selectedStudentId, students]);

  useEffect(() => {
    if (mainTab !== "review") {
      return;
    }
    if (!selectedReviewStudentId && reviewEligibleStudents.length > 0) {
      setSelectedReviewStudentId(reviewEligibleStudents[0]!.id);
      return;
    }
    if (selectedReviewStudentId && !reviewEligibleStudents.some((student) => student.id === selectedReviewStudentId)) {
      setSelectedReviewStudentId(reviewEligibleStudents[0]?.id ?? "");
    }
  }, [mainTab, reviewEligibleStudents, selectedReviewStudentId]);

  useEffect(() => {
    setReviewMemoDraft(selectedReview?.memo ?? "");
  }, [selectedReview?.memo, selectedReviewStudent?.id]);

  useEffect(() => {
    setSelectedReviewClassKey(null);
  }, [selectedReviewStudent?.id]);

  useEffect(() => {
    setNewPlacementDraft((prev) => ({
      ...prev,
      subjectCode: prev.subjectCode || subjects[0]?.code || "",
      classTypeCode: prev.classTypeCode || classTypes[0]?.code || ""
    }));
  }, [classTypes, subjects]);

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
    window.localStorage.setItem("synchro-s-event-memo-v1", JSON.stringify(memoByEventId));
  }, [memoByEventId]);

  useEffect(() => {
    setSelectedGroupId(null);
    setIsCreatingNewSyncTimetable(false);
    autoSelectedGroupScopeRef.current = null;
  }, [currentTargetId, roleView]);

  useEffect(() => {
    if (timetableGroupsLoading || !currentTargetId || !selectedScheduleTagId) return;

    const scopeKey = `${roleView}:${currentTargetId}:${selectedScheduleTagId}`;
    if (autoSelectedGroupScopeRef.current === scopeKey) return;

    const preferredGroup =
      roleView === "student"
        ? getLatestActiveStudentGroup(
            timetableGroups,
            currentTargetId,
            selectedScheduleTagId,
            shiftDate(weekStart, 7),
            todayISO
          )
        : getLatestActiveStudentGroupForInstructor(
            timetableGroups,
            currentTargetId,
            selectedInstructorLabel,
            selectedScheduleTagId
          );

    autoSelectedGroupScopeRef.current = scopeKey;
    if (!preferredGroup || preferredGroup.weekStart <= weekStart) return;

    setWeekStart(preferredGroup.weekStart);
    setCalendarMonth(monthStart(preferredGroup.weekStart));
    if (roleView === "student") {
      setSelectedGroupId(preferredGroup.id);
    }
  }, [
    currentTargetId,
    roleView,
    selectedInstructorLabel,
    selectedScheduleTagId,
    timetableGroups,
    timetableGroupsLoading,
    todayISO,
    weekStart
  ]);

  useEffect(() => {
    setExpandedGroupMonths((prev) => ({ ...prev, [currentGroupMonthKey]: true }));
  }, [currentGroupMonthKey, currentTargetId, roleView]);

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
    if (selected && !selected.isActive && !effectiveGroupIdSet.has(selected.id)) {
      setSelectedGroupId(activeGroup?.id ?? null);
    }
  }, [activeGroup?.id, effectiveGroupIdSet, selectedGroupId, showActiveOnly, timetableGroups]);

  useEffect(() => {
    if (!keyword || (!isWorkspaceTab && mainTab !== "overview")) return;

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
    students,
    isWorkspaceTab,
    mainTab
  ]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const reloadActiveScreen = () => {
      if (isWorkspaceTab && (!showIntroPage || isInstructorReadOnly)) {
        void loadWeek({ silent: true });
      }
      if ((!showIntroPage && mainTab === "overview") || (showIntroPage && !isInstructorReadOnly)) {
        void loadOverviewEvents();
      }
      if (!showIntroPage && mainTab === "review") {
        void loadScheduleReviews();
      }
    };
    const channel = supabase
      .channel("synchro-s-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "classes" }, () => {
        if (importingNotionRef.current) {
          pendingRealtimeReloadRef.current = true;
          return;
        }
        reloadActiveScreen();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "class_enrollments" }, () => {
        if (importingNotionRef.current) {
          pendingRealtimeReloadRef.current = true;
          return;
        }
        reloadActiveScreen();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "class_overrides" }, () => {
        if (importingNotionRef.current) {
          pendingRealtimeReloadRef.current = true;
          return;
        }
        reloadActiveScreen();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "special_notes" }, () => {
        if (!showIntroPage && mainTab === "review") void loadScheduleReviews();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isInstructorReadOnly, isWorkspaceTab, loadOverviewEvents, loadScheduleReviews, loadWeek, mainTab, showIntroPage]);

  return (
    <main
      className={`sync-tabular grid min-h-screen w-full gap-3 overflow-x-hidden bg-slate-50 px-3 py-3 text-slate-900 lg:px-4 2xl:px-6 xl:items-start ${
        viewerRoleResolved && !isInstructorReadOnly ? "xl:grid-cols-[12.5rem_minmax(0,1fr)]" : "xl:grid-cols-1"
      }`}
    >
      {viewerRoleResolved && !isInstructorReadOnly ? (
      <aside className="hidden xl:block xl:sticky xl:top-4 xl:self-start">
        <div className="sync-surface max-h-[calc(100vh-2rem)] w-[12.5rem] overflow-hidden rounded-xl bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M8 7h8" strokeLinecap="round" />
                  <path d="M8 12h8" strokeLinecap="round" />
                  <path d="M8 17h5" strokeLinecap="round" />
                  <circle cx="6" cy="7" r="1" fill="currentColor" stroke="none" />
                  <circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" />
                  <circle cx="6" cy="17" r="1" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Save History</p>
                <p className="text-sm font-black text-slate-800">최근 저장 기록</p>
              </div>
            </div>
          </div>

          <div className="max-h-[calc(100vh-11.5rem)] overflow-y-auto px-3 py-3">
            {saveHistory.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold leading-5 text-slate-500">
                아직 저장 기록이 없습니다.
                <br />
                [DB로 저장] 성공 시 이곳에 최신순으로 표시됩니다.
              </div>
            ) : (
              <div className="relative pl-4">
                <span className="absolute left-[6px] top-1 bottom-1 w-px bg-slate-200" />
                <div className="space-y-2.5">
                  {saveHistory.map((entry) => {
                    const isScheduleCreation = entry.source === "schedule_creation";
                    const historyTypeLabel = isScheduleCreation ? "시간표 생성" : `${entry.targetType} 시간표`;
                    return (
                    <div key={entry.id} className="relative">
                      <span
                        className={`absolute -left-4 top-1.5 h-2.5 w-2.5 rounded-full border shadow-sm ${
                          isScheduleCreation
                            ? "border-emerald-100 bg-emerald-500 shadow-emerald-200"
                            : "border-blue-100 bg-blue-500 shadow-blue-200"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => handleSelectSaveHistoryTarget(entry)}
                        className={`sync-pressable sync-focus w-full rounded-lg border px-2.5 py-2 text-left text-white shadow-sm ${
                          isScheduleCreation
                            ? "border-emerald-700 bg-emerald-600 hover:border-emerald-800 hover:bg-emerald-700"
                            : "border-blue-700 bg-blue-600 hover:border-blue-800 hover:bg-blue-700"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-[10px] font-black tracking-wide text-white/90">[{entry.timestampLabel}]</span>
                          <span className="shrink-0 rounded-full border border-white/25 bg-white/15 px-1.5 py-0.5 text-[9px] font-black tracking-wide text-white">
                            {historyTypeLabel}
                          </span>
                        </span>
                        <p className="mt-1 truncate text-[11px] font-bold leading-5 text-white">
                          {entry.targetName}
                        </p>
                        <p className="mt-1 inline-flex max-w-full rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-black text-amber-950">
                          <span className="truncate">분류: {entry.tagId ? `#${entry.tagLabel}` : entry.tagLabel}</span>
                        </p>
                        <span className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold text-white/90">
                          <StaffAvatar actor={entry.actor} size="xs" />
                          <span className="min-w-0 truncate">
                            {entry.actor.name || "담당자 기록 없음"}
                            {entry.actor.position ? ` · ${entry.actor.position}` : ""}
                          </span>
                        </span>
                      </button>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
      ) : null}

      <div className="flex min-w-0 flex-col gap-4">
      <section className="sync-surface sticky top-0 z-[80] overflow-visible rounded-xl bg-white p-4">
        <div className="space-y-4">
          <div className="grid gap-3 xl:grid-cols-[1.2fr_minmax(320px,0.9fr)_auto]">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_0_0_1px_rgba(15,23,42,0.02)]">
              <div className="flex items-center gap-4">
                <img
                  src="https://raw.githubusercontent.com/whdtjd5294/whdtjd5294.github.io/main/sedu_logo.png"
                  alt="SEDU 로고"
                  className="h-14 w-14 shrink-0 object-contain"
                />
                <div>
                  <div className="flex flex-wrap items-end gap-3">
                    <h1 className="sync-heading text-2xl font-black text-slate-900">Synchro-S</h1>
                    <span className="mb-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Timetable DB
                    </span>
                  </div>
                  <p className="sync-copy text-sm font-semibold text-slate-500">{weekStart} ~ {weekEnd} | 입력 일시/진행현황 자동 기록</p>
                </div>
              </div>
            </div>

            <label className="flex min-h-[88px] items-center gap-3 rounded-lg border-2 border-blue-300 bg-blue-50/40 px-5 shadow-[0_0_0_3px_rgba(59,130,246,0.10)] transition focus-within:border-blue-600 focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.14)]">
              <span className="flex h-10 w-10 items-center justify-center rounded-md border border-blue-200 bg-white text-blue-700">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="11" cy="11" r="6" />
                  <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-blue-600">Global Search</p>
                <input
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  placeholder={showIntroPage ? "강사/학생을 미리 검색해 둘 수 있습니다." : "강사/학생 검색"}
                  className="mt-1 w-full bg-transparent text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400"
                />
              </div>
            </label>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-end gap-2">
              {!isInstructorReadOnly ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setShowIntroPage(true);
                }}
                className={`sync-pressable sync-focus inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-bold shadow-sm ${
                  showIntroPage
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-slate-100 hover:text-blue-700"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${showIntroPage ? "bg-white" : "bg-sky-400"}`} />
                홈
              </button>
              ) : null}
              {!isInstructorReadOnly ? (
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                {(isInstructorReadOnly
                  ? ([{ key: "instructor", label: "강사" }] as const)
                  : ([
                      { key: "overview", label: "전체 요약" },
                      { key: "review", label: "시간표 검토" },
                      { key: "issues", label: "오류 기록" },
                      { key: "new", label: "시간표 생성" },
                      { key: "instructor", label: "강사" },
                      { key: "student", label: "학생" }
                    ] as const)
                ).map((tab) => {
                  const active = !showIntroPage && mainTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => handleMainTabChange(tab.key)}
                      className={`sync-pressable sync-focus rounded-md px-3 py-2 text-sm font-semibold ${
                        active
                          ? "border border-blue-600 bg-blue-600 text-white shadow-sm"
                          : "border border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              ) : null}
              {isInstructorReadOnly ? (
              <label className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="sr-only">시간표 태그</span>
                <select
                  value={selectedScheduleTagId ?? ""}
                  onChange={(event) => {
                    setSelectedScheduleTagId(event.target.value || null);
                    setSelectedGroupId(null);
                  }}
                  className="max-w-[150px] bg-transparent pr-1 font-bold outline-none"
                  aria-label="현재 시간표 태그"
                >
                  <option value="">미분류</option>
                  {scheduleTags.filter((tag) => tag.isActive || tag.id === selectedScheduleTagId).map((tag) => (
                    <option key={tag.id} value={tag.id}>{tag.name}{tag.isCurrent ? " (현재)" : ""}</option>
                  ))}
                </select>
              </label>
              ) : null}
              {!isInstructorReadOnly ? (
                <button
                  type="button"
                  onClick={() => setScheduleTagManagerOpen(true)}
                  className="sync-pressable sync-focus inline-flex h-9 items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 7h10l6 6-7 7-9-9V7Z" strokeLinejoin="round" />
                    <circle cx="9" cy="11" r="1.5" />
                  </svg>
                  태그 관리자
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="sync-pressable sync-focus inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" strokeLinecap="round" />
                  <path d="M10 16l4-4-4-4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 12H4" strokeLinecap="round" />
                </svg>
                로그아웃
              </button>
              </div>
              {!isInstructorReadOnly ? (
                <nav aria-label="시간표 분류 바로가기" className="mt-2 flex flex-wrap items-center justify-end gap-1.5 border-t border-slate-200 pt-2">
                  <span className="mr-1 text-[11px] font-black text-slate-400">시간표 분류</span>
                  <button
                    type="button"
                    aria-pressed={selectedScheduleTagId === null}
                    onClick={() => {
                      setSelectedScheduleTagId(null);
                      setSelectedGroupId(null);
                    }}
                    className={`sync-pressable sync-focus min-h-10 rounded-full border px-3 text-xs font-black transition-[background-color,border-color,box-shadow,color] duration-150 ease-out ${
                      selectedScheduleTagId === null
                        ? "border-slate-500 bg-slate-700 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                    }`}
                  >
                    미분류
                  </button>
                  {scheduleTags.filter((tag) => tag.isActive || tag.id === selectedScheduleTagId).map((tag) => {
                    const active = tag.id === selectedScheduleTagId;
                    return (
                      <button
                        key={`header-tag-${tag.id}`}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setSelectedScheduleTagId(tag.id);
                          setSelectedGroupId(null);
                        }}
                        className={`sync-pressable sync-focus min-h-10 rounded-full border px-3 text-xs font-black transition-[background-color,border-color,box-shadow,color] duration-150 ease-out ${
                          active
                            ? `${SCHEDULE_TAG_TONES[tag.colorKey]} ring-2 ring-blue-200 ring-offset-1 ring-offset-slate-50 shadow-sm`
                            : `${SCHEDULE_TAG_TONES[tag.colorKey]} opacity-75 hover:opacity-100`
                        }`}
                      >
                        <span>#{tag.name}</span>
                        {tag.isCurrent ? (
                          <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-black ${active ? "bg-white/85 text-blue-700" : "bg-blue-600 text-white"}`}>
                            현재
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </nav>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[auto_1fr_auto]">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                className="sync-pressable sync-focus h-8 rounded-md px-3 text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                onClick={() => setWeekStart((prev) => shiftDate(prev, -7))}
              >
                이전 주
              </button>
              <button
                type="button"
                className="sync-pressable sync-focus h-8 rounded-md bg-blue-600 px-3 text-xs font-black text-white shadow-sm"
                onClick={() => setWeekStart(mondayOfCurrentWeek())}
              >
                이번 주
              </button>
              <button
                type="button"
                className="sync-pressable sync-focus h-8 rounded-md px-3 text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                onClick={() => setWeekStart((prev) => shiftDate(prev, 7))}
              >
                다음 주
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={refreshingData}
                onClick={() => void handleHardRefreshData()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
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
                {refreshingData ? "새로고침 중..." : "새로고침"}
              </button>
              <div className="group relative">
                <div className="inline-flex h-10 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 text-[11px] font-bold text-amber-800">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span>정규수업 매주 자동 반복</span>
                </div>
                <div className="pointer-events-none absolute left-0 top-full z-[180] mt-2 w-72 rounded-lg border border-slate-200 bg-white p-3 text-xs font-semibold leading-5 text-slate-700 opacity-0 shadow-lg transition duration-150 group-hover:opacity-100">
                  정규수업은 매주 같은 시간에 반복 표시됩니다. 특정 날짜에 배정된 보강/단기 수업(one-off)만 해당 주차에 표시됩니다.
                </div>
              </div>
              {!isInstructorReadOnly ? (
                <>
                  <button
                    type="button"
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"
                    onClick={() => void handleCopyForNotion()}
                  >
                    <span className="h-2 w-2 rounded-full bg-blue-400" />
                    노션 붙여넣기 복사
                  </button>
                  <button
                    type="button"
                    disabled={syncingSheets}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                    onClick={() => void handleSyncSheets()}
                  >
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    {syncingSheets ? "명단 동기화 중..." : "명단 동기화"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 text-xs font-bold text-violet-700 hover:bg-violet-100"
                    onClick={openSubjectSettingsModal}
                  >
                    <span className="h-2 w-2 rounded-full bg-violet-400" />
                    과목 코드 설정
                  </button>
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="min-w-[240px] rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-3">
                  {!showIntroPage && isWorkspaceTab && roleView === "student" && selectedStudentOption ? (
                    <SchoolEmblem student={selectedStudentOption} size="lg" />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-base font-black text-slate-800">
                      {showIntroPage ? "홈" : profileInitial}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em]">
                      {showIntroPage ? (isInstructorReadOnly ? "My Timetable" : "Today Dashboard") : mainTab === "overview" ? "Overview Dashboard" : profileTitle}
                    </p>
                    <p className="truncate text-lg font-black text-slate-900">
                      {showIntroPage
                        ? isInstructorReadOnly
                          ? `${selectedInstructorLabel} 시간표`
                          : `${homeDashboardRelativeLabel} ${homeDashboardWeekdayLabel}요일 운영 대시보드`
                        : mainTab === "overview"
                          ? "강사 스케줄 모아보기"
                          : profileName}
                    </p>
                    <p className="truncate text-xs font-semibold text-slate-500">
                      {showIntroPage
                        ? isInstructorReadOnly
                          ? "로그인한 강사의 이번 주 수업을 바로 확인합니다."
                          : "선택한 날짜의 강사와 학생 배치를 한 화면에 정리합니다."
                        : mainTab === "overview"
                          ? "등록된 강사를 빠르게 넘겨 보며 심플 시간표를 조회합니다."
                          : profileSecondary || "상세 정보 없음"}
                    </p>
                  </div>
                </div>
              </div>

              {!showIntroPage && isWorkspaceTab ? (
                roleView === "instructor" ? (
                  <div className="relative z-[120]">
                    <button
                      type="button"
                      onClick={() => {
                        setShowInstructorPicker((prev) => !prev);
                        setShowStudentPicker(false);
                      }}
                      className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-100"
                    >
                      강사: {selectedInstructorLabel}
                    </button>
                    {showInstructorPicker ? (
                      <div className="absolute right-0 z-[220] mt-2 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                        <div className="max-h-72 overflow-auto">
                          {(filteredInstructors.length > 0 ? filteredInstructors : instructors).map((instructor) => (
                            <button
                              key={instructor.id}
                              type="button"
                              onClick={() => {
                                setSelectedInstructorId(instructor.id);
                                setShowInstructorPicker(false);
                              }}
                              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold ${
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
                      className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-100"
                    >
                      학생: {selectedStudentLabel}
                    </button>
                    {showStudentPicker ? (
                      <div className="absolute right-0 z-[220] mt-2 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                        <div className="max-h-80 overflow-auto">
                          {(filteredStudents.length > 0 ? filteredStudents : students).map((student) => (
                            <button
                              key={student.id}
                              type="button"
                              onClick={() => {
                                setSelectedStudentId(student.id);
                                setShowStudentPicker(false);
                              }}
                              className={`block w-full rounded-md px-3 py-2 text-left text-sm font-semibold ${
                                student.id === selectedStudentId
                                  ? "bg-teal-100 text-teal-800"
                                  : "text-slate-800 hover:bg-slate-100/70"
                              }`}
                            >
                              <SchoolEmblem student={student} size="xs" />
                              <span className="min-w-0">
                                <span className="block truncate">학생: {student.name}</span>
                                {student.secondary ? <span className="block truncate text-xs font-medium text-slate-500">{student.secondary}</span> : null}
                              </span>
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

      {!showIntroPage && isWorkspaceTab && roleView === "instructor" ? (
        <section className="sync-surface rounded-xl bg-white p-2">
          <div className="inline-flex w-full rounded-lg bg-slate-100 p-1 sm:w-auto">
            {([
              ["schedule", "수업 시간표"],
              ["availability", "수업 가능 일정"]
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setInstructorWorkspaceTab(tab);
                  setError(null);
                  setNotice(null);
                }}
                className={`sync-pressable sync-focus min-h-10 flex-1 rounded-lg px-5 text-xs font-black transition-[background-color,box-shadow,color] duration-150 ease-out sm:flex-none ${
                  instructorWorkspaceTab === tab
                    ? "bg-white text-blue-700 shadow-[0_0_0_1px_rgba(37,99,235,0.18),0_8px_18px_rgba(37,99,235,0.08)]"
                    : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!showIntroPage && isWorkspaceTab && roleView === "instructor" && instructorWorkspaceTab === "schedule" && selectedInstructorId && !isInstructorReadOnly ? (
        <section className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="mr-1 min-w-[92px]">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Days Off</p>
                  <span className="text-[10px] font-semibold text-slate-500">
                    {savingInstructorDaysOff ? "저장 중..." : selectedInstructorDaysOff.length > 0 ? "회색 열 표시" : "설정 없음"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {DAYS.map((day) => {
                  const active = selectedInstructorDaysOff.includes(day.key);
                  return (
                    <button
                      key={`day-off-${day.key}`}
                      type="button"
                      disabled={savingInstructorDaysOff}
                      onClick={() => void handleToggleInstructorDayOff(day.key)}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold transition ${
                        active ? "border-slate-700 bg-slate-700 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                      } disabled:opacity-60`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {!showIntroPage && isWorkspaceTab && roleView === "instructor" && instructorWorkspaceTab === "availability" ? (
        selectedInstructorId ? (
          <InstructorAvailabilityWorkspace
            instructorId={selectedInstructorId}
            instructorName={selectedInstructorLabel}
            instructorSubject={selectedInstructorSecondary}
            initialAvailability={selectedInstructorAvailabilityByDay}
            students={students}
            classTypes={classTypes}
            onActiveAvailabilityChange={(slotsByDay) => {
              setInstructors((prev) =>
                prev.map((item) =>
                  item.id === selectedInstructorId
                    ? {
                        ...item,
                        availableTimeSlotsByDay: slotsByDay,
                        availableTimeSlots: flattenAvailableTimeSlotsByDay(slotsByDay)
                      }
                    : item
                )
              );
            }}
          />
        ) : (
          <div className="sync-surface rounded-xl bg-white p-6 text-center text-sm font-bold text-slate-500">
            가능 일정을 관리할 강사를 먼저 선택해 주세요.
          </div>
        )
      ) : null}

      {!showIntroPage && isWorkspaceTab && (roleView !== "instructor" || instructorWorkspaceTab === "schedule") ? (
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
      {roleView === "student" ? (
        <>
          {!isInstructorReadOnly ? (
            <div className="sync-surface rounded-xl bg-white p-3">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <p className="sync-heading text-sm font-black text-slate-900">학생별 시간표 입력</p>
                  <p className="sync-copy mt-1 text-xs font-semibold text-slate-500">
                    직접 입력하거나 노션 표를 붙여넣어 미리보기 후 DB에 저장합니다.
                  </p>
                </div>
                <div className="inline-flex rounded-t-xl bg-slate-100 p-1">
                  {([
                    ["sync", "싱크로 시간표"],
                    ["notion", "노션 시간표"],
                    ["availability", "가능 일정"]
                  ] as const).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setStudentScheduleInputTab(tab)}
                      className={`sync-pressable sync-focus min-h-10 rounded-lg px-4 text-xs font-black transition-[background-color,box-shadow,color] duration-150 ease-out ${
                        studentScheduleInputTab === tab
                          ? "bg-white text-blue-700 shadow-[0_0_0_1px_rgba(37,99,235,0.18),0_8px_18px_rgba(37,99,235,0.08)]"
                          : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {studentScheduleInputTab === "sync" ? (
                <div className="grid gap-3 pt-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
                    시간표의 빈칸을 누르면 과목, 강사, 수업 유형, 수업 시간을 입력할 수 있습니다. 초안은 아래 시간표에 바로 표시되고, DB 저장 전에는 실제 데이터가 바뀌지 않습니다.
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={savingSyncDrafts || !selectedStudentId}
                      onClick={handleStartNewSyncTimetable}
                      className={`sync-pressable sync-focus min-h-9 rounded-lg border px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-50 ${
                        isCreatingNewSyncTimetable
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                      }`}
                    >
                      {isCreatingNewSyncTimetable ? "새 시간표 작성 중" : "새 시간표 만들기"}
                    </button>
                    <span className="sync-tabular rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">
                      초안 {syncDraftItems.length}건
                    </span>
                    <button
                      type="button"
                      disabled={savingSyncDrafts || syncDraftItems.length === 0 || !selectedScheduleTagId}
                      onClick={() => void handleSaveSyncDraftsToServer()}
                      className="sync-pressable sync-focus min-h-9 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingSyncDrafts ? "저장 중" : "DB로 저장"}
                    </button>
                    <button
                      type="button"
                      disabled={savingSyncDrafts || syncDraftItems.length === 0}
                      onClick={handleResetSyncDrafts}
                      className="sync-pressable sync-focus min-h-9 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      초안 초기화
                    </button>
                  </div>
                  {selectedStudentId ? null : (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 lg:col-span-2">
                      먼저 학생을 선택해야 싱크로 시간표를 입력할 수 있습니다.
                    </p>
                  )}
                  {selectedScheduleTagId ? null : (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 lg:col-span-2">
                      필수 항목: 상단에서 시간표 분류(태그)를 선택해야 입력과 DB 저장을 진행할 수 있습니다.
                    </p>
                  )}
                  {syncDraftItems.length > 0 ? (
                    <div className="grid gap-2 lg:col-span-2 sm:grid-cols-2 xl:grid-cols-3">
                      {syncDraftItems.slice(0, 6).map((item) => (
                        <div key={item.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                          <span className="sync-tabular text-blue-700">
                            {DAYS.find((day) => day.key === item.weekday)?.label} {item.startTime}-{item.endTime}
                          </span>
                          <span className="ml-2">{item.rawText}</span>
                        </div>
                      ))}
                      {syncDraftItems.length > 6 ? (
                        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-black text-slate-500">
                          외 {syncDraftItems.length - 6}건
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : studentScheduleInputTab === "notion" ? (
                <div className="pt-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold text-slate-600">노션 시간표 원본 텍스트</p>
                    <button
                      type="button"
                      onClick={() => void handleLoadClipboardToNotionInput()}
                      className="sync-pressable sync-focus min-h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      클립보드 불러오기
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyNotionInput}
                      className="sync-pressable sync-focus min-h-8 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      시간표에 반영
                    </button>
                    <button
                      type="button"
                      disabled={importingNotion || !selectedScheduleTagId}
                      onClick={() => void handleImportNotionToServer()}
                      className="sync-pressable sync-focus min-h-8 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                    >
                      {importingNotion ? "저장 중" : "DB로 저장"}
                    </button>
                    <button
                      type="button"
                      disabled={!undoState || importingNotion}
                      onClick={() => void handleUndoLastChange()}
                      className="sync-pressable sync-focus min-h-8 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      되돌리기
                    </button>
                    <button
                      type="button"
                      disabled={importingNotion || (!notionTextValue && parsedNotionItems.length === 0)}
                      onClick={handleResetNotionInput}
                      className="sync-pressable sync-focus min-h-8 rounded-md border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      초기화
                    </button>
                    {notionPreview ? (
                      <button
                        type="button"
                        onClick={() => void handleCopyForNotion()}
                        className="sync-pressable sync-focus min-h-8 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        현재 주차 내보내기 복사
                      </button>
                    ) : null}
                  </div>
                  {selectedScheduleTagId ? null : (
                    <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                      필수 항목: 상단에서 시간표 분류(태그)를 선택해야 노션 시간표를 DB에 저장할 수 있습니다.
                    </p>
                  )}
                  <textarea
                    value={notionTextValue}
                    onChange={(event) => {
                      setNotionInput(event.target.value);
                      setParsedNotionItems([]);
                    }}
                    placeholder="노션 표를 그대로 붙여넣으세요. 예: 시간, 월요일, 화요일..."
                    className="sync-input h-28 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-xs font-semibold text-sky-700">
              강사 계정은 본인 시간표 조회만 가능합니다. 편집/저장/삭제 기능은 관리자 계정에서만 사용할 수 있습니다.
            </div>
          )}
        </>
      ) : null}

      {roleView === "student" && studentScheduleInputTab === "availability" ? (
        selectedStudentId ? (
          <StudentAvailabilityWorkspace
            studentId={selectedStudentId}
            studentName={selectedStudentLabel}
            studentSecondary={selectedStudentSecondary}
          />
        ) : (
          <div className="sync-surface rounded-xl bg-white p-6 text-center text-sm font-bold text-slate-500">
            가능 일정을 관리할 학생을 먼저 선택해 주세요.
          </div>
        )
      ) : (
      <section className="grid flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {roleView === "student" ? (
            <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-slate-800">시간표 메모</p>
                  <p className="text-[11px] font-semibold text-slate-500">
                    {isInstructorReadOnly
                      ? "강사 계정은 시간표 메모를 열람만 할 수 있습니다."
                      : displayedGroup
                        ? `'${displayedGroup.name}' 저장 그룹에 메모를 기록합니다.`
                        : "시간표를 DB에 저장한 뒤 저장 그룹별 메모를 기록할 수 있습니다."}
                  </p>
                </div>
                <div className="flex min-w-[280px] flex-1 flex-wrap items-center justify-end gap-2">
                  <input
                    value={specialNoteInput}
                    onChange={(inputEvent) => setSpecialNoteInput(inputEvent.target.value)}
                    placeholder="예: 수학은 안준성T로만 구성 희망"
                    disabled={isInstructorReadOnly || !displayedGroup}
                    className="min-w-[220px] flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                  <button
                    type="button"
                    disabled={isInstructorReadOnly || noteSubmitting || !currentTargetId || !displayedGroup}
                    onClick={() => void handleCreateSpecialNote()}
                    className="h-8 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {noteSubmitting ? "저장 중..." : "등록"}
                  </button>
                </div>
              </div>
              <div className="mt-3 max-h-36 space-y-1.5 overflow-y-auto pr-1">
                {notesLoading ? (
                  <p className="text-xs font-semibold text-slate-500">불러오는 중...</p>
                ) : displayedGroupNotes.length === 0 ? (
                  <p className="text-xs font-semibold text-slate-500">선택한 저장 그룹에 등록된 시간표 메모가 없습니다.</p>
                ) : (
                  displayedGroupNotes.map((note) => (
                    <div
                      key={note.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <p className="min-w-0 text-xs font-semibold leading-5 text-slate-700">
                        <span className="font-black text-slate-500">[{formatSpecialNoteTimestamp(note.createdAt)}]</span>{" "}
                        {note.content}
                      </p>
                      <button
                        type="button"
                        disabled={isInstructorReadOnly || noteSubmitting}
                        onClick={() => void handleDeleteSpecialNote(note.id)}
                        className="shrink-0 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                      >
                        X 삭제
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
          <div className="sync-surface mb-3 flex items-center justify-between rounded-xl bg-white px-3 py-2">
            <div>
              <p className="sync-heading text-sm font-black text-slate-800">시간표 보기 모드</p>
              <p className="sync-copy text-[11px] font-semibold text-slate-500">상세 블록과 중앙 배지형 심플 표시를 전환하고 빈 요일이나 시간대를 접을 수 있습니다.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHideEmptyDays((prev) => !prev)}
                  className={`sync-pressable sync-focus inline-flex min-h-8 items-center rounded-full border px-3 py-1.5 text-xs font-bold ${
                    hideEmptyDays
                      ? "border-blue-300 bg-blue-50 text-blue-700 shadow-sm shadow-blue-100"
                      : "border-slate-200 bg-white/80 text-slate-600 hover:bg-white"
                  }`}
                >
                  빈 요일 숨기기 {hideEmptyDays ? "ON" : "OFF"}
                </button>
                <button
                  type="button"
                  onClick={() => setHideEmptyTimes((prev) => !prev)}
                  className={`sync-pressable sync-focus inline-flex min-h-8 items-center rounded-full border px-3 py-1.5 text-xs font-bold ${
                    hideEmptyTimes
                      ? "border-blue-300 bg-blue-50 text-blue-700 shadow-sm shadow-blue-100"
                      : "border-slate-200 bg-white/80 text-slate-600 hover:bg-white"
                  }`}
                >
                  빈 시간 숨기기 {hideEmptyTimes ? "ON" : "OFF"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCaptureTimetableImage()}
                  disabled={capturingTimetable || loading}
                  title="표시된 시간표를 이미지로 클립보드에 복사"
                  className="sync-pressable sync-focus inline-flex min-h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M7 7.5 8.4 5h7.2L17 7.5h2.5A2.5 2.5 0 0 1 22 10v6.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16.5V10a2.5 2.5 0 0 1 2.5-2.5H7Z" strokeLinejoin="round" />
                    <circle cx="12" cy="13" r="3.2" />
                  </svg>
                  {capturingTimetable ? "복사 중" : "시간표 이미지 캡쳐"}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {roleView === "instructor" ? (
                <label className="relative block w-56 max-w-full">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m16.5 16.5 3.5 3.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    value={instructorStudentSearchKeyword}
                    onChange={(event) => setInstructorStudentSearchKeyword(event.target.value)}
                    placeholder="학생명 검색"
                    className="sync-input h-9 w-full rounded-full border border-slate-200 bg-white pl-9 pr-8 text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                  />
                  {instructorStudentSearchKeyword ? (
                    <button
                      type="button"
                      onClick={() => setInstructorStudentSearchKeyword("")}
                      className="sync-pressable sync-focus absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-black text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label="학생 검색어 지우기"
                    >
                      ×
                    </button>
                  ) : null}
                </label>
              ) : null}
              <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setTimetableViewMode("detailed")}
                  className={`sync-pressable sync-focus rounded-full px-3 py-1.5 text-xs font-bold ${
                    timetableViewMode === "detailed" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-white"
                  }`}
                >
                  상세
                </button>
                <button
                  type="button"
                  onClick={() => setTimetableViewMode("summary")}
                  className={`sync-pressable sync-focus rounded-full px-3 py-1.5 text-xs font-bold ${
                    timetableViewMode === "summary" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-white"
                  }`}
                >
                  심플 뷰
                </button>
              </div>
            </div>
          </div>
          {loading ? (
            <div className="sync-surface rounded-xl bg-white p-5 text-sm font-semibold text-slate-500">로딩 중...</div>
          ) : (
            <>
              <div
                ref={timetableCaptureRef}
                data-timetable-capture="true"
                className={`inline-block max-w-full rounded-lg p-0 align-top ${isDisplayedGroupInactive ? "bg-slate-200" : "bg-white"}`}
              >
                {(roleView === "student" ? selectedStudentLabel !== "학생 선택" : selectedInstructorLabel !== "강사 선택") ? (
                  <div className={`sync-surface mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 ${isDisplayedGroupInactive ? "bg-slate-200" : "bg-white"}`}>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                        {roleView === "instructor" ? "Instructor Timetable" : "Student Timetable"}
                      </p>
                      <p className="sync-heading mt-1 text-xl font-black text-slate-950">
                        {roleView === "student" ? selectedStudentLabel : selectedInstructorLabel}
                        {(roleView === "student" ? selectedStudentSecondary : selectedInstructorSecondary) ? (
                          <span className="ml-2 text-base font-extrabold text-slate-600">
                            {roleView === "student" ? selectedStudentSecondary : selectedInstructorSecondary}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isDisplayedGroupInactive ? (
                        <span className="inline-flex items-center rounded-full border border-slate-400 bg-slate-700 px-3 py-1.5 text-xs font-black text-white">
                          비활성 시간표
                        </span>
                      ) : null}
                      <span className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-black ${selectedScheduleTag ? SCHEDULE_TAG_TONES[selectedScheduleTag.colorKey] : SCHEDULE_TAG_TONES.slate}`}>
                        #{selectedScheduleTagLabel}
                      </span>
                    </div>
                  </div>
                ) : null}
                <TimetableGrid
                  roleView={roleView}
                  days={DAYS}
                  timeSlots={TIME_SLOTS}
                  events={displayEvents}
                  studentSecondaryLookup={studentSecondaryLookup}
                  hideEmptyDays={hideEmptyDays}
                  hideEmptyTimes={hideEmptyTimes}
                  hiddenTimeSlots={hiddenTimeSlots}
                  daysOff={roleView === "instructor" ? selectedInstructorDaysOff : []}
                  viewMode={timetableViewMode}
                  inactive={isDisplayedGroupInactive}
                  emptyMessage={timetableEmptyMessage}
                  dayDateOverrides={roleView === "student" ? studentDayDateOverrides : undefined}
                  onDayDateChange={roleView === "student" ? (weekday, classDate) => {
                    setStudentDayDateOverrides((current) => {
                      const next = { ...current };
                      if (classDate) next[weekday] = classDate;
                      else delete next[weekday];
                      return next;
                    });
                  } : undefined}
                  onEventMove={!isInstructorReadOnly && roleView === "student" ? handleMoveSchedule : undefined}
                  onEventClick={!isInstructorReadOnly && roleView === "student" ? handleOpenTimeEdit : undefined}
                  onEventSave={!isInstructorReadOnly && timetableViewMode === "detailed" ? handleSaveSingleSchedule : undefined}
                  onEventDelete={!isInstructorReadOnly && timetableViewMode === "detailed" ? handleDeleteSingleSchedule : undefined}
                  onCellClick={(ctx) => {
                    if (isInstructorReadOnly) return;
                    if (roleView === "student") {
                      if (!selectedScheduleTagId) {
                        setError("학생 시간표를 입력하려면 상단에서 분류(태그)를 먼저 선택해 주세요.");
                        return;
                      }
                      if (studentScheduleInputTab === "sync") {
                        setSyncDraftInitialCell(ctx);
                        setSyncDraftModalOpen(true);
                        setError(null);
                        return;
                      }
                      setSelfStudyDraft({
                        weekday: ctx.weekday,
                        startTime: ctx.startTime,
                        endTime: addMinutesToTime(ctx.startTime, 60),
                        classDate: ctx.classDate
                      });
                      setError(null);
                      return;
                    }
                    setInitialCell(ctx);
                    setModalOpen(true);
                  }}
                />
              </div>
            </>
          )}
        </div>

        <aside className="sync-surface min-w-0 rounded-xl bg-white p-3 text-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">{monthLabel}</h2>
            <div className="flex gap-1">
              <button
                type="button"
                className="sync-pressable sync-focus rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold text-slate-700 hover:bg-slate-100"
                onClick={() => setCalendarMonth((prev) => shiftMonth(prev, -1))}
              >
                ‹
              </button>
              <button
                type="button"
                className="sync-pressable sync-focus rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold text-slate-700 hover:bg-slate-100"
                onClick={() => setCalendarMonth((prev) => shiftMonth(prev, 1))}
              >
                ›
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-500">
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
                  <span className={hasClass ? "rounded-full bg-blue-600 px-2 py-1 text-white shadow-sm" : "text-blue-950"}>{cell.day}</span>
                  {hasClass ? <span className="absolute bottom-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" /> : null}
                </div>
              );
            })}
          </div>

          <TimeSlotVisibilityControl
            className="mt-5"
            timeSlots={TIME_SLOTS}
            hiddenTimeSlots={hiddenTimeSlots}
            onChange={setHiddenTimeSlots}
          />

          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">월간 수업 현황</p>
            <p className="sync-tabular mt-1 text-2xl font-extrabold text-blue-700">{displayEvents.length}개</p>
            <p className="sync-copy mt-1 text-xs text-slate-500">현재 주간/검색 필터 기준 수업 수</p>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-700">저장된 시간표 그룹</p>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {roleView === "instructor" ? "강사" : "학생"} / {currentTargetLabel}
              </span>
            </div>
            <div className={`mt-2 rounded-md border px-2.5 py-2 text-[11px] font-black ${selectedScheduleTag ? SCHEDULE_TAG_TONES[selectedScheduleTag.colorKey] : SCHEDULE_TAG_TONES.slate}`}>
              현재 범위 · #{selectedScheduleTagLabel}
            </div>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowActiveOnly((prev) => !prev)}
                className={`sync-pressable sync-focus rounded-full border px-3 py-1 text-[11px] font-semibold ${
                  showActiveOnly
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                활성만 보기 {showActiveOnly ? "ON" : "OFF"}
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {groupMonthSections.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">DB 저장 시 월~일 10-22시 한 세트가 그룹으로 저장됩니다.</p>
              ) : (
                groupMonthSections.map((section) => {
                  const isExpanded = expandedGroupMonths[section.sectionKey] ?? (section.isCurrentMonth && section.tagId === selectedScheduleTagId);
                  return (
                    <div key={section.sectionKey} className="rounded-lg border border-slate-200 bg-slate-50/70 p-1.5">
                      <button
                        type="button"
                        onClick={() => setExpandedGroupMonths((prev) => ({ ...prev, [section.sectionKey]: !isExpanded }))}
                        className="sync-pressable sync-focus flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] font-black text-slate-700 hover:bg-white"
                      >
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <span className="text-slate-400">{isExpanded ? "▾" : "▸"}</span>
                          <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-black ${SCHEDULE_TAG_TONES[section.tagColorKey]}`}>#{section.tagName}</span>
                          <span className="truncate">{section.label}</span>
                          {section.isCurrentMonth ? <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-black text-blue-700">이번 달</span> : null}
                        </span>
                        <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{section.groups.length}</span>
                      </button>
                      {isExpanded ? (
                        <div className="mt-1 space-y-2">
                          {section.groups.map((group) => {
                            const isSelectedGroup = (selectedGroup?.id ?? activeGroup?.id) === group.id;
                            const isEffectiveGroup = effectiveGroupIdSet.has(group.id);
                            const groupNotes = specialNotesByGroupId.get(group.id) ?? [];

                            return (
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
                                className={`sync-pressable sync-focus relative w-full overflow-hidden rounded-lg border p-2 text-left ${
                                  groupActivationPulseId === group.id ? "sync-state-confirm" : ""
                                } ${
                                  isSelectedGroup
                                    ? group.isActive || isEffectiveGroup
                                      ? "border-blue-600 bg-blue-600 text-white shadow-sm ring-2 ring-blue-100"
                                      : "border-slate-700 bg-slate-700 text-white shadow-sm ring-2 ring-slate-200"
                                    : group.isActive || isEffectiveGroup
                                      ? "border-slate-200 bg-white text-blue-950 hover:border-blue-300 hover:bg-blue-50"
                                      : "border-slate-300 bg-slate-100 text-slate-700 hover:border-slate-400 hover:bg-slate-200"
                                }`}
                              >
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <input
                                    value={group.name}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(event) => handleRenameGroup(group.id, event.target.value)}
                                    onBlur={(event) => {
                                      void handlePersistGroupName(group.id, event.target.value);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        (event.currentTarget as HTMLInputElement).blur();
                                      }
                                    }}
                                    className={`sync-input min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[11px] font-semibold outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 ${
                                      isSelectedGroup ? "border-blue-200 text-slate-900" : "border-slate-200 text-slate-800"
                                    }`}
                                  />
                                  <button
                                    type="button"
                                    disabled={groupActivationPendingId !== null}
                                    aria-busy={groupActivationPendingId === group.id}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleActivateGroup(group.id);
                                    }}
                                    className={`sync-pressable sync-focus inline-flex min-h-7 shrink-0 items-center gap-1 rounded-lg border px-1.5 py-1 text-[10px] font-semibold backdrop-blur-xl disabled:cursor-wait disabled:opacity-70 ${
                                      group.isActive
                                        ? isSelectedGroup
                                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                          : "border-emerald-300 bg-emerald-50 text-emerald-700"
                                        : isEffectiveGroup
                                          ? "border-cyan-200 bg-cyan-50 text-cyan-700"
                                        : isSelectedGroup
                                          ? "border-white/45 bg-white/12 text-white hover:bg-white/20"
                                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                                    }`}
                                  >
                                    <span className="relative h-3 w-3 shrink-0" aria-hidden="true">
                                      <svg
                                        viewBox="0 0 16 16"
                                        className={`sync-state-icon sync-state-spinner absolute inset-0 h-3 w-3 transition-[opacity,filter,scale] duration-300 ease-out ${
                                          groupActivationPendingId === group.id
                                            ? "scale-100 opacity-100 blur-0 animate-spin"
                                            : "scale-[0.25] opacity-0 blur-[4px]"
                                        }`}
                                        fill="none"
                                      >
                                        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2" />
                                        <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                      </svg>
                                      <svg
                                        viewBox="0 0 16 16"
                                        className={`sync-state-icon absolute inset-0 h-3 w-3 transition-[opacity,filter,scale] duration-300 ease-out ${
                                          groupActivationPendingId === group.id
                                            ? "scale-[0.25] opacity-0 blur-[4px]"
                                            : "scale-100 opacity-100 blur-0"
                                        }`}
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                      >
                                        {group.isActive ? (
                                          <path d="M8 2.5v5M4.5 4.5a5 5 0 1 0 7 0" strokeLinecap="round" />
                                        ) : (
                                          <path d="m3.5 8 2.8 2.8L12.5 4.6" strokeLinecap="round" strokeLinejoin="round" />
                                        )}
                                      </svg>
                                    </span>
                                    {groupActivationPendingId === group.id
                                      ? "전환 중"
                                      : group.isActive
                                        ? "비활성화"
                                        : isEffectiveGroup
                                          ? "적용중"
                                          : "활성화"}
                                  </button>
                                </div>
                                <p className={`mt-1 text-[11px] ${isSelectedGroup ? "text-blue-100" : "text-slate-500"}`}>
                                  <span
                                    className={`mr-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                                      isSelectedGroup ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                                    }`}
                                  >
                                    {groupNumberById[group.id] ?? 1}
                                  </span>
                                  {group.weekStart} | 수업 {group.classIds.length}개
                                </p>
                                <div className={`mt-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-bold ${
                                  isSelectedGroup ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"
                                }`}>
                                  <StaffAvatar actor={group.creator} size="xs" />
                                  <span className="min-w-0 truncate">
                                    생성 · {group.creator.name || "기존 기록"}
                                    {group.creator.position ? ` · ${group.creator.position}` : ""}
                                  </span>
                                </div>
                                {group.activity.length > 0 ? (
                                  <details
                                    className="mt-1.5 rounded-md border border-slate-200 bg-white text-slate-700"
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) => event.stopPropagation()}
                                  >
                                    <summary className="sync-focus cursor-pointer list-none px-2 py-1.5 text-[10px] font-black [&::-webkit-details-marker]:hidden">
                                      상태 이력 {group.activity.filter((item) => item.action !== "created").length}건 ▾
                                    </summary>
                                    <div className="max-h-32 space-y-1 overflow-y-auto border-t border-slate-100 p-1.5">
                                      {group.activity.map((item) => (
                                        <div key={item.id} className="flex items-center gap-1.5 rounded bg-slate-50 px-1.5 py-1 text-[9px] font-bold text-slate-600">
                                          <StaffAvatar actor={item.actor} size="xs" />
                                          <span className="min-w-0 flex-1 truncate">
                                            {item.action === "created" ? "생성" : item.action === "activated" ? "활성" : "비활성"}
                                            {` · ${item.actor.name || "담당자 기록 없음"}`}
                                          </span>
                                          <time className="sync-tabular shrink-0 text-slate-400" dateTime={item.createdAt}>
                                            {formatSaveHistoryTimestamp(new Date(item.createdAt))}
                                          </time>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                ) : null}
                                {groupNotes.length > 0 ? (
                                  <details
                                    className="group/memo relative mt-2"
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) => event.stopPropagation()}
                                  >
                                    <summary
                                      className={`sync-focus inline-flex min-h-7 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-black [&::-webkit-details-marker]:hidden ${
                                        isSelectedGroup ? "bg-white/15 text-white hover:bg-white/25" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                      }`}
                                      title="시간표 메모 보기"
                                    >
                                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                        <path d="M5 4.5h14v12H9l-4 3v-15Z" strokeLinejoin="round" />
                                        <path d="M8 8h8M8 11.5h6" strokeLinecap="round" />
                                      </svg>
                                      메모 <span className="sync-tabular">{groupNotes.length}</span>
                                    </summary>
                                    <div className="absolute left-0 top-full z-50 mt-1 hidden w-64 rounded-lg border border-slate-200 bg-white p-2 text-left text-slate-700 shadow-[0_12px_30px_-16px_rgba(15,23,42,0.42)] group-hover/memo:block group-open/memo:block">
                                      <div className="max-h-40 space-y-1.5 overflow-y-auto">
                                        {groupNotes.map((note) => (
                                          <p key={note.id} className="rounded-md bg-slate-50 px-2 py-1.5 text-[10px] font-semibold leading-4 text-slate-700">
                                            <span className="mr-1 font-black text-slate-400">{formatSpecialNoteTimestamp(note.createdAt)}</span>
                                            {note.content}
                                          </p>
                                        ))}
                                      </div>
                                    </div>
                                  </details>
                                ) : null}
                                <label className={`mt-2 block text-[10px] font-semibold ${isSelectedGroup ? "text-blue-100" : "text-slate-500"}`} onClick={(event) => event.stopPropagation()}>
                                  시간표 태그
                                  <select
                                    value={group.tagId ?? ""}
                                    onChange={(event) => {
                                      const tagId = event.target.value || null;
                                      void updateTimetableGroupTag(group.id, tagId).catch((tagError) => setError(tagError instanceof Error ? tagError.message : "시간표 태그 변경에 실패했습니다."));
                                    }}
                                    className="sync-input mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                  >
                                    <option value="" disabled={roleView === "student"}>미분류{roleView === "student" ? " (새 저장 불가)" : ""}</option>
                                    {scheduleTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}{tag.isActive ? "" : " (보관)"}</option>)}
                                  </select>
                                </label>
                                <label
                                  className={`mt-2 block text-[10px] font-semibold ${isSelectedGroup ? "text-blue-100" : "text-slate-500"}`}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    만료일
                                    {group.expiresOn ? (
                                      <svg aria-label="만료 예정" role="img" viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${isSelectedGroup ? "text-amber-200" : "text-amber-600"}`} fill="none" stroke="currentColor" strokeWidth="1.8">
                                        <circle cx="12" cy="13" r="6.5" />
                                        <path d="M15.5 7.5 18 5m-1.5 0H19v2.5M9 3.5h6M12 3.5V6m-7 7H2.5m19 0H19M6.5 17.5 4.5 19.5m13-2 2 2" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    ) : null}
                                  </span>
                                  <input
                                    type="date"
                                    value={group.expiresOn ?? ""}
                                    min={group.weekStart}
                                    disabled={!timetableGroupExpirationSupported}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(event) => handleGroupExpirationChange(group.id, event.target.value)}
                                    onBlur={(event) => {
                                      if (!timetableGroupExpirationSupported) return;
                                      void handlePersistGroupExpiration(group.id, event.target.value);
                                    }}
                                    className={`sync-input mt-1 w-full rounded-md border px-2 py-1 text-[11px] font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 ${
                                      !timetableGroupExpirationSupported
                                        ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                        : isSelectedGroup
                                          ? "border-blue-200 bg-white text-slate-900"
                                          : "border-slate-200 bg-white text-slate-800"
                                    }`}
                                  />
                                  <span className={`mt-1 block text-[10px] ${isSelectedGroup ? "text-blue-100" : "text-slate-400"}`}>
                                    {timetableGroupExpirationSupported ? getGroupExpirationLabel(group) : "DB 마이그레이션 적용 후 사용 가능"}
                                  </span>
                                  {timetableGroupExpirationSupported && group.expiresOn ? (
                                    <span className={`mt-1 block text-[10px] font-bold leading-4 ${isSelectedGroup ? "text-amber-200" : "text-amber-700"}`}>
                                      이 날짜가 지나면 현재 시간표는 자동으로 적용 대상에서 제외되고, 대기 시간표가 있으면 이어서 활성화됩니다.
                                    </span>
                                  ) : null}
                                </label>
                                <div className="mt-2 flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleSelectGroup(group.id);
                                    }}
                                    className="sync-pressable sync-focus min-h-7 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                                  >
                                    보기
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleCopyGroup(group.id);
                                    }}
                                    className="sync-pressable sync-focus min-h-7 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                                  >
                                    복사
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleOpenDeleteGroupDialog(group.id);
                                    }}
                                    className="sync-pressable sync-focus min-h-7 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                                  >
                                    삭제
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </section>
      )}
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
          <section
            data-testid="schedule-review-workspace"
            data-server-review-count={scheduleReviews.length}
            data-mapped-review-count={reviewByStudentId.size}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Instructor Overview</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{overviewEntity === "instructor" ? "강사 전체 요약" : "학생 전체 요약"}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {overviewEntity === "instructor"
                      ? "실무자 인원을 제외한 강사 목록을 필터 기준별로 재정렬해 빠르게 조회합니다."
                      : "재원생을 요일/학교/수업 유형 기준으로 묶어 한눈에 파악합니다."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {!isInstructorReadOnly && !showSuspendedRoster ? (
                    <button
                      type="button"
                      onClick={() => setShowRosterActions((prev) => !prev)}
                      className={`sync-pressable sync-focus rounded-md border px-3 py-2 text-xs font-black transition ${
                        showRosterActions
                          ? "border-amber-300 bg-amber-50 text-amber-800"
                          : "border-slate-300 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"
                      }`}
                    >
                      {showRosterActions ? "중지 숨김" : "중지 표시"}
                    </button>
                  ) : null}
                  <div className="rounded-md border border-slate-200 bg-white px-4 py-2 text-right">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Selected</p>
                    <p className="text-sm font-black text-slate-800">{currentTargetLabel}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
                <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
                  {([
                    { key: "instructor", label: "강사 전체 요약" },
                    { key: "student", label: "학생 전체 요약" }
                  ] as const).map((tab) => (
                    <button
                      key={`overview-entity-${tab.key}`}
                      type="button"
                      onClick={() => {
                        setOverviewEntity(tab.key);
                        setRoleView(tab.key);
                        setShowRosterActions(false);
                        if (tab.key === "instructor" && !selectedInstructorId && overviewVisibleInstructors.length > 0) {
                          setSelectedInstructorId(overviewVisibleInstructors[0]!.id);
                        }
                        if (tab.key === "student" && !selectedStudentId && students.length > 0) {
                          setSelectedStudentId(students[0]!.id);
                        }
                      }}
                      className={`sync-pressable sync-focus rounded-md px-4 py-2 text-xs font-black transition ${
                        overviewEntity === tab.key
                          ? "bg-blue-600 text-white shadow-sm"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="inline-flex flex-wrap rounded-lg border border-slate-300 bg-white p-1">
                  {(overviewEntity === "instructor"
                    ? ([
                        { key: "subject", label: "과목별" },
                        { key: "weekday", label: "요일별" },
                        { key: "dayOff", label: "휴무일별" }
                      ] as const)
                    : ([
                        { key: "weekday", label: "요일별 재원생" },
                        { key: "school", label: "학교별 재원생" },
                        { key: "classType", label: "수업 유형별" }
                      ] as const)
                  ).map((tab) => {
                    const active =
                      overviewEntity === "instructor"
                        ? instructorOverviewMode === tab.key
                        : studentOverviewMode === tab.key;
                    return (
                      <button
                        key={`overview-mode-${tab.key}`}
                        type="button"
                        onClick={() => {
                          if (overviewEntity === "instructor") {
                            setInstructorOverviewMode(tab.key as InstructorOverviewMode);
                          } else {
                            setStudentOverviewMode(tab.key as StudentOverviewMode);
                          }
                        }}
                        className={`sync-pressable sync-focus rounded-md px-4 py-2 text-xs font-bold transition ${
                          active
                            ? "bg-blue-50 text-blue-800 shadow-sm ring-1 ring-blue-200"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowSuspendedRoster((prev) => !prev);
                    setShowRosterActions(false);
                  }}
                  className={`sync-pressable sync-focus rounded-md border px-4 py-2 text-xs font-black transition ${
                    showSuspendedRoster
                      ? "border-rose-300 bg-rose-50 text-rose-700"
                      : "border-slate-300 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"
                  }`}
                >
                  {showSuspendedRoster ? "활성 명단 보기" : "중지된 명단"}
                </button>
              </div>
              <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                {showSuspendedRoster ? (
                  <div>
                    <div className="flex items-center justify-between gap-3 px-1 pb-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">
                          중지된 {overviewEntity === "instructor" ? "강사" : "학생"} 명단
                        </p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          복구하면 다시 전체 요약과 시간표 검토 대상에 포함됩니다.
                        </p>
                      </div>
                      <span className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">
                        {(overviewEntity === "instructor" ? suspendedInstructors : suspendedStudents).length}명
                      </span>
                    </div>
                    {(overviewEntity === "instructor" ? suspendedInstructors : suspendedStudents).length > 0 ? (
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {(overviewEntity === "instructor" ? suspendedInstructors : suspendedStudents).map((item) => (
                          <div
                            key={`suspended-${overviewEntity}-${item.id}`}
                            className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-white px-3 py-2.5"
                          >
                            {overviewEntity === "student" ? <SchoolEmblem student={item} size="sm" /> : null}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-black text-slate-800">{item.name}</p>
                              <p className="truncate text-xs font-semibold text-slate-400">{item.secondary || "추가 정보 없음"}</p>
                            </div>
                            <button
                              type="button"
                              disabled={statusUpdatingId === `${overviewEntity}-${item.id}`}
                              onClick={() => void handleToggleRosterStatus(overviewEntity, item, true)}
                              className="sync-pressable sync-focus shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                            >
                              복구
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">
                        중지된 명단이 없습니다.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-3 xl:grid-cols-2">
                    {overviewDisplayGroups.map((group) => (
                      <div
                        key={`overview-group-${overviewEntity}-${group.label}`}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="inline-flex rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black tracking-[0.12em] text-slate-700">
                            {group.label}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-400">{group.items.length}명</span>
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {group.items.map((item) => {
                            const active = overviewEntity === "instructor" ? item.id === selectedInstructorId : item.id === selectedStudentId;
                            return (
                              <span
                                key={`overview-chip-${overviewEntity}-${item.id}`}
                                className={`inline-flex items-center overflow-hidden rounded-md border text-sm font-black leading-none transition ${
                                  active
                                    ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                                    : "border-slate-200 bg-white text-blue-950 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (overviewEntity === "instructor") {
                                      setSelectedInstructorId(item.id);
                                      setRoleView("instructor");
                                    } else {
                                      setSelectedStudentId(item.id);
                                      setRoleView("student");
                                    }
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5"
                                >
                                  {overviewEntity === "student" ? <SchoolEmblem student={item} size="xs" className="border-white/50" /> : null}
                                  {item.name}
                                </button>
                                {!isInstructorReadOnly && showRosterActions ? (
                                  <button
                                    type="button"
                                    disabled={statusUpdatingId === `${overviewEntity}-${item.id}`}
                                    onClick={() => void handleToggleRosterStatus(overviewEntity, item, false)}
                                    className={`border-l px-2 py-1.5 text-[11px] font-black ${
                                      active
                                        ? "border-white/25 text-white/90 hover:bg-white/10"
                                        : "border-slate-200/80 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                                    } disabled:opacity-50`}
                                  >
                                    중지
                                  </button>
                                ) : null}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_330px]">
              <div>
                {loading ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500">로딩 중...</div>
                ) : (
                  <TimetableGrid
                    roleView={overviewEntity}
                    days={DAYS}
                    timeSlots={TIME_SLOTS}
                    events={displayEvents}
                    daysOff={overviewEntity === "instructor" ? selectedInstructorDaysOff : []}
                    viewMode="summary"
                    onEventMove={undefined}
                    onCellClick={() => {}}
                  />
                )}
              </div>

              <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Quick Read</p>
                <p className="mt-2 text-xl font-black text-slate-900">{currentTargetLabel}</p>
                <p className="mt-1 text-sm font-semibold text-slate-500">{profileSecondary || "추가 정보 없음"}</p>
                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <p className="text-xs font-bold text-slate-500">이번 주 배치 수업</p>
                  <p className="mt-2 text-3xl font-black text-slate-900">{displayEvents.length}개</p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">심플 뷰 기준으로 동일 시간대는 유형 배지를 중앙에 압축 표시합니다.</p>
                </div>
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">범례</p>
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <span className="inline-flex min-h-[26px] items-center justify-center rounded-md border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-[11px] font-black text-white">
                        1:1
                      </span>
                      1:1 / 2:1 수업
                    </div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <span className="inline-flex min-h-[26px] items-center justify-center rounded-md border border-blue-600 bg-blue-600 px-2.5 py-1 text-[11px] font-black text-white">
                        개별정규
                      </span>
                      개별정규 및 다대일 수업
                    </div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <span className="inline-flex rounded-md border border-slate-300 bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700">휴무</span>
                      휴무일 컬럼
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </section>
        </>
      ) : null}

      {!showIntroPage && mainTab === "review" ? (
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
          <section
            data-review-loaded-group-count={timetableGroups.length}
            data-review-eligible-student-count={reviewEligibleStudents.length}
            data-review-selected-group-id={selectedReviewStudentId ? reviewActiveGroupByStudentId.get(selectedReviewStudentId)?.id ?? "" : ""}
            data-review-selected-group-event-count={
              selectedReviewStudentId
                ? reviewActiveGroupByStudentId.get(selectedReviewStudentId)?.snapshotEvents?.length ?? 0
                : 0
            }
            className="rounded-[30px] border border-white/50 bg-white/40 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-md"
          >
            <div className="rounded-[26px] border border-white/55 bg-white/45 p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Weekly Review</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-900">시간표 검토</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {weekStart} ~ {weekEnd} 주차 학생 시간표를 검토하고 상태와 메모를 저장합니다.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-black ${selectedScheduleTag ? SCHEDULE_TAG_TONES[selectedScheduleTag.colorKey] : SCHEDULE_TAG_TONES.slate}`}>
                      검토 범위 · #{selectedScheduleTagLabel}
                    </span>
                    <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-500">
                      서버 동기화 · {scheduleReviews.length}건
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {[
                    { filter: "all", label: "전체", value: reviewStats.total, className: "border-slate-200 bg-white text-slate-800" },
                    { filter: "unreviewed", label: "미검토", value: reviewStats.unreviewed, className: "border-slate-200 bg-slate-50 text-slate-700" },
                    { filter: "normal", label: "정상", value: reviewStats.normal, className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
                    { filter: "needs_check", label: "확인필요", value: reviewStats.needsCheck, className: "border-amber-200 bg-amber-50 text-amber-700" },
                    { filter: "issue", label: "문제발생", value: reviewStats.issue, className: "border-rose-200 bg-rose-50 text-rose-700" },
                    { filter: "memo", label: "메모", value: reviewStats.memo, className: "border-sky-200 bg-sky-50 text-sky-700" }
                  ].map((item) => (
                    <button
                      key={`review-stat-${item.label}`}
                      type="button"
                      aria-pressed={reviewFilter === item.filter}
                      onClick={() => setReviewFilter(item.filter as typeof reviewFilter)}
                      className={`sync-pressable sync-focus min-h-10 rounded-2xl border px-3 py-2 text-right tabular-nums transition-[box-shadow,transform] duration-150 ease-out ${item.className} ${
                        reviewFilter === item.filter ? "ring-2 ring-blue-400 ring-offset-2 ring-offset-white shadow-sm" : "hover:shadow-md"
                      }`}
                    >
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] opacity-70">{item.label}</p>
                      <p className="text-xl font-black">{item.value}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-600">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                  </svg>
                  <input
                    value={reviewSearchKeyword}
                    onChange={(event) => setReviewSearchKeyword(event.target.value)}
                    placeholder="학생명 검색"
                    className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400"
                  />
                </label>
                <select
                  value={reviewSortMode}
                  onChange={(event) => setReviewSortMode(event.target.value as typeof reviewSortMode)}
                  className="h-10 rounded-full border border-slate-200 bg-white/80 px-4 text-xs font-black text-slate-600 outline-none hover:bg-white"
                >
                  <option value="needs_first">미검토/문제 우선</option>
                  <option value="class_desc">수업 많은 순</option>
                  <option value="class_asc">수업 적은 순</option>
                  <option value="name">이름순</option>
                </select>
                {([
                  { key: "all", label: "전체" },
                  { key: "unreviewed", label: "미검토" },
                  { key: "normal", label: "정상" },
                  { key: "needs_check", label: "확인필요" },
                  { key: "issue", label: "문제발생" },
                  { key: "memo", label: "메모 있음" }
                ] as const).map((filter) => (
                  <button
                    key={`review-filter-${filter.key}`}
                    type="button"
                    onClick={() => setReviewFilter(filter.key)}
                    className={`sync-pressable sync-focus min-h-10 rounded-full border px-4 py-2 text-xs font-black transition-[background-color,border-color,box-shadow,color,transform] duration-150 ease-out ${
                      reviewFilter === filter.key
                        ? "border-blue-500 bg-blue-600 text-white shadow-[0_10px_22px_rgba(37,99,235,0.18)]"
                        : "border-slate-200 bg-white/70 text-slate-600 hover:bg-white"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void loadScheduleReviews()}
                  className="rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-xs font-black text-slate-600 hover:bg-white"
                >
                  검토 데이터 새로고침
                </button>
              </div>

              <div className="mt-4 rounded-3xl border border-white/60 bg-white/50 p-3">
                {reviewLoading ? (
                  <div className="flex gap-3 overflow-hidden">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={`review-skeleton-${index}`} className="h-28 w-64 shrink-0 animate-pulse rounded-2xl bg-slate-100/80" />
                    ))}
                  </div>
                ) : reviewRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-10 text-center text-sm font-bold text-slate-500">
                    조건에 맞는 학생이 없습니다.
                  </div>
                ) : (
                  <div className="overflow-x-auto pb-2">
                    <div className="flex min-w-max gap-3">
                      {reviewRows.map((row) => {
                        const status = row.effectiveReview?.status ?? null;
                        const active = selectedReviewStudent?.id === row.student.id;
                        return (
                          <button
                            key={`review-row-${row.student.id}`}
                            type="button"
                            onClick={() => setSelectedReviewStudentId(row.student.id)}
                            className={`sync-pressable sync-focus min-h-10 w-[270px] shrink-0 rounded-2xl border px-4 py-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out ${
                              active
                                ? "border-blue-300 bg-blue-50/90 shadow-[0_12px_24px_rgba(37,99,235,0.14)]"
                                : "border-slate-200/80 bg-white/82 hover:border-sky-200 hover:bg-sky-50/50"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <SchoolEmblem student={row.student} size="sm" />
                                  <p className="text-base font-black text-slate-900">{row.student.name}</p>
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-500">
                                    {row.events.length}개
                                  </span>
                                  {row.isStale ? (
                                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700">
                                      재검토
                                    </span>
                                  ) : status ? (
                                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${REVIEW_STATUS_META[status].tone}`}>
                                      {REVIEW_STATUS_META[status].label}
                                    </span>
                                  ) : (
                                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-black text-slate-400">
                                      미검토
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 truncate text-xs font-semibold text-slate-500">{row.student.secondary || "상세 정보 없음"}</p>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {row.hints.length > 0 ? (
                                    row.hints.map((hint) => (
                                      <span key={`review-hint-${row.student.id}-${hint}`} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                                        {hint}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                                      자동 감지 이상 없음
                                    </span>
                                  )}
                                </div>
                              </div>
                              {row.review?.memo ? (
                                <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-black text-sky-700">
                                  메모
                                </span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="rounded-3xl border border-white/60 bg-white/50 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Student Timetable</p>
                      <p className="text-lg font-black text-slate-900">
                        {selectedReviewStudent ? `${selectedReviewStudent.name} 시간표` : "학생 시간표"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-black ${selectedScheduleTag ? SCHEDULE_TAG_TONES[selectedScheduleTag.colorKey] : SCHEDULE_TAG_TONES.slate}`}>
                        검토 라벨 · #{selectedScheduleTagLabel}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-600">
                        {selectedReviewEvents.length}개 수업
                      </span>
                    </div>
                  </div>
                  {selectedReviewEvents.length > 0 ? (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/80">
                      <div className="grid grid-cols-[62px_repeat(7,minmax(0,1fr))] border-b border-slate-200 bg-slate-50/90">
                        <div className="flex h-8 items-center justify-center border-r border-slate-200 text-[11px] font-black text-slate-500">
                          시간
                        </div>
                        {DAYS.map((day) => (
                          <div
                            key={`review-grid-head-${day.key}`}
                            className="flex h-8 items-center justify-center border-r border-slate-200 text-[12px] font-black text-blue-700 last:border-r-0"
                          >
                            {day.label}
                          </div>
                        ))}
                      </div>
                      <div>
                        {TIME_SLOTS.map((slot) => (
                          <div
                            key={`review-grid-row-${slot}`}
                            className="grid min-h-[44px] grid-cols-[62px_repeat(7,minmax(0,1fr))] border-b border-slate-100 last:border-b-0"
                          >
                            <div className="flex items-center justify-center border-r border-slate-100 bg-slate-50/70 px-1 text-[11px] font-black text-slate-600">
                              {slot.slice(0, 2)}-{String(Number(slot.slice(0, 2)) + 1)}
                            </div>
                            {DAYS.map((day) => {
                              const cellEvents = selectedReviewEvents.filter(
                                (event) =>
                                  event.weekday === day.key &&
                                  getOverlappingHourSlots(event, [slot]).length > 0
                              );
                              return (
                                <div
                                  key={`review-grid-cell-${day.key}-${slot}`}
                                  className={`min-h-[44px] border-r border-slate-100 p-1 last:border-r-0 ${
                                    cellEvents.length > 0 ? "bg-blue-50/40" : "bg-white/60"
                                  }`}
                                >
                                  {cellEvents.slice(0, 2).map((event) => {
                                    const classKey = getReviewClassKey(event);
                                    const tone = REVIEW_SUBJECT_TONE_CLASSES[getReviewSubjectTone(event)];
                                    const classBadge = getReviewClassBadge(event);
                                    const isHighlighted = selectedReviewClassKey === classKey;
                                    const progress = selectedReviewProgressByEventKey.get(getReviewEventKey(event)) ?? { index: 1, total: 1 };

                                    return (
                                      <button
                                        key={`review-grid-event-${getReviewEventKey(event)}`}
                                        type="button"
                                        onClick={() => setSelectedReviewClassKey((prev) => (prev === classKey ? null : classKey))}
                                        className={`mb-1 w-full rounded-lg border px-2 py-1.5 text-left shadow-sm transition ${
                                          isHighlighted ? tone.selected : tone.card
                                        }`}
                                      >
                                        <div className="flex min-w-0 items-start justify-between gap-1">
                                          <p className="min-w-0 truncate text-[12px] font-black leading-tight">
                                            {event.subjectName} · {event.instructorName}
                                          </p>
                                          {classBadge ? (
                                            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-black leading-none ${tone.badge}`}>
                                              {classBadge}
                                            </span>
                                          ) : null}
                                        </div>
                                        {!classBadge ? (
                                          <p className={`mt-0.5 truncate text-[9px] font-bold leading-tight ${tone.label}`}>
                                            {event.classTypeLabel}
                                          </p>
                                        ) : null}
                                        <div className="mt-1.5 flex items-center justify-between gap-1">
                                          <span className={`inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black leading-none ${tone.time}`}>
                                            {event.startTime}-{event.endTime}
                                          </span>
                                          <span className="flex min-w-0 items-center justify-end gap-1">
                                            {progress.total > 1 ? (
                                              <span className={`text-[9px] font-black leading-none ${tone.label}`}>
                                                {progress.index}/{progress.total}
                                              </span>
                                            ) : null}
                                            <span className="flex items-center gap-0.5">
                                              {Array.from({ length: progress.total }).map((_, idx) => (
                                                <span
                                                  key={`review-progress-${getReviewEventKey(event)}-${idx + 1}`}
                                                  className={`h-1.5 w-2 rounded-sm ${idx + 1 <= progress.index ? tone.segmentOn : tone.segmentOff}`}
                                                />
                                              ))}
                                            </span>
                                          </span>
                                        </div>
                                      </button>
                                    );
                                  })}
                                  {cellEvents.length > 2 ? (
                                    <p className="text-[9px] font-black text-slate-500">+{cellEvents.length - 2}</p>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-8 text-center text-sm font-bold text-slate-500">
                      이번 주 표시할 수업이 없습니다.
                    </div>
                  )}
                </div>
                <aside className="rounded-3xl border border-white/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(239,246,255,0.62))] p-4 shadow-lg shadow-slate-900/5">
                  {selectedReviewStudent ? (
                    <>
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Selected Student</p>
                      <div className="mt-2 flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <SchoolEmblem student={selectedReviewStudent} size="lg" />
                          <div className="min-w-0">
                            <h3 className="truncate text-2xl font-black text-slate-900">{selectedReviewStudent.name}</h3>
                            <p className="mt-1 truncate text-sm font-semibold text-slate-500">{selectedReviewStudent.secondary || "상세 정보 없음"}</p>
                          </div>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs font-black ${selectedReviewIsStale ? "border-amber-300 bg-amber-50 text-amber-700" : selectedReview ? REVIEW_STATUS_META[selectedReview.status].tone : "border-slate-200 bg-white text-blue-700"}`}>
                          {selectedReviewIsStale ? "재검토 필요" : selectedReview ? REVIEW_STATUS_META[selectedReview.status].label : "미검토"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${selectedScheduleTag ? SCHEDULE_TAG_TONES[selectedScheduleTag.colorKey] : SCHEDULE_TAG_TONES.slate}`}>
                          #{selectedScheduleTagLabel}
                        </span>
                        {selectedReview?.isCarryForward ? (
                          <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700">
                            이전 주 검토 유지
                          </span>
                        ) : selectedReview?.isLegacyFallback ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500">
                            기존 검토 불러옴
                          </span>
                        ) : null}
                      </div>

                      {selectedReviewIsStale ? (
                        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/90 px-3 py-2.5 text-xs font-bold leading-relaxed text-amber-800">
                          판정 후 시간표가 변경되었습니다. 현재 시간표를 확인한 뒤 상태를 다시 선택해 주세요.
                        </div>
                      ) : null}

                      <div className="mt-4 grid gap-2">
                        {(["normal", "needs_check", "issue"] as ReviewStatus[]).map((status) => (
                          <button
                            key={`review-status-${status}`}
                            type="button"
                            disabled={reviewSavingId === selectedReviewStudent.id}
                            onClick={() => void saveScheduleReview(selectedReviewStudent.id, status, reviewMemoDraft)}
                            aria-pressed={!selectedReviewIsStale && selectedReview?.status === status}
                            className={`sync-pressable sync-focus relative min-h-10 rounded-2xl border px-3 py-2.5 text-sm font-black transition-[background-color,border-color,box-shadow,color,opacity,transform] duration-150 ease-out disabled:cursor-wait disabled:opacity-70 ${
                              !selectedReviewIsStale && selectedReview?.status === status
                                ? `${REVIEW_STATUS_META[status].button} ring-2 ring-offset-1 ring-offset-white`
                                : REVIEW_STATUS_META[status].button
                            }`}
                          >
                            <span className="inline-flex items-center justify-center gap-2">
                              {reviewSavingId === selectedReviewStudent.id && selectedReview?.status === status ? (
                                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
                              ) : !selectedReviewIsStale && selectedReview?.status === status ? (
                                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                                  <path d="m5 10 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ) : null}
                              {REVIEW_STATUS_META[status].label}
                            </span>
                          </button>
                        ))}
                      </div>

                      <label className="mt-4 block">
                        <span className="text-xs font-black text-slate-600">검토 메모</span>
                        <textarea
                          value={reviewMemoDraft}
                          onChange={(event) => setReviewMemoDraft(event.target.value)}
                          placeholder="예: 금요일 19시 수업 강사 확인 필요"
                          className="mt-2 min-h-[76px] w-full rounded-2xl border border-slate-200 bg-white/85 px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-blue-300"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!selectedReview || reviewSavingId === selectedReviewStudent.id}
                        onClick={() => selectedReview ? void saveScheduleReview(selectedReviewStudent.id, selectedReview.status, reviewMemoDraft, "memo") : undefined}
                        className="sync-pressable sync-focus mt-2 min-h-10 w-full rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-black text-blue-700 transition-[background-color,box-shadow,opacity,transform] duration-150 ease-out hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        메모 저장
                      </button>

                      <div className="mt-4 rounded-2xl border border-white/70 bg-white/65 p-3">
                        <p className="text-xs font-black text-slate-500">자동 점검</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {selectedReviewHints.length > 0 ? (
                            selectedReviewHints.map((hint) => (
                              <span key={`selected-review-hint-${hint}`} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">
                                {hint}
                              </span>
                            ))
                          ) : (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                              자동 감지 이상 없음
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-white/70 bg-white/70 p-3 shadow-[0_0_0_1px_rgba(15,23,42,0.04),0_2px_8px_rgba(15,23,42,0.04)]">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-black text-slate-600">판정 이력</p>
                          <span className="tabular-nums text-[11px] font-bold text-slate-400">최근 {selectedReviewHistory.length}건</span>
                        </div>
                        {selectedReviewHistory.length > 0 ? (
                          <ol className="mt-2 space-y-1.5">
                            {selectedReviewHistory.map((historyItem) => (
                              <li key={`review-history-${historyItem.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50/80 px-2.5 py-2">
                                <div className="min-w-0">
                                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${REVIEW_STATUS_META[historyItem.status].tone}`}>
                                    {REVIEW_STATUS_META[historyItem.status].label}
                                  </span>
                                  <p className="mt-1 truncate text-[10px] font-semibold text-slate-400">
                                    {historyItem.reviewedByName || "담당자"}
                                    {typeof historyItem.snapshotEventCount === "number" ? ` · ${historyItem.snapshotEventCount}개 수업` : ""}
                                  </p>
                                  <p className="mt-0.5 truncate text-[10px] font-bold text-slate-500">
                                    #{historyItem.snapshotTagName || selectedScheduleTagLabel}
                                    {historyItem.snapshotGroupName ? ` · ${historyItem.snapshotGroupName}` : ""}
                                  </p>
                                </div>
                                <time className="shrink-0 tabular-nums text-[11px] font-black text-slate-500" dateTime={historyItem.reviewedAt}>
                                  {historyItem.reviewedAt ? formatConflictLogTimestamp(historyItem.reviewedAt) : "-"}
                                </time>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="mt-2 rounded-xl bg-slate-50/70 px-3 py-3 text-center text-xs font-semibold text-slate-400">
                            아직 저장된 판정 이력이 없습니다.
                          </p>
                        )}
                      </div>

                      {selectedReview?.reviewedAt ? (
                        <p className="mt-4 text-xs font-semibold text-slate-400">
                          최근 저장: {formatConflictLogTimestamp(selectedReview.reviewedAt)}
                          {selectedReview.reviewedByName ? ` · ${selectedReview.reviewedByName}` : ""}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-10 text-center text-sm font-bold text-slate-500">
                      검토할 학생을 선택해 주세요.
                    </div>
                  )}
                </aside>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {!showIntroPage && mainTab === "issues" ? (
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
            <div className="rounded-[26px] border border-white/55 bg-white/45 p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Issue History</p>
                  <p className="mt-1 text-xl font-black text-slate-900">시간표 입력 오류 / 충돌 기록</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    새로 기록되는 충돌은 학생명, 요일, 시간, 사유 기준으로 누적됩니다. 과거 데이터가 이미 저장돼 있었다면 함께 표시됩니다.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="rounded-2xl border border-white/60 bg-white/75 px-4 py-3 text-right">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">전체</p>
                    <p className="text-xl font-black text-slate-900">{conflictLogs.length}건</p>
                  </div>
                  <div className="rounded-2xl border border-white/60 bg-white/75 px-4 py-3 text-right">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">이번 주</p>
                    <p className="text-xl font-black text-slate-900">
                      {conflictLogs.filter((item) => item.weekStart === weekStart).length}건
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/60 bg-white/75 px-4 py-3 text-right">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">검색 결과</p>
                    <p className="text-xl font-black text-slate-900">{filteredConflictLogs.length}건</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-3xl border border-white/60 bg-white/50 p-3">
                {conflictLogsLoading ? (
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-sm font-semibold text-slate-500">
                    오류 기록을 불러오는 중입니다...
                  </div>
                ) : filteredConflictLogs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-8 text-center">
                    <p className="text-sm font-bold text-slate-700">표시할 오류 기록이 없습니다.</p>
                    <p className="mt-2 text-xs font-semibold text-slate-500">
                      충돌이 새로 발생하면 이 화면에 누적됩니다. 검색어가 걸려 있으면 상단 검색어도 함께 확인해 주세요.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredConflictLogs.map((item) => {
                      const storedDetails = formatStoredConflictDetails(item.details);
                      const normalizedReason = normalizeConflictReasonText(item.reason);
                      return (
                      <article
                        key={item.id}
                        className="rounded-2xl border border-white/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(254,243,199,0.38))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700">
                                {item.source}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                                {weekdayLabel(item.weekday)} {item.startTime}-{item.endTime}
                              </span>
                              {item.weekStart ? (
                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700">
                                  기준 주차 {item.weekStart}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-base font-black text-slate-900">{item.studentName}</p>
                            <p className="text-sm font-semibold text-slate-600">
                              강사: {item.instructorName || "미지정"}{item.targetName ? ` · 대상: ${item.targetName}` : ""}
                            </p>
                            <div className="rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2">
                              <p className="text-[11px] font-black text-rose-500">충돌 이유</p>
                              <p className="mt-1 text-sm font-bold text-rose-700">{normalizedReason}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white/85 px-3 py-2.5">
                              <p className="text-[11px] font-black text-slate-500">구체적인 오류 사항</p>
                              <p className="sync-tabular mt-1.5 text-xs font-bold text-slate-700">
                                입력 시도: {weekdayLabel(item.weekday)}요일 {item.startTime}-{item.endTime} · {item.instructorName || "강사 미지정"}
                              </p>
                              {storedDetails ? (
                                <p className="sync-copy mt-2 whitespace-pre-line text-xs font-semibold leading-5 text-slate-600">{storedDetails}</p>
                              ) : (
                                <p className="sync-copy mt-2 text-xs font-semibold text-slate-500">
                                  과거 기록에는 겹친 기존 수업의 상세 정보가 저장되지 않았습니다. 같은 분류의 활성 시간표에서 위 요일과 시간대를 확인해 주세요.
                                </p>
                              )}
                            </div>
                            {item.rawText ? (
                              <p className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-500">
                                원본: {item.rawText}
                              </p>
                            ) : null}
                          </div>
                          <div className="text-right text-xs font-semibold text-slate-500">
                            <p>{formatConflictLogTimestamp(item.createdAt)}</p>
                            {item.targetType ? <p className="mt-1">{item.targetType} 기준 기록</p> : null}
                          </div>
                        </div>
                      </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      ) : null}

      {!showIntroPage && mainTab === "new" ? (
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
          <ScheduleCreationWorkspace
            weekStart={weekStart}
            students={students}
            instructors={instructors}
            subjects={subjects}
            classTypes={classTypes}
            scheduleTagId={selectedScheduleTagId}
            scheduleTags={scheduleTags}
            onScheduleTagChange={setSelectedScheduleTagId}
            hiddenTimeSlots={hiddenTimeSlots}
            onHiddenTimeSlotsChange={setHiddenTimeSlots}
            onDataChanged={async () => {
              await Promise.all([loadTimetableGroups(), loadSaveHistory()]);
            }}
          />
          <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h2 className="text-xl font-black text-slate-900">배정 추천 도구</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                  희망 과목, 수업 유형, 등원 가능 요일과 시간을 선택해 편성 후보를 확인한 뒤 위 격자에 입력할 수 있습니다.
                </p>

                <div className="mt-5 grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-xs font-bold text-slate-600">과목</span>
                    <select
                      value={newPlacementDraft.subjectCode}
                      onChange={(event) => setNewPlacementDraft((prev) => ({ ...prev, subjectCode: event.target.value }))}
                      className="rounded-2xl border border-white/60 bg-white/75 px-4 py-3 text-sm font-semibold text-slate-800 outline-none"
                    >
                      {subjects.map((subject) => (
                        <option key={`new-subject-${subject.code}`} value={subject.code}>
                          {subject.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-2">
                    <span className="text-xs font-bold text-slate-600">수업 유형</span>
                    <select
                      value={newPlacementDraft.classTypeCode}
                      onChange={(event) => setNewPlacementDraft((prev) => ({ ...prev, classTypeCode: event.target.value }))}
                      className="rounded-2xl border border-white/60 bg-white/75 px-4 py-3 text-sm font-semibold text-slate-800 outline-none"
                    >
                      {classTypes.map((type) => (
                        <option key={`new-class-type-${type.code}`} value={type.code}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div>
                    <p className="text-xs font-bold text-slate-600">희망 요일</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {DAYS.map((day) => {
                        const active = newPlacementDraft.preferredWeekdays.includes(day.key);
                        return (
                          <button
                            key={`new-day-${day.key}`}
                            type="button"
                            onClick={() =>
                              setNewPlacementDraft((prev) => ({
                                ...prev,
                                preferredWeekdays: active
                                  ? prev.preferredWeekdays.filter((value) => value !== day.key)
                                  : [...prev.preferredWeekdays, day.key]
                              }))
                            }
                            className={`rounded-full px-4 py-2 text-xs font-black transition ${
                              active
                                ? "bg-[linear-gradient(135deg,rgba(217,70,239,0.92),rgba(96,165,250,0.84))] text-white shadow-[0_10px_24px_rgba(168,85,247,0.24)]"
                                : "border border-white/60 bg-white/70 text-slate-600 hover:bg-white"
                            }`}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-bold text-slate-600">희망 시간</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {TIME_SLOTS.map((slot) => {
                        const active = newPlacementDraft.preferredTimes.includes(slot);
                        return (
                          <button
                            key={`new-time-${slot}`}
                            type="button"
                            onClick={() =>
                              setNewPlacementDraft((prev) => ({
                                ...prev,
                                preferredTimes: active
                                  ? prev.preferredTimes.filter((value) => value !== slot)
                                  : [...prev.preferredTimes, slot]
                              }))
                            }
                            className={`rounded-full px-3 py-2 text-xs font-black transition ${
                              active
                                ? "bg-slate-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.22)]"
                                : "border border-white/60 bg-white/70 text-slate-600 hover:bg-white"
                            }`}
                          >
                            {toKoreanHourRange(slot)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="grid gap-2">
                    <span className="text-xs font-bold text-slate-600">메모</span>
                    <textarea
                      value={newPlacementDraft.note}
                      onChange={(event) => setNewPlacementDraft((prev) => ({ ...prev, note: event.target.value }))}
                      placeholder="예: 주 2회 희망, 토요일 우선"
                      className="h-24 rounded-2xl border border-white/60 bg-white/75 px-4 py-3 text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-[26px] border border-white/55 bg-[linear-gradient(160deg,rgba(244,244,255,0.82),rgba(255,255,255,0.54),rgba(224,242,254,0.62))] p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Recommendation</p>
                    <h3 className="mt-2 text-xl font-black text-slate-900">추천 시간표 후보</h3>
                  </div>
                  <div className="rounded-2xl border border-white/60 bg-white/75 px-4 py-2 text-right">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Results</p>
                    <p className="text-lg font-black text-slate-900">{placementRecommendations.length}건</p>
                  </div>
                </div>

                {placementRecommendations.length === 0 ? (
                  <div className="mt-4 rounded-3xl border border-dashed border-slate-200 bg-white/65 px-5 py-8 text-sm font-semibold leading-7 text-slate-500">
                    과목, 수업 유형, 희망 요일과 시간을 선택하면 저장된 시간표 그룹 기준으로 가능한 배정 후보를 보여줍니다.
                    <br />
                    개별정규는 기존 같은 과목 그룹 합류를 우선 추천하고, 같은 시간에 1:1 수업이 있으면 제외합니다.
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {placementRecommendations.map((item) => {
                      const weekdayLabel = DAYS.find((day) => day.key === item.weekday)?.label ?? `${item.weekday}`;
                      return (
                        <div
                          key={item.key}
                          className={`rounded-3xl border px-4 py-4 shadow-[0_14px_34px_rgba(148,163,184,0.12)] ${
                            item.mode === "join"
                              ? "border-amber-100 bg-[linear-gradient(145deg,rgba(255,247,237,0.88),rgba(254,243,199,0.62))]"
                              : "border-emerald-100 bg-[linear-gradient(145deg,rgba(236,253,245,0.88),rgba(209,250,229,0.62))]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{weekdayLabel}</p>
                              <p className="mt-1 text-lg font-black text-slate-900">
                                {item.instructorName}
                                {item.instructorSecondary ? <span className="ml-2 text-sm font-bold text-slate-500">{item.instructorSecondary}</span> : null}
                              </p>
                            </div>
                            <span
                              className={`rounded-full px-3 py-1 text-[11px] font-black ${
                                item.mode === "join" ? "bg-amber-500/90 text-white" : "bg-emerald-500/90 text-white"
                              }`}
                            >
                              {item.mode === "join" ? "합류" : "신규"}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/60 bg-white/80 px-3 py-1 text-xs font-black text-slate-700">
                              {item.startTime}-{item.endTime}
                            </span>
                            <span className="rounded-full border border-white/60 bg-white/80 px-3 py-1 text-xs font-black text-slate-700">
                              {item.classTypeLabel}
                            </span>
                          </div>
                          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{item.reason}</p>
                          {item.existingStudentNames.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {item.existingStudentNames.map((name) => (
                                <span
                                  key={`${item.key}-${name}`}
                                  className="rounded-full border border-white/60 bg-white/78 px-2.5 py-1 text-[11px] font-bold text-slate-600"
                                >
                                  {name}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      ) : null}

      {showIntroPage ? (
        isInstructorReadOnly ? (
          <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-blue-600">My Timetable</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-900">{selectedInstructorLabel} 강사 시간표</h2>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{weekStart} ~ {weekEnd} 기준 본인 수업입니다.</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">This Week</p>
                  <p className="text-2xl font-black text-slate-900">{displayEvents.length}개</p>
                </div>
              </div>
              {loading ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm font-semibold text-slate-500">로딩 중...</div>
              ) : (
                <TimetableGrid
                  roleView="instructor"
                  days={DAYS}
                  timeSlots={TIME_SLOTS}
                  events={displayEvents}
                  hideEmptyDays={hideEmptyDays}
                  hideEmptyTimes={hideEmptyTimes}
                  hiddenTimeSlots={hiddenTimeSlots}
                  daysOff={selectedInstructorDaysOff}
                  viewMode="summary"
                  onEventMove={undefined}
                  onCellClick={() => {}}
                />
              )}
            </div>
            <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Quick Read</p>
              <p className="mt-2 text-xl font-black text-slate-900">{selectedInstructorLabel}</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">{selectedInstructorSecondary || "상세 정보 없음"}</p>
              <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
                <p className="text-xs font-bold text-blue-700">오늘 {todayLabel}요일 수업</p>
                <p className="mt-2 text-3xl font-black text-slate-900">
                  {displayEvents.filter((event) => event.weekday === todayWeekday).length}개
                </p>
              </div>
              <TimeSlotVisibilityControl
                className="mt-4"
                timeSlots={TIME_SLOTS}
                hiddenTimeSlots={hiddenTimeSlots}
                onChange={setHiddenTimeSlots}
              />
              <button
                type="button"
                onClick={() => setShowIntroPage(false)}
                className="mt-4 w-full rounded-md border border-blue-600 bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-700"
              >
                상세 작업 화면 열기
              </button>
            </aside>
          </section>
        ) : (
          <HomeInstructorFolderDashboard
            relativeLabel={homeDashboardRelativeLabel}
            weekdayLabel={homeDashboardWeekdayLabel}
            dateISO={homeDashboardDateISO}
            selectedTagLabel={selectedScheduleTagLabel}
            dayOffset={homeDashboardDayOffset}
            dateOptions={[
              { offset: -1, label: "어제", date: shiftDate(todayISO, -1), weekdayLabel: weekdayLabel(dayOf(shiftDate(todayISO, -1))) },
              { offset: 0, label: "오늘", date: todayISO, weekdayLabel: weekdayLabel(dayOf(todayISO)) },
              { offset: 1, label: "내일", date: shiftDate(todayISO, 1), weekdayLabel: weekdayLabel(dayOf(shiftDate(todayISO, 1))) }
            ]}
            events={homeTodayEvents}
            instructorSummaries={homeTodayInstructorSummaries}
            studentSummaries={homeTodayStudentSummaries}
            loading={isHomeDashboardLoading}
            onSelectDate={(offset, date) => {
              setHomeDashboardDayOffset(offset);
              setWeekStart(mondayOfDate(date));
            }}
            onOpenInstructor={(id) => {
              setSelectedInstructorId(id);
              setSelectedGroupId(null);
              setMainTab("instructor");
              setRoleView("instructor");
              setInstructorWorkspaceTab("schedule");
              setShowIntroPage(false);
            }}
            onOpenStudent={(id) => {
              setSelectedStudentId(id);
              setSelectedGroupId(null);
              setMainTab("student");
              setRoleView("student");
              setStudentScheduleInputTab("sync");
              setShowIntroPage(false);
            }}
          />
        )
      ) : null}

      {importProgress.active ? (
        <div className="fixed inset-0 z-[340] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.72),rgba(219,234,254,0.65),rgba(167,243,208,0.45))] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.28)] backdrop-blur-2xl">
            <p className="text-base font-extrabold text-slate-800">시간표 저장 중...</p>
            <p className="mt-1 text-xs font-semibold text-slate-600">{importProgress.label || "데이터를 처리하고 있습니다."}</p>
            <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white/60">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#34d399,#60a5fa,#a78bfa)] transition-[width] duration-300 ease-out"
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

      {selfStudyDraft ? (
        <div className="fixed inset-0 z-[325] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-black text-slate-900">자기주도학습 추가</p>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {selectedStudentLabel} · {weekdayLabel(selfStudyDraft.weekday)}요일
                </p>
              </div>
              <button
                type="button"
                disabled={selfStudySaving}
                onClick={() => setSelfStudyDraft(null)}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60"
              >
                닫기
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                시작
                <select
                  value={selfStudyDraft.startTime}
                  onChange={(event) => setSelfStudyDraft((prev) => (prev ? { ...prev, startTime: event.target.value } : prev))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800"
                >
                  {TIME_EDIT_OPTIONS.slice(0, -1).map((time) => (
                    <option key={`self-study-start-${time}`} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                종료
                <select
                  value={selfStudyDraft.endTime}
                  onChange={(event) => setSelfStudyDraft((prev) => (prev ? { ...prev, endTime: event.target.value } : prev))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800"
                >
                  {TIME_EDIT_OPTIONS.filter((time) => timeToMinutes(time) > timeToMinutes(selfStudyDraft.startTime)).map((time) => (
                    <option key={`self-study-end-${time}`} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              강사 없이 학생 시간표 안내용 그룹에만 저장됩니다. 기존 수업 데이터는 변경하지 않습니다.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={selfStudySaving}
                onClick={() => setSelfStudyDraft(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                disabled={selfStudySaving}
                onClick={() => void handleSaveSelfStudy()}
                className="rounded-lg border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
              >
                {selfStudySaving ? "저장 중..." : "추가"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {timeEditEvent ? (
        <div className="fixed inset-0 z-[325] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-black text-slate-900">수업 정보 수정</p>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {timeEditEvent.instructorName ? `${timeEditEvent.subjectName} · ${timeEditEvent.instructorName}` : timeEditEvent.subjectName}
                </p>
              </div>
              <button
                type="button"
                disabled={timeEditSaving}
                onClick={() => setTimeEditEvent(null)}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60"
              >
                닫기
              </button>
            </div>
            {!isSelfStudyEventId(timeEditEvent.id) ? (
              <label className="mb-3 block space-y-1 text-xs font-semibold text-slate-700">
                과목
                <select
                  value={timeEditForm.subjectCode}
                  onChange={(event) => setTimeEditForm((prev) => ({ ...prev, subjectCode: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800"
                >
                  {subjects.map((subject) => (
                    <option key={`edit-subject-${subject.code}`} value={subject.code}>
                      {subject.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                시작
                <select
                  value={timeEditForm.startTime}
                  onChange={(event) => setTimeEditForm((prev) => ({ ...prev, startTime: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800"
                >
                  {TIME_EDIT_OPTIONS.slice(0, -1).map((time) => (
                    <option key={`edit-start-${time}`} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                종료
                <select
                  value={timeEditForm.endTime}
                  onChange={(event) => setTimeEditForm((prev) => ({ ...prev, endTime: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800"
                >
                  {TIME_EDIT_OPTIONS.filter((time) => timeToMinutes(time) > timeToMinutes(timeEditForm.startTime)).map((time) => (
                    <option key={`edit-end-${time}`} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
              30분 단위 시간도 저장됩니다. 저장 시 현재 선택된 주차 기준으로 시간표에 반영됩니다.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={timeEditSaving}
                onClick={() => setTimeEditEvent(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                disabled={timeEditSaving}
                onClick={() => void handleSaveTimeEdit()}
                className="rounded-lg border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
              >
                {timeEditSaving ? "저장 중..." : "저장"}
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
      <SyncScheduleDraftModal
        open={syncDraftModalOpen}
        initialCell={syncDraftInitialCell}
        instructors={instructors}
        subjects={subjects.map((subject) => ({ code: subject.code, label: subject.label }))}
        classTypes={classTypes.map((type) => ({
          code: type.code,
          label: type.label,
          badgeText: type.badgeText,
          maxStudents: type.maxStudents
        }))}
        onSubmit={handleAddSyncDraft}
        onClose={() => setSyncDraftModalOpen(false)}
      />
      <ScheduleTagManager
        open={scheduleTagManagerOpen}
        tags={scheduleTags}
        busy={scheduleTagsBusy}
        onClose={() => setScheduleTagManagerOpen(false)}
        onCreate={async (input) => {
          try {
            await createScheduleTag(input);
          } catch (tagError) {
            setError(tagError instanceof Error ? tagError.message : "태그 저장에 실패했습니다.");
          }
        }}
        onUpdate={async (id, input) => {
          try {
            await updateScheduleTag(id, input);
            if (input.isCurrent === true) {
              const tagName = scheduleTags.find((tag) => tag.id === id)?.name ?? "선택한 분류";
              setNotice(`#${tagName}을 현재 분류로 설정했습니다.`);
            }
          } catch (tagError) {
            setError(tagError instanceof Error ? tagError.message : "태그 수정에 실패했습니다.");
          }
        }}
      />
      </div>
    </main>
  );
}
