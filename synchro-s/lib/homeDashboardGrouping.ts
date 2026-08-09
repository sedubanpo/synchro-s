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
  const indexById = new Map<string, number>();
  const indexByName = new Map<string, number>();

  for (const event of [a, b]) {
    const length = Math.max(event.studentIds.length, event.studentNames.length);
    for (let index = 0; index < length; index += 1) {
      const id = (event.studentIds[index] ?? "").trim();
      const name = (event.studentNames[index] ?? "").trim();
      const nameKey = normalizePersonName(name);

      if (!id && !nameKey) continue;

      // 이름이 있는 기록은 이름을 주 식별자로 사용한다. 일부 구형 데이터는
      // 서로 다른 학생에게 같은 임시 ID를 넣었으므로 ID만으로 제거하면 실제
      // 학생이 강사 폴더에서 누락된다.
      if (nameKey) {
        const existingByName = indexByName.get(nameKey);
        if (existingByName !== undefined) {
          if (!studentIds[existingByName] && id) studentIds[existingByName] = id;
          if (id && !indexById.has(id)) indexById.set(id, existingByName);
          continue;
        }

        const existingById = id ? indexById.get(id) : undefined;
        if (
          existingById !== undefined &&
          normalizePersonName(studentNames[existingById] ?? "") === normalizePersonName(studentIds[existingById] ?? "")
        ) {
          studentNames[existingById] = name;
          indexByName.set(nameKey, existingById);
          continue;
        }
      } else if (id && indexById.has(id)) {
        continue;
      }

      const rosterIndex = studentNames.length;
      studentIds.push(id);
      studentNames.push(name || id);
      if (id && !indexById.has(id)) indexById.set(id, rosterIndex);
      if (nameKey) indexByName.set(nameKey, rosterIndex);
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
