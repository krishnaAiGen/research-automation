import "@/lib/bootstrap";
import { NextResponse } from "next/server";
import { db, defaultCollectionId } from "@/lib/db";
import { listSchedules, resetNextRun } from "@/lib/scheduler";
import { pendingCount } from "@/lib/runner";
import { collectionSummaries, getCollection } from "@/lib/collections";
import type { Schedule } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    schedules: listSchedules(),
    pending: pendingCount({ send_to_all: 0 }),
    collections: collectionSummaries(),
    upcoming: db
      .prepare(
        `SELECT c.id, c.name, c.status, c.target_count, c.sent, c.failed, c.created_at,
                s.name AS schedule_name
           FROM campaigns c JOIN schedules s ON s.id = c.schedule_id
          ORDER BY c.id DESC LIMIT 20`,
      )
      .all(),
  });
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));

  const collectionId = Number(b.collection_id) || defaultCollectionId();
  if (!getCollection(collectionId)) {
    return NextResponse.json({ error: "Collection not found." }, { status: 400 });
  }

  const info = db
    .prepare(
      `INSERT INTO schedules
        (name, prompt_config_id, collection_id, batch_size, total_cap, interval_minutes,
         days_of_week, window_start, window_end, send_delay_ms, dry_run, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      String(b.name || "New schedule"),
      b.prompt_config_id ? Number(b.prompt_config_id) : null,
      collectionId,
      Math.max(1, Number(b.batch_size) || 50),
      Math.max(0, Number(b.total_cap) || 0),
      Math.max(1, Number(b.interval_minutes) || 1440),
      JSON.stringify(Array.isArray(b.days_of_week) ? b.days_of_week.map(Number) : []),
      String(b.window_start || "09:00"),
      String(b.window_end || "18:00"),
      Math.max(0, Number(b.send_delay_ms ?? 3000)),
      0, // dry_run: removed as an option; every run sends for real
      b.enabled ? 1 : 0,
      new Date().toISOString(),
    );

  const id = Number(info.lastInsertRowid);
  if (b.enabled) resetNextRun(id);
  return NextResponse.json({
    schedule: db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as Schedule,
  });
}
