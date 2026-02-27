const SUBJECT_COLOR_MAP: Record<string, string> = {
  MATH: "bg-blue-500",
  ENGLISH: "bg-purple-500",
  SOCIAL: "bg-amber-500"
};

function normalizeCode(subjectCode: string): string {
  return (subjectCode || "").trim().toUpperCase();
}

function sanitizeColorClass(code: string, inputClass: string): string {
  const value = (inputClass || "").trim();
  if (!value) {
    return code === "SOCIAL" ? "bg-amber-500" : "bg-slate-500";
  }

  // SOCIAL은 투명/저불투명 색이 들어오면 강제로 선명한 앰버 색을 유지한다.
  if (code === "SOCIAL") {
    if (!value.startsWith("bg-") || value.includes("/") || value.includes("transparent")) {
      return "bg-amber-500";
    }
    return value;
  }

  return value;
}

export function getSubjectColorClass(subjectCode: string): string {
  const code = normalizeCode(subjectCode);
  return sanitizeColorClass(code, SUBJECT_COLOR_MAP[code] ?? "bg-slate-500");
}

export function setSubjectColor(subjectCode: string, tailwindClass: string): void {
  const code = normalizeCode(subjectCode);
  SUBJECT_COLOR_MAP[code] = sanitizeColorClass(code, tailwindClass);
}
