import { NextResponse } from "next/server";
import { z } from "zod";
import type { ApiError, PersonsApiSuccess } from "@/lib/types";
import { getDirectoryDatabaseMeta, listPersonsByType } from "@/lib/server/notionService";

const querySchema = z.object({
  type: z.enum(["student", "instructor", "staff"])
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

function getNotionErrorResponse(error: unknown, dbLabel: string, dbId: string) {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message;
  const normalized = message.toLowerCase();

  if (
    normalized.includes("api token is invalid") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalid_grant")
  ) {
    return errorResponse(
      401,
      "NOTION_AUTH_INVALID",
      `Notion API 토큰이 유효하지 않습니다. 현재 요청 대상: ${dbLabel} (${dbId}). 새 Internal Integration Secret으로 교체하고 Next.js 서버를 재시작해 주세요.`
    );
  }

  if (
    normalized.includes("restricted_resource") ||
    normalized.includes("object_not_found") ||
    normalized.includes("could not find database")
  ) {
    return errorResponse(
      403,
      "NOTION_RESOURCE_NOT_SHARED",
      `Notion 데이터베이스 접근 실패: ${dbLabel} (${dbId}). 현재 Integration과 연결되지 않았거나, DB ID가 잘못되었거나, 원본 DB가 아닐 수 있습니다.`
    );
  }

  if (
    normalized.includes("forbidden") ||
    normalized.includes("insufficient_permissions")
  ) {
    return errorResponse(
      403,
      "NOTION_FORBIDDEN",
      `Notion Integration 권한 부족: ${dbLabel} (${dbId}). 콘텐츠 읽기/업데이트/입력 권한과 DB 연결 상태를 확인해 주세요.`
    );
  }

  if (
    normalized.includes("속성을 찾지 못했습니다") ||
    normalized.includes("title 또는 rich_text 타입이어야")
  ) {
    return errorResponse(
      500,
      "NOTION_CONFIG_ERROR",
      message
    );
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      type: searchParams.get("type")
    });
    const persons = await listPersonsByType(query.type);

    return NextResponse.json<PersonsApiSuccess>({
      ok: true,
      persons
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstIssue = error.issues[0];
      return errorResponse(400, "INVALID_QUERY", firstIssue?.message ?? "쿼리 형식이 올바르지 않습니다.");
    }

    let dbLabel = "알 수 없는 DB";
    let dbId = "unknown";

    const type = new URL(request.url).searchParams.get("type");

    if (type === "student" || type === "instructor" || type === "staff") {
      const meta = getDirectoryDatabaseMeta(type);
      dbLabel = meta.label;
      dbId = meta.databaseId;
    }

    const notionError = getNotionErrorResponse(error, dbLabel, dbId);

    if (notionError) {
      return notionError;
    }

    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return errorResponse(500, "INTERNAL_ERROR", message);
  }
}
