import { DAYS, TIME_SLOTS } from "@/lib/constants";
import { timeToMinutes } from "@/lib/time";
import type { Weekday } from "@/types/schedule";

export const CANONICAL_TIMETABLE_WEEKDAYS = DAYS.map((day) => day.key) as readonly Weekday[];
export const CANONICAL_TIMETABLE_TIME_SLOTS = TIME_SLOTS as readonly string[];

export type TimetableRangeCell = {
  weekday: Weekday;
  startTime: string;
};

export type TimetableRangeSourceEvent = {
  weekday: Weekday;
  startTime: string;
  endTime: string;
};

export type TimetableRangeClipboardItem<TTemplate, TSourceEvent extends TimetableRangeSourceEvent> = {
  columnOffset: number;
  rowOffset: number;
  durationMinutes: number;
  template: TTemplate;
  sourceEvent: TSourceEvent;
};

export type TimetableRangeClipboard<TTemplate, TSourceEvent extends TimetableRangeSourceEvent> = {
  sourceAnchor: TimetableRangeCell;
  items: TimetableRangeClipboardItem<TTemplate, TSourceEvent>[];
  rowCount: number;
  columnCount: number;
};

export type TranslatedTimetableRangeItem<TTemplate, TSourceEvent extends TimetableRangeSourceEvent> = {
  weekday: Weekday;
  startTime: string;
  endTime: string;
  template: TTemplate;
  sourceEvent: TSourceEvent;
};

type CopyableRangeEvent<TTemplate, TSourceEvent extends TimetableRangeSourceEvent> = {
  dayIndex: number;
  slotIndex: number;
  durationMinutes: number;
  template: TTemplate;
  sourceEvent: TSourceEvent;
};

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function canonicalSlotIndexForTime(time: string): number {
  let minutes: number;
  try {
    minutes = timeToMinutes(time);
  } catch {
    return -1;
  }

  return CANONICAL_TIMETABLE_TIME_SLOTS.findIndex((slot) => {
    const slotStart = timeToMinutes(slot);
    return minutes >= slotStart && minutes < slotStart + 60;
  });
}

function canonicalEndBoundary(): number {
  const finalSlot = CANONICAL_TIMETABLE_TIME_SLOTS.at(-1);
  return finalSlot ? timeToMinutes(finalSlot) + 60 : 0;
}

/**
 * Builds a clipboard from the copyable events inside a grid selection.
 *
 * Offsets are anchored to the minimum occupied event day and slot instead of
 * the dragged rectangle's top-left cell. That means decorative/blank leading
 * rows and columns never shift a paste destination, while gaps between actual
 * lessons remain intact.
 */
export function createTimetableRangeClipboard<
  TSourceEvent extends TimetableRangeSourceEvent,
  TTemplate
>(input: {
  cells: readonly TimetableRangeCell[];
  events: readonly TSourceEvent[];
  createTemplate: (event: TSourceEvent) => TTemplate | null;
}): TimetableRangeClipboard<TTemplate, TSourceEvent> | null {
  const selectedCellKeys = new Set(
    input.cells.map((cell) => `${cell.weekday}-${cell.startTime}`)
  );
  const endBoundary = canonicalEndBoundary();
  const copyableEvents: CopyableRangeEvent<TTemplate, TSourceEvent>[] = [];

  for (const sourceEvent of input.events) {
    const dayIndex = CANONICAL_TIMETABLE_WEEKDAYS.indexOf(sourceEvent.weekday);
    const slotIndex = canonicalSlotIndexForTime(sourceEvent.startTime);
    if (dayIndex < 0 || slotIndex < 0) continue;

    const sourceSlot = CANONICAL_TIMETABLE_TIME_SLOTS[slotIndex];
    if (!selectedCellKeys.has(`${sourceEvent.weekday}-${sourceSlot}`)) continue;

    let durationMinutes: number;
    try {
      durationMinutes = timeToMinutes(sourceEvent.endTime) - timeToMinutes(sourceEvent.startTime);
    } catch {
      continue;
    }
    if (durationMinutes <= 0 || timeToMinutes(sourceEvent.endTime) > endBoundary) continue;

    const template = input.createTemplate(sourceEvent);
    if (template === null) continue;

    copyableEvents.push({ dayIndex, slotIndex, durationMinutes, template, sourceEvent });
  }

  if (copyableEvents.length === 0) return null;

  const anchorDayIndex = Math.min(...copyableEvents.map((item) => item.dayIndex));
  const anchorSlotIndex = Math.min(...copyableEvents.map((item) => item.slotIndex));
  const sourceAnchor = {
    weekday: CANONICAL_TIMETABLE_WEEKDAYS[anchorDayIndex],
    startTime: CANONICAL_TIMETABLE_TIME_SLOTS[anchorSlotIndex]
  } satisfies TimetableRangeCell;

  const items = copyableEvents
    .map((item) => ({
      columnOffset: item.dayIndex - anchorDayIndex,
      rowOffset: item.slotIndex - anchorSlotIndex,
      durationMinutes: item.durationMinutes,
      template: item.template,
      sourceEvent: item.sourceEvent
    }))
    .sort((left, right) => left.columnOffset - right.columnOffset || left.rowOffset - right.rowOffset);

  const columnCount = Math.max(...items.map((item) => item.columnOffset)) + 1;
  const rowCount = Math.max(
    ...items.map((item) => item.rowOffset + Math.max(1, Math.ceil(item.durationMinutes / 60)))
  );

  return { sourceAnchor, items, rowCount, columnCount };
}

/**
 * Translates every clipboard item relative to a destination cell.
 * Returns null without any partial placements when one item would leave the
 * canonical Monday-Sunday / 08:00-24:00 timetable bounds.
 */
export function translateTimetableRangeClipboard<
  TTemplate,
  TSourceEvent extends TimetableRangeSourceEvent
>(
  clipboard: TimetableRangeClipboard<TTemplate, TSourceEvent>,
  target: TimetableRangeCell
): TranslatedTimetableRangeItem<TTemplate, TSourceEvent>[] | null {
  const targetDayIndex = CANONICAL_TIMETABLE_WEEKDAYS.indexOf(target.weekday);
  const targetSlotIndex = CANONICAL_TIMETABLE_TIME_SLOTS.indexOf(target.startTime);
  if (targetDayIndex < 0 || targetSlotIndex < 0) return null;

  const endBoundary = canonicalEndBoundary();
  const translated: TranslatedTimetableRangeItem<TTemplate, TSourceEvent>[] = [];

  for (const item of clipboard.items) {
    const dayIndex = targetDayIndex + item.columnOffset;
    const slotIndex = targetSlotIndex + item.rowOffset;
    const weekday = CANONICAL_TIMETABLE_WEEKDAYS[dayIndex];
    const startTime = CANONICAL_TIMETABLE_TIME_SLOTS[slotIndex];
    if (!weekday || !startTime) return null;

    const endMinutes = timeToMinutes(startTime) + item.durationMinutes;
    if (item.durationMinutes <= 0 || endMinutes > endBoundary) return null;

    translated.push({
      weekday,
      startTime,
      endTime: formatMinutes(endMinutes),
      template: item.template,
      sourceEvent: item.sourceEvent
    });
  }

  return translated;
}
