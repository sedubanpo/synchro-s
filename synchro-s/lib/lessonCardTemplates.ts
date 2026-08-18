import { instructorMatchesSubject } from "@/lib/instructorSubjectMatching";
import { timeToMinutes } from "@/lib/time";
import type { ClassTypeOption, ScheduleEvent, SelectOption, SubjectOption } from "@/types/schedule";

export type LessonCardTemplate = {
  key: string;
  instructorId: string;
  instructorName: string;
  subjectCode: string;
  subjectName: string;
  classTypeCode: string;
  classTypeLabel: string;
  badgeText: string;
  durationMinutes: number;
  usageCount: number;
  source: "preset" | "timetable";
  maxStudents?: number;
  classTypeMemo?: string;
};

function normalize(value: string): string {
  return value.replace(/[^0-9a-z가-힣:]/gi, "").toLowerCase();
}

function isSelfStudyType(type: Pick<ClassTypeOption, "code" | "label">): boolean {
  const token = normalize(`${type.code} ${type.label}`);
  return token.includes("selfstudy") || token.includes("자기주도") || token.includes("자습");
}

function templateKey(instructorId: string, subjectCode: string, classTypeCode: string): string {
  return `${instructorId}::${subjectCode}::${classTypeCode}`;
}

export function buildLessonCardTemplates(input: {
  instructors: SelectOption[];
  subjects: SubjectOption[];
  classTypes: ClassTypeOption[];
  events: ScheduleEvent[];
}): LessonCardTemplate[] {
  const instructors = input.instructors.filter((item) => item.isActive !== false);
  const classTypes = input.classTypes.filter((item) => !isSelfStudyType(item));
  const instructorById = new Map(instructors.map((item) => [item.id, item]));
  const subjectByCode = new Map(input.subjects.map((item) => [item.code, item]));
  const classTypeByCode = new Map(classTypes.map((item) => [item.code, item]));
  const usageByKey = new Map<string, number>();

  for (const event of input.events) {
    if (!instructorById.has(event.instructorId) || !subjectByCode.has(event.subjectCode) || !classTypeByCode.has(event.classTypeCode)) continue;
    const key = templateKey(event.instructorId, event.subjectCode, event.classTypeCode);
    usageByKey.set(key, (usageByKey.get(key) ?? 0) + 1);
  }

  const templates: LessonCardTemplate[] = [];
  for (const instructor of instructors) {
    for (const subject of input.subjects) {
      if (!instructorMatchesSubject(instructor, subject.label)) continue;
      for (const classType of classTypes) {
        const key = templateKey(instructor.id, subject.code, classType.code);
        templates.push({
          key,
          instructorId: instructor.id,
          instructorName: instructor.name,
          subjectCode: subject.code,
          subjectName: subject.label,
          classTypeCode: classType.code,
          classTypeLabel: classType.label,
          badgeText: classType.badgeText,
          durationMinutes: 60,
          usageCount: usageByKey.get(key) ?? 0,
          source: "preset",
          maxStudents: classType.maxStudents,
          classTypeMemo: classType.memo
        });
      }
    }
  }

  return templates.sort((a, b) => {
    if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
    const subjectDiff = a.subjectName.localeCompare(b.subjectName, "ko");
    if (subjectDiff !== 0) return subjectDiff;
    const instructorDiff = a.instructorName.localeCompare(b.instructorName, "ko");
    if (instructorDiff !== 0) return instructorDiff;
    return a.classTypeLabel.localeCompare(b.classTypeLabel, "ko");
  });
}

export function createLessonCardTemplateFromEvent(event: ScheduleEvent): LessonCardTemplate | null {
  const durationMinutes = timeToMinutes(event.endTime) - timeToMinutes(event.startTime);
  if (!event.instructorId || !event.subjectCode || !event.classTypeCode || durationMinutes <= 0) return null;

  return {
    key: `timetable::${event.id}::${event.classDate}::${event.startTime}`,
    instructorId: event.instructorId,
    instructorName: event.instructorName,
    subjectCode: event.subjectCode,
    subjectName: event.subjectName,
    classTypeCode: event.classTypeCode,
    classTypeLabel: event.classTypeLabel,
    badgeText: event.badgeText,
    durationMinutes,
    usageCount: 0,
    source: "timetable"
  };
}

export function filterLessonCardTemplates(templates: LessonCardTemplate[], query: string): LessonCardTemplate[] {
  const token = normalize(query);
  if (!token) return templates;
  return templates.filter((template) =>
    normalize(`${template.instructorName} ${template.subjectName} ${template.classTypeLabel} ${template.badgeText}`).includes(token)
  );
}
