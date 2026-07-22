import type { StudentAvailabilitySlot } from "@/types/schedule";

export type StudentAvailabilityPaintMode = "available" | "unavailable" | "clear";

export function nextStudentAvailabilitySlot(
  current: StudentAvailabilitySlot | undefined,
  mode: StudentAvailabilityPaintMode
): StudentAvailabilitySlot | null {
  if (mode === "clear" || current?.status === mode) return null;
  const note = current?.note ?? current?.reason;
  return {
    status: mode,
    ...(note ? { note } : {})
  };
}
