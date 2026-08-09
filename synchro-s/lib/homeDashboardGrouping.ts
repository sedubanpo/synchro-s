import type { ScheduleEvent } from "@/types/schedule";

function normalizeToken(value: string): string {
  return value.replace(/[\s_\-:()[\]·]/g, "").toLowerCase();
}

function isRegularMultiEvent(event: ScheduleEvent): boolean {
  const value = normalizeToken(`${event.classTypeCode} ${event.classTypeLabel} ${event.badgeText}`);
  return ["regularmulti", "개별정규", "개별", "다대일", "multi"].some((token) => value.includes(normalizeToken(token)));
}

function normalizePersonName(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function mergeRosters(a: ScheduleEvent, b: ScheduleEvent): Pick<ScheduleEvent, "studentIds" | "studentNames"> {
  const studentIds: string[] = [];
  const studentNames: string[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (const event of [a, b]) {
    const length = Math.max(event.studentIds.length, event.studentNames.length);
    for (let index = 0; index < length; index += 1) {
      const id = (event.studentIds[index] ?? "").trim();
      const name = (event.studentNames[index] ?? "").trim();
      const nameKey = normalizePersonName(name);
      if ((id && seenIds.has(id)) || (nameKey && seenNames.has(nameKey)) || (!id && !nameKey)) continue;
      studentIds.push(id);
      studentNames.push(name || id);
      if (id) seenIds.add(id);
      if (nameKey) seenNames.add(nameKey);
    }
  }

  return { studentIds, studentNames };
}

export function mergeHomeInstructorEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  const grouped = new Map<string, ScheduleEvent>();

  for (const event of events) {
    // This function receives events that the Home summary has already resolved
    // to one instructor. Legacy ids and aliases can both differ, so neither may
    // split a regular class back into multiple cards here.
    const key = isRegularMultiEvent(event)
      ? [
          "regular-multi",
          event.weekday,
          event.startTime,
          event.endTime
        ].join("::")
      : `single::${event.id}::${event.classDate}::${event.startTime}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...event, ...mergeRosters(event, event) });
      continue;
    }
    grouped.set(key, { ...existing, ...mergeRosters(existing, event) });
  }

  return [...grouped.values()].sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.endTime.localeCompare(b.endTime);
  });
}
