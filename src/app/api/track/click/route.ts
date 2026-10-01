import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Click tracking: links in the HTML part are rewritten to point here with the
 * original destination in `?url=`. A click is a definitive user action, so it
 * survives image-blocking and Apple privacy proxies — the reliable half of
 * engagement measurement. Same fire-and-forget discipline as the open route:
 * log inside try/catch, then redirect without waiting on anything else.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const trackId = params.get("id") ?? "";
  const destination = params.get("url") ?? "";

  // Only real http(s) URLs are redirected to — a malformed or non-web `url`
  // falls back to the tracker root rather than becoming an open redirect.
  let safe = "/";
  try {
    const parsed = new URL(destination);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") safe = destination;
  } catch {
    // keep the fallback
  }

  if (trackId && safe !== "/") {
    try {
      db.prepare(
        `INSERT INTO email_events (track_id, event, position, url, user_agent, ip, created_at)
         VALUES (?, 'click', '', ?, ?, ?, ?)`,
      ).run(
        trackId,
        destination,
        req.headers.get("user-agent") ?? "",
        (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim(),
        new Date().toISOString(),
      );
    } catch {
      // Log loss is acceptable; the redirect is not.
    }
  }

  return NextResponse.redirect(new URL(safe, req.url), 302);
}
