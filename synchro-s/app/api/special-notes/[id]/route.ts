import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { NextResponse } from "next/server";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
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

    const noteId = params.id?.trim();
    if (!noteId) {
      return jsonError("Invalid note id", 400);
    }

    const { error } = await supabase.from("special_notes").delete().eq("id", noteId);
    if (error) {
      throw error;
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
