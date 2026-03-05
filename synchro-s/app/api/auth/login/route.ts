import { errorMessage, jsonError } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildSessionToken, getSessionCookieName } from "@/lib/server/sessionToken";
import { verifyTeacherSheetCredential } from "@/lib/server/sheetAuth";
import { NextResponse } from "next/server";

type LoginPayload = {
  id?: string;
  password?: string;
};

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
    const { data: instructors, error } = await supabase
      .from("instructors")
      .select("id,instructor_name,is_active")
      .eq("is_active", true);

    if (error) throw error;

    const matched =
      (instructors ?? []).find(
        (item: { id: string; instructor_name: string }) =>
          normalizeTeacherName(item.instructor_name) === teacherNameToken
      ) ??
      (instructors ?? []).find((item: { id: string; instructor_name: string }) => {
        const token = normalizeTeacherName(item.instructor_name);
        return token.includes(teacherNameToken) || teacherNameToken.includes(token);
      });

    if (!matched?.id) {
      return jsonError("Teachers 시트 계정과 매칭되는 활성 강사 정보가 없습니다.", 403);
    }

    const token = buildSessionToken({
      fullName: matched.instructor_name,
      instructorId: matched.id
    });

    const response = NextResponse.json({
      ok: true,
      role: "instructor",
      name: matched.instructor_name
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
