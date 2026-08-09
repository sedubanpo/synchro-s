"use client";

import { SyncScheduleDraftModal, type SyncScheduleDraftInput } from "@/components/schedule/SyncScheduleDraftModal";
import { SchoolEmblem } from "@/components/schedule/SchoolEmblem";
import { TimeSlotVisibilityControl } from "@/components/schedule/TimeSlotVisibilityControl";
import { TimetableGrid } from "@/components/schedule/TimetableGrid";
import { SCHEDULE_TAG_TONES, type ScheduleTag } from "@/components/schedule/ScheduleTagManager";
import { DAYS, TIME_SLOTS } from "@/lib/constants";
import {
  filterProspectTimetableGroups,
  formatProspectSchoolGrade
} from "@/lib/prospectTimetableGroups";
import { resolveSubjectOption } from "@/lib/subjectResolver";
import type { ClassTypeOption, ScheduleEvent, SelectOption, SubjectOption, Weekday } from "@/types/schedule";
import { useCallback, useEffect, useMemo, useState } from "react";

type TargetMode = "resident" | "prospect";

type CreationGroup = {
  id: string;
  name: string;
  targetId: string;
  weekStart: string;
  snapshotEvents: ScheduleEvent[];
  isActive: boolean;
  createdAt: string;
  kind: TargetMode;
};

type Prospect = {
  id: string;
  name: string;
  school?: string | null;
  grade?: string | null;
  memo?: string | null;
};

type Props = {
  weekStart: string;
  students: SelectOption[];
  instructors: SelectOption[];
  subjects: SubjectOption[];
  classTypes: ClassTypeOption[];
  scheduleTagId: string | null;
  scheduleTags: ScheduleTag[];
  onScheduleTagChange: (tagId: string) => void;
  hiddenTimeSlots: string[];
  onHiddenTimeSlotsChange: (timeSlots: string[]) => void;
  onDataChanged: () => void | Promise<void>;
};

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00+09:00`);
  parsed.setDate(parsed.getDate() + days);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(parsed);
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function makeDraftId(): string {
  return `sync-draft:creation:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function mapGroupItem(item: any, kind: TargetMode): CreationGroup {
  return {
    id: item.id,
    name: item.name,
    targetId: kind === "resident" ? item.targetId : item.prospectId,
    weekStart: item.weekStart,
    snapshotEvents: Array.isArray(item.snapshotEvents) ? item.snapshotEvents : [],
    isActive: item.isActive === true,
    createdAt: item.createdAt,
    kind
  };
}

