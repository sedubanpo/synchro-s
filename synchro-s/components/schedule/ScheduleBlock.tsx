import { getSubjectColorClass } from "@/lib/subjectColors";
import type { RoleView, ScheduleEvent } from "@/types/schedule";

type ScheduleBlockProps = {
  event: ScheduleEvent;
  roleView: RoleView;
  chainProgress?: {
    index: number;
    total: number;
  };
  showSaveAction?: boolean;
  onSave?: (event: ScheduleEvent) => void;
  onDelete?: (event: ScheduleEvent) => void;
  highlightedStudentName?: string | null;
  onStudentHighlight?: (studentName: string) => void;
  studentSecondaryLookup?: Readonly<Record<string, string>>;
};

type ScheduleTone = "blue" | "violet" | "amber" | "emerald" | "rose" | "slate";
type StudentEntry = { id: string; name: string };

function baseToneBySubject(event: ScheduleEvent, subjectColorClass: string): ScheduleTone {
  const code = event.subjectCode.toUpperCase();
  const name = event.subjectName.replace(/\s+/g, "");
  const color = subjectColorClass.toLowerCase();
  if (code.includes("KOREAN") || name.includes("국어")) return "rose";
  if (code.includes("MATH") || name.includes("수학")) return "blue";
  if (code.includes("ENGLISH") || name.includes("영어")) return "violet";
  if (code.includes("SOCIAL") || name.includes("사회") || name.includes("사탐")) return "amber";
  if (code.includes("SCIENCE") || name.includes("과학")) return "emerald";
  if (color.includes("rose") || color.includes("red") || color.includes("pink")) return "rose";
  if (color.includes("blue") || color.includes("sky")) return "blue";
  if (color.includes("purple") || color.includes("violet") || color.includes("fuchsia")) return "violet";
  if (color.includes("amber") || color.includes("orange") || color.includes("yellow")) return "amber";
  if (color.includes("green") || color.includes("emerald") || color.includes("teal")) return "emerald";
  return "slate";
}

function classTypeTone(event: ScheduleEvent): ScheduleTone {
  const normalized = `${event.classTypeCode} ${event.classTypeLabel} ${event.badgeText}`
    .replace(/[^0-9a-z가-힣:]/gi, "")
    .toLowerCase();
  if (normalized.includes("3:1") || normalized.includes("3대1") || normalized.includes("threetoone") || normalized.includes("threeone")) return "rose";
  if (normalized.includes("2:1") || normalized.includes("2대1") || normalized.includes("twotoone") || normalized.includes("twoone")) return "violet";
  if (normalized.includes("1:1") || normalized.includes("1대1") || normalized.includes("onetoone") || normalized.includes("oneone")) return "blue";
  if (normalized.includes("개별정규") || normalized.includes("개별") || normalized.includes("regular") || normalized.includes("multi")) return "amber";
  return "slate";
}

function toneClasses(tone: ReturnType<typeof baseToneBySubject>): {
  block: string;
  pill: string;
  badge: string;
  time: string;
  notch: string;
  segmentOn: string;
  segmentOff: string;
} {
  const classes = {
    blue: {
      block: "border-blue-200 bg-blue-50 text-blue-950",
      pill: "border-blue-200 bg-white/70 text-blue-800",
      badge: "border-blue-200 bg-blue-100 text-blue-800",
      time: "bg-white/75 text-blue-900 ring-1 ring-blue-100",
      notch: "bg-white",
      segmentOn: "bg-blue-500",
      segmentOff: "bg-blue-200"
    },
    violet: {
      block: "border-violet-200 bg-violet-50 text-violet-950",
      pill: "border-violet-200 bg-white/70 text-violet-800",
      badge: "border-violet-200 bg-violet-100 text-violet-800",
      time: "bg-white/75 text-violet-900 ring-1 ring-violet-100",
      notch: "bg-white",
      segmentOn: "bg-violet-500",
      segmentOff: "bg-violet-200"
    },
    amber: {
      block: "border-amber-200 bg-amber-50 text-amber-950",
      pill: "border-amber-200 bg-white/70 text-amber-800",
      badge: "border-amber-200 bg-amber-100 text-amber-800",
      time: "bg-white/75 text-amber-900 ring-1 ring-amber-100",
      notch: "bg-white",
      segmentOn: "bg-amber-500",
      segmentOff: "bg-amber-200"
    },
    emerald: {
      block: "border-emerald-200 bg-emerald-50 text-emerald-950",
      pill: "border-emerald-200 bg-white/70 text-emerald-800",
      badge: "border-emerald-200 bg-emerald-100 text-emerald-800",
      time: "bg-white/75 text-emerald-900 ring-1 ring-emerald-100",
      notch: "bg-white",
      segmentOn: "bg-emerald-500",
      segmentOff: "bg-emerald-200"
    },
    rose: {
      block: "border-rose-200 bg-rose-50 text-rose-950",
      pill: "border-rose-200 bg-white/70 text-rose-800",
      badge: "border-rose-200 bg-rose-100 text-rose-800",
      time: "bg-white/75 text-rose-900 ring-1 ring-rose-100",
      notch: "bg-white",
      segmentOn: "bg-rose-500",
      segmentOff: "bg-rose-200"
    },
    slate: {
      block: "border-slate-200 bg-slate-50 text-slate-950",
      pill: "border-slate-200 bg-white/75 text-slate-700",
      badge: "border-slate-200 bg-slate-100 text-slate-700",
      time: "bg-white/75 text-slate-800 ring-1 ring-slate-100",
      notch: "bg-white",
      segmentOn: "bg-slate-500",
      segmentOff: "bg-slate-200"
    }
  };

  return classes[tone];
}

