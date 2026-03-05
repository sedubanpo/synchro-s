import { errorMessage, jsonError } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildSessionToken, getSessionCookieName } from "@/lib/server/sessionToken";
import { verifyTeacherSheetCredential } from "@/lib/server/sheetAuth";
import { NextResponse } from "next/server";

type LoginPayload = {
  id?: string;
  password?: string;
};

const MANAGER_NAME_ALLOWLIST = new Set(["에스에듀", "안종성", "홍성우", "김용찬"]);

function normalizeTeacherName(value: string): string {
  return value.replace(/^\/+/, "").replace(/\s+/g, "").trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as LoginPayload;
    const loginId = payload.id?.trim() ?? "";
    const password = payload.password?.trim() ?? "";

    if (!loginId || !password) {
      return jsonError("아이디와 비밀번호를 입력해 주세요.", 400);
    }

    const verified = await verifyTeacherSheetCredential(loginId, password);
    if (!verified) {
      return jsonError("아이디 또는 비밀번호가 일치하지 않습니다.", 401);
    }

    const supabase = await createSupabaseServerClient();
    const teacherNameToken = normalizeTeacherName(verified.teacherName);
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id,role,full_name");
    if (usersError) throw usersError;

    const matchedUser =
      (users ?? []).find((item: { full_name: string }) => normalizeTeacherName(item.full_name ?? "") === teacherNameToken) ??
      (users ?? []).find((item: { full_name: string }) => {
        const token = normalizeTeacherName(item.full_name ?? "");
        return token.includes(teacherNameToken) || teacherNameToken.includes(token);
      });

    const userRole = (matchedUser?.role as "admin" | "coordinator" | "instructor" | "student" | undefined) ?? undefined;
    const sessionRole = userRole === "admin" || userRole === "coordinator" ? userRole : MANAGER_NAME_ALLOWLIST.has(verified.teacherName) ? "coordinator" : "instructor";

    const { data: instructors, error } = await supabase
      .from("instructors")
      .select("id,instructor_name,is_active");

    if (error) throw error;

    let matched =
      (instructors ?? []).find(
        (item: { id: string; instructor_name: string; is_active?: boolean | null }) =>
          item.is_active !== false && normalizeTeacherName(item.instructor_name) === teacherNameToken
      ) ??
      (instructors ?? []).find((item: { id: string; instructor_name: string; is_active?: boolean | null }) => {
        if (item.is_active === false) return false;
        const token = normalizeTeacherName(item.instructor_name);
        return token.includes(teacherNameToken) || teacherNameToken.includes(token);
      });

    if (!matched?.id && matchedUser?.id) {
      const { data: instructorByUser, error: instructorByUserError } = await supabase
        .from("instructors")
        .select("id,instructor_name,is_active")
        .eq("user_id", matchedUser.id)
        .maybeSingle();
      if (instructorByUserError) throw instructorByUserError;
      if (instructorByUser?.id && instructorByUser.is_active !== false) {
        matched = instructorByUser;
      }
    }

    if (sessionRole === "instructor" && !matched?.id) {
      return jsonError("Teachers 시트 계정과 매칭되는 활성 강사 정보가 없습니다.", 403);
    }

    const token = buildSessionToken({
      fullName: matched?.instructor_name ?? verified.teacherName,
      role: sessionRole,
      instructorId: matched?.id ?? null
    });

    const response = NextResponse.json({
      ok: true,
      role: sessionRole,
      name: matched?.instructor_name ?? verified.teacherName
    });

    response.cookies.set({
      name: getSessionCookieName(),
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12
    });

    return response;
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
