"use client";

import { DAYS, TIME_SLOTS } from "@/lib/constants";
import type { ScheduleFormInput, Weekday } from "@/types/schedule";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

type ScheduleModalProps = {
  open: boolean;
  initialCell?: { weekday: Weekday; startTime: string };
  instructors: { id: string; name: string }[];
  students: { id: string; name: string }[];
  preferredInstructorId?: string;
  preferredStudentId?: string;
  subjects: { code: string; label: string }[];
  classTypes: { code: string; label: string; badgeText: string; maxStudents?: number }[];
  onSubmit: (input: ScheduleFormInput) => Promise<void>;
  onClose: () => void;
};

const END_TIME_OPTIONS = [...TIME_SLOTS, "22:00"];

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function ScheduleModal({
  open,
  initialCell,
  instructors,
  students,
  preferredInstructorId,
  preferredStudentId,
  subjects,
  classTypes,
  onSubmit,
  onClose
}: ScheduleModalProps) {
  const [form, setForm] = useState<ScheduleFormInput>({
    instructorId: "",
    studentIds: [],
    subjectCode: "",
    classTypeCode: "",
    note: "",
    scheduleMode: "recurring",
    weekday: 1,
    classDate: getTodayISO(),
    startTime: "10:00",
    endTime: "11:00"
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentClassType = useMemo(
    () => classTypes.find((type) => type.code === form.classTypeCode),
    [classTypes, form.classTypeCode]
  );

  const maxStudents = currentClassType?.maxStudents ?? Number.MAX_SAFE_INTEGER;

  useEffect(() => {
    if (!open) return;

    setForm({
      instructorId: preferredInstructorId || instructors[0]?.id || "",
      studentIds: preferredStudentId ? [preferredStudentId] : [],
      subjectCode: subjects[0]?.code ?? "",
      classTypeCode: classTypes[0]?.code ?? "",
      note: "",
      scheduleMode: "recurring",
      weekday: initialCell?.weekday ?? 1,
      classDate: getTodayISO(),
      startTime: initialCell?.startTime ?? "10:00",
      endTime: END_TIME_OPTIONS[Math.min(TIME_SLOTS.indexOf(initialCell?.startTime ?? "10:00") + 1, END_TIME_OPTIONS.length - 1)]
    });
    setError(null);
  }, [open, initialCell, instructors, preferredInstructorId, preferredStudentId, subjects, classTypes]);

  if (!open) {
    return null;
  }

  const toggleStudent = (studentId: string) => {
    setForm((prev) => {
      const exists = prev.studentIds.includes(studentId);
      if (exists) {
        return { ...prev, studentIds: prev.studentIds.filter((id) => id !== studentId) };
      }

      if (prev.studentIds.length >= maxStudents) {
        return prev;
      }

      return { ...prev, studentIds: [...prev.studentIds, studentId] };
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!form.note.trim()) {
      setError("메모는 필수입니다.");
      return;
    }
    setSubmitting(true);

    try {
      await onSubmit({ ...form, note: form.note.trim() });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save schedule");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-slate-900">새 수업 등록</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
          >
            닫기
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-slate-700">
              수업유형
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.scheduleMode}
                onChange={(e) => setForm((prev) => ({ ...prev, scheduleMode: e.target.value as "recurring" | "one_off" }))}
              >
                <option value="recurring">반복</option>
                <option value="one_off">단건</option>
              </select>
            </label>

            <label className="space-y-1 text-xs font-semibold text-slate-700">
              강사
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.instructorId}
                onChange={(e) => setForm((prev) => ({ ...prev, instructorId: e.target.value }))}
              >
                {instructors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-slate-700">
              과목
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.subjectCode}
                onChange={(e) => setForm((prev) => ({ ...prev, subjectCode: e.target.value }))}
              >
                {subjects.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs font-semibold text-slate-700">
              수업 타입
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.classTypeCode}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    classTypeCode: e.target.value,
                    studentIds: prev.studentIds.slice(
                      0,
                      classTypes.find((item) => item.code === e.target.value)?.maxStudents ?? Number.MAX_SAFE_INTEGER
                    )
                  }))
                }
              >
                {classTypes.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label} {item.badgeText}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {form.scheduleMode === "recurring" ? (
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                요일
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={form.weekday}
                  onChange={(e) => setForm((prev) => ({ ...prev, weekday: Number(e.target.value) as Weekday }))}
                >
                  {DAYS.map((day) => (
                    <option key={day.key} value={day.key}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                날짜
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  type="date"
                  value={form.classDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, classDate: e.target.value }))}
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs font-semibold text-slate-700">
                시작
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={form.startTime}
                  onChange={(e) => setForm((prev) => ({ ...prev, startTime: e.target.value }))}
                >
                  {TIME_SLOTS.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs font-semibold text-slate-700">
                종료
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={form.endTime}
                  onChange={(e) => setForm((prev) => ({ ...prev, endTime: e.target.value }))}
                >
                  {END_TIME_OPTIONS.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <fieldset>
            <legend className="text-xs font-semibold text-slate-700">
              학생 선택 ({form.studentIds.length}/{maxStudents === Number.MAX_SAFE_INTEGER ? "∞" : maxStudents})
            </legend>
            <div className="mt-2 max-h-36 space-y-2 overflow-auto rounded-lg border border-slate-200 p-3">
              {students.map((student) => {
                const checked = form.studentIds.includes(student.id);
                const disabled = !checked && form.studentIds.length >= maxStudents;

                return (
                  <label
                    key={student.id}
                    className={`flex items-center justify-between rounded px-2 py-1 text-sm ${disabled ? "text-slate-400" : "text-slate-700"}`}
                  >
                    <span>{student.name}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleStudent(student.id)}
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="block space-y-1 text-xs font-semibold text-slate-700">
            메모 (필수)
            <textarea
              value={form.note}
              required
              onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
              placeholder="특이사항/주의사항을 입력하세요."
              className="h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          {error ? <p className="text-xs font-semibold text-rose-600">{error}</p> : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? "저장 중..." : "저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