function uniqueStudents(ids: string[], names: string[]): StudentEntry[] {
  const seen = new Set<string>();
  const unique: StudentEntry[] = [];

  for (let index = 0; index < names.length; index += 1) {
    const name = names[index] ?? "";
    const trimmed = name.trim();
    const key = trimmed.replace(/\s+/g, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ id: (ids[index] ?? "").trim(), name: trimmed });
  }

  return unique;
}

function normalizedStudentName(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase().trim();
}

export function ScheduleBlock({
  event,
  roleView,
  chainProgress,
  showSaveAction = false,
  onSave,
  onDelete,
  highlightedStudentName = null,
  onStudentHighlight,
  studentSecondaryLookup = {}
}: ScheduleBlockProps) {
  const subjectColorClass = getSubjectColorClass(event.subjectCode, event.subjectName);
  const subjectTone = toneClasses(baseToneBySubject(event, subjectColorClass));
  const instructorTone = toneClasses(classTypeTone(event));
  const tone = roleView === "instructor" ? instructorTone : subjectTone;
  const title = event.instructorName ? `${event.subjectName} ${event.instructorName}` : event.subjectName;
  const uniqueStudentEntries = uniqueStudents(event.studentIds, event.studentNames);
  const studentBadges = uniqueStudentEntries.length > 0 ? uniqueStudentEntries : [{ id: "", name: "학생없음" }];
  const timeBubble = `${event.startTime}-${event.endTime}`;
  const totalSegments = chainProgress?.total ?? 1;
  const currentSegment = chainProgress?.index ?? 1;
  const isRoyalClass =
    event.classTypeCode === "ONE_TO_ONE" ||
    event.classTypeCode === "TWO_TO_ONE" ||
    event.classTypeLabel.includes("1:1") ||
    event.classTypeLabel.includes("2:1");
  const isOneToOneClass =
    event.classTypeCode === "ONE_TO_ONE" ||
    event.classTypeLabel.includes("1:1");
  const oneToOneLabel = event.classTypeLabel.includes("2:1") ? "2:1" : "1:1";
  const blockClass = roleView === "instructor"
    ? isOneToOneClass
      ? "border-2 border-amber-400 bg-blue-50 text-blue-950 shadow-[0_3px_10px_rgba(180,120,0,0.12)]"
      : `${instructorTone.block} border shadow-sm`
    : isRoyalClass
    ? "border border-emerald-200 bg-emerald-50 text-emerald-950 shadow-sm"
    : `${tone.block} border shadow-sm`;
  const studentBadgeClass = roleView === "instructor"
    ? instructorTone.pill
    : isRoyalClass
      ? "border-emerald-200 bg-white/75 text-emerald-800"
      : tone.pill;
  const textBadgeClass = roleView === "instructor"
    ? `border ${instructorTone.badge}`
    : isRoyalClass
      ? "border border-emerald-200 bg-emerald-100 text-emerald-800"
      : `border ${tone.badge}`;
  const timeBubbleClass = isRoyalClass ? "bg-white/75 text-emerald-900 ring-1 ring-emerald-100" : tone.time;
  const notchClass = isRoyalClass ? "bg-white" : tone.notch;
  const segmentOnClass = isRoyalClass ? "bg-emerald-500" : tone.segmentOn;
  const segmentOffClass = isRoyalClass ? "bg-emerald-200" : tone.segmentOff;
  const normalizedHighlight = highlightedStudentName ? normalizedStudentName(highlightedStudentName) : "";
  const containsHighlightedStudent = Boolean(
    normalizedHighlight && studentBadges.some((student) => normalizedStudentName(student.name) === normalizedHighlight)
  );
  const classTypeLabel = event.badgeText.replace(/^\[|\]$/g, "").trim() || event.classTypeLabel;

  return (
    <div
      data-instructor-highlight-match={roleView === "instructor" && normalizedHighlight ? String(containsHighlightedStudent) : undefined}
      className={`${blockClass} sync-schedule-block group relative rounded-lg px-1.5 py-1.5 transition-[box-shadow,opacity,border-color] duration-150 ease-out ${
        roleView === "instructor" && normalizedHighlight
          ? containsHighlightedStudent
            ? "border-amber-400 ring-2 ring-amber-300"
            : "opacity-45"
          : ""
      }`}
    >
      {isRoyalClass && roleView !== "instructor" ? (
        <span className="absolute -top-1.5 -left-1.5 z-20 inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-300 bg-amber-200 text-[11px] shadow-sm">
          👑
        </span>
      ) : null}

      {(showSaveAction || onDelete) ? (
        <div className="absolute right-1.5 top-1.5 z-30 flex items-center gap-1 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100">
          {showSaveAction && onSave ? (
            <button
              type="button"
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                onSave(event);
              }}
              className="sync-pressable sync-focus inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
              title="이 수업만 즉시 저장"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 4h9l3 3v13H6z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 4v6h6V4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                onDelete(event);
              }}
              className="sync-pressable sync-focus inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
              title="이 수업 삭제"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16" strokeLinecap="round" />
                <path d="M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 10v7" strokeLinecap="round" />
                <path d="M12 10v7" strokeLinecap="round" />
                <path d="M16 10v7" strokeLinecap="round" />
                <path d="M6 7l1 12h10l1-12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}

      {roleView === "instructor" ? (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center justify-between gap-1.5">
            <span
              data-schedule-type-badge="true"
              className={`inline-flex h-5 min-w-0 max-w-full items-center justify-center rounded px-1.5 py-0 text-[10px] font-extrabold leading-none ${textBadgeClass}`}
              title={classTypeLabel}
            >
              <span className="truncate">{classTypeLabel}</span>
            </span>
            <span className="sync-tabular inline-flex h-5 shrink-0 items-center rounded bg-slate-900 px-1.5 text-[9px] font-black leading-none text-white">
              {studentBadges.length}명
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap gap-1">
            {studentBadges.map((student, index) => {
              const { id, name } = student;
              const isSelected = normalizedHighlight === normalizedStudentName(name);
              const canHighlight = name !== "학생없음" && Boolean(onStudentHighlight);
              const secondary = studentSecondaryLookup[`id:${id}`] ?? studentSecondaryLookup[`name:${normalizedStudentName(name)}`] ?? "";

              return (
                <button
                  type="button"
                  key={`${event.id}-student-${index}-${name}`}
                  aria-pressed={isSelected}
                  disabled={!canHighlight}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    if (canHighlight) onStudentHighlight?.(name);
                  }}
                  aria-label={canHighlight ? (isSelected && secondary ? `${name}, ${secondary}, 전체 배치 강조 해제` : `${name} 학생의 전체 배치 강조`) : undefined}
                  className={`sync-focus inline-flex min-h-8 min-w-0 max-w-full flex-col items-start justify-center rounded border px-1.5 py-1 text-left transition-[background-color,border-color,box-shadow,color,opacity,transform] duration-150 ease-out ${
                    isSelected
                      ? "border-amber-300 bg-amber-200 text-slate-950 shadow-sm ring-2 ring-amber-100"
                      : canHighlight
                        ? `${studentBadgeClass} cursor-pointer hover:-translate-y-px hover:border-amber-300 hover:bg-amber-50 hover:text-slate-900 hover:shadow-sm active:translate-y-0 ${normalizedHighlight ? "opacity-60" : ""}`
                        : `${studentBadgeClass} cursor-default`
                  }`}
                  title={canHighlight ? `${name} 학생의 전체 배치 강조` : undefined}
                >
                  <span className="max-w-full truncate text-[10px] font-black leading-3.5">{name}</span>
                  {isSelected && secondary ? (
                    <span className="mt-0.5 max-w-full truncate text-[8px] font-semibold leading-3 text-amber-900" title={secondary}>
                      {secondary}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-1 flex items-start justify-between gap-1">
            <div className="flex min-w-0 items-center gap-1">
            <p
              title={title}
              data-schedule-title="true"
              className="min-w-0 flex-1 break-keep pr-0.5 text-pretty text-[12px] font-bold leading-4"
            >
              {title}
            </p>
            {isRoyalClass ? (
            <span
              data-schedule-type-badge="true"
              className="inline-flex h-5 shrink-0 items-center justify-center rounded-full border border-amber-100/80 bg-amber-200/90 px-1.5 py-0 text-[9px] font-black leading-none text-amber-900"
            >
              {oneToOneLabel}
            </span>
            ) : null}
            </div>
            <span
              data-schedule-type-badge="true"
              className={`inline-flex h-5 shrink-0 items-center justify-center rounded px-1.5 py-0 text-[10px] font-semibold leading-none ${textBadgeClass}`}
            >
              {event.badgeText}
            </span>
          </div>

          <div className="flex items-center justify-between gap-1">
            <div
              data-schedule-time-bubble="true"
              className={`sync-tabular relative inline-flex h-6 items-center justify-center rounded-full px-2 text-[10px] font-semibold leading-none ${timeBubbleClass}`}
            >
              <span className="whitespace-nowrap leading-none">{timeBubble}</span>
              <span data-schedule-time-notch="true" className={`absolute -bottom-0.5 left-3 h-1.5 w-1.5 rotate-45 ${notchClass}`} />
            </div>
            <div className="flex items-center gap-0.5">
              {Array.from({ length: totalSegments }).map((_, idx) => (
                <span
                  key={`seg-${idx + 1}`}
                  className={`h-1.5 w-2 rounded-sm ${idx + 1 <= currentSegment ? segmentOnClass : segmentOffClass}`}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
