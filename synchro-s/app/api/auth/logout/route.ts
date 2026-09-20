import { HUB_SESSION_COOKIE, hubCookieOptions } from '@/lib/server/hubSession';
import { getSessionCookieName } from "@/lib/server/sessionToken";
import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: getSessionCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
  response.cookies.set({name:HUB_SESSION_COOKIE,value:'',...hubCookieOptions(),maxAge:0});
  return response;
}
