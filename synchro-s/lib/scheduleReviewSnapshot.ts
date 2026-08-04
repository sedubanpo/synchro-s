import type { ScheduleEvent } from "@/types/schedule";

export type ScheduleReviewSnapshot = {
  snapshotEvents: ScheduleEvent[];
  snapshotFingerprint: string;
  snapshotEventCount: number;
};

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function getOccurrenceKey(event: ScheduleEvent): string {
  return [event.id, event.classDate, event.startTime, event.endTime].join("::");
}

function getFingerprintRow(event: ScheduleEvent): string {
  return [
    event.id,
    event.weekday,
    event.startTime,
    event.endTime,
    normalize(event.instructorId),
    normalize(event.instructorName),
    normalize(event.subjectCode),
    normalize(event.subjectName),
    normalize(event.classTypeCode),
    normalize(event.classTypeLabel),
    normalize(event.badgeText),
    normalize(event.scheduleMode)
  ].join("|");
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getScheduleReviewFingerprint(events: ScheduleEvent[]): string {
  const rows = events.map(getFingerprintRow).sort();
  return `v1:${events.length}:${fnv1a(rows.join("\n"))}`;
}

export function createScheduleReviewSnapshot(events: ScheduleEvent[]): ScheduleReviewSnapshot {
  const snapshotEvents = events.map((event) => ({
    ...event,
    studentIds: [...event.studentIds],
    studentNames: [...event.studentNames]
  }));

  return {
    snapshotEvents,
    snapshotFingerprint: getScheduleReviewFingerprint(snapshotEvents),
    snapshotEventCount: snapshotEvents.length
  };
}

/**
 * A saved student group can contain an older partial snapshot. Keep its authored
 * entries, then supplement only occurrences that are linked to the same group
 * and are absent from that snapshot.
 */
export function mergeScheduleReviewEvents(snapshotEvents: ScheduleEvent[], liveLinkedEvents: ScheduleEvent[]): ScheduleEvent[] {
  const merged = new Map<string, ScheduleEvent>();
  for (const event of snapshotEvents) {
    merged.set(getOccurrenceKey(event), event);
  }
  for (const event of liveLinkedEvents) {
    const key = getOccurrenceKey(event);
    if (!merged.has(key)) merged.set(key, event);
  }
  return [...merged.values()];
}
