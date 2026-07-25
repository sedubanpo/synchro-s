import type {
  StudentAvailabilityByDay,
  StudentAvailabilityDateOverrides,
  StudentAvailabilitySlot,
  Weekday
} from "@/types/schedule";

export type StudentAvailabilityComparisonCell = {
  status: StudentAvailabilitySlot["status"] | "unset";
  source: "weekly" | "temporary" | "date-unavailable" | "unset";
  note?: string;
};

export function availabilityWeekdayForDate(date: string): Weekday {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
}

export function studentAvailabilityComparisonCell(
  weeklyAvailability: StudentAvailabilityByDay,
  dateOverrides: StudentAvailabilityDateOverrides,
  date: string,
  slot: string
): StudentAvailabilityComparisonCell {
  const override = dateOverrides[date];
  if (override?.status === "unavailable") {
    return {
      status: "unavailable",
      source: "date-unavailable",
      ...(override.note ? { note: override.note } : {})
    };
  }
  if (override?.status === "temporary") {
    return override.slots.includes(slot)
      ? {
          status: "available",
          source: "temporary",
          ...(override.note ? { note: override.note } : {})
        }
      : { status: "unset", source: "temporary" };
  }

  const weekly = weeklyAvailability[availabilityWeekdayForDate(date)]?.[slot];
  if (!weekly) return { status: "unset", source: "unset" };
  const note = weekly.note ?? weekly.reason;
  return {
    status: weekly.status,
    source: "weekly",
    ...(note ? { note } : {})
  };
}
