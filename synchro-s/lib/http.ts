import { NextResponse } from "next/server";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeUpstreamErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return trimmed;
  }

  const looksLikeHtml = trimmed.startsWith("<!DOCTYPE html>") || trimmed.startsWith("<html");
  const isGatewayError =
    /502/i.test(trimmed) && /(bad gateway|cloudflare|supabase\.co)/i.test(trimmed);

  if (looksLikeHtml && isGatewayError) {
    return "Supabase에서 일시적인 502 오류가 발생했습니다. 저장이 이미 일부 반영되었을 수 있으니 새로고침 후 다시 확인해 주세요.";
  }

  return trimmed;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return normalizeUpstreamErrorMessage(error.message);
  }

  if (typeof error === "object" && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
      return normalizeUpstreamErrorMessage(maybeMessage);
    }
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return normalizeUpstreamErrorMessage(error);
  }

  return "Internal server error";
}
