import { NextResponse } from "next/server";
import { DISPLAY_COOKIE, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // maxAge 0 rather than a delete, so the browser is told to drop it now.
  for (const name of [SESSION_COOKIE, DISPLAY_COOKIE]) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return res;
}
