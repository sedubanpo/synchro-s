import { getSubjectColorClass } from "@/lib/subjectColors";
import { timeToMinutes } from "@/lib/time";
import type { RoleView, ScheduleEvent } from "@/types/schedule";

type ScheduleBlockProps = {
  event: ScheduleEvent;
  roleView: RoleView;
};

export function ScheduleBlock({ event, roleView }: ScheduleBlockProps) {
  const subjectColorClass = getSubjectColorClass(event.subjectCode);
  const durationMinutes = Math.max(30, timeToMinutes(event.endTime) - timeToMinutes(event.startTime));
  const personLabel =
    roleView === "student"
      ? event.instructorName || "강사없음"
      : event.studentNames.join(", ") || "학생없음";
  const title = `${event.subjectName} ${personLabel} ${event.classTypeLabel}`;
  const timeBubble = `${event.startTime}-${event.endTime}`;

  return (
    <div className={`${subjectColorClass} relative rounded-lg px-2 py-1.5 text-white shadow-sm`}>
      {event.note ? (
        <div className="absolute -top-2 left-2 z-20 inline-flex max-w-[88%] items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 shadow-sm">
          <span className="truncate">{event.note}</span>
          <span className="absolute -bottom-1 left-3 h-2 w-2 rotate-45 border-b border-r border-amber-300 bg-amber-100" />
        </div>
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
        <span className="text-[10px] font-medium opacity-90">{Math.floor(durationMinutes / 60)}h</span>
      </div>
    </div>
  );
}
