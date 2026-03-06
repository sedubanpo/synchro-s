import { NextResponse } from "next/server";
import { z } from "zod";
import type { ApiError, IncidentApiSuccess } from "@/lib/types";
import { createIncidentPage } from "@/lib/server/notionService";

const requestSchema = z.object({
  group: z.enum(["student", "instructor", "staff"]),
  personPageId: z.string().trim().min(1, "대상자를 선택해 주세요."),
  summary: z.string().trim().min(1, "특이사항 내용을 입력해 주세요."),
  targetDate: z.preprocess(
    (value) => {
      if (value === "" || value === undefined) {
        return null;
      }

      return value;
    },
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식은 YYYY-MM-DD 여야 합니다.")
      .nullable()
  )
});

function errorResponse(status: number, code: ApiError["code"], error: string) {
  return NextResponse.json<ApiError>(
    {
      ok: false,
      code,
      error
    },
    { status }
  );
}

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const created = await createIncidentPage(payload);

    return NextResponse.json<IncidentApiSuccess>({
      ok: true,
      personPageId: payload.personPageId,
      summary: payload.summary,
      targetDate: payload.targetDate,
      notionPageId: created.id,
      notionPageUrl: created.url ?? null
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstIssue = error.issues[0];
      return errorResponse(400, "INVALID_REQUEST", firstIssue?.message ?? "요청 형식이 올바르지 않습니다.");
    }

    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return errorResponse(500, "INTERNAL_ERROR", message);
  }
}
