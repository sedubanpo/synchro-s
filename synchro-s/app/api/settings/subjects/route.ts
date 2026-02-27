import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { NextResponse } from "next/server";

type SubjectPayload = {
  code?: string;
  displayName?: string;
  tailwindBgClass?: string;
};

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

export async function GET() {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) return jsonError("Unauthorized", 401);
    if (!profile) return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    if (!canManageSchedules(profile.role)) return jsonError("Forbidden", 403);

    const { data, error } = await supabase
      .from("subjects")
      .select("code,display_name,tailwind_bg_class")
      .order("display_name", { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      subjects: (data ?? []).map((row: { code: string; display_name: string; tailwind_bg_class: string }) => ({
        code: row.code,
        displayName: row.display_name,
        tailwindBgClass: row.tailwind_bg_class
      }))
    });
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

    const body = (await req.json()) as SubjectPayload;
    const code = normalizeCode(body.code ?? "");
    const displayName = (body.displayName ?? "").trim();
    const tailwindBgClass = (body.tailwindBgClass ?? "").trim();

    if (!code || !displayName || !tailwindBgClass) {
      return jsonError("code/displayName/tailwindBgClass는 필수입니다.", 400);
    }

    const { error } = await supabase.from("subjects").upsert(
      {
        code,
        display_name: displayName,
        tailwind_bg_class: tailwindBgClass
      },
      { onConflict: "code" }
    );
    if (error) throw error;

    return NextResponse.json({ ok: true, code }, { status: 201 });
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

    const body = (await req.json()) as SubjectPayload;
    const code = normalizeCode(body.code ?? "");
    const displayName = (body.displayName ?? "").trim();
    const tailwindBgClass = (body.tailwindBgClass ?? "").trim();

    if (!code) return jsonError("code는 필수입니다.", 400);
    if (!displayName && !tailwindBgClass) return jsonError("수정할 항목이 없습니다.", 400);

    const updatePayload: { display_name?: string; tailwind_bg_class?: string } = {};
    if (displayName) updatePayload.display_name = displayName;
    if (tailwindBgClass) updatePayload.tailwind_bg_class = tailwindBgClass;

    const { error } = await supabase.from("subjects").update(updatePayload).eq("code", code);
    if (error) throw error;

    return NextResponse.json({ ok: true, code });
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

    const body = (await req.json().catch(() => ({}))) as SubjectPayload;
    const code = normalizeCode(body.code ?? "");
    if (!code) return jsonError("code는 필수입니다.", 400);

    const { error } = await supabase.from("subjects").delete().eq("code", code);
    if (error) throw error;

    return NextResponse.json({ ok: true, code });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}

