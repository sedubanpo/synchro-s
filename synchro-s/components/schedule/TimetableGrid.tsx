import { ScheduleBlock } from "@/components/schedule/ScheduleBlock";
import { timeToMinutes } from "@/lib/time";
import type { RoleView, ScheduleEvent, Weekday } from "@/types/schedule";
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";

type TimetableGridProps = {
  roleView: RoleView;
  days: { key: Weekday; label: string }[];
  timeSlots: string[];
  events: ScheduleEvent[];
  highlightCellTints?: Record<string, string>;
  onCellClick: (ctx: { weekday: Weekday; startTime: string }) => void;
  onEventMove?: (ctx: { classId: string; weekday: Weekday; startTime: string; endTime: string }) => Promise<void>;
};

function toRangeLabel(startTime: string): string {
  const [h, m] = startTime.split(":").map(Number);
  const nextHour = h + 1;
  if (m === 0) {
    return `${h}-${nextHour}시`;
  }
  const mm = String(m).padStart(2, "0");
  return `${h}:${mm}-${nextHour}:${mm}`;
}

function minutesToTime(totalMinutes: number): string {
  const safe = Math.max(0, totalMinutes);
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addMinutes(time: string, durationMinutes: number): string {
  const [h, m] = time.split(":").map(Number);
  return minutesToTime(h * 60 + m + durationMinutes);
}

export function TimetableGrid({ roleView, days, timeSlots, events, highlightCellTints, onCellClick, onEventMove }: TimetableGridProps) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  const dragPayloadRef = useRef<{ classId: string; durationMinutes: number } | null>(null);
  const dropHandledRef = useRef(false);
  const progressByEventKey = new Map<string, { index: number; total: number }>();
  const eventMap = new Map<string, ScheduleEvent[]>();
  const activeDaySet = new Set<Weekday>();

  for (const event of events) {
    const key = `${event.weekday}-${event.startTime}`;
    const bucket = eventMap.get(key) ?? [];
    bucket.push(event);
    eventMap.set(key, bucket);
    activeDaySet.add(event.weekday);
  }

  const chainBaseKey = (event: ScheduleEvent): string => {
    const studentsKey = [...event.studentNames].sort().join("|");
    return [
      event.weekday,
      event.subjectCode,
      event.classTypeCode,
      event.instructorId || event.instructorName,
      studentsKey
    ].join("::");
  };

  const eventGroups = new Map<string, ScheduleEvent[]>();
  for (const event of events) {
    const key = chainBaseKey(event);
    const bucket = eventGroups.get(key) ?? [];
    bucket.push(event);
    eventGroups.set(key, bucket);
  }

  for (const [, group] of eventGroups) {
    const ordered = [...group].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    let chainStart = 0;
    while (chainStart < ordered.length) {
      let chainEnd = chainStart;
      while (chainEnd + 1 < ordered.length) {
        const current = ordered[chainEnd];
        const next = ordered[chainEnd + 1];
        if (timeToMinutes(current.endTime) !== timeToMinutes(next.startTime)) break;
        chainEnd += 1;
      }
      const total = chainEnd - chainStart + 1;
      for (let idx = chainStart; idx <= chainEnd; idx += 1) {
        const event = ordered[idx];
        progressByEventKey.set(`${event.id}-${event.classDate}-${event.startTime}`, {
          index: idx - chainStart + 1,
          total
        });
      }
      chainStart = chainEnd + 1;
    }
  }

  const moveByPayload = async (payload: { classId: string; durationMinutes: number }, weekday: Weekday, startTime: string) => {
    if (!onEventMove) return;
    if (!payload.classId || Number.isNaN(payload.durationMinutes)) return;
    await onEventMove({
      classId: payload.classId,
      weekday,
      startTime,
      endTime: addMinutes(startTime, payload.durationMinutes)
    });
  };

  useEffect(() => {
    const clearDragState = () => {
      dragPayloadRef.current = null;
      setDragOverCell(null);
      setDraggingKey(null);
    };

    window.addEventListener("dragend", clearDragState);
    window.addEventListener("drop", clearDragState);
    window.addEventListener("mouseup", clearDragState);
    return () => {
      window.removeEventListener("dragend", clearDragState);
      window.removeEventListener("drop", clearDragState);
      window.removeEventListener("mouseup", clearDragState);
    };
  }, []);

  const handleDrop = async (event: DragEvent<HTMLElement>, weekday: Weekday, startTime: string) => {
    if (!onEventMove) return;
    event.preventDefault();
    event.stopPropagation();
    dropHandledRef.current = true;
    try {
      let payload = dragPayloadRef.current;
      if (!payload) {
        const payloadRaw = event.dataTransfer.getData("application/json");
        if (payloadRaw) {
          payload = JSON.parse(payloadRaw) as { classId: string; durationMinutes: number };
        }
      }
      if (!payload) return;
      await moveByPayload(payload, weekday, startTime);
    } finally {
      dragPayloadRef.current = null;
      setDragOverCell(null);
      setDraggingKey(null);
    }
  };

  return (
    <div className="grid-scrollbar overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-[980px] table-fixed border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 w-24 border-b border-r border-slate-200 bg-slate-50 px-2 py-3 text-center font-extrabold text-slate-600">
              시간
            </th>
            {days.map((day) => (
              <th
                key={day.key}
                className={`sticky top-0 z-20 border-b border-r px-3 py-3 text-center text-sm font-bold transition ${
                  activeDaySet.has(day.key)
                    ? "border-sky-200 bg-gradient-to-b from-sky-50 to-white text-sky-700 shadow-[inset_0_-1px_0_rgba(56,189,248,0.3),0_0_18px_rgba(59,130,246,0.18)]"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                {day.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {timeSlots.map((slot) => (
            <tr key={slot}>
              <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-center text-xs font-bold text-slate-600">
                {toRangeLabel(slot)}
              </td>

              {days.map((day) => {
                const cellKey = `${day.key}-${slot}`;
                const entries = eventMap.get(cellKey) ?? [];
                const isEmpty = entries.length === 0;
                const isDropTarget = dragOverCell === cellKey;

                return (
                  <td
                    key={cellKey}
                    className={`border-b border-r align-top transition ${
                      isDropTarget ? "border-sky-300 bg-sky-50/50" : "border-slate-100 bg-white"
                    }`}
                    style={undefined}
                    onClick={() => {
                      if (isEmpty) {
                        onCellClick({ weekday: day.key, startTime: slot });
                      }
                    }}
                    onDragOver={(event) => {
                      if (!onEventMove) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      if (dragOverCell !== cellKey) {
                        setDragOverCell(cellKey);
                      }
                    }}
                    onDragEnter={(event) => {
                      if (!onEventMove) return;
                      event.preventDefault();
                      setDragOverCell(cellKey);
                    }}
                    onDragLeave={(event) => {
                      if (!onEventMove) return;
                      const nextTarget = event.relatedTarget as Node | null;
                      if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                      if (dragOverCell === cellKey) {
                        setDragOverCell(null);
                      }
                    }}
                    onDrop={(event) => {
                      event.stopPropagation();
                      void handleDrop(event, day.key, slot);
                    }}
                  >
                    <div className="p-1">
                      {isEmpty ? (
                        <div
                          className={`min-h-[46px] rounded-md border border-dashed transition ${
                            isDropTarget
                              ? "border-sky-400 bg-sky-100/40 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.35)]"
                              : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                          }`}
                        />
                      ) : (
                        <div className="flex min-h-[46px] flex-col gap-1">
                          {entries.map((event) => (
                            <div
                              key={`${event.id}-${event.classDate}`}
                              draggable
                              onDragStart={(dragEvent) => {
                                const eventKey = `${event.id}-${event.classDate}-${event.startTime}`;
                                setDraggingKey(eventKey);
                                dropHandledRef.current = false;
                                const payload = JSON.stringify({
                                  classId: event.id,
                                  durationMinutes: timeToMinutes(event.endTime) - timeToMinutes(event.startTime)
                                });
                                dragPayloadRef.current = {
                                  classId: event.id,
                                  durationMinutes: timeToMinutes(event.endTime) - timeToMinutes(event.startTime)
                                };
                                dragEvent.dataTransfer.setData("application/json", payload);
                                dragEvent.dataTransfer.setData("text/plain", payload);
                                dragEvent.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => {
                                const hovered = dragOverCell;
                                const payload = dragPayloadRef.current;
                                if (!dropHandledRef.current && hovered && payload && onEventMove) {
                                  const [weekdayRaw, startTime] = hovered.split("-");
                                  const weekday = Number(weekdayRaw) as Weekday;
                                  if (weekday >= 1 && weekday <= 7 && startTime) {
                                    void moveByPayload(payload, weekday, startTime);
                                  }
                                }
                                dragPayloadRef.current = null;
                                setDragOverCell(null);
                                setDraggingKey(null);
                              }}
                              className={draggingKey === `${event.id}-${event.classDate}-${event.startTime}` ? "opacity-60" : ""}
                              style={
                                highlightCellTints?.[cellKey]
                                  ? {
                                      filter: `drop-shadow(0 0 14px ${highlightCellTints[cellKey]}) drop-shadow(0 0 24px ${highlightCellTints[cellKey]})`
                                    }
                                  : undefined
                              }
                            >
                              <ScheduleBlock
                                event={event}
                                roleView={roleView}
                                chainProgress={progressByEventKey.get(`${event.id}-${event.classDate}-${event.startTime}`)}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
