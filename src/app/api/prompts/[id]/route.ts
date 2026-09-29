import { NextResponse } from "next/server";
import { db, CONFERENCE_FIELDS } from "@/lib/db";
import type { PromptConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => ({}));
  const existing = db.prepare("SELECT * FROM prompt_configs WHERE id = ?").get(id) as
    | PromptConfig
    | undefined;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const conference = Object.fromEntries(
    CONFERENCE_FIELDS.map((f) => [f, body[f] ?? existing[f]]),
  ) as Record<(typeof CONFERENCE_FIELDS)[number], string>;

  const merged = {
    name: body.name ?? existing.name,
    model: body.model ?? existing.model,
    reasoning: body.reasoning === undefined ? existing.reasoning : body.reasoning ? 1 : 0,
    system_prompt: body.system_prompt ?? existing.system_prompt,
    user_prompt: body.user_prompt ?? existing.user_prompt,
    template: body.template ?? existing.template,
    product_url: body.product_url ?? existing.product_url,
    demo_url: body.demo_url ?? existing.demo_url,
    ...conference,
  };

  db.prepare(
    `UPDATE prompt_configs SET name=?, model=?, reasoning=?, system_prompt=?,
       user_prompt=?, template=?, product_url=?, demo_url=?,
       ${CONFERENCE_FIELDS.map((f) => `${f}=?`).join(", ")}, updated_at=? WHERE id=?`,
  ).run(
    merged.name,
    merged.model,
    merged.reasoning,
    merged.system_prompt,
    merged.user_prompt,
    merged.template,
    merged.product_url,
    merged.demo_url,
    ...CONFERENCE_FIELDS.map((f) => merged[f]),
    new Date().toISOString(),
    id,
  );

  if (body.is_active) {
    db.prepare("UPDATE prompt_configs SET is_active = 0").run();
    db.prepare("UPDATE prompt_configs SET is_active = 1 WHERE id = ?").run(id);
  }

  return NextResponse.json({
    config: db.prepare("SELECT * FROM prompt_configs WHERE id = ?").get(id),
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const total = db.prepare("SELECT COUNT(*) AS n FROM prompt_configs").get() as { n: number };
  if (total.n <= 1) {
    return NextResponse.json({ error: "Cannot delete the only prompt." }, { status: 400 });
  }
  const row = db.prepare("SELECT is_active FROM prompt_configs WHERE id = ?").get(id) as
    | { is_active: number }
    | undefined;
  db.prepare("DELETE FROM prompt_configs WHERE id = ?").run(id);
  if (row?.is_active) {
    db.prepare("UPDATE prompt_configs SET is_active = 1 WHERE id = (SELECT MIN(id) FROM prompt_configs)").run();
  }
  return NextResponse.json({ ok: true });
}
