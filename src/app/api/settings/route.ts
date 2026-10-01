import "@/lib/bootstrap";
import { NextResponse } from "next/server";
import {
  trackingEnabled,
  setTrackingEnabled,
  trackingBaseUrl,
  setTrackingBaseUrl,
  TRACKING_ENABLED_KEY,
  TRACKING_BASE_URL_KEY,
} from "@/lib/tracking";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    [TRACKING_ENABLED_KEY]: trackingEnabled(),
    [TRACKING_BASE_URL_KEY]: trackingBaseUrl(),
  });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.tracking_enabled !== undefined) setTrackingEnabled(Boolean(body.tracking_enabled));
  if (body.tracking_base_url !== undefined) {
    const url = String(body.tracking_base_url);
    if (url.trim() === "") {
      return NextResponse.json(
        { error: "Tracking base URL cannot be empty — set it to where this app is publicly reachable." },
        { status: 400 },
      );
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return NextResponse.json({ error: "Base URL must be http(s)." }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Base URL must be a valid URL." }, { status: 400 });
    }
    setTrackingBaseUrl(url);
  }
  return NextResponse.json({
    [TRACKING_ENABLED_KEY]: trackingEnabled(),
    [TRACKING_BASE_URL_KEY]: trackingBaseUrl(),
  });
}
