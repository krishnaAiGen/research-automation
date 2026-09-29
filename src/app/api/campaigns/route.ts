import "@/lib/bootstrap";
import { NextResponse } from "next/server";
import { db, defaultCollectionId } from "@/lib/db";
import { pendingCount, startCampaign, runningCampaignIds } from "@/lib/runner";
import { collectionSummaries, getCollection } from "@/lib/collections";
import { campaignSummaries, tracks } from "@/lib/stats";
import type { Campaign } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    campaigns: campaignSummaries(100),
    running: runningCampaignIds(),
    // Across every collection — the per-collection numbers a batch is sized
    // against come from `collections`.
    pending: pendingCount({ send_to_all: 0 }),
    pendingAllAddresses: pendingCount({ send_to_all: 1 }),
    collections: collectionSummaries(),
    tracks: tracks(),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const collectionId = Number(body.collection_id) || defaultCollectionId();
  if (!getCollection(collectionId)) {
    return NextResponse.json({ error: "Collection not found." }, { status: 400 });
  }

  const sendToAll = body.send_to_all ? 1 : 0;
  const trackFilter = String(body.track_filter ?? "");
  const available = pendingCount({
    send_to_all: sendToAll,
    track_filter: trackFilter,
    collection_id: collectionId,
  });
  const requested = Math.max(0, Number(body.target_count) || 0);
  const target = requested === 0 ? available : Math.min(requested, available);

  if (available === 0) {
    return NextResponse.json(
      { error: "No unsent addresses match this filter." },
      { status: 400 },
    );
  }

  const info = db
    .prepare(
      `INSERT INTO campaigns
        (name, prompt_config_id, schedule_id, collection_id, target_count, send_delay_ms,
         send_to_all, dry_run, test_recipient, track_filter, status, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    )
    .run(
      String(body.name || `Campaign ${new Date().toISOString().slice(0, 16).replace("T", " ")}`),
      body.prompt_config_id ? Number(body.prompt_config_id) : null,
      collectionId,
      target,
      Math.max(0, Number(body.send_delay_ms ?? 3000)),
      sendToAll,
      body.dry_run === false ? 0 : 1,
      String(body.test_recipient ?? "").trim(),
      trackFilter,
      new Date().toISOString(),
    );

  const id = Number(info.lastInsertRowid);
  let started: { ok: boolean; error?: string } = { ok: false };
  if (body.start) started = startCampaign(id);

  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as Campaign;
  return NextResponse.json({ campaign, started });
}
