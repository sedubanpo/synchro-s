"use client";

import { DAYS } from "@/lib/constants";
import {
  findInstructorByTypedName,
  getInstructorSubjectFamily,
  instructorMatchesSubject,
  normalizeInstructorToken,
  type InstructorSubjectFamily
} from "@/lib/instructorSubjectMatching";
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
  scheduleMode: "recurring" | "one_off";
  classDate?: string;
};

type SyncScheduleDraftModalProps = {
  open: boolean;
  initialCell?: { weekday: Weekday; startTime: string; classDate?: string; scheduleMode?: "recurring" | "one_off" };
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

const INSTRUCTOR_TONES: Record<InstructorSubjectFamily, string> = {
  korean: "border-rose-200 bg-rose-50 text-rose-950 hover:bg-rose-100",
  math: "border-blue-200 bg-blue-50 text-blue-950 hover:bg-blue-100",
  english: "border-purple-200 bg-purple-50 text-purple-950 hover:bg-purple-100",
  science: "border-emerald-200 bg-emerald-50 text-emerald-950 hover:bg-emerald-100",
  social: "border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100",
  other: "border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100"
};

const INSTRUCTOR_FAMILY_ORDER: InstructorSubjectFamily[] = ["korean", "math", "english", "social", "science", "other"];
const INSTRUCTOR_FAMILY_LABELS: Record<InstructorSubjectFamily, string> = {
  korean: "국어",
  math: "수학",
  english: "영어",
  social: "사회",
  science: "과학",
  other: "기타"
};

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
  const [instructorQuery, setInstructorQuery] = useState("");
  const [autoSelectBySubject, setAutoSelectBySubject] = useState(false);
  const [instructorPickerOpen, setInstructorPickerOpen] = useState(false);
  const [activeInstructorIndex, setActiveInstructorIndex] = useState(0);
  const [classTypeCode, setClassTypeCode] = useState("");
  const [durationHours, setDurationHours] = useState("1");
  const [note, setNote] = useState("");
  const [isSelfStudy, setIsSelfStudy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeInstructors = useMemo(
    () =>
      instructors
        .filter((instructor) => instructor.isActive === true)
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [instructors]
  );
  const subjectMatchedInstructors = useMemo(() => {
    const trimmedSubject = subjectLabel.trim();
    if (!autoSelectBySubject || !trimmedSubject) return activeInstructors;
    return activeInstructors.filter((instructor) => instructorMatchesSubject(instructor, trimmedSubject));
  }, [activeInstructors, autoSelectBySubject, subjectLabel]);
  const filteredInstructors = useMemo(() => {
    const query = normalizeInstructorToken(instructorQuery);
    if (!query) return activeInstructors;
    return activeInstructors.filter((instructor) =>
      normalizeInstructorToken(`${instructor.name} ${instructor.secondary ?? ""}`).includes(query)
    );
  }, [activeInstructors, instructorQuery]);
  const groupedInstructors = useMemo(
    () =>
      INSTRUCTOR_FAMILY_ORDER.map((family) => ({
        family,
        instructors: filteredInstructors.filter((instructor) => getInstructorSubjectFamily(instructor) === family)
      })),
    [filteredInstructors]
  );
  const orderedFilteredInstructors = useMemo(
    () => groupedInstructors.flatMap((group) => group.instructors),
    [groupedInstructors]
  );
  const selectedInstructor = activeInstructors.find((instructor) => instructor.id === instructorId) ?? null;
  const instructorMatchWarning = instructorQuery.trim() && !selectedInstructor
    ? "입력한 강사명을 활성 강사 명단에서 찾지 못했습니다. 이름을 확인하거나 아래 목록에서 선택해 주세요."
    : null;

  const duration = normalizeDurationHours(durationHours);
  const startTime = initialCell?.startTime ?? "10:00";
  const requestedEndMinutes = duration ? timeToMinutes(startTime) + duration * 60 : timeToMinutes(startTime);
  const endTime = duration ? addMinutesToTime(startTime, duration * 60) : startTime;

  useEffect(() => {
    if (!open) return;
    const nextClassType = preferredRegularType(classTypes);
    setSubjectLabel("");
    setInstructorId("");
    setInstructorQuery("");
    setAutoSelectBySubject(false);
    setInstructorPickerOpen(false);
    setActiveInstructorIndex(0);
    setClassTypeCode(nextClassType);
    setDurationHours("1");
    setNote("");
    setIsSelfStudy(false);
    setError(null);
  }, [classTypes, open]);

  useEffect(() => {
    if (!open || isSelfStudy || !autoSelectBySubject) return;
    const firstMatch = subjectMatchedInstructors[0] ?? null;
    setInstructorId(firstMatch?.id ?? "");
    setInstructorQuery(firstMatch?.name ?? "");
  }, [autoSelectBySubject, isSelfStudy, open, subjectLabel, subjectMatchedInstructors]);

  useEffect(() => {
    setActiveInstructorIndex((current) => Math.min(current, Math.max(orderedFilteredInstructors.length - 1, 0)));
  }, [orderedFilteredInstructors.length]);

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
      note: note.trim(),
      scheduleMode: initialCell.scheduleMode ?? "recurring",
      classDate: initialCell.classDate
    });
    if (accepted !== false) onClose();
  };

  const weekdayLabel = DAYS.find((day) => day.key === initialCell?.weekday)?.label ?? "-";
  const dateLabel = initialCell?.classDate
    ? `${Number(initialCell.classDate.slice(5, 7))}/${Number(initialCell.classDate.slice(8, 10))}(${weekdayLabel})`
    : `${weekdayLabel}요일`;

  const selectInstructor = (instructor: SelectOption) => {
    setInstructorId(instructor.id);
    setInstructorQuery(instructor.name);
    setInstructorPickerOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-schedule-draft-title"
        className="sync-surface max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p id="sync-schedule-draft-title" className="sync-heading text-lg font-extrabold text-slate-950">싱크로 시간표 추가</p>
            <p className="sync-copy mt-1 text-xs font-semibold text-slate-500">
              {dateLabel} {startTime}부터 입력한 시간만큼 미리보기에 반영됩니다.
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
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>과목명</span>
                  <span className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600">
                    과목 기준 자동 선택
                    <input
                      type="checkbox"
                      checked={autoSelectBySubject}
                      onChange={(event) => setAutoSelectBySubject(event.target.checked)}
                      className="h-4 w-4 accent-blue-600"
                    />
                  </span>
                </span>
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

              <div className="relative space-y-1 text-xs font-semibold text-slate-700">
                <label className="block space-y-1">
                  <span>강사</span>
                  <input
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={instructorPickerOpen}
                    aria-controls="sync-instructor-options"
                    aria-activedescendant={
                      instructorPickerOpen && orderedFilteredInstructors[activeInstructorIndex]
                        ? `sync-instructor-option-${orderedFilteredInstructors[activeInstructorIndex]!.id}`
                        : undefined
                    }
                    value={instructorQuery}
                    onFocus={() => setInstructorPickerOpen(true)}
                    onBlur={() => window.setTimeout(() => setInstructorPickerOpen(false), 100)}
                    onChange={(event) => {
                      const nextQuery = event.target.value;
                      const match = findInstructorByTypedName(activeInstructors, nextQuery);
                      setInstructorQuery(nextQuery);
                      setInstructorId(match?.id ?? "");
                      setInstructorPickerOpen(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        if (!instructorPickerOpen) setInstructorPickerOpen(true);
                        const direction = event.key === "ArrowDown" ? 1 : -1;
                        setActiveInstructorIndex((current) => {
                          if (orderedFilteredInstructors.length === 0) return 0;
                          return (current + direction + orderedFilteredInstructors.length) % orderedFilteredInstructors.length;
                        });
                      } else if (event.key === "Enter" && instructorPickerOpen && orderedFilteredInstructors[activeInstructorIndex]) {
                        event.preventDefault();
                        selectInstructor(orderedFilteredInstructors[activeInstructorIndex]!);
                      } else if (event.key === "Escape") {
                        setInstructorPickerOpen(false);
                      }
                    }}
                    placeholder="강사명을 입력하거나 선택"
                    className={`sync-input w-full rounded-lg border px-3 py-2 text-sm font-semibold outline-none focus:ring-2 ${
                      instructorMatchWarning
                        ? "border-amber-300 bg-amber-50 text-amber-950 focus:border-amber-400 focus:ring-amber-100"
                        : "border-slate-300 focus:border-blue-400 focus:ring-blue-100"
                    }`}
                  />
                </label>
                {instructorPickerOpen ? (
                  <div
                    id="sync-instructor-options"
                    role="listbox"
                    aria-label="과목별 활성 강사"
                    className="absolute left-0 z-20 mt-1 max-h-72 w-[min(46rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
                  >
                    {filteredInstructors.length > 0 ? (
                      <div className="grid min-w-[42rem] grid-cols-6 gap-1.5">
                        {groupedInstructors.map(({ family, instructors: familyInstructors }) => (
                          <section key={family} aria-labelledby={`sync-instructor-family-${family}`} className="min-w-0">
                            <h3
                              id={`sync-instructor-family-${family}`}
                              className={`sticky top-0 z-10 mb-1 rounded-md border px-2 py-1.5 text-center text-[11px] font-black ${INSTRUCTOR_TONES[family]}`}
                            >
                              {INSTRUCTOR_FAMILY_LABELS[family]}
                            </h3>
                            <div className="space-y-1">
                              {familyInstructors.length > 0 ? familyInstructors.map((instructor) => {
                                const optionIndex = orderedFilteredInstructors.findIndex((item) => item.id === instructor.id);
                                const selected = instructor.id === instructorId;
                                const keyboardActive = optionIndex === activeInstructorIndex;
                                return (
                                  <button
                                    id={`sync-instructor-option-${instructor.id}`}
                                    key={instructor.id}
                                    type="button"
                                    role="option"
                                    tabIndex={-1}
                                    aria-selected={selected}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseEnter={() => setActiveInstructorIndex(optionIndex)}
                                    onClick={() => selectInstructor(instructor)}
                                    className={`sync-pressable sync-focus min-h-10 w-full rounded-md border px-2 py-1.5 text-left ${INSTRUCTOR_TONES[family]} ${
                                      selected || keyboardActive ? "ring-2 ring-blue-500 ring-offset-1" : ""
                                    }`}
                                  >
                                    <span className="block truncate text-xs font-black">{instructor.name}</span>
                                    {selected ? (
                                      <span className="mt-0.5 block text-[9px] font-black opacity-80">선택됨</span>
                                    ) : instructor.secondary ? (
                                      <span className="mt-0.5 block truncate text-[9px] font-bold opacity-70">{instructor.secondary}</span>
                                    ) : null}
                                  </button>
                                );
                              }) : (
                                <p className="rounded-md bg-slate-50 px-2 py-3 text-center text-[10px] font-bold text-slate-400">없음</p>
                              )}
                            </div>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <p className="px-3 py-6 text-center text-xs font-bold text-slate-500">검색어와 일치하는 활성 강사가 없습니다.</p>
                    )}
                  </div>
                ) : null}
                  <span className={`block min-h-4 text-[11px] font-bold ${instructorMatchWarning ? "text-amber-700" : "text-slate-500"}`}>
                    {instructorMatchWarning ?? (selectedInstructor ? `${selectedInstructor.name} 강사가 선택되었습니다.` : "퇴사·중지 강사는 목록에서 제외됩니다.")}
                  </span>
              </div>

              <div className="grid items-start gap-3 sm:grid-cols-2">
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
            </>
          ) : null}

          <label className="space-y-1 text-xs font-semibold text-slate-700">
            시작 시간
            <input
              value={`${dateLabel} ${startTime}`}
              readOnly
              className="sync-input sync-tabular w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700"
            />
          </label>

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
