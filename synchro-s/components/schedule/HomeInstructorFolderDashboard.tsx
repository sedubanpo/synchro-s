"use client";

import { TIME_SLOTS } from "@/lib/constants";
import { getSubjectColorClass } from "@/lib/subjectColors";
import type { ScheduleEvent } from "@/types/schedule";
import { useEffect, useMemo, useState } from "react";

export type HomeDashboardPersonSummary = {
  id: string;
  name: string;
  secondary?: string;
  events: ScheduleEvent[];
};

type DateOption = {
  offset: -1 | 0 | 1;
  label: string;
  date: string;
  weekdayLabel: string;
};

type Props = {
  relativeLabel: string;
  weekdayLabel: string;
  dateISO: string;
  selectedTagLabel: string;
  dayOffset: -1 | 0 | 1;
  dateOptions: DateOption[];
  events: ScheduleEvent[];
  instructorSummaries: HomeDashboardPersonSummary[];
  studentSummaries: HomeDashboardPersonSummary[];
  loading: boolean;
  onSelectDate: (offset: -1 | 0 | 1, date: string) => void;
  onOpenInstructor: (id: string) => void;
  onOpenStudent: (id: string) => void;
};

const subjectCardTone: Record<string, string> = {
  blue: "border-blue-200 bg-blue-50 text-blue-950",
  violet: "border-violet-200 bg-violet-50 text-violet-950",
  amber: "border-amber-200 bg-amber-50 text-amber-950",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
  rose: "border-rose-200 bg-rose-50 text-rose-950",
  slate: "border-slate-200 bg-slate-50 text-slate-950"
};

function getSubjectTone(event: ScheduleEvent): keyof typeof subjectCardTone {
  const color = getSubjectColorClass(event.subjectCode, event.subjectName).toLowerCase();
  const code = event.subjectCode.toLowerCase();
  const name = event.subjectName.replace(/\s+/g, "").toLowerCase();
  if (code.includes("math") || name.includes("수학")) return "blue";
  if (code.includes("english") || name.includes("영어")) return "violet";
  if (code.includes("social") || name.includes("사회") || name.includes("사탐")) return "amber";
  if (code.includes("science") || ["과학", "생명", "물리", "화학", "지구", "통과"].some((token) => name.includes(token))) return "emerald";
  if (code.includes("korean") || name.includes("국어")) return "rose";
  if (color.includes("blue")) return "blue";
  if (color.includes("violet") || color.includes("purple")) return "violet";
  if (color.includes("amber") || color.includes("orange") || color.includes("yellow")) return "amber";
  if (color.includes("emerald") || color.includes("green") || color.includes("teal")) return "emerald";
  if (color.includes("rose") || color.includes("red") || color.includes("pink")) return "rose";
  return "slate";
}

function classTypeTone(event: ScheduleEvent): string {
  const value = `${event.classTypeCode} ${event.classTypeLabel} ${event.badgeText}`.toLowerCase();
  if (value.includes("three_to_one") || value.includes("3:1") || value.includes("3대1")) return "border-rose-200 bg-rose-100 text-rose-700";
  if (value.includes("two_to_one") || value.includes("2:1") || value.includes("2대1")) return "border-violet-200 bg-violet-100 text-violet-700";
  if (value.includes("one_to_one") || value.includes("1:1") || value.includes("1대1")) return "border-blue-200 bg-blue-100 text-blue-700";
  return "border-amber-200 bg-amber-100 text-amber-700";
}

function hourRange(startTime: string, endTime?: string): string {
  const start = Number(startTime.slice(0, 2));
  const end = endTime ? Number(endTime.slice(0, 2)) : start + 1;
  return `${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}시`;
}

