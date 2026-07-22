import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { NextResponse } from "next/server";

const COLOR_KEYS = new Set(["blue", "emerald", "amber", "rose", "violet", "slate"]);

function cleanName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 40) : "";
}

function mapRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    colorKey: row.color_key,
    sortOrder: row.sort_order,
    isActive: row.is_active === true,
    isCurrent: row.is_current === true,
    createdAt: row.created_at
  };
}

export async function GET() {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();
    if (!user) return jsonError("Unauthorized", 401);
    if (!profile) return jsonError("Authenticated but no app profile", 403);

    const { data, error } = await supabase
      .from("schedule_tags")
      .select("id,name,color_key,sort_order,is_active,is_current,created_at")
      .order("is_active", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ items: (data ?? []).map(mapRow) });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();
    if (!user) return jsonError("Unauthorized", 401);
    if (!profile || !canManageSchedules(profile.role)) return jsonError("Forbidden", 403);
    const payload = (await req.json()) as { name?: unknown; colorKey?: unknown };
    const name = cleanName(payload.name);
    if (!name) return jsonError("태그 이름을 입력해 주세요.", 400);
    const colorKey = typeof payload.colorKey === "string" && COLOR_KEYS.has(payload.colorKey) ? payload.colorKey : "blue";
    const { data, error } = await supabase
      .from("schedule_tags")
      .insert({ name, color_key: colorKey })
      .select("id,name,color_key,sort_order,is_active,is_current,created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ item: mapRow(data) });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();
    if (!user) return jsonError("Unauthorized", 401);
    if (!profile || !canManageSchedules(profile.role)) return jsonError("Forbidden", 403);
    const payload = (await req.json()) as { id?: string; name?: unknown; colorKey?: unknown; isActive?: unknown; isCurrent?: unknown };
    if (!payload.id) return jsonError("id is required", 400);
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (payload.name !== undefined) {
      const name = cleanName(payload.name);
      if (!name) return jsonError("태그 이름을 입력해 주세요.", 400);
      updates.name = name;
    }
    if (typeof payload.colorKey === "string" && COLOR_KEYS.has(payload.colorKey)) updates.color_key = payload.colorKey;
    if (payload.isActive === false) {
      const { data: currentTag, error: currentTagError } = await supabase
        .from("schedule_tags")
        .select("is_current")
        .eq("id", payload.id)
        .single();
      if (currentTagError) throw currentTagError;
      if (currentTag?.is_current === true) return jsonError("현재 분류는 보관할 수 없습니다. 다른 분류를 현재 분류로 먼저 설정해 주세요.", 400);
    }
    if (typeof payload.isActive === "boolean") updates.is_active = payload.isActive;
    if (payload.isCurrent === true) {
      const { error: currentError } = await supabase.rpc("set_current_schedule_tag", { p_tag_id: payload.id });
      if (currentError) throw currentError;
    }
    const { error } = await supabase.from("schedule_tags").update(updates).eq("id", payload.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
