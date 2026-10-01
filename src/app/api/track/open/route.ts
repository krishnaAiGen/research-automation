import "@/lib/bootstrap";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PIXEL_GIF } from "@/lib/tracking";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Content-Type": "image/gif",
  "Content-Length": String(PIXEL_GIF.length),
  // Critical: without these, mail clients and proxies cache the pixel and only
  // the first open ever reaches the server.
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
  Expires: "0",
} as const;

/**
 * The tracking pixel. Every fetch logs one open event, attributed to the send
 * via `?id=<track_id>`. better-sqlite3 writes synchronously in well under a
 * millisecond — cheaper than the response itself — so the log happens inline
 * inside a try/catch: a failed write must never delay or break the image.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const trackId = params.get("id") ?? "";
  if (trackId) {
    try {
      db.prepare(
        `INSERT INTO email_events (track_id, event, position, user_agent, ip, created_at)
         VALUES (?, 'open', ?, ?, ?, ?)`,
      ).run(
        trackId,
        params.get("p") === "bottom" ? "bottom" : "top",
        req.headers.get("user-agent") ?? "",
        (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim(),
        new Date().toISOString(),
      );
    } catch {
      // Swallow silently — the pixel must come back regardless.
    }
  }
  return new NextResponse(PIXEL_GIF, { headers: NO_STORE });
}
