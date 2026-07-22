"use client";

import { planningClassTypeTone } from "@/lib/instructorAvailabilityPlanning";
import type {
  ClassTypeOption,
  InstructorAvailabilityPlannedClass,
  SelectOption
} from "@/types/schedule";
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";

type Props = {
  open: boolean;
  dateLabel: string;
  slot: string;
  students: SelectOption[];
  classTypes: ClassTypeOption[];
  initialClass?: InstructorAvailabilityPlannedClass;
  onSave: (plannedClass: InstructorAvailabilityPlannedClass) => void;
  onDelete: () => void;
  onClose: () => void;
};

function normalizeStudentToken(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function typeButtonClass(classType: ClassTypeOption, selected: boolean): string {
  const tone = planningClassTypeTone(classType.code, classType.label);
  if (tone === "one") return selected ? "border-blue-600 bg-blue-600 text-white" : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100";
  if (tone === "two") return selected ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100";
  if (tone === "three") return selected ? "border-rose-600 bg-rose-600 text-white" : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100";
  return selected ? "border-amber-600 bg-amber-600 text-white" : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100";
}

export function InstructorAvailabilityAssignmentModal({
  open,
  dateLabel,
  slot,
  students,
  classTypes,
  initialClass,
  onSave,
  onDelete,
  onClose
}: Props) {
  const [classTypeCode, setClassTypeCode] = useState("");
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setClassTypeCode(initialClass?.classTypeCode ?? classTypes[0]?.code ?? "");
    setStudentIds(initialClass?.studentIds ?? []);
    setQuery("");
    setError(null);
  }, [classTypes, initialClass, open]);

  const selectedType = useMemo(
    () => classTypes.find((classType) => classType.code === classTypeCode) ?? classTypes[0],
    [classTypeCode, classTypes]
  );
  const maxStudents = selectedType?.maxStudents ?? 1;
  const selectedStudents = useMemo(
    () => studentIds.map((studentId) => students.find((student) => student.id === studentId)).filter((student): student is SelectOption => Boolean(student)),
    [studentIds, students]
  );
  const suggestions = useMemo(() => {
    const token = normalizeStudentToken(query);
    if (!token) return [];
    return students
      .filter((student) => !studentIds.includes(student.id) && normalizeStudentToken(`${student.name} ${student.secondary ?? ""}`).includes(token))
      .slice(0, 8);
  }, [query, studentIds, students]);

  if (!open || !selectedType) return null;

  const addStudent = (student: SelectOption) => {
    if (studentIds.includes(student.id)) return;
    if (studentIds.length >= maxStudents) {
      setError(`${selectedType.label}은 최대 ${maxStudents}명까지 배치할 수 있습니다.`);
      return;
    }
    setStudentIds((prev) => [...prev, student.id]);
    setQuery("");
    setError(null);
  };

  const handleQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (suggestions[0]) addStudent(suggestions[0]);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedStudents.length === 0) {
      setError("학생명을 입력하고 자동매칭 결과에서 학생을 선택해 주세요.");
      return;
    }
    onSave({
      slot,
      classTypeCode: selectedType.code,
      classTypeLabel: selectedType.label,
      badgeText: selectedType.badgeText,
      studentIds: selectedStudents.map((student) => student.id),
      studentNames: selectedStudents.map((student) => student.name)
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form onSubmit={handleSubmit} className="sync-surface w-full max-w-lg rounded-xl bg-white p-4" role="dialog" aria-modal="true" aria-label={`${dateLabel} ${slot} 학생 배치`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="sync-heading text-base font-black text-slate-900">{dateLabel} {slot} 학생 배치</h3>
            <p className="sync-copy mt-1 text-xs font-semibold text-slate-500">학생명을 입력하면 활성 학생 명단에서 자동으로 찾습니다.</p>
          </div>
          <button type="button" onClick={onClose} className="sync-pressable sync-focus min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
            닫기
          </button>
        </div>

        <fieldset className="mt-4">
          <legend className="mb-2 text-xs font-black text-slate-700">수업 유형</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {classTypes.map((classType) => {
              const selected = classType.code === selectedType.code;
              return (
                <button
                  key={classType.code}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setClassTypeCode(classType.code);
                    setStudentIds((prev) => prev.slice(0, classType.maxStudents));
                    setError(null);
                  }}
                  className={`sync-pressable sync-focus min-h-10 rounded-lg border px-2 text-xs font-black transition-[background-color,border-color,color,transform] ${typeButtonClass(classType, selected)}`}
                >
                  {classType.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="temporary-student-search" className="text-xs font-black text-slate-700">학생 자동매칭</label>
            <span className="sync-tabular text-[11px] font-bold text-slate-500">{selectedStudents.length}/{maxStudents}명</span>
          </div>
          <input
            id="temporary-student-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleQueryKeyDown}
            autoComplete="off"
            placeholder="학생명 또는 학교 입력"
            className="sync-input mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          {query ? (
            <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              {suggestions.length > 0 ? suggestions.map((student) => (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => addStudent(student)}
                  className="sync-pressable sync-focus flex min-h-10 w-full items-center justify-between rounded-md px-3 text-left text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-800"
                >
                  <span>{student.name}</span>
                  <span className="truncate pl-3 text-[10px] font-semibold text-slate-400">{student.secondary ?? "학생"}</span>
                </button>
              )) : (
                <p className="px-3 py-3 text-xs font-semibold text-slate-500">일치하는 활성 학생이 없습니다.</p>
              )}
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex min-h-10 flex-wrap gap-2">
          {selectedStudents.map((student) => (
            <button
              key={student.id}
              type="button"
              onClick={() => setStudentIds((prev) => prev.filter((studentId) => studentId !== student.id))}
              className="sync-pressable sync-focus min-h-10 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-black text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
              aria-label={`${student.name} 배치 해제`}
            >
              {student.name} ×
            </button>
          ))}
        </div>

        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p> : null}

        <div className="mt-5 flex items-center justify-between gap-2">
          <div>
            {initialClass ? (
              <button type="button" onClick={onDelete} className="sync-pressable sync-focus min-h-10 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-700 hover:bg-rose-100">
                배치 삭제
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="sync-pressable sync-focus min-h-10 rounded-lg border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 hover:bg-slate-50">취소</button>
            <button type="submit" className="sync-pressable sync-focus min-h-10 rounded-lg bg-blue-600 px-4 text-xs font-black text-white shadow-sm hover:bg-blue-700">배치 적용</button>
          </div>
        </div>
      </form>
    </div>
  );
}
