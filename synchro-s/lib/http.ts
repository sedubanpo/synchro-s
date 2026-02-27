import { NextResponse } from "next/server";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
      return maybeMessage;
    }
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Internal server error";
}
