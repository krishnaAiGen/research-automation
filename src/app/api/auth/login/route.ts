import { NextResponse } from "next/server";
import {
  DISPLAY_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  authEnabled,
  createSession,
  credentialsMatch,
  isSecureRequest,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!authEnabled()) {
    return NextResponse.json(
      { error: "No login is configured on this server. Set AUTH_USERNAME and AUTH_PASSWORD." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));

  if (!credentialsMatch(body.username, body.password)) {
    // Slow every rejection down. Not a rate limiter, but it turns an online
    // guessing attack from thousands of attempts a second into a handful.
    await new Promise((r) => setTimeout(r, 500));
    return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
  }

  const now = Date.now();
  const token = await createSession(String(body.username), now);
  const secure = isSecureRequest(req);
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);

  const res = NextResponse.json({ ok: true, username: String(body.username) });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  });
  // For the header only. Not httpOnly on purpose, and trusted for nothing.
  res.cookies.set(DISPLAY_COOKIE, String(body.username), {
    httpOnly: false,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  });
  return res;
}
