import { errorMessage, jsonError } from "@/lib/http";
import { getAuthenticatedProfile } from "@/lib/server/auth";
import { fetchRecentSaveHistory } from "@/lib/server/saveHistory";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) {
      return jsonError("Unauthorized", 401);
    }

    if (!profile) {
      return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    }

    const items = await fetchRecentSaveHistory(supabase, 20);
    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
