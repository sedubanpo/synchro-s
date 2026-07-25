import { timeToMinutes } from "@/lib/time";

type TimeRange = {
  startTime: string;
  endTime: string;
};

export function getOverlappingHourSlots(event: TimeRange, timeSlots: string[]): string[] {
  const start = timeToMinutes(event.startTime);
  const end = timeToMinutes(event.endTime);

  if (end <= start) return [];

  return timeSlots.filter((slot) => {
    const slotStart = timeToMinutes(slot);
    const slotEnd = slotStart + 60;
    return start < slotEnd && end > slotStart;
  });
}
