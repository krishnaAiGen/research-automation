import "@/lib/bootstrap";
import { NextResponse } from "next/server";
import {
  overview,
  sendsByDay,
  byTrack,
  topDomains,
  recentSends,
  campaignSummaries,
} from "@/lib/stats";
import { runningCampaignIds } from "@/lib/runner";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 30);
  return NextResponse.json({
    overview: overview(),
    byDay: sendsByDay(Number.isFinite(days) && days > 0 ? Math.min(days, 180) : 30),
    byTrack: byTrack(),
    topDomains: topDomains(),
    recent: recentSends(15),
    campaigns: campaignSummaries(10),
    running: runningCampaignIds(),
  });
}
