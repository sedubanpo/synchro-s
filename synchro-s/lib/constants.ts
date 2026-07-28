import type { Weekday } from "@/types/schedule";

export const DAYS: { key: Weekday; label: string }[] = [
  { key: 1, label: "월" },
  { key: 2, label: "화" },
  { key: 3, label: "수" },
  { key: 4, label: "목" },
  { key: 5, label: "금" },
  { key: 6, label: "토" },
  { key: 7, label: "일" }
];

// The grid represents each hour-long interval from 08:00 through midnight.
// Keeping 24:00 as the end boundary lets a 23:00 class render in its own row.
export const TIME_SLOTS = Array.from({ length: 16 }, (_, idx) => {
  const hour = idx + 8;
  return `${String(hour).padStart(2, "0")}:00`;
});

export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE ?? "Asia/Seoul";
