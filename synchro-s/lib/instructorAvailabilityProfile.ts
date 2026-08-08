import { DAYS } from "@/lib/constants";
import type {
  AvailableTimeSlotsByDay,
  InstructorAvailabilityDateOverrides,
  Weekday
} from "@/types/schedule";

export type InstructorAvailabilityDaySummary = {
  availableDays: Weekday[];
  unavailableDays: Weekday[];
  selectedHours: number;
};

export function summarizeInstructorAvailabilityDays(
  slotsByDay: AvailableTimeSlotsByDay
): InstructorAvailabilityDaySummary {
  const availableDays: Weekday[] = [];
  const unavailableDays: Weekday[] = [];
  let selectedHours = 0;

  for (const day of DAYS) {
    const slots = slotsByDay[day.key] ?? [];
    selectedHours += slots.length;

    if (slots.length > 0) availableDays.push(day.key);
    else unavailableDays.push(day.key);
  }

  return { availableDays, unavailableDays, selectedHours };
}

export function formatAvailabilityWeekdays(days: Weekday[]): string {
  if (days.length === 0) return "없음";
  return DAYS.filter((day) => days.includes(day.key))
    .map((day) => day.label)
    .join(" · ");
}

export function formatInstructorTeacherName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "강사";
  return /T$/i.test(trimmed) ? trimmed : `${trimmed}T`;
}

export function findIncompleteInstructorAvailabilityDate(
  dateOverrides: InstructorAvailabilityDateOverrides
): string | null {
  return (
    Object.entries(dateOverrides).find(
      ([, override]) =>
        (override.status === "available" || override.status === "temporary") && override.slots.length === 0
    )?.[0] ?? null
  );
}
