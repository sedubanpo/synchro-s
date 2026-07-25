import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { insertSaveHistory } from "@/lib/server/saveHistory";
import type { ScheduleEvent, Weekday } from "@/types/schedule";
import { NextResponse } from "next/server";

type ProspectDraftItem = {
  instructorId?: string;
  instructorName?: string;
  subjectCode?: string;
  subjectName?: string;
  classTypeCode?: string;
  classTypeLabel?: string;
  badgeText?: string;
  weekday: Weekday;
  startTime: string;
  endTime: string;
  note?: string;
  isSelfStudy?: boolean;
};

type SavePayload = {
  action: "save";
  prospectId?: string;
  prospect: { name: string; school?: string; grade?: string; memo?: string };
  weekStart: string;
  groupName: string;
  items: ProspectDraftItem[];
  scheduleTagId?: string;
};

type ActivatePayload = { action: "activate"; groupId: string };

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || value === "24:00";
}

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00+09:00`);
  parsed.setDate(parsed.getDate() + days);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(parsed);
}

function validateItems(items: ProspectDraftItem[]): void {
  if (items.length === 0) throw new Error("가안 시간표에 수업을 한 개 이상 추가해 주세요.");
  for (const item of items) {
    if (!Number.isInteger(item.weekday) || item.weekday < 1 || item.weekday > 7) throw new Error("요일 값이 올바르지 않습니다.");
    if (!isTime(item.startTime) || !isTime(item.endTime) || item.startTime >= item.endTime) throw new Error("수업 시간이 올바르지 않습니다.");
    if (!item.isSelfStudy && (!item.instructorId || !item.subjectCode || !item.classTypeCode)) {
      throw new Error("강사, 과목, 수업 유형을 모두 선택해 주세요.");
    }
  }
}

function buildSnapshotEvents(items: ProspectDraftItem[], prospectId: string, prospectName: string, weekStart: string): ScheduleEvent[] {
  return items.map((item, index) => ({
    id: `prospect-draft:${prospectId}:${index}:${item.weekday}:${item.startTime}`,
    scheduleMode: "recurring",
    instructorId: item.instructorId ?? "",
    instructorName: item.instructorName ?? "",
    studentIds: [`prospect:${prospectId}`],
    studentNames: [`[가안] ${prospectName}`],
    subjectCode: item.isSelfStudy ? "SELF_STUDY" : item.subjectCode ?? "",
    subjectName: item.isSelfStudy ? "자기주도학습" : item.subjectName ?? item.subjectCode ?? "",
    classTypeCode: item.isSelfStudy ? "SELF_STUDY" : item.classTypeCode ?? "",
    classTypeLabel: item.isSelfStudy ? "자기주도학습" : item.classTypeLabel ?? item.classTypeCode ?? "",
    badgeText: item.isSelfStudy ? "[자습]" : item.badgeText ?? "",
    weekday: item.weekday,
    classDate: shiftDate(weekStart, item.weekday - 1),
    startTime: item.startTime,
    endTime: item.endTime,
    progressStatus: "planned",
    createdAt: new Date().toISOString(),
    note: item.note ?? ""
  }));
}

function mapGroup(row: any) {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    weekStart: row.week_start,
    name: row.name,
    snapshotEvents: Array.isArray(row.snapshot_events) ? row.snapshot_events : [],
    isActive: row.is_active === true,
    createdAt: row.created_at
  };
}

export async function GET(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();
    if (!user) return jsonError("Unauthorized", 401);
    if (!profile || !canManageSchedules(profile.role)) return jsonError("Forbidden", 403);

    const { searchParams } = new URL(req.url);
    const prospectId = searchParams.get("prospectId");
    const weekStart = searchParams.get("weekStart");

    let prospectQuery = supabase
      .from("schedule_prospects")
      .select("id,name,school,grade,memo,status,created_at,updated_at")
      .eq("status", "inquiry")
      .order("updated_at", { ascending: false });
    if (prospectId) prospectQuery = prospectQuery.eq("id", prospectId);
    const { data: prospects, error: prospectError } = await prospectQuery;
    if (prospectError) throw prospectError;

    let groupQuery = supabase
      .from("prospect_timetable_groups")
      .select("id,prospect_id,week_start,name,snapshot_events,is_active,created_at,updated_at")
      .order("created_at", { ascending: false });
    if (prospectId) groupQuery = groupQuery.eq("prospect_id", prospectId);
    if (weekStart) groupQuery = groupQuery.eq("week_start", weekStart);
    const { data: groups, error: groupError } = await groupQuery;
    if (groupError) throw groupError;

    return NextResponse.json({ prospects: prospects ?? [], groups: (groups ?? []).map(mapGroup) });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();
    if (!user) return jsonError("Unauthorized", 401);
    if (!profile || !canManageSchedules(profile.role)) return jsonError("Forbidden", 403);
    const payload = (await req.json()) as SavePayload;
    if (payload.action !== "save") return jsonError("Unsupported action", 400);
    const name = payload.prospect?.name?.trim();
    if (!name) return jsonError("신규문의 학생 이름을 입력해 주세요.", 400);
    if (!isDate(payload.weekStart)) return jsonError("weekStart must be YYYY-MM-DD", 400);
    if (!payload.groupName?.trim()) return jsonError("시간표 이름을 입력해 주세요.", 400);
    validateItems(payload.items ?? []);

    const prospectValues = {
      name,
      school: payload.prospect.school?.trim() || null,
      grade: payload.prospect.grade?.trim() || null,
      memo: payload.prospect.memo?.trim() || null,
      updated_at: new Date().toISOString()
    };

    let prospectId = payload.prospectId?.trim() ?? "";
    if (prospectId) {
      const { error } = await supabase.from("schedule_prospects").update(prospectValues).eq("id", prospectId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from("schedule_prospects")
        .insert({ ...prospectValues, created_by_name: (profile as { full_name?: string | null }).full_name ?? null })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("신규문의 대상을 저장하지 못했습니다.");
      prospectId = data.id;
    }

    const snapshotEvents = buildSnapshotEvents(payload.items, prospectId, name, payload.weekStart);
    const { data: group, error: groupError } = await supabase
      .from("prospect_timetable_groups")
      .insert({
        prospect_id: prospectId,
        week_start: payload.weekStart,
        name: payload.groupName.trim(),
        snapshot_events: snapshotEvents,
        is_active: false,
        created_by_name: (profile as { full_name?: string | null }).full_name ?? null
      })
      .select("id,prospect_id,week_start,name,snapshot_events,is_active,created_at,updated_at")
      .single();
    if (groupError || !group) throw groupError ?? new Error("가안 시간표 그룹을 저장하지 못했습니다.");

    const itemRows = payload.items.map((item) => ({
      group_id: group.id,
      prospect_id: prospectId,
      instructor_id: item.isSelfStudy ? null : item.instructorId,
      subject_code: item.isSelfStudy ? null : item.subjectCode,
      class_type_code: item.isSelfStudy ? null : item.classTypeCode,
      weekday: item.weekday,
      start_time: item.startTime,
      end_time: item.endTime,
      note: item.note?.trim() || null,
      is_self_study: item.isSelfStudy === true
    }));
    const { error: itemError } = await supabase.from("prospect_schedule_items").insert(itemRows);
    if (itemError) {
      await supabase.from("prospect_timetable_groups").delete().eq("id", group.id);
      throw itemError;
    }

    try {
      await insertSaveHistory(
        supabase,
        "학생",
        name,
        payload.scheduleTagId?.trim() || null,
        "schedule_creation"
      );
    } catch (historyError) {
      console.error("[save-history] prospect schedule creation insert failed", historyError);
    }

    return NextResponse.json({ prospectId, group: mapGroup(group) });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();
    if (!user) return jsonError("Unauthorized", 401);
    if (!profile || !canManageSchedules(profile.role)) return jsonError("Forbidden", 403);
    const payload = (await req.json()) as ActivatePayload;
    if (payload.action !== "activate" || !payload.groupId) return jsonError("groupId is required", 400);
    const { data, error } = await supabase.rpc("toggle_prospect_timetable_group", { p_group_id: payload.groupId });
    if (error) throw error;
    return NextResponse.json({ ok: true, isActive: data === true });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
