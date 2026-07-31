import type { ScheduleEvent } from "@/types/schedule";

export function mergeScheduleEventsByIdentity(
  current: ScheduleEvent[],
  incoming: ScheduleEvent[]
): ScheduleEvent[] {
  const merged = new Map(current.map((event) => [`${event.id}:${event.classDate}`, event]));
  for (const event of incoming) {
    merged.set(`${event.id}:${event.classDate}`, event);
  }
  return [...merged.values()];
}
