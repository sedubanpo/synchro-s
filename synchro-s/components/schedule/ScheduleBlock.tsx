import { getSubjectColorClass } from "@/lib/subjectColors";
import { timeToMinutes } from "@/lib/time";
import type { RoleView, ScheduleEvent } from "@/types/schedule";

type ScheduleBlockProps = {
  event: ScheduleEvent;
  roleView: RoleView;
};

export function ScheduleBlock({ event, roleView }: ScheduleBlockProps) {
  const subjectColorClass = getSubjectColorClass(event.subjectCode);
  const durationMinutes = timeToMinutes(event.endTime) - timeToMinutes(event.startTime);
  const durationHours = Math.max(durationMinutes / 60, 1);

  return (
    <div className={`${subjectColorClass} relative rounded-lg p-2 pt-4 text-white shadow-sm`}>
      {event.note ? (
        <div className="absolute -top-2 left-2 inline-flex max-w-[90%] items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 shadow-sm">
          <span className="truncate">{event.note}</span>
          <span className="absolute -bottom-1 left-3 h-2 w-2 rotate-45 border-b border-r border-amber-300 bg-amber-100" />
        </div>
      ) : null}
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="truncate text-xs font-bold">{event.subjectName}</span>
        <span className="inline-flex rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-semibold">{event.badgeText}</span>
      </div>
      <div className="text-[11px] font-medium opacity-95">
        {event.startTime} - {event.endTime} ({durationHours}h)
      </div>
      <div className="mt-1 line-clamp-2 text-[11px] font-semibold">
        {roleView === "student"
          ? event.instructorName || "강사 없음"
          : event.studentNames.join(", ") || "학생 없음"}
      </div>
    </div>
  );
}
