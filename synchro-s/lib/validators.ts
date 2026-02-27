import type { CreateScheduleRequest, Weekday } from "@/types/schedule";
import { timeToMinutes } from "@/lib/time";

export function isWeekday(value: unknown): value is Weekday {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 7;
}

export function validateSchedulePayload(input: CreateScheduleRequest): string[] {
  const errors: string[] = [];

  if (!input.instructorId) errors.push("instructorId is required");
  if (!Array.isArray(input.studentIds) || input.studentIds.length === 0) {
    errors.push("studentIds must contain at least one student");
  }
  if (!input.subjectCode) errors.push("subjectCode is required");
  if (!input.classTypeCode) errors.push("classTypeCode is required");
  if (!input.note || input.note.trim().length === 0) errors.push("note is required");
  if (!input.startTime || !input.endTime) errors.push("startTime and endTime are required");

  if (input.startTime && input.endTime) {
    try {
      if (timeToMinutes(input.startTime) >= timeToMinutes(input.endTime)) {
        errors.push("endTime must be later than startTime");
      }
    } catch {
      errors.push("Invalid time format");
    }
  }

  if (input.scheduleMode === "recurring") {
    if (!isWeekday(input.weekday)) {
      errors.push("weekday must be 1..7 for recurring mode");
    }
  }

  if (input.scheduleMode === "one_off") {
    if (!input.classDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.classDate)) {
      errors.push("classDate (YYYY-MM-DD) is required for one_off mode");
    }
  }

  return errors;
}
