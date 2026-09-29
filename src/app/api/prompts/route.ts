import { NextResponse } from "next/server";
import { DEFAULT_MODEL } from "@/lib/models";
import {
  db,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_USER_PROMPT,
  DEFAULT_TEMPLATE,
  CONFERENCE_FIELDS,
} from "@/lib/db";
import type { PromptConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const configs = db
    .prepare("SELECT * FROM prompt_configs ORDER BY is_active DESC, id DESC")
    .all() as PromptConfig[];
  return NextResponse.json({ configs });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();

  // `preset: "contact"` starts a configuration for a hand-built list. A
  // hand-built contact has name / email / notes rather than a paper, which is
  // exactly what the conference prompts consume — so it starts from the same
  // defaults and the URLs carry over so they need not be re-entered.
  const contact = body.preset === "contact";
  const base = {
    name: contact ? "Hand-built list (starter)" : "Untitled prompt",
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    user_prompt: DEFAULT_USER_PROMPT,
    template: DEFAULT_TEMPLATE,
  };

  const info = db
    .prepare(
      `INSERT INTO prompt_configs
        (name, is_active, model, reasoning, system_prompt, user_prompt,
         template, product_url, demo_url, conference_name, conference_website,
         conference_dates, conference_location, submission_deadline,
         notification_date, camera_ready_deadline, conference_topics,
         keynote_speakers, organizers, sender_name, sender_affiliation,
         sender_role, created_at, updated_at)
       VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      String(body.name || base.name),
      String(body.model || DEFAULT_MODEL),
      body.reasoning ? 1 : 0,
      String(contact ? base.system_prompt : (body.system_prompt ?? base.system_prompt)),
      String(contact ? base.user_prompt : (body.user_prompt ?? base.user_prompt)),
      String(contact ? base.template : (body.template ?? base.template)),
      String(body.product_url ?? ""),
      String(body.demo_url ?? ""),
      ...CONFERENCE_FIELDS.map((f) => String(body[f] ?? "")),
      now,
      now,
    );
  const config = db
    .prepare("SELECT * FROM prompt_configs WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as PromptConfig;
  return NextResponse.json({ config });
}
