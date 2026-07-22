import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { NextResponse } from "next/server";

const INTERNAL_REVIEW_NOTE_PREFIX = "__SCHEDULE_REVIEW__";
const TIMETABLE_GROUP_MEMO_PREFIX = "__TIMETABLE_GROUP_MEMO__";

type SpecialNoteTargetType = "학생" | "강사";

type CreateSpecialNoteRequest = {
  targetType?: SpecialNoteTargetType;
  targetId?: string;
  groupId?: string | null;
  content?: string;
};

function encodeTimetableGroupMemo(groupId: string, content: string): string {
  return `${TIMETABLE_GROUP_MEMO_PREFIX}${JSON.stringify({ groupId, content })}`;
}

function decodeTimetableGroupMemo(content: string): { groupId: string | null; content: string } {
  if (!content.startsWith(TIMETABLE_GROUP_MEMO_PREFIX)) return { groupId: null, content };
  try {
    const parsed = JSON.parse(content.slice(TIMETABLE_GROUP_MEMO_PREFIX.length)) as { groupId?: unknown; content?: unknown };
    return {
      groupId: typeof parsed.groupId === "string" && parsed.groupId.trim() ? parsed.groupId : null,
      content: typeof parsed.content === "string" ? parsed.content : ""
    };
  } catch {
    return { groupId: null, content };
  }
}

function isTargetType(value: string | null): value is SpecialNoteTargetType {
  return value === "학생" || value === "강사";
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

    const { searchParams } = new URL(req.url);
    const targetType = searchParams.get("targetType");
    const targetId = searchParams.get("targetId");

    if (!isTargetType(targetType) || !targetId) {
      return jsonError("targetType and targetId are required", 400);
    }

    if (!canManageSchedules(profile.role)) {
      if (profile.role !== "instructor") {
        return jsonError("Forbidden", 403);
      }
      const ownInstructorId = (profile as { instructor_id?: string | null }).instructor_id ?? null;
      if (targetType !== "강사" || !ownInstructorId || ownInstructorId !== targetId) {
        return jsonError("Forbidden", 403);
      }
    }

    const { data, error } = await supabase
      .from("special_notes")
      .select("id,created_at,target_type,target_id,content")
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      items: (data ?? [])
        .filter((item: { content: string }) => !item.content.startsWith(INTERNAL_REVIEW_NOTE_PREFIX))
        .map((item: { id: string; created_at: string; target_type: SpecialNoteTargetType; target_id: string; content: string }) => {
          const decoded = decodeTimetableGroupMemo(item.content);
          return {
            id: item.id,
            created_at: item.created_at,
            target_type: item.target_type,
            target_id: item.target_id,
            group_id: decoded.groupId,
            content: decoded.content
          };
        })
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
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

    const payload = (await req.json()) as CreateSpecialNoteRequest;
    const targetType = payload.targetType;
    const targetId = payload.targetId?.trim();
    const groupId = payload.groupId?.trim() || null;
    const content = payload.content?.trim();

    if (!targetType || (targetType !== "학생" && targetType !== "강사") || !targetId || !content) {
      return jsonError("targetType, targetId and content are required", 400);
    }

    if (targetType === "학생" && !groupId) {
      return jsonError("학생 시간표 메모에는 groupId가 필요합니다.", 400);
    }

    if (groupId) {
      const { data: group, error: groupError } = await supabase
        .from("timetable_groups")
        .select("id")
        .eq("id", groupId)
        .eq("target_id", targetId)
        .eq("role_view", targetType === "학생" ? "student" : "instructor")
        .maybeSingle();
      if (groupError) throw groupError;
      if (!group) return jsonError("메모를 연결할 시간표 그룹을 찾지 못했습니다.", 404);
    }

    const storedContent = groupId ? encodeTimetableGroupMemo(groupId, content) : content;

    const { data, error } = await supabase
      .from("special_notes")
      .insert({
        target_type: targetType,
        target_id: targetId,
        content: storedContent
      })
      .select("id,created_at,target_type,target_id,content")
      .single();

    if (error || !data) {
      throw error ?? new Error("특이사항 저장에 실패했습니다.");
    }

    return NextResponse.json(
      {
        item: {
          ...data,
          group_id: groupId,
          content
        }
      },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
