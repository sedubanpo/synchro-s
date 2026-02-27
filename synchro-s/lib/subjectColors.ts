const SUBJECT_COLOR_MAP: Record<string, string> = {
  MATH: "bg-blue-500",
  ENGLISH: "bg-purple-500",
  SOCIAL: "bg-amber-500"
};

function normalizeCode(subjectCode: string): string {
  return (subjectCode || "").trim().toUpperCase();
}

function normalizeName(subjectName?: string): string {
  return (subjectName || "").replace(/\s+/g, "").toLowerCase().trim();
}

function sanitizeColorClass(code: string, inputClass: string): string {
  const value = (inputClass || "").trim();
  if (!value) {
    return code === "SOCIAL" ? "bg-amber-500" : "bg-slate-500";
  }

  // 과목색으로 투명 클래스가 내려오면 카드가 안 보이므로 불투명 기본색으로 보정한다.
  if (!value.startsWith("bg-") || value.includes("transparent")) {
    return code === "SOCIAL" ? "bg-amber-500" : "bg-slate-500";
  }

  // SOCIAL은 /alpha 클래스도 강제로 선명 앰버로 보정한다.
  if (code === "SOCIAL" && value.includes("/")) return "bg-amber-500";

  return value;
}

export function getSubjectColorClass(subjectCode: string, subjectName?: string): string {
  const code = normalizeCode(subjectCode);
  const name = normalizeName(subjectName);
  const looksLikeSocial =
    code === "SOCIAL" ||
    code.includes("SOCIAL") ||
    name.includes("사회") ||
    name.includes("사탐");
  const resolvedCode = looksLikeSocial ? "SOCIAL" : code;
  return sanitizeColorClass(resolvedCode, SUBJECT_COLOR_MAP[code] ?? SUBJECT_COLOR_MAP[resolvedCode] ?? "bg-slate-500");
}

export function setSubjectColor(subjectCode: string, tailwindClass: string): void {
  const code = normalizeCode(subjectCode);
  SUBJECT_COLOR_MAP[code] = sanitizeColorClass(code, tailwindClass);
}
