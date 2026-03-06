import { NextResponse } from "next/server";
import type { ApiError, NotionEnvDebugSuccess } from "@/lib/types";
import { inspectServerEnv } from "@/lib/server/env";

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

export async function GET() {
  try {
    const inspected = inspectServerEnv("NOTION_API_KEY");
    const value = inspected.value;

    return NextResponse.json<NotionEnvDebugSuccess>({
      ok: true,
      notionApiKey: {
        exists: inspected.exists,
        normalized: inspected.normalized,
        prefix: value ? value.slice(0, Math.min(8, value.length)) : null,
        length: value.length
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return errorResponse(500, "INTERNAL_ERROR", message);
  }
}
