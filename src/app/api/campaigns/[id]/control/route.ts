import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { startCampaign, pauseCampaign, cancelCampaign, runStatus } from "@/lib/runner";
import type { Campaign } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };

  switch (action) {
    case "start":
    case "resume": {
      const res = startCampaign(id);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
      break;
    }
    case "pause":
      if (!pauseCampaign(id)) {
        return NextResponse.json({ error: "Campaign is not running." }, { status: 400 });
      }
      break;
    case "cancel":
      cancelCampaign(id);
      break;
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as Campaign;
  return NextResponse.json({ campaign, run: runStatus(id) });
}
