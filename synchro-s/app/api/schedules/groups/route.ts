import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { fetchEventsForClassIdsInWeek } from "@/lib/server/scheduleService";
import { fetchAllSupabaseRows } from "@/lib/server/supabasePagination";
import { insertSaveHistory } from "@/lib/server/saveHistory";
import { getStaffAttribution, type StaffAttribution } from "@/lib/server/staffAttribution";
import { shiftSnapshotEventsToWeek } from "@/lib/timetableGroupBulkCopy";
import { selectEffectiveStudentTimetableGroup } from "@/lib/timetableGroupSelection";
import { NextResponse } from "next/server";

type GroupMutationPayload =
  | {
      action: "activate";
      id: string;
      isActive: boolean;
    }
  | {
      action: "rename";
      id: string;
      name: string;
    }
  | {
      action: "snapshot";
      id: string;
      classIds: string[];
      snapshotEvents: unknown[];
    }
  | {
      action: "expiration";
      id: string;
      expiresOn: string | null;
    }
  | {
      action: "tag";
      id: string;
      tagId: string | null;
    }
  | {
      action: "week";
      id: string;
      weekStart: string;
    };

type GroupCreatePayload = {
  name: string;
  roleView: "student" | "instructor";
  targetId: string;
  weekStart: string;
  expiresOn?: string | null;
  tagId?: string | null;
  classIds: string[];
  snapshotEvents: unknown[];
  isActive?: boolean;
  historySource?: "schedule_creation";
};

function isRoleView(value: string | null): value is "student" | "instructor" {
  return value === "student" || value === "instructor";
}

function nowIso() {
  return new Date().toISOString();
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? "");
  const code = (error as { code?: string } | null)?.code;
  return code === "42703" || message.includes(columnName);
}

function normalizeDateOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("expiresOn must be YYYY-MM-DD or null");
  }
  return value;
}

function isMonday(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCDay() === 1;
}

type GroupActivityRow = {
  id: string;
  group_id: string;
  created_at: string;
  action: "created" | "activated" | "deactivated";
  actor_uid?: string | null;
  actor_name?: string | null;
  actor_position?: string | null;
  actor_icon_url?: string | null;
};

function mapActivityRow(row: GroupActivityRow) {
  return {
    id: row.id,
    createdAt: row.created_at,
    action: row.action,
    actor: {
      uid: row.actor_uid ?? null,
      name: row.actor_name ?? null,
      position: row.actor_position ?? null,
      iconUrl: row.actor_icon_url ?? null
    }
  };
}

function mapGroupRow(row: any, snapshotEvents: unknown[], activity: GroupActivityRow[] = []) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    roleView: row.role_view,
    targetId: row.target_id,
    weekStart: row.week_start,
    expiresOn: row.expires_on ?? null,
    tagId: row.tag_id ?? null,
    name: row.name,
    classIds: Array.isArray(row.class_ids) ? row.class_ids : [],
    snapshotEvents,
    isActive: row.is_active === true,
    creator: {
      uid: row.created_by_uid ?? null,
      name: row.created_by_name ?? null,
      position: row.created_by_position ?? null,
      iconUrl: row.created_by_icon_url ?? null
    },
    activity: activity.map(mapActivityRow)
  };
}

function actorRpcPayload(actor: StaffAttribution) {
  return {
    p_actor_uid: actor.uid,
    p_actor_name: actor.name,
    p_actor_position: actor.position,
    p_actor_icon_url: actor.iconUrl
  };
}

function normalizePersonName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, "").trim().toLowerCase() : "";
}

function isSnapshotEventForInstructor(event: unknown, instructorId: string, instructorName: string): boolean {
  if (!event || typeof event !== "object") return false;
  const item = event as { instructorId?: unknown; instructorName?: unknown };
  if (typeof item.instructorId === "string" && item.instructorId === instructorId) return true;
  const eventInstructorName = normalizePersonName(item.instructorName);
  return Boolean(eventInstructorName && eventInstructorName === normalizePersonName(instructorName));
}

function scopeSnapshotEventToStudent(event: unknown, studentId: string): unknown | null {
  if (!event || typeof event !== "object") return null;
  const item = event as { studentIds?: unknown; studentNames?: unknown };
  const studentIds = Array.isArray(item.studentIds) ? item.studentIds : [];
  const studentIndex = studentIds.findIndex((value) => value === studentId);
  if (studentIndex < 0) return null;
  const studentNames = Array.isArray(item.studentNames) ? item.studentNames : [];
  return {
    ...event,
    studentIds: [studentId],
    studentNames: [typeof studentNames[studentIndex] === "string" ? studentNames[studentIndex] : studentId]
  };
}

