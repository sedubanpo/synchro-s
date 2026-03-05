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
};

function hashText(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function baseHueBySubject(event: ScheduleEvent): number {
  const code = event.subjectCode.toUpperCase();
  const name = event.subjectName.replace(/\s+/g, "");
  if (code.includes("MATH") || name.includes("수학")) return 216;
  if (code.includes("ENGLISH") || name.includes("영어")) return 270;
  if (code.includes("SOCIAL") || name.includes("사회") || name.includes("사탐")) return 38;
  if (code.includes("SCIENCE") || name.includes("과학")) return 158;
  if (code.includes("KOREAN") || name.includes("국어")) return 24;
  return 210;
}

function buildInstructorTint(event: ScheduleEvent): {
  backgroundImage: string;
  borderColor: string;
  boxShadow: string;
} {
  const seed = hashText(`${event.subjectCode}:${event.instructorName || "no-instructor"}`);
  const delta = (seed % 13) - 6; // -6 ~ +6
  const saturationDelta = seed % 2 === 0 ? 2 : -2;
  const lightnessDelta = (Math.floor(seed / 7) % 3) - 1; // -1 ~ +1

  const hue = baseHueBySubject(event) + delta;
  const sat = Math.max(58, Math.min(78, 72 + saturationDelta));
  const light = Math.max(53, Math.min(61, 56 + lightnessDelta));

  return {
    backgroundImage: `linear-gradient(145deg, hsl(${hue} ${sat}% ${light}% / 0.96), hsl(${hue + 7} ${Math.max(52, sat - 6)}% ${Math.min(72, light + 7)}% / 0.88), hsl(${hue - 8} ${Math.max(45, sat - 18)}% ${Math.min(78, light + 13)}% / 0.8))`,
    borderColor: `hsl(${hue} ${Math.max(40, sat - 28)}% ${Math.min(88, light + 22)}% / 0.55)`,
    boxShadow: `0 14px 30px hsl(${hue} ${Math.max(38, sat - 22)}% ${Math.max(38, light - 8)}% / 0.24)`
  };
}

export function ScheduleBlock({ event, roleView, chainProgress, showSaveAction = false, onSave, onDelete }: ScheduleBlockProps) {
  const subjectColorClass = getSubjectColorClass(event.subjectCode, event.subjectName);
  const title = `${event.subjectName} ${event.instructorName || "강사없음"}`;
  const studentBadges = event.studentNames.length > 0 ? event.studentNames : ["학생없음"];
  const timeBubble = `${event.startTime}-${event.endTime}`;
  const totalSegments = chainProgress?.total ?? 1;
  const currentSegment = chainProgress?.index ?? 1;
  const isRoyalClass =
    event.classTypeCode === "ONE_TO_ONE" ||
    event.classTypeCode === "TWO_TO_ONE" ||
    event.classTypeLabel.includes("1:1") ||
    event.classTypeLabel.includes("2:1");
  const oneToOneLabel = event.classTypeLabel.includes("2:1") ? "2:1" : "1:1";
  const instructorTint = buildInstructorTint(event);
  const blockClass = isRoyalClass
    ? "border border-emerald-200/55 bg-[linear-gradient(145deg,rgba(16,185,129,0.92),rgba(52,211,153,0.82),rgba(110,231,183,0.76))] shadow-[0_14px_32px_rgba(16,185,129,0.26)]"
    : `${subjectColorClass} border shadow-sm`;
  const studentBadgeClass = isRoyalClass
    ? "border-emerald-100/45 bg-white/22 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
    : "border-white/30 bg-white/18 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]";
  const textBadgeClass = isRoyalClass
    ? "bg-emerald-900/22 text-white"
    : "bg-white/25 text-white";
  const timeBubbleClass = isRoyalClass
    ? "bg-emerald-950/20 text-white"
    : "bg-white/18 text-white";

  return (
    <div
      className={`${blockClass} group relative rounded-lg px-2 py-1.5 text-white`}
      style={!isRoyalClass ? instructorTint : undefined}
    >
      {isRoyalClass ? (
        <span className="absolute -top-1.5 -left-1.5 z-20 inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-200 bg-gradient-to-b from-amber-200 to-amber-400 text-[11px] shadow-[0_4px_12px_rgba(251,191,36,0.45)]">
          👑
        </span>
      ) : null}

      {(showSaveAction || onDelete) ? (
        <div className="absolute right-1.5 top-1.5 z-30 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          {showSaveAction && onSave ? (
            <button
              type="button"
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                onSave(event);
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/55 bg-white/28 text-white shadow-[0_6px_14px_rgba(15,23,42,0.2)] backdrop-blur-md hover:bg-emerald-400/75"
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
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/55 bg-white/28 text-white shadow-[0_6px_14px_rgba(15,23,42,0.2)] backdrop-blur-md hover:bg-rose-500/80"
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

      <div className="mb-1 flex items-start justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1">
          {roleView === "instructor" ? (
            <div className="flex min-w-0 flex-wrap gap-1 pr-1">
              {studentBadges.map((name, index) => (
                <span
                  key={`${event.id}-student-${index}-${name}`}
                  className={`inline-flex max-w-full items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-4 ${studentBadgeClass}`}
                >
                  <span className="truncate">{name}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="pr-1 text-[12px] font-bold leading-4 whitespace-normal break-words">{title}</p>
          )}
          {isRoyalClass ? (
            <span className="inline-flex shrink-0 rounded-full border border-amber-100/80 bg-amber-200/90 px-1.5 py-0.5 text-[9px] font-black text-amber-900">
              {oneToOneLabel}
            </span>
          ) : null}
        </div>
        <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${textBadgeClass}`}>{event.badgeText}</span>
      </div>

      <div className="flex items-center justify-between gap-1">
        <div className={`relative inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${timeBubbleClass}`}>
          <span>{timeBubble}</span>
          <span className={`absolute -bottom-1 left-2 h-1.5 w-1.5 rotate-45 ${isRoyalClass ? "bg-emerald-950/20" : "bg-white/18"}`} />
        </div>
        <div className="flex items-center gap-0.5">
          {Array.from({ length: totalSegments }).map((_, idx) => (
            <span
              key={`seg-${idx + 1}`}
              className={`h-1.5 w-2 rounded-sm ${idx + 1 <= currentSegment ? "bg-white/95" : "bg-white/30"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
