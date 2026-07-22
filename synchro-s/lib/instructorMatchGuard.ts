import { normalizeInstructorAlias } from "@/lib/notionScheduleParser";

export function normalizeInstructorMatchName(value: string): string {
  return normalizeInstructorAlias(value).replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
}

export function isInstructorSourceMatch(sourceName: string, savedName: string): boolean {
  const normalizedSourceName = normalizeInstructorMatchName(sourceName);
  const normalizedSavedName = normalizeInstructorMatchName(savedName);
  return Boolean(normalizedSourceName && normalizedSourceName === normalizedSavedName);
}
