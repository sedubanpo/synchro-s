import { NextResponse } from "next/server";
import type { ApiError, NotionDatabaseDebugSuccess } from "@/lib/types";
import {
  getAllDatabaseDebugTargets,
  inspectDatabaseAccess
} from "@/lib/server/notionService";

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
    const targets = getAllDatabaseDebugTargets();
    const databases = await Promise.all(targets.map((target) => inspectDatabaseAccess(target)));

    return NextResponse.json<NotionDatabaseDebugSuccess>({
      ok: true,
      databases
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return errorResponse(500, "INTERNAL_ERROR", message);
  }
}
