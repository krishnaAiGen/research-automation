import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runStatus } from "@/lib/runner";
import type { Campaign } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as
    | Campaign
    | undefined;
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sends = db
    .prepare(
      `SELECT s.id, s.email, s.subject, s.topic, s.status, s.error, s.created_at, s.body,
              s.queries, p.title
         FROM sends s LEFT JOIN papers p ON p.id = s.paper_id
        WHERE s.campaign_id = ? ORDER BY s.id DESC LIMIT 200`,
    )
    .all(id);

  return NextResponse.json({ campaign, sends, run: runStatus(id) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const campaign = db.prepare("SELECT status FROM campaigns WHERE id = ?").get(id) as
    | { status: string }
    | undefined;
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (campaign.status === "running") {
    return NextResponse.json({ error: "Stop the campaign before deleting it." }, { status: 400 });
  }
  // The sends stay — they are the record of who was emailed, and dropping them
  // would let those addresses be contacted a second time.
  db.prepare("UPDATE sends SET campaign_id = NULL WHERE campaign_id = ?").run(id);
  db.prepare("DELETE FROM campaigns WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
