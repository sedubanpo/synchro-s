import type { Weekday } from "@/types/schedule";

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Invalid time format: ${time}`);
  }
  return h * 60 + m;
}

export function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  return timeToMinutes(startA) < timeToMinutes(endB) && timeToMinutes(endA) > timeToMinutes(startB);
}

export function addDays(dateISO: string, days: number): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function weekRange(weekStartISO: string): { weekStart: string; weekEnd: string } {
  return {
    weekStart: weekStartISO,
    weekEnd: addDays(weekStartISO, 6)
  };
}

export function dateToWeekday(dateISO: string): Weekday {
  const [year, month, day] = dateISO.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const jsDay = d.getUTCDay();
  return (jsDay === 0 ? 7 : jsDay) as Weekday;
}

export function toSqlTime(value: string): string {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error("Time must use HH:mm format");
  }
  return `${value}:00`;
}

export function fromSqlTime(value: string): string {
  if (!value) {
    return "00:00";
  }
  return value.slice(0, 5);
}
