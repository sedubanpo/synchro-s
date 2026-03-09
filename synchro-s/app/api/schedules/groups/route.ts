import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { fetchEventsForClassIdsInWeek } from "@/lib/server/scheduleService";
import { NextResponse } from "next/server";

type GroupMutationPayload =
  | {
      action: "activate";
      id: string;
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
    };

type GroupCreatePayload = {
  name: string;
  roleView: "student" | "instructor";
  targetId: string;
  weekStart: string;
  classIds: string[];
  snapshotEvents: unknown[];
  isActive?: boolean;
};

function isRoleView(value: string | null): value is "student" | "instructor" {
  return value === "student" || value === "instructor";
}

function nowIso() {
  return new Date().toISOString();
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

    const query = supabase
      .from("timetable_groups")
      .select("id,created_at,updated_at,role_view,target_id,week_start,name,class_ids,snapshot_events,is_active")
      .order("created_at", { ascending: false });

    if (canManageSchedules(profile.role)) {
      if (isRoleView(roleViewParam)) query.eq("role_view", roleViewParam);
      if (targetIdParam) query.eq("target_id", targetIdParam);
    } else if (profile.role === "instructor") {
      query.eq("role_view", "instructor");
      const ownInstructorId = (profile as { instructor_id?: string | null }).instructor_id ?? null;
      if (ownInstructorId) {
        query.eq("target_id", ownInstructorId);
      } else if (targetIdParam) {
        query.eq("target_id", targetIdParam);
      }
    } else if (profile.role === "student") {
      query.eq("role_view", "student");
      const ownStudentId = await findOwnStudentId(supabase, user.id);
      if (!ownStudentId) return NextResponse.json({ items: [] });
      query.eq("target_id", ownStudentId);
    } else {
      return jsonError("Forbidden", 403);
    }

    const { data, error } = await query;
    if (error) throw error;

    const items = await Promise.all(
      (data ?? []).map(async (row: any) => {
        const classIds = Array.isArray(row.class_ids) ? row.class_ids : [];
        const rawSnapshotEvents = Array.isArray(row.snapshot_events) ? row.snapshot_events : [];
        const snapshotEvents =
          rawSnapshotEvents.length > 0
            ? rawSnapshotEvents
            : classIds.length > 0
              ? await fetchEventsForClassIdsInWeek(supabase, { weekStart: row.week_start, classIds })
              : [];

        return {
          id: row.id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          roleView: row.role_view,
          targetId: row.target_id,
          weekStart: row.week_start,
          name: row.name,
          classIds,
          snapshotEvents,
          isActive: row.is_active === true
        };
      })
    );

    return NextResponse.json({ items });
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
    if (!isRoleView(payload.roleView)) return jsonError("roleView must be student or instructor", 400);
    if (!payload.targetId) return jsonError("targetId is required", 400);
    if (!payload.weekStart) return jsonError("weekStart is required", 400);

    const classIds = Array.from(new Set((payload.classIds ?? []).filter(Boolean)));
    const snapshotEvents = Array.isArray(payload.snapshotEvents) ? payload.snapshotEvents : [];
    const setActive = payload.isActive !== false;

    if (setActive) {
      const { error: deactivateError } = await supabase
        .from("timetable_groups")
        .update({ is_active: false, updated_at: nowIso() })
        .eq("role_view", payload.roleView)
        .eq("target_id", payload.targetId)
        .eq("is_active", true);
      if (deactivateError) throw deactivateError;
    }

    const { data, error } = await supabase
      .from("timetable_groups")
      .insert({
        name: payload.name.trim(),
        role_view: payload.roleView,
        target_id: payload.targetId,
        week_start: payload.weekStart,
        class_ids: classIds,
        snapshot_events: snapshotEvents,
        is_active: setActive,
        created_by_name: (profile as { full_name?: string | null }).full_name ?? null,
        updated_at: nowIso()
      })
      .select("id,created_at,updated_at,role_view,target_id,week_start,name,class_ids,snapshot_events,is_active")
      .single();

    if (error) throw error;

    return NextResponse.json({
      item: {
        id: data.id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        roleView: data.role_view,
        targetId: data.target_id,
        weekStart: data.week_start,
        name: data.name,
        classIds: Array.isArray(data.class_ids) ? data.class_ids : [],
        snapshotEvents: Array.isArray(data.snapshot_events) ? data.snapshot_events : [],
        isActive: data.is_active === true
      }
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
      const { data: scope, error: scopeError } = await supabase
        .from("timetable_groups")
        .select("role_view,target_id")
        .eq("id", payload.id)
        .maybeSingle();

      if (scopeError) throw scopeError;
      if (!scope) return jsonError("Group not found", 404);

      const { error: deactivateError } = await supabase
        .from("timetable_groups")
        .update({ is_active: false, updated_at: nowIso() })
        .eq("role_view", scope.role_view)
        .eq("target_id", scope.target_id)
        .eq("is_active", true);
      if (deactivateError) throw deactivateError;

      const { error: activateError } = await supabase
        .from("timetable_groups")
        .update({ is_active: true, updated_at: nowIso() })
        .eq("id", payload.id);
      if (activateError) throw activateError;

      return NextResponse.json({ ok: true });
    }

    if (payload.action === "rename") {
      const nextName = payload.name?.trim();
      if (!nextName) return jsonError("name is required", 400);
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
