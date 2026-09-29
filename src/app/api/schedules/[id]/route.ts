import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resetNextRun } from "@/lib/scheduler";
import type { Schedule } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const NUMERIC = ["batch_size", "total_cap", "interval_minutes", "send_delay_ms"] as const;
const TEXT = ["name", "window_start", "window_end"] as const;

export async function PATCH(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const b = await req.json().catch(() => ({}));
  const existing = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as
    | Schedule
    | undefined;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const k of TEXT) {
    if (b[k] !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(String(b[k]));
    }
  }
  for (const k of NUMERIC) {
    if (b[k] !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(Math.max(k === "total_cap" || k === "send_delay_ms" ? 0 : 1, Number(b[k]) || 0));
    }
  }
  if (b.days_of_week !== undefined) {
    sets.push("days_of_week = ?");
    vals.push(JSON.stringify(Array.isArray(b.days_of_week) ? b.days_of_week.map(Number) : []));
  }
  if (b.dry_run !== undefined) {
    sets.push("dry_run = ?");
    vals.push(b.dry_run ? 1 : 0);
  }
  if (b.prompt_config_id !== undefined) {
    sets.push("prompt_config_id = ?");
    vals.push(b.prompt_config_id ? Number(b.prompt_config_id) : null);
  }
  if (b.collection_id !== undefined && Number(b.collection_id)) {
    sets.push("collection_id = ?");
    vals.push(Number(b.collection_id));
  }
  if (b.enabled !== undefined) {
    sets.push("enabled = ?");
    vals.push(b.enabled ? 1 : 0);
  }
  if (b.reset_sent_total) {
    sets.push("sent_total = 0");
  }

  if (sets.length > 0) {
    db.prepare(`UPDATE schedules SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  }

  const enabledNow = b.enabled === undefined ? existing.enabled : b.enabled ? 1 : 0;
  if (enabledNow) {
    resetNextRun(id);
  } else {
    db.prepare("UPDATE schedules SET next_run_at = NULL WHERE id = ?").run(id);
  }

  return NextResponse.json({
    schedule: db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as Schedule,
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
