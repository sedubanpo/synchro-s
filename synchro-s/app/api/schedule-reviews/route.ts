import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

const REVIEW_NOTE_PREFIX = "__SCHEDULE_REVIEW__";

type ReviewStatus = "normal" | "needs_check" | "issue";

type ReviewPayload = {
  weekStart?: string;
  studentId?: string;
  tagId?: string | null;
  status?: ReviewStatus;
  memo?: string;
};

type ReviewNotePayload = {
  weekStart: string;
  tagId: string | null;
  studentName: string;
  status: ReviewStatus;
  memo: string;
  reviewedByName: string;
  reviewedAt: string;
};

function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === "normal" || value === "needs_check" || value === "issue";
}

function parseReviewNote(content: string): ReviewNotePayload | null {
  if (!content.startsWith(REVIEW_NOTE_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(content.slice(REVIEW_NOTE_PREFIX.length)) as ReviewNotePayload;
    if (!parsed.weekStart || !isReviewStatus(parsed.status)) {
      return null;
    }
    return {
      weekStart: parsed.weekStart,
      tagId: typeof parsed.tagId === "string" && parsed.tagId.trim() ? parsed.tagId.trim() : null,
      studentName: typeof parsed.studentName === "string" ? parsed.studentName : "",
      status: parsed.status,
      memo: typeof parsed.memo === "string" ? parsed.memo : "",
      reviewedByName: typeof parsed.reviewedByName === "string" ? parsed.reviewedByName : "",
      reviewedAt: typeof parsed.reviewedAt === "string" ? parsed.reviewedAt : ""
    };
  } catch {
    return null;
  }
}

function buildReviewNote(payload: ReviewNotePayload): string {
  return `${REVIEW_NOTE_PREFIX}${JSON.stringify(payload)}`;
}

export async function GET(req: Request) {
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

    // 검토 결과는 관리자 공용 운영 데이터입니다. 로그인 방식이나 브라우저 세션의
    // RLS 상태에 따라 빈 결과가 나오지 않도록 인증/권한 확인 뒤 서버 클라이언트로 읽습니다.
    const dataSupabase = createSupabaseAdminClient() ?? supabase;

    const { searchParams } = new URL(req.url);
    const weekStart = searchParams.get("weekStart")?.trim();
    const requestedTagId = searchParams.get("tagId")?.trim() || null;
    if (!weekStart) {
      return jsonError("weekStart is required", 400);
    }

    const { data, error } = await dataSupabase
      .from("special_notes")
      .select("id,created_at,target_type,target_id,content")
      .in("target_type", ["학생", "신규문의"])
      .like("content", `${REVIEW_NOTE_PREFIX}%`)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    type ReviewRow = { id: string; created_at: string; target_id: string; parsed: ReviewNotePayload };
    const exactByStudent = new Map<string, ReviewRow>();
    const taggedCarryForwardByStudent = new Map<string, ReviewRow>();
    const legacyByStudent = new Map<string, ReviewRow>();
    for (const row of (data ?? []) as { id: string; created_at: string; target_type: "학생" | "신규문의"; target_id: string; content: string }[]) {
      const targetId = row.target_type === "신규문의" ? `prospect:${row.target_id}` : row.target_id;
      const parsed = parseReviewNote(row.content);
      if (!parsed) continue;
      const reviewRow = { id: row.id, created_at: row.created_at, target_id: targetId, parsed };
      if (parsed.weekStart === weekStart && parsed.tagId === requestedTagId && !exactByStudent.has(targetId)) {
        exactByStudent.set(targetId, reviewRow);
      }
      if (
        requestedTagId &&
        parsed.tagId === requestedTagId &&
        parsed.weekStart <= weekStart &&
        !taggedCarryForwardByStudent.has(targetId)
      ) {
        taggedCarryForwardByStudent.set(targetId, reviewRow);
      }
      if (parsed.weekStart === weekStart && requestedTagId && parsed.tagId === null && !legacyByStudent.has(targetId)) {
        legacyByStudent.set(targetId, reviewRow);
      }
    }

    const latestByStudent = new Map(legacyByStudent);
    for (const [studentId, row] of taggedCarryForwardByStudent) latestByStudent.set(studentId, row);
    for (const [studentId, row] of exactByStudent) latestByStudent.set(studentId, row);

    const regularStudentIds = [...latestByStudent.values()]
      .map((row) => row.target_id)
      .filter((studentId) => !studentId.startsWith("prospect:"));
    const prospectIds = [...latestByStudent.values()]
      .map((row) => row.target_id)
      .filter((studentId) => studentId.startsWith("prospect:"))
      .map((studentId) => studentId.slice("prospect:".length));
    const [studentResult, prospectResult] = await Promise.all([
      regularStudentIds.length > 0
        ? dataSupabase.from("students").select("id,student_name").in("id", regularStudentIds)
        : Promise.resolve({ data: [], error: null }),
      prospectIds.length > 0
        ? dataSupabase.from("schedule_prospects").select("id,name").in("id", prospectIds)
        : Promise.resolve({ data: [], error: null })
    ]);
    if (studentResult.error) throw studentResult.error;
    if (prospectResult.error) throw prospectResult.error;

    const studentNameById = new Map(
      ((studentResult.data ?? []) as { id: string; student_name: string }[]).map((student) => [student.id, student.student_name])
    );
    const prospectNameById = new Map(
      ((prospectResult.data ?? []) as { id: string; name: string }[]).map((prospect) => [`prospect:${prospect.id}`, prospect.name])
    );

    console.info("[timetable-review-state] loaded", {
      weekStart,
      requestedTagId,
      itemCount: latestByStudent.size,
      carryForwardCount: [...latestByStudent.values()].filter((row) => row.parsed.weekStart !== weekStart).length
    });

    return NextResponse.json({
      items: [...latestByStudent.values()].map((row) => ({
        id: row.id,
        studentId: row.target_id,
        studentName: studentNameById.get(row.target_id) ?? prospectNameById.get(row.target_id) ?? row.parsed.studentName,
        weekStart,
        sourceWeekStart: row.parsed.weekStart,
        tagId: requestedTagId ?? row.parsed.tagId,
        isLegacyFallback: Boolean(requestedTagId && row.parsed.tagId === null),
        isCarryForward: Boolean(
          requestedTagId &&
          row.parsed.tagId === requestedTagId &&
          row.parsed.weekStart !== weekStart
        ),
        status: row.parsed.status,
        memo: row.parsed.memo,
        reviewedByName: row.parsed.reviewedByName,
        reviewedAt: row.parsed.reviewedAt || row.created_at
      }))
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function PATCH(req: Request) {
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

    // 저장 역시 인증된 관리자 요청만 허용하되, 실제 쓰기는 서버에서 일관되게
    // 수행해 다른 PC와 로그인 소스에서도 같은 결과를 보장합니다.
    const dataSupabase = createSupabaseAdminClient() ?? supabase;

    const payload = (await req.json()) as ReviewPayload;
    const weekStart = payload.weekStart?.trim();
    const studentId = payload.studentId?.trim();
    const tagId = payload.tagId?.trim() || null;
    const memo = payload.memo?.trim() ?? "";

    if (!weekStart || !studentId || !isReviewStatus(payload.status)) {
      return jsonError("weekStart, studentId and status are required", 400);
    }

    const isProspect = studentId.startsWith("prospect:");
    const targetId = isProspect ? studentId.slice("prospect:".length) : studentId;
    const targetType = isProspect ? "신규문의" : "학생";
    const nameResult = isProspect
      ? await dataSupabase.from("schedule_prospects").select("name").eq("id", targetId).maybeSingle()
      : await dataSupabase.from("students").select("student_name").eq("id", targetId).maybeSingle();
    if (nameResult.error) throw nameResult.error;
    const studentName = isProspect
      ? ((nameResult.data as { name?: string } | null)?.name ?? "")
      : ((nameResult.data as { student_name?: string } | null)?.student_name ?? "");

    const likePrefix = `${REVIEW_NOTE_PREFIX}${JSON.stringify({ weekStart }).slice(0, -1)}%`;
    const { data: existingRows, error: existingRowsError } = await dataSupabase
      .from("special_notes")
      .select("id,content")
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .like("content", likePrefix);
    if (existingRowsError) throw existingRowsError;

    const matchingIds = ((existingRows ?? []) as { id: string; content: string }[])
      .filter((row) => parseReviewNote(row.content)?.tagId === tagId)
      .map((row) => row.id);
    const reviewedAt = new Date().toISOString();
    const reviewedByName = (profile as { full_name?: string | null }).full_name ?? "";
    const content = buildReviewNote({
      weekStart,
      tagId,
      studentName,
      status: payload.status,
      memo,
      reviewedByName,
      reviewedAt
    });

    const { data, error } = await dataSupabase
      .from("special_notes")
      .insert({
        target_type: targetType,
        target_id: targetId,
        content
      })
      .select("id,created_at,target_id,content")
      .single();

    if (error || !data) {
      throw error ?? new Error("시간표 검토 저장에 실패했습니다.");
    }

    // 새 기록을 먼저 확정한 뒤 과거 중복만 정리합니다. 정리 실패가 방금 저장한 검토를 되돌리지는 않습니다.
    if (matchingIds.length > 0) {
      await dataSupabase.from("special_notes").delete().in("id", matchingIds);
    }

    return NextResponse.json({
      item: {
        id: data.id,
        studentId,
        studentName,
        weekStart,
        sourceWeekStart: weekStart,
        tagId,
        isLegacyFallback: false,
        isCarryForward: false,
        status: payload.status,
        memo,
        reviewedByName,
        reviewedAt
      }
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
