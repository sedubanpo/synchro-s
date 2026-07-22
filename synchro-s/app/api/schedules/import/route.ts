import { errorMessage, jsonError } from "@/lib/http";
import { isInstructorSourceMatch } from "@/lib/instructorMatchGuard";
import { normalizeInstructorAlias } from "@/lib/notionScheduleParser";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { insertSaveHistory } from "@/lib/server/saveHistory";
import { importScheduleRow, INSTRUCTOR_DAY_OFF_MESSAGE } from "@/lib/server/scheduleService";
import type { CreateScheduleRequest } from "@/types/schedule";
import { NextResponse } from "next/server";

type ImportBatchRequest = {
  items: CreateScheduleRequest[];
  targetType?: "학생" | "강사";
  targetName?: string;
};

type IndexedImportItem = {
  index: number;
  item: CreateScheduleRequest;
};

type ImportResult = Awaited<ReturnType<typeof importScheduleRow>>;

const IMPORT_LANE_CONCURRENCY = 8;

async function assertSourceInstructorsMatch(
  supabase: Parameters<typeof importScheduleRow>[0],
  items: CreateScheduleRequest[]
): Promise<void> {
  const guardedItems = items.filter((item) => item.sourceInstructorName?.trim());
  if (guardedItems.length === 0) return;

  const instructorIds = Array.from(new Set(guardedItems.map((item) => item.instructorId).filter(Boolean)));
  const { data, error } = await supabase
    .from("instructors")
    .select("id,instructor_name")
    .in("id", instructorIds);
  if (error) throw error;

  const instructorNameById = new Map<string, string>(
    (data ?? []).map((row: { id: string; instructor_name: string }) => [row.id, row.instructor_name] as [string, string])
  );

  for (const item of guardedItems) {
    const sourceName = normalizeInstructorAlias(item.sourceInstructorName ?? "");
    const savedName = instructorNameById.get(item.instructorId) ?? "";
    if (isInstructorSourceMatch(sourceName, savedName)) continue;

    const slot = item.scheduleMode === "recurring" ? `${item.weekday ?? "?"}요일` : item.classDate ?? "날짜 미지정";
    const rawText = item.sourceRawText?.trim() || "원문 없음";
    throw new Error(
      `강사 매칭 불일치: 원문 '${rawText}'의 강사 '${sourceName || "인식 실패"}'를 '${savedName || "강사 미지정"}'로 저장할 수 없습니다. (${slot} ${item.startTime}-${item.endTime})`
    );
  }
}

function isImportBatchRequest(payload: unknown): payload is ImportBatchRequest {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  return Array.isArray((payload as { items?: unknown }).items);
}

function importLaneKey(item: CreateScheduleRequest): string {
  const scheduleKey = item.scheduleMode === "recurring" ? `weekday:${item.weekday ?? ""}` : `date:${item.classDate ?? ""}`;
  return `${item.instructorId}:${scheduleKey}`;
}

function timeToMinutes(value: string): number | null {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

function splitIntoConflictLanes(items: IndexedImportItem[]): IndexedImportItem[][] {
  const ordered = [...items].sort((a, b) => a.item.startTime.localeCompare(b.item.startTime));
  const lanes: IndexedImportItem[][] = [];
  let currentLane: IndexedImportItem[] = [];
  let currentLaneEnd = -1;

  for (const entry of ordered) {
    const start = timeToMinutes(entry.item.startTime);
    const end = timeToMinutes(entry.item.endTime);
    if (start === null || end === null || end <= start) {
      currentLane.push(entry);
      continue;
    }

    if (currentLane.length > 0 && start >= currentLaneEnd) {
      lanes.push(currentLane);
      currentLane = [];
      currentLaneEnd = -1;
    }

    currentLane.push(entry);
    currentLaneEnd = Math.max(currentLaneEnd, end);
  }

  if (currentLane.length > 0) lanes.push(currentLane);
  return lanes;
}

async function importBatchWithSafeConcurrency(
  supabase: Parameters<typeof importScheduleRow>[0],
  items: CreateScheduleRequest[],
  actorUserId: string
): Promise<ImportResult[]> {
  const lanesByKey = new Map<string, IndexedImportItem[]>();
  items.forEach((item, index) => {
    const key = importLaneKey(item);
    const lane = lanesByKey.get(key) ?? [];
    lane.push({ index, item });
    lanesByKey.set(key, lane);
  });

  // Only overlapping slots must stay sequential. Consecutive hourly rows are
  // independent and can be sent to Supabase together.
  const lanes = [...lanesByKey.values()].flatMap(splitIntoConflictLanes);
  const results = new Array<ImportResult>(items.length);
  let nextLaneIndex = 0;

  const runWorker = async () => {
    while (nextLaneIndex < lanes.length) {
      const laneIndex = nextLaneIndex;
      nextLaneIndex += 1;
      const lane = lanes[laneIndex];
      for (const entry of lane) {
        results[entry.index] = await importScheduleRow(supabase, entry.item, actorUserId);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(IMPORT_LANE_CONCURRENCY, lanes.length) }, () => runWorker())
  );
  return results;
}

export async function POST(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) {
      return jsonError("Unauthorized", 401);
    }

    if (!profile) {
      return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    }

    if (!canManageSchedules(profile.role)) {
      return jsonError("Forbidden", 403);
    }

    const payload = (await req.json()) as CreateScheduleRequest | ImportBatchRequest;

    if (isImportBatchRequest(payload)) {
      if (payload.targetType === "학생" && payload.items.some((item) => !item.scheduleTagId?.trim())) {
        return jsonError("학생 시간표는 분류(태그)를 선택해야 저장할 수 있습니다.", 400);
      }
      await assertSourceInstructorsMatch(supabase, payload.items);
      const results = await importBatchWithSafeConcurrency(supabase, payload.items, user.id);
      if (results.some((result) => result.status === "created" || result.status === "enrolled" || result.status === "existing")) {
        try {
          await insertSaveHistory(supabase, payload.targetType, payload.targetName, payload.items[0]?.scheduleTagId ?? null);
        } catch (historyError) {
          console.error("[save-history] insert failed", historyError);
        }
      }
      return NextResponse.json({ results });
    }

    await assertSourceInstructorsMatch(supabase, [payload]);
    const result = await importScheduleRow(supabase, payload, user.id);

    if (result.status === "conflict") {
      return NextResponse.json(result, { status: 409 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (errorMessage(error) === INSTRUCTOR_DAY_OFF_MESSAGE) {
      return jsonError(INSTRUCTOR_DAY_OFF_MESSAGE, 400);
    }
    return jsonError(errorMessage(error), 500);
  }
}
