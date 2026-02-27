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

export const TIME_SLOTS = Array.from({ length: 12 }, (_, idx) => {
  const hour = idx + 10;
  return `${String(hour).padStart(2, "0")}:00`;
});

export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE ?? "Asia/Seoul";