export function ScheduleCreationWorkspace({
  weekStart,
  students,
  instructors,
  subjects,
  classTypes,
  scheduleTagId,
  scheduleTags,
  onScheduleTagChange,
  hiddenTimeSlots,
  onHiddenTimeSlotsChange,
  onDataChanged
}: Props) {
  const [mode, setMode] = useState<TargetMode>("resident");
  const [studentId, setStudentId] = useState("");
  const [prospectId, setProspectId] = useState("");
  const [prospectForm, setProspectForm] = useState({ name: "", school: "", grade: "", memo: "" });
  const [groupName, setGroupName] = useState("");
  const [draftEvents, setDraftEvents] = useState<ScheduleEvent[]>([]);
  const [groups, setGroups] = useState<CreationGroup[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [modalCell, setModalCell] = useState<{
    weekday: Weekday;
    startTime: string;
    classDate?: string;
    scheduleMode?: "recurring" | "one_off";
  }>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hideEmptyDays, setHideEmptyDays] = useState(false);
  const [hideEmptyTimes, setHideEmptyTimes] = useState(false);
  const [savedGroupSearch, setSavedGroupSearch] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [dayDateOverrides, setDayDateOverrides] = useState<Partial<Record<Weekday, string>>>({});
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renamingGroupName, setRenamingGroupName] = useState("");

  const activeStudents = useMemo(() => students.filter((student) => student.isActive !== false), [students]);
  const effectiveScheduleTagId = scheduleTagId ?? scheduleTags.find((tag) => tag.isCurrent && tag.isActive)?.id ?? null;
  const filteredStudents = useMemo(() => {
    const token = studentSearch.replace(/\s+/g, "").toLowerCase();
    if (!token) return activeStudents;
    return activeStudents.filter((student) =>
      student.id === studentId || `${student.name}${student.secondary ?? ""}`.replace(/\s+/g, "").toLowerCase().includes(token)
    );
  }, [activeStudents, studentId, studentSearch]);
  const activeInstructors = useMemo(() => instructors.filter((instructor) => instructor.isActive !== false), [instructors]);
  const selectedStudent = activeStudents.find((student) => student.id === studentId) ?? null;
  const selectedProspect = prospects.find((prospect) => prospect.id === prospectId) ?? null;
  const targetName = mode === "resident" ? selectedStudent?.name ?? "" : prospectForm.name.trim();
  const targetId = mode === "resident" ? studentId : prospectId;
  const prospectById = useMemo(() => new Map(prospects.map((prospect) => [prospect.id, prospect])), [prospects]);
  const visibleGroups = useMemo(() => {
    if (mode === "prospect") {
      return filterProspectTimetableGroups(
        groups.filter((group) => group.kind === "prospect"),
        prospects,
        savedGroupSearch
      );
    }
    return groups.filter((group) => group.kind === "resident" && group.targetId === targetId);
  }, [groups, mode, prospects, savedGroupSearch, targetId]);
  const prospectGroupTotal = useMemo(
    () => groups.filter((group) => group.kind === "prospect").length,
    [groups]
  );

  useEffect(() => {
    if (!scheduleTagId && effectiveScheduleTagId) onScheduleTagChange(effectiveScheduleTagId);
  }, [effectiveScheduleTagId, onScheduleTagChange, scheduleTagId]);

  useEffect(() => {
    setGroupName(`${weekStart} ${targetName || (mode === "resident" ? "재원생" : "신규문의")} 시간표`);
  }, [mode, targetName, weekStart]);

  useEffect(() => {
    setDayDateOverrides({});
  }, [mode, prospectId, studentId, weekStart]);

  const loadProspects = useCallback(async () => {
    const res = await fetch("/api/schedule-creation/prospects", { cache: "no-store" });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "신규문의 시간표를 불러오지 못했습니다.");
    }
    const payload = (await res.json()) as { prospects?: Prospect[]; groups?: any[] };
    const nextProspects = payload.prospects ?? [];
    setProspects(nextProspects);
    setGroups((prev) => [...prev.filter((group) => group.kind !== "prospect"), ...(payload.groups ?? []).map((item) => mapGroupItem(item, "prospect"))]);
    return nextProspects;
  }, []);

  const loadResidentGroups = useCallback(async (nextStudentId: string) => {
    if (!nextStudentId) {
      setGroups((prev) => prev.filter((group) => group.kind !== "resident"));
      return;
    }
    const query = new URLSearchParams({ roleView: "student", targetId: nextStudentId });
    const res = await fetch(`/api/schedules/groups?${query.toString()}`, { cache: "no-store" });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "재원생 저장 시간표를 불러오지 못했습니다.");
    }
    const payload = (await res.json()) as { items?: any[] };
    setGroups((prev) => [...prev.filter((group) => group.kind !== "resident"), ...(payload.items ?? []).map((item) => mapGroupItem(item, "resident"))]);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadProspects()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "신규문의 정보를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [loadProspects]);

  useEffect(() => {
    if (mode !== "resident") return;
    setLoading(true);
    loadResidentGroups(studentId)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "저장 시간표를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [loadResidentGroups, mode, studentId]);

  useEffect(() => {
    if (!selectedProspect) return;
    setProspectForm({
      name: selectedProspect.name,
      school: selectedProspect.school ?? "",
      grade: selectedProspect.grade ?? "",
      memo: selectedProspect.memo ?? ""
    });
  }, [selectedProspect]);

  const addDraft = (input: SyncScheduleDraftInput): boolean => {
    const instructor = activeInstructors.find((item) => item.id === input.instructorId);
    const subject = resolveSubjectOption(subjects, input.subjectLabel);
    const classType = classTypes.find((item) => item.code === input.classTypeCode);
    const isSelfStudy = input.kind === "self-study";

    if (!isSelfStudy && (!instructor || !subject || !classType)) {
      const missing = [
        !subject ? `"${input.subjectLabel}" 과목` : "",
        !instructor ? "강사" : "",
        !classType ? "수업 유형" : ""
      ].filter(Boolean);
      setError(`${missing.join(", ")} 정보를 확인해 주세요.`);
      return false;
    }
    const overlap = !isSelfStudy
      ? draftEvents.find(
          (event) =>
            event.instructorId === input.instructorId &&
            event.weekday === input.weekday &&
            rangesOverlap(input.startTime, input.endTime, event.startTime, event.endTime)
        )
      : null;
    if (overlap) {
      setError(`${instructor?.name ?? "선택 강사"}의 같은 요일 수업 시간이 겹칩니다.`);
      return false;
    }

    const name = targetName || (mode === "prospect" ? "[가안] 신규문의" : "재원생");
    const event: ScheduleEvent = {
      id: makeDraftId(),
      scheduleMode: input.scheduleMode,
      instructorId: isSelfStudy ? "" : input.instructorId,
      instructorName: isSelfStudy ? "" : instructor?.name ?? "",
      studentIds: targetId ? [mode === "prospect" ? `prospect:${targetId}` : targetId] : [],
      studentNames: [mode === "prospect" ? `[가안] ${name}` : name],
      subjectCode: isSelfStudy ? "SELF_STUDY" : subject?.code ?? "",
      subjectName: isSelfStudy ? "자기주도학습" : subject?.label ?? input.subjectLabel,
      classTypeCode: isSelfStudy ? "SELF_STUDY" : classType?.code ?? "",
      classTypeLabel: isSelfStudy ? "자기주도학습" : classType?.label ?? "",
      badgeText: isSelfStudy ? "[자습]" : classType?.badgeText ?? "",
      weekday: input.weekday,
      classDate: input.classDate ?? shiftDate(weekStart, input.weekday - 1),
      startTime: input.startTime,
      endTime: input.endTime,
      progressStatus: "planned",
      createdAt: new Date().toISOString(),
      note: input.note
    };
    setDraftEvents((prev) => [...prev, event].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)));
    setError(null);
    setNotice("시간표 초안에 수업을 추가했습니다.");
    return true;
  };

  const saveResident = async (): Promise<number> => {
    if (!studentId || !selectedStudent) throw new Error("재원생을 선택해 주세요.");
    const classEvents = draftEvents.filter((event) => event.subjectCode !== "SELF_STUDY");
    const selfStudyEvents = draftEvents.filter((event) => event.subjectCode === "SELF_STUDY");
    const importedEvents: ScheduleEvent[] = [];
    const classIds: string[] = [];
    const conflictReasons: string[] = [];

    if (classEvents.length > 0) {
      const res = await fetch("/api/schedules/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: classEvents.map((event) => ({
            instructorId: event.instructorId,
            studentIds: [studentId],
            subjectCode: event.subjectCode,
            classTypeCode: event.classTypeCode,
            note: event.note?.trim() || "시간표 생성",
            scheduleMode: event.scheduleMode,
            weekday: event.scheduleMode === "recurring" ? event.weekday : undefined,
            classDate: event.scheduleMode === "one_off" ? event.classDate : undefined,
            activeFrom: event.scheduleMode === "recurring" ? weekStart : undefined,
            startTime: event.startTime,
            endTime: event.endTime,
            scheduleTagId: effectiveScheduleTagId
          })),
          targetType: "학생",
          targetName: selectedStudent.name,
          recordHistory: false
        })
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string; results?: { status?: string; classId?: string; conflict?: { conflicts?: { reason?: string }[] } }[] };
      if (!res.ok) throw new Error(payload.error ?? "재원생 시간표 수업 저장에 실패했습니다.");
      classEvents.forEach((event, index) => {
        const result = payload.results?.[index];
        if (result?.status === "conflict") {
          conflictReasons.push(
            result.conflict?.conflicts?.map((item) => item.reason).filter(Boolean).join(", ") ||
              `${event.weekday}요일 ${event.startTime} 시간표 충돌`
          );
          return;
        }
        if (result?.classId) {
          classIds.push(result.classId);
          importedEvents.push({ ...event, id: result.classId, studentIds: [studentId], studentNames: [selectedStudent.name] });
        }
      });
    }

    const snapshots = [...importedEvents, ...selfStudyEvents.map((event) => ({ ...event, studentIds: [studentId], studentNames: [selectedStudent.name] }))];
    if (snapshots.length === 0) {
      throw new Error(conflictReasons.join("\n") || "저장할 수업을 찾지 못했습니다.");
    }
    const groupRes = await fetch("/api/schedules/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: groupName.trim(),
        roleView: "student",
        targetId: studentId,
        weekStart,
        tagId: effectiveScheduleTagId,
        classIds,
        snapshotEvents: snapshots,
        isActive: false,
        historySource: "schedule_creation"
      })
    });
    if (!groupRes.ok) {
      const payload = (await groupRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "재원생 시간표 그룹 저장에 실패했습니다.");
    }
    await loadResidentGroups(studentId);
    return conflictReasons.length;
  };

  const saveProspect = async (): Promise<number> => {
    const res = await fetch("/api/schedule-creation/prospects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        prospectId: prospectId || undefined,
        prospect: prospectForm,
        weekStart,
        groupName: groupName.trim(),
        scheduleTagId: effectiveScheduleTagId ?? undefined,
        items: draftEvents.map((event) => ({
          instructorId: event.instructorId || undefined,
          instructorName: event.instructorName,
          subjectCode: event.subjectCode === "SELF_STUDY" ? undefined : event.subjectCode,
          subjectName: event.subjectName,
          classTypeCode: event.classTypeCode === "SELF_STUDY" ? undefined : event.classTypeCode,
          classTypeLabel: event.classTypeLabel,
          badgeText: event.badgeText,
          weekday: event.weekday,
          scheduleMode: event.scheduleMode,
          classDate: event.classDate,
          startTime: event.startTime,
          endTime: event.endTime,
          note: event.note,
          isSelfStudy: event.subjectCode === "SELF_STUDY"
        }))
      })
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string; prospectId?: string };
    if (!res.ok) throw new Error(payload.error ?? "신규문의 가안 저장에 실패했습니다.");
    if (payload.prospectId) setProspectId(payload.prospectId);
    await loadProspects();
    return 0;
  };

  const handleSave = async () => {
    if (!effectiveScheduleTagId) {
      setError("시간표 분류(태그)를 선택해 주세요.");
      return;
    }
    if (!groupName.trim()) {
      setError("시간표 이름을 입력해 주세요.");
      return;
    }
    if (draftEvents.length === 0) {
      setError("격자에 수업을 한 개 이상 추가해 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const skipped = mode === "resident" ? await saveResident() : await saveProspect();
      setNotice(
        skipped > 0
          ? `새 시간표 버전을 비활성 상태로 저장했습니다. 충돌 ${skipped}건은 제외했습니다.`
          : "새 시간표 버전을 비활성 상태로 저장했습니다. 상담 확정 후 활성화해 주세요."
      );
      await onDataChanged();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "시간표 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (group: CreationGroup) => {
    setSaving(true);
    setError(null);
    try {
      const url = group.kind === "resident" ? "/api/schedules/groups" : "/api/schedule-creation/prospects";
      const body = group.kind === "resident"
        ? { action: "activate", id: group.id, isActive: !group.isActive }
        : { action: "activate", groupId: group.id };
      const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = (await res.json().catch(() => ({}))) as { error?: string; isActive?: boolean };
      if (!res.ok) throw new Error(payload.error ?? "시간표 활성화에 실패했습니다.");
      if (group.kind === "resident") await loadResidentGroups(group.targetId);
      else await loadProspects();
      await onDataChanged();
      setNotice(payload.isActive === false ? "시간표를 비활성화했습니다." : "활성 시간표를 변경하고 운영 화면에 반영했습니다.");
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "시간표 활성화에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const startRenamingGroup = (group: CreationGroup) => {
    setRenamingGroupId(group.id);
    setRenamingGroupName(group.name);
    setError(null);
  };

  const handleRenameGroup = async (group: CreationGroup) => {
    const nextName = renamingGroupName.trim();
    if (!nextName) {
      setError("시간표 이름을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = group.kind === "resident" ? "/api/schedules/groups" : "/api/schedule-creation/prospects";
      const body = group.kind === "resident"
        ? { action: "rename", id: group.id, name: nextName }
        : { action: "rename", groupId: group.id, name: nextName };
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "시간표 이름 저장에 실패했습니다.");
      if (group.kind === "resident") await loadResidentGroups(group.targetId);
      else await loadProspects();
      setRenamingGroupId(null);
      setRenamingGroupName("");
      setNotice(`시간표 이름을 “${nextName}”(으)로 서버에 저장했습니다.`);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "시간표 이름 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const selectGroup = (group: CreationGroup) => {
    if (group.kind === "prospect") {
      setProspectId(group.targetId);
      const prospect = prospectById.get(group.targetId);
      if (prospect) {
        setProspectForm({
          name: prospect.name,
          school: prospect.school ?? "",
          grade: prospect.grade ?? "",
          memo: prospect.memo ?? ""
        });
      }
    }
    setDraftEvents(group.snapshotEvents.map((event) => ({ ...event, id: makeDraftId() })));
    setGroupName(`${group.name} 복사본`);
    setNotice("저장된 버전을 불러왔습니다. 변경 후 새 버전으로 저장할 수 있습니다.");
  };

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}
        {notice ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</p> : null}

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-900">시간표 생성</h2>
              <p className="mt-1 text-sm font-semibold text-slate-500">상담 대상을 선택하고 격자의 빈칸을 눌러 시간표를 구성합니다.</p>
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {([['resident', '재원생'], ['prospect', '신규문의(가안)']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setMode(key);
                    setDraftEvents([]);
                    setNotice(null);
                    setError(null);
                  }}
                  className={`sync-pressable sync-focus rounded-md px-3 py-2 text-xs font-black ${mode === key ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {mode === "resident" ? (
              <label className="space-y-1 text-xs font-bold text-slate-600">
                재원생
                <input
                  type="search"
                  value={studentSearch}
                  onChange={(event) => setStudentSearch(event.target.value)}
                  placeholder="이름 또는 학교 검색"
                  className="sync-input mb-2 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold"
                />
                <select value={studentId} onChange={(event) => { setStudentId(event.target.value); setDraftEvents([]); }} className="sync-input h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold">
                  <option value="">학생 선택</option>
                  {filteredStudents.map((student) => <option key={student.id} value={student.id}>{student.name}{student.secondary ? ` · ${student.secondary}` : ""}</option>)}
                </select>
                {studentSearch && filteredStudents.length === 0 ? <span className="block text-[11px] font-semibold text-rose-600">검색 결과가 없습니다.</span> : null}
              </label>
            ) : (
              <label className="space-y-1 text-xs font-bold text-slate-600">
                저장된 신규문의
                <select
                  value={prospectId}
                  onChange={(event) => {
                    setProspectId(event.target.value);
                    setDraftEvents([]);
                    if (!event.target.value) setProspectForm({ name: "", school: "", grade: "", memo: "" });
                  }}
                  className="sync-input h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold"
                >
                  <option value="">새 신규문의 작성</option>
                  {prospects.map((prospect) => <option key={prospect.id} value={prospect.id}>{prospect.name}{prospect.school ? ` · ${prospect.school}` : ""}</option>)}
                </select>
              </label>
            )}
            <label className="space-y-1 text-xs font-bold text-slate-600">
              시간표 이름
              <input
                value={groupName}
                maxLength={100}
                onChange={(event) => setGroupName(event.target.value)}
                className="sync-input h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold"
              />
              <span className="block text-[11px] font-semibold text-slate-400">새 버전을 저장하면 이 이름이 서버에 보관됩니다.</span>
            </label>
          </div>

          {mode === "prospect" ? (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-xs font-bold text-slate-600">이름<input value={prospectForm.name} onChange={(event) => setProspectForm((prev) => ({ ...prev, name: event.target.value }))} className="sync-input h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold" /></label>
              <label className="space-y-1 text-xs font-bold text-slate-600">학교<input value={prospectForm.school} onChange={(event) => setProspectForm((prev) => ({ ...prev, school: event.target.value }))} className="sync-input h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold" /></label>
              <label className="space-y-1 text-xs font-bold text-slate-600">학년<input value={prospectForm.grade} onChange={(event) => setProspectForm((prev) => ({ ...prev, grade: event.target.value }))} className="sync-input h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold" /></label>
              <label className="space-y-1 text-xs font-bold text-slate-600 md:col-span-3">상담 메모<textarea value={prospectForm.memo} onChange={(event) => setProspectForm((prev) => ({ ...prev, memo: event.target.value }))} className="sync-input min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" placeholder="등원 희망 조건이나 상담 내용을 기록합니다." /></label>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-black text-slate-600">시간표 태그</span>
              {scheduleTags.filter((tag) => tag.isActive || tag.id === effectiveScheduleTagId).map((tag) => {
                const active = tag.id === effectiveScheduleTagId;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      onScheduleTagChange(tag.id);
                      setError(null);
                    }}
                    className={`sync-pressable sync-focus min-h-9 rounded-full border px-3 text-xs font-black ${
                      active ? `${SCHEDULE_TAG_TONES[tag.colorKey]} ring-2 ring-blue-200` : "border-slate-200 bg-white text-slate-600 hover:border-blue-200"
                    }`}
                  >
                    #{tag.name}{tag.isCurrent ? " · 현재" : ""}
                  </button>
                );
              })}
            </div>
            <p className={`mt-2 text-[11px] font-bold ${effectiveScheduleTagId ? "text-slate-500" : "text-rose-600"}`}>
              {effectiveScheduleTagId ? "선택한 태그로 새 시간표 버전을 저장합니다." : "저장할 시간표 태그를 먼저 선택해 주세요."}
            </p>
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2">
              {mode === "resident" && selectedStudent ? <SchoolEmblem student={selectedStudent} size="sm" /> : null}
              <div>
                <p className="text-sm font-black text-slate-900">{targetName || "대상 미선택"} 시간표 초안</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">빈칸을 눌러 수업을 추가하고, 블록의 삭제 버튼으로 제거할 수 있습니다.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700">초안 {draftEvents.length}건</span>
              <button
                type="button"
                aria-pressed={hideEmptyDays}
                onClick={() => setHideEmptyDays((current) => !current)}
                className={`sync-pressable sync-focus rounded-lg border px-3 py-2 text-xs font-bold ${
                  hideEmptyDays ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                빈 요일 숨기기 {hideEmptyDays ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                aria-pressed={hideEmptyTimes}
                onClick={() => setHideEmptyTimes((current) => !current)}
                className={`sync-pressable sync-focus rounded-lg border px-3 py-2 text-xs font-bold ${
                  hideEmptyTimes ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                빈 시간 숨기기 {hideEmptyTimes ? "ON" : "OFF"}
              </button>
              <button type="button" disabled={draftEvents.length === 0 || saving} onClick={() => setDraftEvents([])} className="sync-pressable sync-focus rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-40">전체 지우기</button>
              <button type="button" disabled={saving || loading || draftEvents.length === 0 || !targetName || !effectiveScheduleTagId} onClick={() => void handleSave()} className="sync-pressable sync-focus rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-sm disabled:opacity-40">{saving ? "저장 중" : "새 버전 저장"}</button>
            </div>
          </div>
          <TimetableGrid
            roleView="student"
            days={DAYS}
            timeSlots={TIME_SLOTS}
            events={draftEvents}
            dayDateOverrides={dayDateOverrides}
            onDayDateChange={(weekday, classDate) =>
              setDayDateOverrides((current) => {
                const next = { ...current };
                if (classDate) next[weekday] = classDate;
                else delete next[weekday];
                return next;
              })
            }
            hideEmptyDays={hideEmptyDays}
            hideEmptyTimes={hideEmptyTimes}
            hiddenTimeSlots={hiddenTimeSlots}
            viewMode="detailed"
            onCellClick={(cell) => setModalCell(cell)}
            onEventDelete={async (event) => setDraftEvents((prev) => prev.filter((item) => item.id !== event.id))}
          />
        </div>
      </div>

      <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <TimeSlotVisibilityControl
          className="mb-4"
          timeSlots={TIME_SLOTS}
          hiddenTimeSlots={hiddenTimeSlots}
          onChange={onHiddenTimeSlotsChange}
        />
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-black text-slate-900">저장된 시간표</h3>
            <p className="mt-1 text-xs font-semibold text-slate-500">활성 일정이 운영 화면에 반영됩니다.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">
            {mode === "prospect" && savedGroupSearch.trim()
              ? `${visibleGroups.length}/${prospectGroupTotal}개`
              : `${visibleGroups.length}개`}
          </span>
        </div>
        {mode === "prospect" ? (
          <label className="mt-4 block">
            <span className="sr-only">저장된 신규문의 시간표 검색</span>
            <span className="relative block">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-slate-400"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m16.5 16.5 4 4" />
              </svg>
              <input
                type="search"
                value={savedGroupSearch}
                onChange={(event) => setSavedGroupSearch(event.target.value)}
                placeholder="이름·학교·학년·메모 검색"
                className="sync-input h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-semibold text-slate-800 placeholder:text-slate-400"
              />
            </span>
          </label>
        ) : null}
        <div className="mt-4 space-y-2">
          {loading ? <p className="rounded-lg bg-slate-50 px-3 py-4 text-xs font-semibold text-slate-500">불러오는 중...</p> : null}
          {!loading && mode === "resident" && !targetId ? <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs font-semibold leading-5 text-slate-500">대상을 선택하면 저장된 버전을 표시합니다.</p> : null}
          {!loading && visibleGroups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs font-semibold leading-5 text-slate-500">
              {mode === "prospect" && savedGroupSearch.trim()
                ? "검색 조건과 일치하는 신규문의 시간표가 없습니다."
                : "아직 저장된 시간표가 없습니다."}
            </p>
          ) : null}
          {visibleGroups.map((group) => {
            const prospect = group.kind === "prospect" ? prospectById.get(group.targetId) : null;
            return (
              <article key={`${group.kind}-${group.id}`} className={`rounded-lg border p-3 ${group.isActive ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}>
                {renamingGroupId === group.id ? (
                  <form
                    className="mb-3 rounded-lg border border-blue-200 bg-white p-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleRenameGroup(group);
                    }}
                  >
                    <label className="block text-[11px] font-black text-slate-600">
                      시간표 이름
                      <input
                        autoFocus
                        value={renamingGroupName}
                        maxLength={100}
                        onChange={(event) => setRenamingGroupName(event.target.value)}
                        className="sync-input mt-1 h-9 w-full rounded-md border border-slate-300 px-2.5 text-xs font-semibold text-slate-800"
                      />
                    </label>
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" disabled={saving} onClick={() => setRenamingGroupId(null)} className="sync-pressable sync-focus rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600">취소</button>
                      <button type="submit" disabled={saving || !renamingGroupName.trim()} className="sync-pressable sync-focus rounded-md bg-blue-600 px-3 py-1.5 text-xs font-black text-white disabled:opacity-40">{saving ? "저장 중" : "서버에 저장"}</button>
                    </div>
                  </form>
                ) : null}
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => selectGroup(group)} className="sync-focus min-w-0 flex-1 rounded-md text-left">
                    {prospect ? (
                      <>
                        <p className="truncate text-sm font-black text-slate-900">{prospect.name}</p>
                        <p className="mt-1 truncate text-xs font-bold text-slate-600">{formatProspectSchoolGrade(prospect)}</p>
                        <p className="mt-2 truncate text-[11px] font-semibold text-slate-500">{group.name}</p>
                      </>
                    ) : (
                      <p className="truncate text-sm font-black text-slate-900">{group.name}</p>
                    )}
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      적용 주차 {group.weekStart} · 수업 {group.snapshotEvents.length}개
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-400">
                      저장 {new Date(group.createdAt).toLocaleDateString("ko-KR")}
                    </p>
                  </button>
                  {group.isActive ? <span className="rounded-full bg-emerald-600 px-2 py-1 text-[10px] font-black text-white">활성</span> : null}
                </div>
                {prospect ? (
                  <p className="mt-3 rounded-md bg-slate-50 px-2.5 py-2 text-xs font-semibold leading-5 text-slate-600">
                    <span className="font-black text-slate-500">메모</span>
                    <span className="ml-2 whitespace-pre-wrap">{prospect.memo?.trim() || "메모 없음"}</span>
                  </p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => selectGroup(group)} className="sync-pressable sync-focus flex-1 rounded-md border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-600">불러오기</button>
                  <button type="button" disabled={saving} onClick={() => startRenamingGroup(group)} className="sync-pressable sync-focus flex-1 rounded-md border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-600">이름 수정</button>
                  <button type="button" disabled={saving} onClick={() => void handleActivate(group)} className={`sync-pressable sync-focus flex-1 rounded-md px-2 py-2 text-xs font-black ${group.isActive ? "border border-slate-200 bg-white text-slate-600" : "bg-blue-600 text-white"}`}>{group.isActive ? "비활성" : "활성"}</button>
                </div>
              </article>
            );
          })}
        </div>
      </aside>

      <SyncScheduleDraftModal
        open={Boolean(modalCell)}
        initialCell={modalCell}
        instructors={activeInstructors}
        subjects={subjects}
        classTypes={classTypes}
        onSubmit={addDraft}
        onClose={() => setModalCell(undefined)}
      />
    </section>
  );
}
