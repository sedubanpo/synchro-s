"use client";

import { DAYS } from "@/lib/constants";
import type { ClassTypeOption, SelectOption, SubjectOption, Weekday } from "@/types/schedule";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

export type SyncScheduleDraftInput = {
  kind: "class" | "self-study";
  weekday: Weekday;
  startTime: string;
  endTime: string;
  subjectLabel: string;
  instructorId: string;
  classTypeCode: string;
  note: string;
};

type SyncScheduleDraftModalProps = {
  open: boolean;
  initialCell?: { weekday: Weekday; startTime: string };
  instructors: SelectOption[];
  subjects: SubjectOption[];
  classTypes: ClassTypeOption[];
  onSubmit: (input: SyncScheduleDraftInput) => boolean | void;
  onClose: () => void;
};

const MIN_DURATION_HOURS = 0.5;
const MAX_DURATION_HOURS = 12;
const END_OF_DAY_MINUTES = 24 * 60;

function normalizeLookupToken(value: string): string {
  return value.replace(/[^0-9a-z가-힣:]/gi, "").toLowerCase();
}

function subjectAliases(label: string): string[] {
  const normalized = normalizeLookupToken(label);
  if (normalized.includes("사회문화") || normalized === "사문") return ["사회", "사탐", "social"];
  if (normalized.includes("세계지리") || normalized === "세지") return ["사회", "사탐", "social"];
  if (normalized.includes("통합사회") || normalized === "통사") return ["사회", "사탐", "social"];
  if (normalized.includes("생활과윤리") || normalized === "생윤") return ["사회", "사탐", "social"];
  if (normalized.includes("통합과학") || normalized === "통과") return ["과학", "science"];
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

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(totalMinutes: number): string {
  const safe = Math.max(0, Math.min(totalMinutes, 24 * 60));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutesToTime(time: string, minutes: number): string {
  return minutesToTime(timeToMinutes(time) + minutes);
}

function normalizeDurationHours(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < MIN_DURATION_HOURS || parsed > MAX_DURATION_HOURS) return null;
  return Math.round(parsed * 2) / 2;
}

function preferredRegularType(classTypes: ClassTypeOption[]): string {
  return (
    classTypes.find((item) => normalizeLookupToken(`${item.code} ${item.label}`).includes(normalizeLookupToken("개별정규")))?.code ??
    classTypes.find((item) => normalizeLookupToken(`${item.code} ${item.label}`).includes("regular"))?.code ??
    classTypes[0]?.code ??
    ""
  );
}

export function SyncScheduleDraftModal({
  open,
  initialCell,
  instructors,
  subjects,
  classTypes,
  onSubmit,
  onClose
}: SyncScheduleDraftModalProps) {
  const [subjectLabel, setSubjectLabel] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [classTypeCode, setClassTypeCode] = useState("");
  const [durationHours, setDurationHours] = useState("1");
  const [note, setNote] = useState("");
  const [isSelfStudy, setIsSelfStudy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredInstructors = useMemo(() => {
    const trimmedSubject = subjectLabel.trim();
    if (!trimmedSubject) return instructors;
    return instructors.filter((instructor) => instructorMatchesSubject(instructor, trimmedSubject));
  }, [instructors, subjectLabel]);

  const duration = normalizeDurationHours(durationHours);
  const startTime = initialCell?.startTime ?? "10:00";
  const requestedEndMinutes = duration ? timeToMinutes(startTime) + duration * 60 : timeToMinutes(startTime);
  const endTime = duration ? addMinutesToTime(startTime, duration * 60) : startTime;

  useEffect(() => {
    if (!open) return;
    const nextClassType = preferredRegularType(classTypes);
    setSubjectLabel("");
    setInstructorId(instructors[0]?.id ?? "");
    setClassTypeCode(nextClassType);
    setDurationHours("1");
    setNote("");
    setIsSelfStudy(false);
    setError(null);
  }, [classTypes, instructors, open]);

  useEffect(() => {
    if (!open || isSelfStudy) return;
    if (filteredInstructors.length === 0) {
      setInstructorId("");
      return;
    }
    if (!filteredInstructors.some((instructor) => instructor.id === instructorId)) {
      setInstructorId(filteredInstructors[0].id);
    }
  }, [filteredInstructors, instructorId, isSelfStudy, open]);

  if (!open) return null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!initialCell) {
      setError("시간표 칸을 다시 선택해 주세요.");
      return;
    }
    if (!duration) {
      setError("수업 시간은 0.5시간부터 12시간까지 입력할 수 있습니다.");
      return;
    }
    if (requestedEndMinutes > END_OF_DAY_MINUTES) {
      setError("수업 종료 시간이 자정(24:00)을 넘지 않도록 입력해 주세요.");
      return;
    }

    if (!isSelfStudy) {
      if (!subjectLabel.trim()) {
        setError("과목명을 입력해 주세요.");
        return;
      }
      if (!instructorId) {
        setError("해당 과목에 배정할 활성 강사를 선택해 주세요.");
        return;
      }
      if (!classTypeCode) {
        setError("수업 유형을 선택해 주세요.");
        return;
      }
    }

    const accepted = onSubmit({
      kind: isSelfStudy ? "self-study" : "class",
      weekday: initialCell.weekday,
      startTime,
      endTime,
      subjectLabel: isSelfStudy ? "자기주도학습" : subjectLabel.trim(),
      instructorId: isSelfStudy ? "" : instructorId,
      classTypeCode: isSelfStudy ? "SELF_STUDY" : classTypeCode,
      note: note.trim()
    });
    if (accepted !== false) onClose();
  };

  const weekdayLabel = DAYS.find((day) => day.key === initialCell?.weekday)?.label ?? "-";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
      <div className="sync-surface w-full max-w-lg rounded-2xl bg-white p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="sync-heading text-lg font-extrabold text-slate-950">싱크로 시간표 추가</p>
            <p className="sync-copy mt-1 text-xs font-semibold text-slate-500">
              {weekdayLabel}요일 {startTime}부터 입력한 시간만큼 미리보기에 반영됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="sync-pressable sync-focus min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            닫기
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
            자습 시간으로 추가
            <input
              type="checkbox"
              checked={isSelfStudy}
              onChange={(event) => setIsSelfStudy(event.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
          </label>

          {!isSelfStudy ? (
            <>
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                과목명
                <input
                  list="sync-subject-options"
                  value={subjectLabel}
                  onChange={(event) => setSubjectLabel(event.target.value)}
                  placeholder="예: 수학, 영어, 과학"
                  className="sync-input w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <datalist id="sync-subject-options">
                  {subjects.map((subject) => (
                    <option key={subject.code} value={subject.label} />
                  ))}
                </datalist>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs font-semibold text-slate-700">
                  강사
                  <select
                    value={instructorId}
                    disabled={filteredInstructors.length === 0}
                    onChange={(event) => setInstructorId(event.target.value)}
                    className="sync-input w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {filteredInstructors.length === 0 ? (
                      <option value="">매칭 강사 없음</option>
                    ) : (
                      filteredInstructors.map((instructor) => (
                        <option key={instructor.id} value={instructor.id}>
                          {instructor.name}
                          {instructor.secondary ? ` · ${instructor.secondary}` : ""}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="space-y-1 text-xs font-semibold text-slate-700">
                  수업 유형
                  <select
                    value={classTypeCode}
                    onChange={(event) => setClassTypeCode(event.target.value)}
                    className="sync-input w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  >
                    {classTypes.map((classType) => (
                      <option key={classType.code} value={classType.code}>
                        {classType.label} {classType.badgeText}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-slate-700">
              시작 시간
              <input
                value={`${weekdayLabel} ${startTime}`}
                readOnly
                className="sync-input sync-tabular w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-700">
              수업 시간
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={MIN_DURATION_HOURS}
                  max={MAX_DURATION_HOURS}
                  step={0.5}
                  value={durationHours}
                  onChange={(event) => setDurationHours(event.target.value)}
                  className="sync-input sync-tabular w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <span className="shrink-0 text-xs font-bold text-slate-500">시간</span>
              </div>
              <p className="sync-tabular text-[11px] font-bold text-blue-700">반영 시간 {startTime}-{endTime}</p>
            </label>
          </div>

          <label className="block space-y-1 text-xs font-semibold text-slate-700">
            메모
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="필요한 경우 특이사항을 적어 주세요."
              className="sync-input h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          {error ? <p className="text-xs font-semibold text-rose-600">{error}</p> : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="sync-pressable sync-focus min-h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              취소
            </button>
            <button
              type="submit"
              className="sync-pressable sync-focus min-h-10 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
            >
              미리보기 추가
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
