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

function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function getGapSignature(event: ScheduleEvent): string {
  return [
    event.classDate,
    event.weekday,
    normalizePersonName(event.instructorName) || event.instructorId,
    normalizeToken(event.subjectName) || normalizeToken(event.subjectCode),
    normalizeToken(event.classTypeLabel) || normalizeToken(event.classTypeCode),
    event.scheduleMode
  ].join("::");
}

function getRosterSignature(event: ScheduleEvent): string {
  const names = event.studentNames.map(normalizePersonName).filter(Boolean).sort();
  if (names.length > 0) return names.join("|");
  return event.studentIds.map((id) => id.trim().toLowerCase()).filter(Boolean).sort().join("|");
}

/**
 * Older saved groups can contain the first and last segment of a continuous
 * class while omitting a middle hour. Recover only live occurrences strictly
 * inside that saved range, with the same student and class signature. This is
 * intentionally narrower than adding every live event for the student, which
 * could mix another timetable tag into the selected tag.
 */
export function findInteriorScheduleGapEvents(
  snapshotEvents: ScheduleEvent[],
  liveEvents: ScheduleEvent[],
  targetStudentId: string,
  targetStudentName = ""
): ScheduleEvent[] {
  const eventsBySignature = new Map<string, ScheduleEvent[]>();

  for (const event of snapshotEvents) {
    const key = getGapSignature(event);
    const bucket = eventsBySignature.get(key) ?? [];
    bucket.push(event);
    eventsBySignature.set(key, bucket);
  }

  const normalizedTargetName = normalizePersonName(targetStudentName);
  const matchesTargetStudent = (event: ScheduleEvent) => {
    if (event.studentIds.includes(targetStudentId)) return true;
    return normalizedTargetName
      ? event.studentNames.some((name) => normalizePersonName(name) === normalizedTargetName)
      : false;
  };
  const recovered: ScheduleEvent[] = [];

  for (const [signature, signatureEvents] of eventsBySignature) {
    const sorted = [...signatureEvents].sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (sorted.length < 2 || !isRegularMultiEvent(sorted[0]!)) continue;

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!;
      const next = sorted[index]!;
      const previousStart = toMinutes(previous.startTime);
      const previousEnd = toMinutes(previous.endTime);
      const nextStart = toMinutes(next.startTime);
      const nextEnd = toMinutes(next.endTime);
      const duration = previousEnd - previousStart;

      // 앞뒤 블록의 길이가 같고 정확히 한 블록만 비는 경우만 복원한다.
      if (
        duration <= 0 ||
        nextEnd - nextStart !== duration ||
        nextStart - previousEnd !== duration ||
        getRosterSignature(previous) !== getRosterSignature(next)
      ) continue;

      const liveMatch = liveEvents.find(
        (event) =>
          getGapSignature(event) === signature &&
          toMinutes(event.startTime) === previousEnd &&
          toMinutes(event.endTime) === nextStart &&
          matchesTargetStudent(event)
      );
      if (liveMatch) {
        recovered.push(liveMatch);
        continue;
      }

      const roster = mergeScheduleStudentRosters(previous, next);
      recovered.push({
        ...previous,
        id: `snapshot-gap:${previous.id}:${previous.classDate}:${previous.endTime}`,
        startTime: previous.endTime,
        endTime: next.startTime,
        ...roster
      });
    }
  }

  return recovered;
}

export function mergeScheduleStudentRosters(a: ScheduleEvent, b: ScheduleEvent): Pick<ScheduleEvent, "studentIds" | "studentNames"> {
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
      grouped.set(key, { ...event, ...mergeScheduleStudentRosters(event, event) });
      continue;
    }
    grouped.set(key, { ...existing, ...mergeScheduleStudentRosters(existing, event) });
  }

  return [...grouped.values()].sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.endTime.localeCompare(b.endTime);
  });
}
