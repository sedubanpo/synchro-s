import type { ClassTypeOption } from "@/types/schedule";

const FALLBACK_CLASS_TYPES: ClassTypeOption[] = [
  { code: "ONE_TO_ONE", label: "1:1", badgeText: "[1:1]", maxStudents: 1 },
  { code: "TWO_TO_ONE", label: "2:1", badgeText: "[2:1]", maxStudents: 2 },
  { code: "THREE_TO_ONE", label: "3:1", badgeText: "[3:1]", maxStudents: 3 },
  { code: "REGULAR_MULTI", label: "개별정규", badgeText: "[개별정규]", maxStudents: 8 }
];

function normalizeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9가-힣]/g, "").toLowerCase();
}

export function planningClassTypeTone(code: string, label: string): "one" | "two" | "three" | "regular" {
  const token = normalizeToken(`${code} ${label}`);
  if (token.includes("threetoone") || token.includes("31") || token.includes("3대1")) return "three";
  if (token.includes("twotoone") || token.includes("21") || token.includes("2대1")) return "two";
  if (token.includes("onetoone") || token.includes("11") || token.includes("1대1")) return "one";
  return "regular";
}

export function resolvePlanningClassTypes(classTypes: ClassTypeOption[]): ClassTypeOption[] {
  return FALLBACK_CLASS_TYPES.map((fallback) => {
    const fallbackTone = planningClassTypeTone(fallback.code, fallback.label);
    return classTypes.find((item) => planningClassTypeTone(item.code, item.label) === fallbackTone) ?? fallback;
  });
}