async function resolveOwnInstructor(
  supabase: any,
  userId: string,
  profile: { instructor_id?: string | null; full_name?: string | null }
): Promise<{ id: string; name: string } | null> {
  const profileInstructorId = profile.instructor_id ?? null;
  if (profileInstructorId) {
    const { data, error } = await supabase
      .from("instructors")
      .select("id,instructor_name")
      .eq("id", profileInstructorId)
      .maybeSingle();
    if (error) throw error;
    if (data) return { id: data.id, name: data.instructor_name };
  }

  if (!userId.startsWith("sheet:")) {
    const { data, error } = await supabase
      .from("instructors")
      .select("id,instructor_name")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (data) return { id: data.id, name: data.instructor_name };
  }

  const profileName = profile.full_name?.trim();
  if (!profileName) return null;
  const { data, error } = await supabase
    .from("instructors")
    .select("id,instructor_name")
    .eq("instructor_name", profileName)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, name: data.instructor_name } : null;
}

async function findOwnStudentId(supabase: any, userId: string): Promise<string | null> {
  const { data, error } = await supabase.from("students").select("id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function GET(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) return jsonError("Unauthorized", 401);
    if (!profile) return jsonError("Authenticated but no app profile or role mapping in public.users", 403);

    const { searchParams } = new URL(req.url);
    const roleViewParam = searchParams.get("roleView");
    const targetIdParam = searchParams.get("targetId");
    const hasTagFilter = searchParams.has("tagId");
    const tagIdParam = searchParams.get("tagId")?.trim() || null;
    const activeOnly = searchParams.get("activeOnly") === "1" || searchParams.get("activeOnly") === "true";
    const effectiveWeekStart = normalizeDateOrNull(searchParams.get("effectiveWeekStart"));
    const includeSnapshots = searchParams.get("includeSnapshots") !== "0" && searchParams.get("includeSnapshots") !== "false";
    const profileStudentId = (profile as { student_id?: string | null }).student_id ?? null;
    const ownStudentId = profile.role === "student" ? profileStudentId || (await findOwnStudentId(supabase, user.id)) : null;
    const instructorStudentGroupRead = profile.role === "instructor" && roleViewParam === "student";
    const ownInstructor = profile.role === "instructor"
      ? await resolveOwnInstructor(supabase, user.id, profile as { instructor_id?: string | null; full_name?: string | null })
      : null;

    if (profile.role === "student" && !ownStudentId) {
      return NextResponse.json({ items: [] });
    }
    if (profile.role === "instructor" && !ownInstructor) {
      return jsonError("Instructor profile not found", 400);
    }

    const includeStandbyCandidates = activeOnly && Boolean(effectiveWeekStart);
    const createQuery = (includeExpiration: boolean, includeStandby: boolean) => {
      const query = supabase
        .from("timetable_groups")
        .select(
          includeExpiration
            ? "id,created_at,updated_at,role_view,target_id,week_start,expires_on,tag_id,name,class_ids,snapshot_events,is_active,created_by_uid,created_by_name,created_by_position,created_by_icon_url"
            : "id,created_at,updated_at,role_view,target_id,week_start,tag_id,name,class_ids,snapshot_events,is_active,created_by_uid,created_by_name,created_by_position,created_by_icon_url"
        )
        .order("created_at", { ascending: false });

      if (canManageSchedules(profile.role)) {
        if (isRoleView(roleViewParam)) query.eq("role_view", roleViewParam);
        if (targetIdParam) query.eq("target_id", targetIdParam);
      } else if (profile.role === "instructor") {
        if (instructorStudentGroupRead) {
          query.eq("role_view", "student");
        } else {
          query.eq("role_view", "instructor");
          query.eq("target_id", ownInstructor!.id);
        }
      } else if (profile.role === "student") {
        query.eq("role_view", "student");
        query.eq("target_id", ownStudentId);
      }

      if (activeOnly && !includeStandby) {
        query.eq("is_active", true);
      }
      if (hasTagFilter) {
        if (tagIdParam) query.eq("tag_id", tagIdParam);
        else query.is("tag_id", null);
      }
      return query;
    };

    if (!canManageSchedules(profile.role) && profile.role !== "instructor" && profile.role !== "student") {
      return jsonError("Forbidden", 403);
    }

    let supportsExpiration = true;
    let rows: any[];
    try {
      rows = await fetchAllSupabaseRows<any>((from, to) =>
        createQuery(true, includeStandbyCandidates).range(from, to)
      );
    } catch (error) {
      if (!isMissingColumnError(error, "expires_on")) throw error;
      supportsExpiration = false;
      rows = await fetchAllSupabaseRows<any>((from, to) =>
        createQuery(false, false).range(from, to)
      );
    }

    if (includeStandbyCandidates && supportsExpiration && effectiveWeekStart) {
      const rowsByScope = new Map<string, any[]>();
      for (const row of rows) {
        const key = `${row.target_id}:${row.tag_id ?? ""}`;
        const bucket = rowsByScope.get(key) ?? [];
        bucket.push(row);
        rowsByScope.set(key, bucket);
      }

      const standbyIds = new Set<string>();
      for (const bucket of rowsByScope.values()) {
        const selected = selectEffectiveStudentTimetableGroup(
          bucket.map((row) => ({
            id: row.id,
            roleView: row.role_view,
            targetId: row.target_id,
            weekStart: row.week_start,
            expiresOn: row.expires_on ?? null,
            tagId: row.tag_id ?? null,
            isActive: row.is_active === true,
            createdAt: row.created_at
          })),
          effectiveWeekStart,
          bucket[0]?.tag_id ?? null,
          effectiveWeekStart
        );
        if (selected && !selected.isActive) standbyIds.add(selected.id);
      }
      rows = rows.filter((row) => row.is_active === true || standbyIds.has(row.id));
    }
    const missingSnapshotClassIds = includeSnapshots && effectiveWeekStart
      ? Array.from(new Set(rows.flatMap((row: any) => {
          const snapshotEvents = Array.isArray(row.snapshot_events) ? row.snapshot_events : [];
          return snapshotEvents.length === 0 && Array.isArray(row.class_ids) ? row.class_ids : [];
        }).filter(Boolean)))
      : [];
    const hydratedEvents = missingSnapshotClassIds.length > 0 && effectiveWeekStart
      ? await fetchEventsForClassIdsInWeek(supabase, { weekStart: effectiveWeekStart, classIds: missingSnapshotClassIds })
      : [];

    const groupIds = rows.map((row) => row.id).filter(Boolean);
    const { data: activityRows, error: activityError } = groupIds.length > 0
      ? await supabase
          .from("timetable_group_activity_history")
          .select("id,group_id,created_at,action,actor_uid,actor_name,actor_position,actor_icon_url")
          .in("group_id", groupIds)
          .order("created_at", { ascending: false })
      : { data: [], error: null };
    if (activityError) throw activityError;
    const activityByGroupId = new Map<string, GroupActivityRow[]>();
    for (const activityRow of (activityRows ?? []) as GroupActivityRow[]) {
      const bucket = activityByGroupId.get(activityRow.group_id) ?? [];
      bucket.push(activityRow);
      activityByGroupId.set(activityRow.group_id, bucket);
    }

    const mappedItems = await Promise.all(
      rows.map(async (row: any) => {
        const classIds = Array.isArray(row.class_ids) ? row.class_ids : [];
        const rawSnapshotEvents = Array.isArray(row.snapshot_events) ? row.snapshot_events : [];
        let snapshotEvents = rawSnapshotEvents;
        if (includeSnapshots && rawSnapshotEvents.length === 0 && classIds.length > 0) {
          if (effectiveWeekStart) {
            const classIdSet = new Set(classIds);
            snapshotEvents = hydratedEvents.filter((event) => classIdSet.has(event.id));
          } else {
            snapshotEvents = await fetchEventsForClassIdsInWeek(supabase, { weekStart: row.week_start, classIds });
          }
        }

        return mapGroupRow(row, snapshotEvents, activityByGroupId.get(row.id) ?? []);
      })
    );

    const items = instructorStudentGroupRead
      ? mappedItems.flatMap((group) => {
          const snapshotEvents = group.snapshotEvents.flatMap((event) => {
            if (!isSnapshotEventForInstructor(event, ownInstructor!.id, ownInstructor!.name)) return [];
            const scopedEvent = scopeSnapshotEventToStudent(event, group.targetId);
            return scopedEvent ? [scopedEvent] : [];
          });
          if (snapshotEvents.length === 0) return [];
          return [{
            ...group,
            classIds: Array.from(new Set(snapshotEvents.flatMap((event: any) =>
              typeof event?.id === "string" && event.id ? [event.id] : []
            ))),
            snapshotEvents
          }];
        })
      : mappedItems;

    return NextResponse.json(
      { items, supportsExpiration },
      { headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" } }
    );
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) return jsonError("Unauthorized", 401);
    if (!profile) return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    if (!canManageSchedules(profile.role)) return jsonError("Forbidden", 403);

    const payload = (await req.json()) as GroupCreatePayload;
    if (!payload.name?.trim()) return jsonError("name is required", 400);
    if (payload.name.trim().length > 100) return jsonError("시간표 이름은 100자 이하로 입력해 주세요.", 400);
    if (!isRoleView(payload.roleView)) return jsonError("roleView must be student or instructor", 400);
    if (!payload.targetId) return jsonError("targetId is required", 400);
    if (!payload.weekStart) return jsonError("weekStart is required", 400);
    if (payload.roleView === "student" && !payload.tagId?.trim()) {
      return jsonError("학생 시간표는 분류(태그)가 필수입니다.", 400);
    }
    const expiresOn = normalizeDateOrNull(payload.expiresOn);

    const classIds = Array.from(new Set((payload.classIds ?? []).filter(Boolean)));
    const snapshotEvents = Array.isArray(payload.snapshotEvents) ? payload.snapshotEvents : [];
    const setActive = payload.isActive !== false;
    const actor = getStaffAttribution(user, profile);

    const insertPayload: Record<string, unknown> = {
      name: payload.name.trim(),
      role_view: payload.roleView,
      target_id: payload.targetId,
      week_start: payload.weekStart,
      tag_id: payload.tagId ?? null,
      expires_on: expiresOn,
      class_ids: classIds,
      snapshot_events: snapshotEvents,
      // Keep the previously active group intact until the new row is safely
      // inserted. Activation is applied atomically by the RPC below.
      is_active: false,
      created_by_name: (profile as { full_name?: string | null }).full_name ?? null,
      created_by_uid: actor.uid,
      created_by_position: actor.position,
      created_by_icon_url: actor.iconUrl,
      updated_at: nowIso()
    };

    let { data, error } = (await supabase
      .from("timetable_groups")
      .insert(insertPayload)
      .select("id,created_at,updated_at,role_view,target_id,week_start,expires_on,tag_id,name,class_ids,snapshot_events,is_active,created_by_uid,created_by_name,created_by_position,created_by_icon_url")
      .single()) as { data: any | null; error: any };

    if (error && isMissingColumnError(error, "expires_on")) {
      delete insertPayload.expires_on;
      const fallback = (await supabase
        .from("timetable_groups")
        .insert(insertPayload)
        .select("id,created_at,updated_at,role_view,target_id,week_start,tag_id,name,class_ids,snapshot_events,is_active,created_by_uid,created_by_name,created_by_position,created_by_icon_url")
        .single()) as { data: any | null; error: any };
      data = fallback.data;
      error = fallback.error;
    }

    if (error) throw error;
    if (!data) throw new Error("시간표 그룹 저장 결과를 찾지 못했습니다.");

    const createdActivity = {
      group_id: data.id,
      action: "created",
      actor_uid: actor.uid,
      actor_name: actor.name,
      actor_position: actor.position,
      actor_icon_url: actor.iconUrl
    };
    const { error: createdActivityError } = await supabase
      .from("timetable_group_activity_history")
      .insert(createdActivity);
    if (createdActivityError) {
      await supabase.from("timetable_groups").delete().eq("id", data.id);
      throw createdActivityError;
    }

    if (setActive) {
      const { data: activationState, error: activationError } = await supabase.rpc("set_timetable_group_active_with_actor", {
        p_group_id: data.id,
        p_is_active: true,
        ...actorRpcPayload(actor)
      });
      if (activationError) {
        await supabase.from("timetable_groups").delete().eq("id", data.id);
        throw activationError;
      }
      data.is_active = activationState === true;
    }

    if (payload.historySource === "schedule_creation" && payload.roleView === "student") {
      try {
        const { data: student } = await supabase
          .from("students")
          .select("student_name")
          .eq("id", payload.targetId)
          .maybeSingle();
        await insertSaveHistory(
          supabase,
          "학생",
          student?.student_name ?? payload.name.trim(),
          payload.tagId ?? null,
          "schedule_creation",
          actor
        );
      } catch (historyError) {
        console.error("[save-history] schedule creation insert failed", historyError);
      }
    }

    const { data: activity } = await supabase
      .from("timetable_group_activity_history")
      .select("id,group_id,created_at,action,actor_uid,actor_name,actor_position,actor_icon_url")
      .eq("group_id", data.id)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      item: mapGroupRow(data, Array.isArray(data.snapshot_events) ? data.snapshot_events : [], (activity ?? []) as GroupActivityRow[])
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) return jsonError("Unauthorized", 401);
    if (!profile) return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    if (!canManageSchedules(profile.role)) return jsonError("Forbidden", 403);

    const payload = (await req.json()) as GroupMutationPayload;
    if (!payload?.id) return jsonError("id is required", 400);

    if (payload.action === "activate") {
      if (typeof payload.isActive !== "boolean") return jsonError("isActive must be boolean", 400);
      const actor = getStaffAttribution(user, profile);
      const { data, error } = await supabase.rpc("set_timetable_group_active_with_actor", {
        p_group_id: payload.id,
        p_is_active: payload.isActive,
        ...actorRpcPayload(actor)
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, isActive: data === true });
    }

    if (payload.action === "rename") {
      const nextName = payload.name?.trim();
      if (!nextName) return jsonError("name is required", 400);
      if (nextName.length > 100) return jsonError("시간표 이름은 100자 이하로 입력해 주세요.", 400);
      const { error } = await supabase
        .from("timetable_groups")
        .update({ name: nextName, updated_at: nowIso() })
        .eq("id", payload.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (payload.action === "snapshot") {
      const classIds = Array.from(new Set((payload.classIds ?? []).filter(Boolean)));
      const snapshotEvents = Array.isArray(payload.snapshotEvents) ? payload.snapshotEvents : [];
      const { error } = await supabase
        .from("timetable_groups")
        .update({
          class_ids: classIds,
          snapshot_events: snapshotEvents,
          updated_at: nowIso()
        })
        .eq("id", payload.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (payload.action === "expiration") {
      const expiresOn = normalizeDateOrNull(payload.expiresOn);
      const { error } = await supabase
        .from("timetable_groups")
        .update({
          expires_on: expiresOn,
          updated_at: nowIso()
        })
        .eq("id", payload.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (payload.action === "tag") {
      const { data: group, error: groupError } = await supabase
        .from("timetable_groups")
        .select("id,role_view,target_id,week_start,is_active")
        .eq("id", payload.id)
        .single();
      if (groupError) throw groupError;
      if (group.role_view === "student" && !payload.tagId) {
        return jsonError("학생 시간표는 미분류로 변경할 수 없습니다.", 400);
      }

      const { error } = await supabase.rpc("set_timetable_group_tag", {
        p_group_id: payload.id,
        p_tag_id: payload.tagId ?? null
      });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (payload.action === "week") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.weekStart) || !isMonday(payload.weekStart)) {
        return jsonError("기준 주차는 월요일 날짜로 선택해 주세요.", 400);
      }
      const { data: group, error: groupError } = await supabase
        .from("timetable_groups")
        .select("id,week_start,expires_on,snapshot_events")
        .eq("id", payload.id)
        .single();
      if (groupError) throw groupError;
      if (group.expires_on && group.expires_on < payload.weekStart) {
        return jsonError("만료일보다 늦은 주차로 변경할 수 없습니다. 만료일을 먼저 수정해 주세요.", 400);
      }
      const snapshotEvents = shiftSnapshotEventsToWeek(
        Array.isArray(group.snapshot_events) ? group.snapshot_events : [],
        group.week_start,
        payload.weekStart
      );
      const { error } = await supabase
        .from("timetable_groups")
        .update({ week_start: payload.weekStart, snapshot_events: snapshotEvents, updated_at: nowIso() })
        .eq("id", payload.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return jsonError("Unsupported action", 400);
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) return jsonError("Unauthorized", 401);
    if (!profile) return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    if (!canManageSchedules(profile.role)) return jsonError("Forbidden", 403);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return jsonError("id is required", 400);

    const { error } = await supabase.from("timetable_groups").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
