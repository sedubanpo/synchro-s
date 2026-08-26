import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveSynchroFirebaseIdentity } from "@/lib/server/firebaseAuth";
import { NextResponse } from "next/server";

const ALLOWED_ORIGINS = new Set([
  "https://sedubanpo.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://sedubanpo.github.io",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function withCors(req: Request, body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { ...corsHeaders(req), "Cache-Control": "private, no-store, max-age=0" }
  });
}

function getBearerToken(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

async function requirePortalManager(req: Request) {
  const token = getBearerToken(req);
  if (!token) throw new Error("UNAUTHORIZED");
  const identity = await resolveSynchroFirebaseIdentity(token);
  if (identity.role !== "admin" && identity.role !== "coordinator") throw new Error("FORBIDDEN");
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("Synchro-S Supabase 관리자 연결이 설정되지 않았습니다.");
  return { identity, supabase };
}

function mapGroup(row: any, tagNameById: Map<string, string>) {
  return {
    id: row.id,
    name: row.name,
    weekStart: row.week_start,
    expiresOn: row.expires_on ?? null,
    tagId: row.tag_id ?? null,
    tagName: row.tag_id ? tagNameById.get(row.tag_id) ?? "분류 없음" : "분류 없음",
    isActive: row.is_active === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    snapshotEvents: Array.isArray(row.snapshot_events) ? row.snapshot_events : []
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  try {
    const { supabase } = await requirePortalManager(req);
    const url = new URL(req.url);
    const directoryMode = url.searchParams.get("mode") === "directory";
    const firebaseStudentId = url.searchParams.get("firebaseStudentId")?.trim() ?? "";
    const studentName = url.searchParams.get("studentName")?.trim() ?? "";

    const { data: students, error: studentError } = await supabase
      .from("students")
      .select("id,student_name,is_active,firebase_student_id,firebase_match_key,firebase_sync_status")
      .eq("is_active", true)
      .order("student_name", { ascending: true });
    if (studentError) throw studentError;

    if (directoryMode) {
      const studentIds = (students ?? []).map((row: any) => row.id);
      const { data: groups, error: groupCountError } = studentIds.length
        ? await supabase.from("timetable_groups").select("target_id").eq("role_view", "student").in("target_id", studentIds)
        : { data: [], error: null };
      if (groupCountError) throw groupCountError;
      const groupCounts = new Map<string, number>();
      for (const group of groups ?? []) groupCounts.set(group.target_id, (groupCounts.get(group.target_id) ?? 0) + 1);
      return withCors(req, {
        students: (students ?? []).map((row: any) => ({
          id: row.id,
          name: row.student_name,
          firebaseStudentId: row.firebase_student_id ?? "",
          syncStatus: row.firebase_sync_status ?? "unmapped",
          groupCount: groupCounts.get(row.id) ?? 0
        }))
      });
    }

    const normalizedName = studentName.replace(/\s+/g, "").toLowerCase();
    const exactIdentity = (students ?? []).filter((row: any) => firebaseStudentId && row.firebase_student_id === firebaseStudentId);
    const nameCandidates = (students ?? []).filter((row: any) =>
      normalizedName && String(row.student_name ?? "").replace(/\s+/g, "").toLowerCase() === normalizedName
    );
    const matched = exactIdentity.length === 1 ? exactIdentity[0] : null;
    const candidates = (matched ? [matched] : nameCandidates).slice(0, 8).map((row: any) => ({
      id: row.id,
      name: row.student_name,
      firebaseStudentId: row.firebase_student_id ?? "",
      syncStatus: row.firebase_sync_status ?? "unmapped"
    }));

    if (!matched) {
      return withCors(req, {
        matchStatus: exactIdentity.length > 1 || nameCandidates.length > 1 ? "ambiguous" : "unmatched",
        student: null,
        candidates,
        groups: []
      });
    }

    const { data: groups, error: groupError } = await supabase
      .from("timetable_groups")
      .select("id,name,week_start,expires_on,tag_id,is_active,created_at,updated_at,snapshot_events")
      .eq("role_view", "student")
      .eq("target_id", matched.id)
      .order("created_at", { ascending: false });
    if (groupError) throw groupError;
    const tagIds = Array.from(new Set((groups ?? []).map((row: any) => row.tag_id).filter(Boolean)));
    const { data: tags, error: tagError } = tagIds.length
      ? await supabase.from("schedule_tags").select("id,name").in("id", tagIds)
      : { data: [], error: null };
    if (tagError) throw tagError;
    const tagNameById = new Map<string, string>((tags ?? []).map((tag: any) => [tag.id, tag.name]));

    return withCors(req, {
      matchStatus: "matched",
      student: { id: matched.id, name: matched.student_name, firebaseStudentId: matched.firebase_student_id },
      candidates,
      groups: (groups ?? []).map((row: any) => mapGroup(row, tagNameById))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "UNAUTHORIZED") return withCors(req, { error: "Firebase 로그인이 필요합니다." }, 401);
    if (message === "FORBIDDEN") return withCors(req, { error: "관리자 또는 실무자 계정만 조회할 수 있습니다." }, 403);
    return withCors(req, { error: message }, 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const { identity, supabase } = await requirePortalManager(req);
    const payload = (await req.json()) as { firebaseStudentId?: string; synchroStudentId?: string };
    const firebaseStudentId = payload.firebaseStudentId?.trim() ?? "";
    const synchroStudentId = payload.synchroStudentId?.trim() ?? "";
    if (!firebaseStudentId || !synchroStudentId) {
      return withCors(req, { error: "포털 학생 식별자와 Synchro-S 학생을 모두 선택해 주세요." }, 400);
    }

    const { data: conflict, error: conflictError } = await supabase
      .from("students")
      .select("id,student_name")
      .eq("firebase_student_id", firebaseStudentId)
      .neq("id", synchroStudentId)
      .maybeSingle();
    if (conflictError) throw conflictError;
    if (conflict) return withCors(req, { error: `이미 ${conflict.student_name} 학생과 연결된 식별자입니다.` }, 409);

    const { data: student, error } = await supabase
      .from("students")
      .update({
        firebase_student_id: firebaseStudentId,
        firebase_sync_status: "matched",
        firebase_synced_at: new Date().toISOString()
      })
      .eq("id", synchroStudentId)
      .select("id,student_name,firebase_student_id")
      .single();
    if (error) throw error;

    return withCors(req, {
      ok: true,
      student: { id: student.id, name: student.student_name, firebaseStudentId: student.firebase_student_id },
      matchedBy: identity.fullName
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "UNAUTHORIZED") return withCors(req, { error: "Firebase 로그인이 필요합니다." }, 401);
    if (message === "FORBIDDEN") return withCors(req, { error: "관리자 또는 실무자 계정만 연결할 수 있습니다." }, 403);
    return withCors(req, { error: message }, 500);
  }
}
