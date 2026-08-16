export type EffectiveStudentTimetableGroup = {
  id: string;
  roleView: "student" | "instructor";
  targetId: string;
  weekStart: string;
  expiresOn?: string | null;
  tagId?: string | null;
  isActive: boolean;
  createdAt: string;
};

export function formatDateISOInKST(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}

function addDays(dateISO: string, days: number): string {
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getTimetableGroupExpirationReferenceDate(
  targetWeekStart: string,
  todayISO = formatDateISOInKST(new Date())
): string {
  const targetWeekEnd = addDays(targetWeekStart, 6);
  return todayISO >= targetWeekStart && todayISO <= targetWeekEnd ? todayISO : targetWeekStart;
}

/** `expiresOn` is the last date on which a timetable remains applicable. */
export function isTimetableGroupExpired(
  group: Pick<EffectiveStudentTimetableGroup, "expiresOn">,
  targetWeekStart: string,
  todayISO?: string
): boolean {
  const referenceDate = getTimetableGroupExpirationReferenceDate(targetWeekStart, todayISO);
  return Boolean(group.expiresOn && group.expiresOn < referenceDate);
}

export function compareEffectiveTimetableGroups(
  a: Pick<EffectiveStudentTimetableGroup, "id" | "weekStart" | "createdAt">,
  b: Pick<EffectiveStudentTimetableGroup, "id" | "weekStart" | "createdAt">
): number {
  if (a.weekStart !== b.weekStart) return b.weekStart.localeCompare(a.weekStart);
  if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
  return b.id.localeCompare(a.id);
}

/**
 * Stored activation remains authoritative while valid. An inactive timetable
 * is promoted only when this scope contains a previously active timetable
 * that has expired. A deliberate all-inactive state therefore stays inactive.
 */
export function selectEffectiveStudentTimetableGroup<T extends EffectiveStudentTimetableGroup>(
  groups: T[],
  targetWeekStart: string,
  tagId: string | null,
  todayISO?: string
): T | null {
  const candidates = groups.filter(
    (group) =>
      group.roleView === "student" &&
      (tagId !== null || group.weekStart <= targetWeekStart) &&
      (group.tagId ?? null) === tagId
  );
  const available = candidates.filter(
    (group) => !isTimetableGroupExpired(group, targetWeekStart, todayISO)
  );
  const active = available.filter((group) => group.isActive).sort(compareEffectiveTimetableGroups)[0];
  if (active) return active;

  const hasExpiredActivePredecessor = candidates.some(
    (group) => group.isActive && isTimetableGroupExpired(group, targetWeekStart, todayISO)
  );
  if (!hasExpiredActivePredecessor) return null;

  return available.filter((group) => !group.isActive).sort(compareEffectiveTimetableGroups)[0] ?? null;
}

export function getEffectiveStudentTimetableGroupMap<T extends EffectiveStudentTimetableGroup>(
  groups: T[],
  targetWeekStart: string,
  tagId: string | null,
  todayISO?: string
): Map<string, T> {
  const grouped = new Map<string, T[]>();
  for (const group of groups) {
    if (
      group.roleView !== "student" ||
      (tagId === null && group.weekStart > targetWeekStart) ||
      (group.tagId ?? null) !== tagId
    ) {
      continue;
    }
    const bucket = grouped.get(group.targetId) ?? [];
    bucket.push(group);
    grouped.set(group.targetId, bucket);
  }

  const effective = new Map<string, T>();
  for (const [targetId, bucket] of grouped) {
    const selected = selectEffectiveStudentTimetableGroup(bucket, targetWeekStart, tagId, todayISO);
    if (selected) effective.set(targetId, selected);
  }
  return effective;
}
