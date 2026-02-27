const SUBJECT_COLOR_MAP: Record<string, string> = {
  MATH: "bg-blue-500",
  ENGLISH: "bg-purple-500"
};

export function getSubjectColorClass(subjectCode: string): string {
  return SUBJECT_COLOR_MAP[subjectCode] ?? "bg-slate-500";
}

export function setSubjectColor(subjectCode: string, tailwindClass: string): void {
  SUBJECT_COLOR_MAP[subjectCode] = tailwindClass;
}
