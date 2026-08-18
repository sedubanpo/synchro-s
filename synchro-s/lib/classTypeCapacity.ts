import type { ClassTypeOption } from "@/types/schedule";

export function getClassTypeCapacityConflictReason(
  classType: Pick<ClassTypeOption, "label" | "maxStudents">,
  existingStudentCount: number,
  incomingStudentCount: number
): string | null {
  if (existingStudentCount + incomingStudentCount <= classType.maxStudents) return null;
  return `${classType.label} 수업 정원 ${classType.maxStudents}명을 초과합니다.`;
}
