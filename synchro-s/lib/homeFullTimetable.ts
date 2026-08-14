export const HOME_CLASSROOM_OPTIONS = [
  "1강의실",
  "2강의실",
  "3강의실",
  "4강의실",
  "5강의실",
  "6강의실",
  "7강의실",
  "8강의실",
  "9강의실",
  "2관 1강의실",
  "2관 2강의실",
  "2관 3강의실",
  "3관 1강의실",
  "3관 2강의실"
] as const;

export type HomeClassroomAssignment = Record<string, string>;

export function isHomeClassroomOption(value: unknown): value is (typeof HOME_CLASSROOM_OPTIONS)[number] {
  return typeof value === "string" && HOME_CLASSROOM_OPTIONS.includes(value as (typeof HOME_CLASSROOM_OPTIONS)[number]);
}

export function sanitizeHomeClassroomAssignments(value: unknown): HomeClassroomAssignment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([instructorId, classroom]) => Boolean(instructorId) && isHomeClassroomOption(classroom))
  );
}

export function createDefaultHomeClassroomAssignments(instructorIds: string[]): HomeClassroomAssignment {
  return Object.fromEntries(
    instructorIds.map((id, index) => [id, HOME_CLASSROOM_OPTIONS[index % HOME_CLASSROOM_OPTIONS.length]])
  );
}

export function getHomeClassroomOccupancy(
  instructorIds: string[],
  assignments: HomeClassroomAssignment
): Map<string, string[]> {
  const occupancy = new Map<string, string[]>();
  for (const instructorId of instructorIds) {
    const classroom = assignments[instructorId];
    if (!classroom) continue;
    const instructors = occupancy.get(classroom) ?? [];
    instructors.push(instructorId);
    occupancy.set(classroom, instructors);
  }
  return occupancy;
}
