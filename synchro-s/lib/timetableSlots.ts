import { timeToMinutes } from "@/lib/time";

type TimeRange = {
  startTime: string;
  endTime: string;
};

export function formatTimeSlotRange(startTime: string): string {
  const [hour, minute] = startTime.split(":").map(Number);
  const nextHour = hour + 1;
  if (minute === 0) {
    return `${hour}-${nextHour}시`;
  }
  const paddedMinute = String(minute).padStart(2, "0");
  return `${hour}:${paddedMinute}-${nextHour}:${paddedMinute}`;
}

export function getVisibleTimeSlots(timeSlots: string[], hiddenTimeSlots: readonly string[]): string[] {
  if (hiddenTimeSlots.length === 0) return [...timeSlots];
  const hiddenSet = new Set(hiddenTimeSlots);
  return timeSlots.filter((slot) => !hiddenSet.has(slot));
}

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
