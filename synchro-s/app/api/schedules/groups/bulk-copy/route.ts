import { createHash } from "node:crypto";

import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import {
  getBearerIdToken,
  isStudentActiveFromCanonicalRoster,
  loadFirebaseRoster,
  type FirebaseStudentRosterItem
} from "@/lib/server/firestoreRoster";
import { fetchAllSupabaseRows } from "@/lib/server/supabasePagination";
import { getStaffAttribution } from "@/lib/server/staffAttribution";
import {
  buildStudentTimetableBulkCopyPlan,
  shiftSnapshotEventsToWeek,
  type BulkCopyGroup
} from "@/lib/timetableGroupBulkCopy";
import { NextResponse } from "next/server";

type BulkCopyPayload = {
  mode: "preview" | "execute";
  sourceTagId: string;
  destinationTagId: string;
  destinationWeekStart: string;
  studentIds: string[];
  previewToken?: string;
};

type GroupRow = {
  id: string;
  target_id: string;
  tag_id: string | null;
  week_start: string;
  name: string;
  class_ids: string[] | null;
  snapshot_events: unknown[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isMonday(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCDay() === 1;
}

function planToken(input: {
  sourceTagId: string;
  destinationTagId: string;
  destinationWeekStart: string;
  studentIds: string[];
  candidateSources: BulkCopyGroup[];
  blockedStudentIds: string[];
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function mapGroup(row: GroupRow): BulkCopyGroup {
  return {
    id: row.id,
    targetId: row.target_id,
    tagId: row.tag_id,
    weekStart: row.week_start,
    name: row.name,
    classIds: Array.isArray(row.class_ids) ? row.class_ids : [],
    snapshotEvents: Array.isArray(row.snapshot_events) ? row.snapshot_events : [],
    isActive: row.is_active === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function POST(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();
    if (!user) return jsonError("Unauthorized", 401);
    if (!profile) return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    if (!canManageSchedules(profile.role)) return jsonError("Forbidden", 403);

    const payload = (await req.json()) as BulkCopyPayload;
    if (payload.mode !== "preview" && payload.mode !== "execute") return jsonError("mode must be preview or execute", 400);
    if (typeof payload.sourceTagId !== "string" || typeof payload.destinationTagId !== "string" || !payload.sourceTagId.trim() || !payload.destinationTagId.trim()) return jsonError("원본 태그와 대상 태그를 선택해 주세요.", 400);
    if (payload.sourceTagId === payload.destinationTagId) return jsonError("원본 태그와 대상 태그는 달라야 합니다.", 400);
    if (!isIsoDate(payload.destinationWeekStart) || !isMonday(payload.destinationWeekStart)) {
      return jsonError("대상 기준 주차는 월요일 날짜로 선택해 주세요.", 400);
    }
    if (!Array.isArray(payload.studentIds)) return jsonError("재원생 목록 형식이 올바르지 않습니다.", 400);
    const studentIds = Array.from(new Set(payload.studentIds.filter((id) => typeof id === "string" && id.trim()))).sort();
    if (studentIds.length === 0) return jsonError("복사할 재원생이 없습니다. 명단을 먼저 동기화해 주세요.", 400);
    if (studentIds.length > 2000) return jsonError("한 번에 처리할 수 있는 재원생은 2,000명까지입니다.", 400);

    const { data: tags, error: tagError } = await supabase
      .from("schedule_tags")
      .select("id,name,is_active")
      .in("id", [payload.sourceTagId, payload.destinationTagId]);
    if (tagError) throw tagError;
    const sourceTag = (tags ?? []).find((tag: { id: string }) => tag.id === payload.sourceTagId);
    const destinationTag = (tags ?? []).find((tag: { id: string }) => tag.id === payload.destinationTagId);
    if (!sourceTag || !destinationTag) return jsonError("선택한 시간표 태그를 찾지 못했습니다.", 404);
    if (destinationTag.is_active === false) return jsonError("보관된 태그에는 일괄 복사할 수 없습니다.", 400);

    const { data: studentRows, error: studentError } = await supabase
      .from("students")
      .select("id,student_name,is_active,firebase_student_id,firebase_uid")
      .in("id", studentIds);
    if (studentError) throw studentError;
    const firebaseRoster = await loadFirebaseRoster(getBearerIdToken(req));
    const firebaseStudentById = new Map<string, FirebaseStudentRosterItem>();
    const nameCounts = new Map<string, number>();
    const firebaseStudentByUniqueName = new Map<string, FirebaseStudentRosterItem>();
    for (const student of firebaseRoster.students) {
      const nameKey = student.name.replace(/\s+/g, "").toLowerCase();
      if (nameKey) {
        nameCounts.set(nameKey, (nameCounts.get(nameKey) ?? 0) + 1);
        if (!firebaseStudentByUniqueName.has(nameKey)) firebaseStudentByUniqueName.set(nameKey, student);
      }
      for (const id of [student.id, student.studentId, student.canonicalStudentId, student.supabaseStudentId, student.firebaseUid, ...(student.studentIdAliases ?? [])].filter(Boolean) as string[]) {
        firebaseStudentById.set(id, student);
      }
    }
    for (const [nameKey, count] of nameCounts) if (count > 1) firebaseStudentByUniqueName.delete(nameKey);
    const activeStudents = (studentRows ?? [])
      .filter((student: { id: string; student_name: string; is_active?: boolean | null; firebase_student_id?: string | null; firebase_uid?: string | null }) => {
        const firebaseStudent = firebaseStudentById.get(student.id) ??
          (student.firebase_student_id ? firebaseStudentById.get(student.firebase_student_id) : undefined) ??
          (student.firebase_uid ? firebaseStudentById.get(student.firebase_uid) : undefined) ??
          firebaseStudentByUniqueName.get(student.student_name.replace(/\s+/g, "").toLowerCase());
        return isStudentActiveFromCanonicalRoster(firebaseRoster.studentsAvailable, firebaseStudent, student.is_active ?? null);
      })
      .map((student: { id: string; student_name: string }) => ({ id: student.id, name: student.student_name }));

    const groupRows = activeStudents.length === 0 ? [] : await fetchAllSupabaseRows<GroupRow>((from, to) =>
      supabase
        .from("timetable_groups")
        .select("id,target_id,tag_id,week_start,name,class_ids,snapshot_events,is_active,created_at,updated_at")
        .eq("role_view", "student")
        .in("target_id", activeStudents.map((student) => student.id))
        .in("tag_id", [payload.sourceTagId, payload.destinationTagId])
        .range(from, to)
    );
    const plan = buildStudentTimetableBulkCopyPlan({
      students: activeStudents,
      groups: groupRows.map(mapGroup),
      sourceTagId: payload.sourceTagId,
      destinationTagId: payload.destinationTagId
    });
    const token = planToken({
      sourceTagId: payload.sourceTagId,
      destinationTagId: payload.destinationTagId,
      destinationWeekStart: payload.destinationWeekStart,
      studentIds,
      candidateSources: plan.candidates.map((item) => item.sourceGroup).sort((a, b) => a.id.localeCompare(b.id)),
      blockedStudentIds: [...plan.destinationExists, ...plan.containsOneOff].map((item) => item.id).sort()
    });
    const preview = {
      sourceTag: { id: sourceTag.id, name: sourceTag.name },
      destinationTag: { id: destinationTag.id, name: destinationTag.name },
      destinationWeekStart: payload.destinationWeekStart,
      requestedStudentCount: studentIds.length,
      activeStudentCount: activeStudents.length,
      copyCount: plan.candidates.length,
      totalClassCount: plan.candidates.reduce((sum, item) => sum + item.sourceGroup.classIds.length, 0),
      missingSource: plan.missingSource,
      destinationExists: plan.destinationExists,
      containsOneOff: plan.containsOneOff,
      excludedInactiveCount: studentIds.length - activeStudents.length,
      rosterSource: firebaseRoster.studentsAvailable ? "firebase" : "supabase",
      previewToken: token
    };

    if (payload.mode === "preview") return NextResponse.json({ preview });
    if (!payload.previewToken || payload.previewToken !== token) {
      return jsonError("미리보기 이후 시간표 상태가 변경되었습니다. 다시 미리보기해 주세요.", 409);
    }
    if (plan.candidates.length === 0) return jsonError("복사할 수 있는 학생 시간표가 없습니다.", 409);

    const actor = getStaffAttribution(user, profile);
    const now = new Date().toISOString();
    const rows = plan.candidates.map((candidate) => ({
      name: `${payload.destinationWeekStart} ${candidate.studentName} 시간표`,
      role_view: "student",
      target_id: candidate.studentId,
      week_start: payload.destinationWeekStart,
      tag_id: payload.destinationTagId,
      expires_on: null,
      class_ids: candidate.sourceGroup.classIds,
      snapshot_events: shiftSnapshotEventsToWeek(
        candidate.sourceGroup.snapshotEvents,
        candidate.sourceGroup.weekStart,
        payload.destinationWeekStart
      ),
      // Insert the whole batch as active in one statement. The database's
      // student+tag partial unique index makes concurrent retries fail as a
      // whole instead of leaving duplicate inactive copies behind.
      is_active: true,
      created_by_name: actor.name,
      created_by_uid: actor.uid,
      created_by_position: actor.position,
      created_by_icon_url: actor.iconUrl,
      updated_at: now
    }));

    const { data: createdRows, error: createError } = await supabase
      .from("timetable_groups")
      .insert(rows)
      .select("id,target_id");
    if (createError) throw createError;
    const created = (createdRows ?? []) as { id: string; target_id: string }[];
    if (created.length !== rows.length) {
      if (created.length > 0) await supabase.from("timetable_groups").delete().in("id", created.map((item) => item.id));
      throw new Error("일괄 복사 결과 수가 일치하지 않아 변경을 취소했습니다.");
    }

    try {
      const { error: activityError } = await supabase.from("timetable_group_activity_history").insert(
        created.flatMap((item) => (["created", "activated"] as const).map((action) => ({
          group_id: item.id,
          action,
          actor_uid: actor.uid,
          actor_name: actor.name,
          actor_position: actor.position,
          actor_icon_url: actor.iconUrl
        })))
      );
      if (activityError) throw activityError;
    } catch (mutationError) {
      await supabase.from("timetable_groups").delete().in("id", created.map((item) => item.id));
      throw mutationError;
    }

    return NextResponse.json({
      result: {
        ...preview,
        copiedCount: created.length
      }
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
