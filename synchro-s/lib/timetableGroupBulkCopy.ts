export type BulkCopyGroup = {
  id: string;
  targetId: string;
  tagId: string | null;
  weekStart: string;
  name: string;
  classIds: string[];
  snapshotEvents: unknown[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BulkCopyStudent = {
  id: string;
  name: string;
};

export type BulkCopyCandidate = {
  studentId: string;
  studentName: string;
  sourceGroup: BulkCopyGroup;
};

export type BulkCopyPlan = {
  candidates: BulkCopyCandidate[];
  missingSource: BulkCopyStudent[];
  destinationExists: BulkCopyStudent[];
  containsOneOff: BulkCopyStudent[];
};

function compareGroupRecency(a: BulkCopyGroup, b: BulkCopyGroup): number {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
  if (a.weekStart !== b.weekStart) return b.weekStart.localeCompare(a.weekStart);
  if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
  return b.id.localeCompare(a.id);
}

export function buildStudentTimetableBulkCopyPlan(input: {
  students: BulkCopyStudent[];
  groups: BulkCopyGroup[];
  sourceTagId: string;
  destinationTagId: string;
}): BulkCopyPlan {
  const groupsByStudent = new Map<string, BulkCopyGroup[]>();
  for (const group of input.groups) {
    const bucket = groupsByStudent.get(group.targetId) ?? [];
    bucket.push(group);
    groupsByStudent.set(group.targetId, bucket);
  }

  const candidates: BulkCopyCandidate[] = [];
  const missingSource: BulkCopyStudent[] = [];
  const destinationExists: BulkCopyStudent[] = [];
  const containsOneOff: BulkCopyStudent[] = [];

  for (const student of input.students) {
    const groups = groupsByStudent.get(student.id) ?? [];
    if (groups.some((group) => group.tagId === input.destinationTagId)) {
      destinationExists.push(student);
      continue;
    }
    const sourceGroup = groups
      .filter((group) => group.tagId === input.sourceTagId && group.isActive)
      .sort(compareGroupRecency)[0];
    if (!sourceGroup) {
      missingSource.push(student);
      continue;
    }
    if (sourceGroup.snapshotEvents.some((event) => {
      if (!event || typeof event !== "object" || Array.isArray(event)) return false;
      return (event as { scheduleMode?: unknown }).scheduleMode === "one_off";
    })) {
      containsOneOff.push(student);
      continue;
    }
    candidates.push({ studentId: student.id, studentName: student.name, sourceGroup });
  }

  return { candidates, missingSource, destinationExists, containsOneOff };
}

function shiftIsoDate(date: string, dayDelta: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) return date;
  value.setUTCDate(value.getUTCDate() + dayDelta);
  return value.toISOString().slice(0, 10);
}

export function shiftSnapshotEventsToWeek(
  events: unknown[],
  sourceWeekStart: string,
  destinationWeekStart: string
): unknown[] {
  const source = new Date(`${sourceWeekStart}T00:00:00Z`);
  const destination = new Date(`${destinationWeekStart}T00:00:00Z`);
  const dayDelta = Math.round((destination.getTime() - source.getTime()) / 86_400_000);
  if (!Number.isFinite(dayDelta) || dayDelta === 0) return events;

  return events.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return event;
    const item = event as Record<string, unknown>;
    const next = { ...item };
    if (typeof item.classDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.classDate)) {
      next.classDate = shiftIsoDate(item.classDate, dayDelta);
    }
    return next;
  });
}
