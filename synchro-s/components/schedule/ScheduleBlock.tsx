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
  const subjectColorClass = getSubjectColorClass(event.subjectCode);
  const title =
    roleView === "instructor"
      ? `${event.studentNames.join(", ") || "학생없음"} ${event.classTypeLabel}`
      : `${event.subjectName} ${event.instructorName || "강사없음"} ${event.classTypeLabel}`;
  const timeBubble = `${event.startTime}-${event.endTime}`;
  const totalSegments = chainProgress?.total ?? 1;
  const currentSegment = chainProgress?.index ?? 1;
  const isRoyalClass =
    event.classTypeCode === "ONE_TO_ONE" ||
    event.classTypeCode === "TWO_TO_ONE" ||
    event.classTypeLabel.includes("1:1") ||
    event.classTypeLabel.includes("2:1");

  return (
    <div className={`${subjectColorClass} relative rounded-lg px-2 py-1.5 text-white shadow-sm`}>
      {isRoyalClass ? (
        <span className="absolute -top-1.5 -left-1.5 z-20 inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-200 bg-gradient-to-b from-amber-200 to-amber-400 text-[11px] shadow-[0_4px_12px_rgba(251,191,36,0.45)]">
          👑
        </span>
      ) : null}

      <div className="mb-1 flex items-start justify-between gap-1">
        <p className="line-clamp-1 pr-1 text-[12px] font-bold leading-4">{title}</p>
        <span className="inline-flex shrink-0 rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-semibold">{event.badgeText}</span>
      </div>

      <div className="flex items-center justify-between gap-1">
        <div className="relative inline-flex items-center rounded-full bg-white/18 px-2 py-0.5 text-[10px] font-semibold">
          <span>{timeBubble}</span>
          <span className="absolute -bottom-1 left-2 h-1.5 w-1.5 rotate-45 bg-white/18" />
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