export function HomeInstructorFolderDashboard({
  relativeLabel,
  weekdayLabel,
  dateISO,
  selectedTagLabel,
  dayOffset,
  dateOptions,
  events,
  instructorSummaries,
  studentSummaries,
  loading,
  onSelectDate,
  onOpenInstructor,
  onOpenStudent
}: Props) {
  const [selectedInstructorId, setSelectedInstructorId] = useState("");

  useEffect(() => {
    if (instructorSummaries.length === 0) {
      setSelectedInstructorId("");
      return;
    }
    if (!instructorSummaries.some((item) => item.id === selectedInstructorId)) {
      setSelectedInstructorId(instructorSummaries[0].id);
    }
  }, [instructorSummaries, selectedInstructorId]);

  const selectedInstructor = useMemo(
    () => instructorSummaries.find((item) => item.id === selectedInstructorId) ?? instructorSummaries[0] ?? null,
    [instructorSummaries, selectedInstructorId]
  );
  const rows = useMemo(
    () =>
      TIME_SLOTS.map((slot) => ({
        slot,
        events: (selectedInstructor?.events ?? []).filter((event) => event.startTime === slot)
      })),
    [selectedInstructor]
  );
  const selectedStudentCount = useMemo(
    () => new Set((selectedInstructor?.events ?? []).flatMap((event) => event.studentNames)).size,
    [selectedInstructor]
  );

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black text-blue-600">선택 날짜 운영 시간표</p>
            <h2 className="sync-heading mt-1 text-2xl font-black text-slate-900">
              {relativeLabel} {weekdayLabel}요일 강사·학생 대시보드
            </h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              #{selectedTagLabel} 기준 {dateISO} ({weekdayLabel}요일) 배치입니다.
            </p>
            <div className="mt-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-sm" aria-label="홈 대시보드 날짜 선택">
              {dateOptions.map((item) => {
                const active = dayOffset === item.offset;
                return (
                  <button
                    key={item.offset}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectDate(item.offset, item.date)}
                    className={`sync-pressable sync-focus min-h-10 rounded-md px-3 text-xs transition-[background-color,box-shadow,color,transform] duration-150 ease-out ${
                      active ? "bg-blue-600 font-black text-white shadow-sm" : "font-bold text-slate-600 hover:bg-white hover:text-slate-900"
                    }`}
                  >
                    <span className="block">{item.label}</span>
                    <span className={`mt-0.5 block text-[10px] tabular-nums ${active ? "text-blue-100" : "text-slate-400"}`}>
                      {item.date.slice(5).replace("-", ".")} {item.weekdayLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ["수업", events.length, "border-slate-200 bg-slate-50"],
              ["강사", instructorSummaries.length, "border-blue-100 bg-blue-50"],
              ["학생", studentSummaries.length, "border-emerald-100 bg-emerald-50"]
            ].map(([label, value, tone]) => (
              <div key={String(label)} className={`min-w-20 rounded-lg border px-3 py-2 ${tone}`}>
                <dt className="text-[10px] font-bold text-slate-500">{label}</dt>
                {loading ? <div className="mx-auto mt-1 h-6 w-10 animate-pulse rounded bg-slate-200" /> : <dd className="text-xl font-black tabular-nums text-slate-900">{value}</dd>}
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-3 pt-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-black text-slate-900">강사 폴더</p>
              <p className="sync-copy mt-0.5 text-[11px] font-semibold text-slate-500">강사를 선택하면 아래 격자에서 하루 수업을 확인할 수 있습니다.</p>
            </div>
            <span className="shrink-0 pb-2 text-[11px] font-bold text-blue-700">수평으로 밀어 전체 강사 보기</span>
          </div>
          <div role="tablist" aria-label={`${dateISO} 강사 목록`} className="mt-3 flex items-end gap-1.5 overflow-x-auto pb-0.5">
            {loading ? (
              Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-16 min-w-32 animate-pulse rounded-t-lg bg-slate-200" />)
            ) : instructorSummaries.length === 0 ? (
              <p className="w-full rounded-t-lg border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-xs font-semibold text-slate-500">
                선택한 날짜에 표시할 강사 수업이 없습니다.
              </p>
            ) : (
              instructorSummaries.map((item, index) => {
                const selected = selectedInstructor?.id === item.id;
                return (
                  <button
                    key={item.id}
                    id={`home-instructor-tab-${index}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="home-instructor-timetable"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setSelectedInstructorId(item.id)}
                    onKeyDown={(event) => {
                      const lastIndex = instructorSummaries.length - 1;
                      const nextIndex =
                        event.key === "ArrowRight"
                          ? (index + 1) % instructorSummaries.length
                          : event.key === "ArrowLeft"
                            ? (index - 1 + instructorSummaries.length) % instructorSummaries.length
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? lastIndex
                                : null;
                      if (nextIndex === null) return;
                      event.preventDefault();
                      setSelectedInstructorId(instructorSummaries[nextIndex]!.id);
                      document.getElementById(`home-instructor-tab-${nextIndex}`)?.focus();
                    }}
                    className={`sync-pressable sync-focus relative min-h-16 min-w-36 shrink-0 rounded-t-lg border px-3 pb-2 pt-3 text-left transition-[background-color,border-color,box-shadow,color,transform] duration-150 ease-out ${
                      selected
                        ? "z-10 -mb-px border-blue-300 border-b-white bg-white text-slate-950 shadow-sm"
                        : "border-slate-200 bg-slate-100 text-slate-600 hover:border-blue-200 hover:bg-blue-50"
                    }`}
                  >
                    <span className={`absolute left-2 top-0 h-1.5 w-12 -translate-y-full rounded-t-md ${selected ? "bg-blue-600" : "bg-slate-300"}`} />
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-black">{item.name}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-black tabular-nums ${selected ? "bg-blue-600 text-white" : "bg-white text-slate-600"}`}>
                        {item.events.length}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-[11px] font-semibold text-slate-500">{item.secondary || "과목 정보 없음"}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="grid gap-4 p-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div
            id="home-instructor-timetable"
            role="tabpanel"
            aria-labelledby={selectedInstructor ? `home-instructor-tab-${Math.max(0, instructorSummaries.findIndex((item) => item.id === selectedInstructor.id))}` : undefined}
            className="min-w-0 overflow-hidden rounded-lg border border-slate-200"
          >
            {selectedInstructor ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
                  <div>
                    <p className="text-lg font-black">{selectedInstructor.name}</p>
                    <p className="mt-0.5 text-xs font-semibold text-slate-300">{selectedInstructor.secondary || "과목 정보 없음"}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-bold tabular-nums">수업 {selectedInstructor.events.length}개</span>
                    <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-bold tabular-nums">학생 {selectedStudentCount}명</span>
                    <span className="rounded-md bg-blue-500 px-2 py-1 text-[11px] font-black">#{selectedTagLabel}</span>
                    <button type="button" onClick={() => onOpenInstructor(selectedInstructor.id)} className="sync-pressable sync-focus min-h-10 rounded-md border border-white/20 bg-white px-3 text-[11px] font-black text-slate-900 hover:bg-blue-50">
                      강사 상세 열기
                    </button>
                  </div>
                </div>

                <div className="max-h-[720px] overflow-y-auto">
                  <div className="grid grid-cols-[82px_minmax(0,1fr)] border-b border-slate-200 bg-slate-100 text-xs font-black text-slate-600">
                    <div className="border-r border-slate-200 px-3 py-2 text-center">시간</div>
                    <div className="px-3 py-2">수업 배치</div>
                  </div>
                  {rows.map((row) => (
                    <div key={row.slot} className="grid min-h-20 grid-cols-[82px_minmax(0,1fr)] border-b border-slate-200 last:border-b-0">
                      <div className="border-r border-slate-200 bg-slate-50 px-2 py-3 text-center text-xs font-black tabular-nums text-slate-600">
                        {hourRange(row.slot)}
                      </div>
                      <div className="bg-slate-50/30 p-2">
                        {row.events.length === 0 ? (
                          <div className="flex h-full min-h-14 items-center justify-center rounded-md border border-dashed border-slate-200 bg-white/60 text-[11px] font-semibold text-slate-400">수업 없음</div>
                        ) : (
                          <div className="grid gap-2 xl:grid-cols-2">
                            {row.events.map((event) => (
                              <article key={`${event.id}-${event.classDate}-${event.startTime}`} className={`rounded-lg border p-2.5 shadow-sm ${subjectCardTone[getSubjectTone(event)]}`}>
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-black">{event.subjectName} · {event.instructorName}</p>
                                    <p className="mt-0.5 text-[11px] font-bold tabular-nums opacity-70">{event.startTime}-{event.endTime}</p>
                                  </div>
                                  <div className="flex flex-wrap justify-end gap-1">
                                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-black ${classTypeTone(event)}`}>{event.classTypeLabel || event.badgeText}</span>
                                    <span className="rounded border border-slate-200 bg-white/80 px-1.5 py-0.5 text-[10px] font-black text-slate-600">#{selectedTagLabel}</span>
                                  </div>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {event.studentNames.map((studentName, studentIndex) => (
                                    <span key={`${studentName}-${studentIndex}`} className="rounded-md border border-white/80 bg-white/85 px-2 py-1 text-[11px] font-bold text-slate-700 shadow-sm">{studentName}</span>
                                  ))}
                                  <span className="rounded-md border border-slate-200 bg-slate-900 px-2 py-1 text-[10px] font-black tabular-nums text-white">{event.studentNames.length}명</span>
                                </div>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex min-h-80 items-center justify-center bg-slate-50 px-4 text-center text-sm font-semibold text-slate-500">선택한 날짜의 강사 시간표가 없습니다.</div>
            )}
          </div>

          <aside className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-black text-slate-900">학생별 {relativeLabel} 수업</p>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-500">재원생 기준 전체 배치</p>
              </div>
              <span className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-black tabular-nums text-white">{studentSummaries.length}명</span>
            </div>
            <div className="mt-3 max-h-[720px] space-y-2 overflow-y-auto pr-1">
              {loading ? (
                Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-emerald-100" />)
              ) : studentSummaries.length === 0 ? (
                <p className="rounded-lg border border-dashed border-emerald-200 bg-white px-3 py-5 text-center text-xs font-semibold text-slate-500">선택한 날짜에 표시할 학생 수업이 없습니다.</p>
              ) : (
                studentSummaries.map((item) => (
                  <button key={item.id} type="button" onClick={() => onOpenStudent(item.id)} className="sync-pressable sync-focus w-full rounded-lg border border-emerald-100 bg-white p-2.5 text-left shadow-sm transition-[background-color,border-color,box-shadow,transform] hover:border-emerald-300 hover:bg-emerald-50">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-black text-slate-900">{item.name}</span>
                      <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-white">{item.events.length}개</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] font-semibold text-slate-500">{item.secondary || "학교 정보 없음"}</span>
                    <span className="mt-2 flex flex-wrap gap-1">
                      {item.events.slice(0, 4).map((event, eventIndex) => (
                        <span key={`${event.id}-${event.startTime}-${eventIndex}`} className="rounded border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-emerald-700">{event.startTime} {event.instructorName}</span>
                      ))}
                      {item.events.length > 4 ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">+{item.events.length - 4}</span> : null}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
