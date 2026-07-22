import { TIME_SLOTS } from "@/lib/constants";
import type {
  StudentAvailabilityByDay,
  StudentAvailabilityDateOverrides,
  StudentAvailabilitySlot,
  Weekday
} from "@/types/schedule";

const TIME_SLOT_SET = new Set(TIME_SLOTS);

function normalizeNote(value: unknown, label: string, maxLength = 160): string {
  if (value == null) return "";
  if (typeof value !== "string") throw new Error(`${label}은 문자로 입력해 주세요.`);
  const note = value.trim();
  if (note.length > maxLength) throw new Error(`${label}은 ${maxLength}자 이하로 입력해 주세요.`);
  return note;
}

function normalizeSlot(value: unknown): string {
  const slot = typeof value === "string" ? value.trim() : "";
  if (!TIME_SLOT_SET.has(slot)) throw new Error("가능 일정은 시간표의 정시 슬롯만 저장할 수 있습니다.");
  return slot;
}

function normalizeWeeklySlot(value: unknown): StudentAvailabilitySlot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("학생 가능 일정의 시간별 상태가 올바르지 않습니다.");
  }
  const raw = value as { status?: unknown; note?: unknown; reason?: unknown };
  if (raw.status !== "available" && raw.status !== "unavailable") {
    throw new Error("시간별 상태는 수업 가능 또는 수업 불가여야 합니다.");
  }
  const note = normalizeNote(raw.note ?? raw.reason, "시간별 가능 일정 메모");
  return {
    status: raw.status,
    ...(note ? { note } : {})
  };
}

export function normalizeStudentAvailabilityByDay(value: unknown): StudentAvailabilityByDay {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("학생 기본 가능 일정 형식이 올바르지 않습니다.");
  }

  const result: StudentAvailabilityByDay = {};
  for (const [rawWeekday, rawSlots] of Object.entries(value)) {
    const weekday = Number(rawWeekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !rawSlots || typeof rawSlots !== "object" || Array.isArray(rawSlots)) {
      throw new Error("기본 가능 일정은 월요일(1)부터 일요일(7)까지 저장해야 합니다.");
    }
    const slots: Partial<Record<string, StudentAvailabilitySlot>> = {};
    for (const [rawSlot, rawValue] of Object.entries(rawSlots)) {
      slots[normalizeSlot(rawSlot)] = normalizeWeeklySlot(rawValue);
    }
    if (Object.keys(slots).length > 0) result[weekday as Weekday] = slots;
  }
  return result;
}

export function normalizeStudentAvailabilityDateOverrides(
  value: unknown,
  monthStart: string
): StudentAvailabilityDateOverrides {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("학생 날짜별 가능 일정 형식이 올바르지 않습니다.");
  }

  const result: StudentAvailabilityDateOverrides = {};
  const monthPrefix = monthStart.slice(0, 7);
  for (const [date, rawValue] of Object.entries(value)) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !date.startsWith(`${monthPrefix}-`) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      throw new Error("날짜별 일정은 선택한 달의 유효한 날짜만 저장할 수 있습니다.");
    }
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
      throw new Error("날짜별 일정 상태가 올바르지 않습니다.");
    }
    const raw = rawValue as { status?: unknown; slots?: unknown; note?: unknown };
    if (raw.status !== "temporary" && raw.status !== "unavailable") {
      throw new Error("날짜별 상태는 한시 적용 또는 수업 불가여야 합니다.");
    }
    const note = normalizeNote(raw.note, raw.status === "unavailable" ? "수업 불가 사유" : "일자 메모");
    const slots =
      raw.status === "temporary"
        ? Array.from(new Set((Array.isArray(raw.slots) ? raw.slots : []).map(normalizeSlot))).sort((a, b) => a.localeCompare(b))
        : [];
    if (raw.status === "temporary" && slots.length === 0) {
      throw new Error("한시 적용 일정에는 한 개 이상의 가능 시간이 필요합니다.");
    }
    result[date] = { status: raw.status, slots, ...(note ? { note } : {}) };
  }
  return result;
}
