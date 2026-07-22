import { TIME_SLOTS } from "@/lib/constants";
import type {
  InstructorAvailabilityDateOverrides,
  InstructorAvailabilityPlannedClass
} from "@/types/schedule";

const TIME_SLOT_SET = new Set(TIME_SLOTS);

function normalizeOverrideSlots(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("날짜별 가능 시간 형식이 올바르지 않습니다.");
  }
  const normalized = Array.from(
    new Set(
      value
        .map((slot) => (typeof slot === "string" ? slot.trim() : ""))
        .filter((slot) => TIME_SLOT_SET.has(slot))
    )
  ).sort((a, b) => a.localeCompare(b));
  if (normalized.length !== value.length) {
    throw new Error("가능 시간은 시간표의 정시 슬롯만 저장할 수 있습니다.");
  }
  return normalized;
}

function normalizePlannedClasses(value: unknown, allowedSlots: string[]): Record<string, InstructorAvailabilityPlannedClass> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("한시 일정의 학생 배치 형식이 올바르지 않습니다.");
  }

  const allowedSlotSet = new Set(allowedSlots);
  const normalized: Record<string, InstructorAvailabilityPlannedClass> = {};
  for (const [slot, rawClass] of Object.entries(value)) {
    if (!TIME_SLOT_SET.has(slot) || !allowedSlotSet.has(slot)) {
      throw new Error("학생 배치는 한시 적용된 가능 시간에만 저장할 수 있습니다.");
    }
    if (!rawClass || typeof rawClass !== "object" || Array.isArray(rawClass)) {
      throw new Error("한시 일정의 학생 배치 정보가 올바르지 않습니다.");
    }

    const plannedClass = rawClass as {
      slot?: unknown;
      classTypeCode?: unknown;
      classTypeLabel?: unknown;
      badgeText?: unknown;
      studentIds?: unknown;
      studentNames?: unknown;
    };
    const classTypeCode = typeof plannedClass.classTypeCode === "string" ? plannedClass.classTypeCode.trim() : "";
    const classTypeLabel = typeof plannedClass.classTypeLabel === "string" ? plannedClass.classTypeLabel.trim() : "";
    const badgeText = typeof plannedClass.badgeText === "string" ? plannedClass.badgeText.trim() : "";
    if (!classTypeCode || classTypeCode.length > 80 || !classTypeLabel || classTypeLabel.length > 40 || badgeText.length > 20) {
      throw new Error("한시 일정의 수업 유형 정보가 올바르지 않습니다.");
    }
    if (!Array.isArray(plannedClass.studentIds) || !Array.isArray(plannedClass.studentNames)) {
      throw new Error("한시 일정의 학생 명단 형식이 올바르지 않습니다.");
    }
    const studentIds = plannedClass.studentIds.map((studentId) => (typeof studentId === "string" ? studentId.trim() : ""));
    const studentNames = plannedClass.studentNames.map((studentName) => (typeof studentName === "string" ? studentName.trim() : ""));
    if (
      studentIds.length === 0 ||
      studentIds.length > 8 ||
      studentIds.length !== studentNames.length ||
      studentIds.some((studentId) => !studentId || studentId.length > 120) ||
      studentNames.some((studentName) => !studentName || studentName.length > 80) ||
      new Set(studentIds).size !== studentIds.length
    ) {
      throw new Error("한시 일정의 학생 명단을 확인해 주세요.");
    }

    normalized[slot] = {
      slot,
      classTypeCode,
      classTypeLabel,
      badgeText,
      studentIds,
      studentNames
    };
  }
  return normalized;
}

export function normalizeInstructorAvailabilityDateOverrides(
  value: unknown,
  monthStart: string
): InstructorAvailabilityDateOverrides {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("날짜별 변동 일정 형식이 올바르지 않습니다.");
  }

  const monthPrefix = monthStart.slice(0, 7);
  const normalized: InstructorAvailabilityDateOverrides = {};
  for (const [date, rawOverride] of Object.entries(value)) {
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !date.startsWith(`${monthPrefix}-`) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      throw new Error("날짜별 변동 일정은 선택한 달의 유효한 날짜만 저장할 수 있습니다.");
    }
    if (!rawOverride || typeof rawOverride !== "object" || Array.isArray(rawOverride)) {
      throw new Error("날짜별 변동 일정의 상태가 올바르지 않습니다.");
    }

    const override = rawOverride as { status?: unknown; slots?: unknown; note?: unknown; plannedClasses?: unknown };
    if (override.status !== "available" && override.status !== "temporary" && override.status !== "unavailable") {
      throw new Error("날짜별 상태는 변동 가능, 한시 적용 또는 수업 불가여야 합니다.");
    }
    const hasAvailableSlots = override.status === "available" || override.status === "temporary";
    const slots = hasAvailableSlots ? normalizeOverrideSlots(override.slots) : [];
    if (hasAvailableSlots && slots.length === 0) {
      throw new Error(`${override.status === "temporary" ? "한시 적용" : "변동 가능"} 일정에는 한 개 이상의 시간 슬롯이 필요합니다.`);
    }
    if (override.note != null && typeof override.note !== "string") {
      throw new Error("날짜별 메모는 문자로 입력해 주세요.");
    }
    const note = typeof override.note === "string" ? override.note.trim() : "";
    if (note.length > 120) throw new Error("날짜별 메모는 120자 이하로 입력해 주세요.");
    if (override.status !== "temporary" && override.plannedClasses != null) {
      if (typeof override.plannedClasses !== "object" || Array.isArray(override.plannedClasses)) {
        throw new Error("한시 일정의 학생 배치 형식이 올바르지 않습니다.");
      }
      if (Object.keys(override.plannedClasses).length > 0) {
        throw new Error("학생 배치는 한시 적용 일정에만 저장할 수 있습니다.");
      }
    }
    const plannedClasses = override.status === "temporary" ? normalizePlannedClasses(override.plannedClasses, slots) : {};
    normalized[date] = {
      status: override.status,
      slots,
      ...(note ? { note } : {}),
      ...(Object.keys(plannedClasses).length > 0 ? { plannedClasses } : {})
    };
  }
  return normalized;
}
