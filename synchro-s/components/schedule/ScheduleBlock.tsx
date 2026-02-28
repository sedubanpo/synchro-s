import { getSubjectColorClass } from "@/lib/subjectColors";
import type { RoleView, ScheduleEvent } from "@/types/schedule";

type ScheduleBlockProps = {
  event: ScheduleEvent;
  roleView: RoleView;
  chainProgress?: {
    index: number;
    total: number;
  };
};

export function ScheduleBlock({ event, roleView, chainProgress }: ScheduleBlockProps) {
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
  const blockClass = isRoyalClass
    ? "border border-emerald-200/55 bg-[linear-gradient(145deg,rgba(16,185,129,0.92),rgba(52,211,153,0.82),rgba(110,231,183,0.76))] shadow-[0_14px_32px_rgba(16,185,129,0.26)]"
    : `${subjectColorClass} shadow-sm`;
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
    <div className={`${blockClass} relative rounded-lg px-2 py-1.5 text-white`}>
      {isRoyalClass ? (
        <span className="absolute -top-1.5 -left-1.5 z-20 inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-200 bg-gradient-to-b from-amber-200 to-amber-400 text-[11px] shadow-[0_4px_12px_rgba(251,191,36,0.45)]">
          👑
        </span>
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
            <p className="line-clamp-1 pr-1 text-[12px] font-bold leading-4">{title}</p>
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
