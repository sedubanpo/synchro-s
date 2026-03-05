import { cookies } from "next/headers";
import { getSessionCookieName, verifySessionToken } from "@/lib/server/sessionToken";
import { NextResponse } from "next/server";

export async function GET() {
  const cookieStore = cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  const session = verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    role: session.role,
    fullName: session.fullName,
    instructorId: session.instructorId
  });
}
