import type { SelectOption } from "@/types/schedule";

export type InstructorSubjectFamily = "korean" | "math" | "english" | "science" | "social" | "other";

export function normalizeInstructorToken(value: string): string {
  return value.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
}

function subjectFamily(value: string): InstructorSubjectFamily {
  const token = normalizeInstructorToken(value);
  if (!token) return "other";
  if (token.includes("국어") || token.includes("korean")) return "korean";
  if (token.includes("수학") || token.includes("math")) return "math";
  if (token.includes("영어") || token.includes("english") || token === "eng") return "english";
  if (
    ["과학", "통과", "물리", "생명", "생물", "화학", "지구", "science", "physics", "biology", "chemistry"].some(
      (alias) => token.includes(alias)
    )
  ) {
    return "science";
  }
  if (
    ["사회", "사탐", "사문", "사회문화", "세지", "세계지리", "생윤", "생활과윤리", "통사", "통합사회", "social"].some(
      (alias) => token.includes(alias)
    )
  ) {
    return "social";
  }
  return "other";
}

export function getInstructorSubjectFamily(instructor: Pick<SelectOption, "name" | "secondary">): InstructorSubjectFamily {
  if (normalizeInstructorToken(instructor.name) === "안준성") return "math";
  return subjectFamily(instructor.secondary ?? "");
}

export function getInstructorSubjectLabel(instructor: Pick<SelectOption, "name" | "secondary">): string {
  const family = getInstructorSubjectFamily(instructor);
  const labels: Record<InstructorSubjectFamily, string> = {
    korean: "국어",
    math: "수학",
    english: "영어",
    science: "과학",
    social: "사회",
    other: "기타"
  };
  return labels[family];
}

export function instructorMatchesSubject(
  instructor: Pick<SelectOption, "name" | "secondary">,
  subjectLabel: string
): boolean {
  const requestedFamily = subjectFamily(subjectLabel);
  if (requestedFamily !== "other") return getInstructorSubjectFamily(instructor) === requestedFamily;

  const query = normalizeInstructorToken(subjectLabel);
  const secondary = normalizeInstructorToken(instructor.secondary ?? "");
  return Boolean(query && secondary && (secondary.includes(query) || query.includes(secondary)));
}

export function findInstructorByTypedName<T extends Pick<SelectOption, "name">>(instructors: T[], rawName: string): T | null {
  const query = normalizeInstructorToken(rawName);
  if (!query) return null;

  const exact = instructors.find((instructor) => normalizeInstructorToken(instructor.name) === query);
  if (exact) return exact;

  const partial = instructors.filter((instructor) => normalizeInstructorToken(instructor.name).includes(query));
  return partial.length === 1 ? partial[0]! : null;
}
