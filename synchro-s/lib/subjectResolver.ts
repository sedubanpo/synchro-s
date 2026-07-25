import type { SubjectOption } from "@/types/schedule";

export function normalizeSubjectToken(value: string): string {
  return value.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase().trim();
}

const SPECIFIC_SUBJECT_ALIASES: Record<string, string[]> = {
  SOCIAL2: ["사문", "사회문화"],
  SOCIAL: ["세지", "세계지리"],
  SOCIAL3: ["생윤", "생활과윤리"],
  SOCIAL4: ["윤리", "윤리와사상"],
  SOCIAL5: ["한국사"],
  SOCIAL6: ["경제"],
  SOCIAL7: ["지리"],
  SOCIAL8: ["통사", "통합사회"],
  SCIENCE2: ["물리"],
  SCIENCE3: ["생물"],
  SCIENCE5: ["화학"],
  SCIENCE6: ["생명", "생명과학"],
  SCIENCE7: ["통과", "통합과학"]
};

const GENERAL_SUBJECT_ALIASES: Record<string, string[]> = {
  MATH: ["수학", "math"],
  ENGLISH: ["영어", "english", "eng"],
  KOREAN: ["국어", "korean"],
  SCIENCE: ["과학", "science"],
  SOCIAL: ["사회", "사탐", "social"]
};

export function resolveSubjectOption<T extends SubjectOption>(subjects: T[], rawLabel: string): T | undefined {
  const target = normalizeSubjectToken(rawLabel);
  if (!target) return undefined;

  const direct =
    subjects.find((entry) => normalizeSubjectToken(entry.label) === target) ??
    subjects.find((entry) => normalizeSubjectToken(entry.code) === target);
  if (direct) return direct;

  for (const [code, aliases] of Object.entries(SPECIFIC_SUBJECT_ALIASES)) {
    if (!aliases.some((alias) => target === normalizeSubjectToken(alias))) continue;
    const mapped = subjects.find((entry) => normalizeSubjectToken(entry.code) === normalizeSubjectToken(code));
    if (mapped) return mapped;
  }

  for (const [code, aliases] of Object.entries(GENERAL_SUBJECT_ALIASES)) {
    if (!aliases.some((alias) => target.includes(normalizeSubjectToken(alias)))) continue;
    const mapped =
      subjects.find((entry) => normalizeSubjectToken(entry.code) === normalizeSubjectToken(code)) ??
      subjects.find((entry) => aliases.some((alias) => normalizeSubjectToken(entry.label).includes(normalizeSubjectToken(alias))));
    if (mapped) return mapped;
  }

  return (
    subjects.find((entry) => {
      const label = normalizeSubjectToken(entry.label);
      return label.length >= 2 && (label.includes(target) || target.includes(label));
    }) ??
    subjects.find((entry) => {
      const code = normalizeSubjectToken(entry.code);
      return code.length >= 2 && (code.includes(target) || target.includes(code));
    })
  );
}
